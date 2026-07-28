import { createHash } from 'node:crypto';
import { ImportError, mergeBatches } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { deriveRunTelemetry, serializeTelemetry } from '@costflow/telemetry';
import { buildPseudonymizationContext, decryptSecret } from './crypto';
import { GatewayError, resolveSelection } from './connectors/types';
import type { ConnectorRegistry } from './connectors/registry';
import { hasSelection } from './scopes';
import type { EventRecorder } from './events';
import type { JobErrorClass, Store } from './store/contract';

/**
 * Analysis job execution (doc 09 P4.1 plan §3): fetch raw pages → pure
 * transform → runAnalysis (report mode) → render → persist an append-only
 * run with its artifacts (run.json, report.md, telemetry.jsonl). The token
 * is decrypted only inside this function; failures are sanitized to a class
 * + message. Retry is a NEW job, never mutation of a finished one.
 *
 * Provider dispatch happens HERE, once, through the connector registry
 * (ADR-0005): the workspace's provider id resolves to a connector whose
 * gateway fetches and whose buildBatch adapts the raw documents into the
 * canonical ImportBatch. Nothing downstream of the batch knows the provider.
 */

export interface JobDeps {
  readonly store: Store;
  readonly connectors: ConnectorRegistry;
  readonly credentialKey: Buffer;
  /** Injected for deterministic tests; production uses the wall clock. */
  readonly nowFn?: () => string;
  /**
   * Durable activity recorder (P4.5). Optional so existing callers and tests
   * construct JobDeps unchanged; jobs run detached from any request, so an
   * import outcome is only visible to the console if it is recorded here.
   */
  readonly record?: EventRecorder;
}

function classify(error: unknown): { errorClass: JobErrorClass; message: string } {
  if (error instanceof GatewayError) {
    return { errorClass: error.errorClass, message: error.message };
  }
  if (error instanceof ImportError) {
    return { errorClass: 'import-error', message: error.message };
  }
  return {
    errorClass: 'unexpected',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function executeJob(deps: JobDeps, tenantId: string, jobId: string): Promise<void> {
  const { store, connectors, credentialKey, record } = deps;
  const nowIso = (deps.nowFn ?? (() => new Date(Date.now()).toISOString()))();
  const job = await store.getJob(tenantId, jobId);
  if (!job) return;
  const workspace = await store.getWorkspace(tenantId, job.workspaceId);
  const tenant = await store.getTenant(tenantId);
  // A job runs detached from the request that started it, so there is no
  // session here: the event is attributed to the organization and the
  // workspace, with no actor. Claiming a user did it would be a guess.
  const context = { tenantId, userId: null, workspaceId: job.workspaceId };
  if (!workspace || !tenant || !hasSelection(workspace?.scopes ?? []) || !workspace.assumptions) {
    await store.updateJob(tenantId, jobId, {
      status: 'failed',
      errorClass: 'unexpected',
      errorMessage: 'Workspace is not fully configured.',
      finishedAt: nowIso,
    });
    return;
  }
  const connector = connectors.get(workspace.provider);
  if (!connector) {
    await store.updateJob(tenantId, jobId, {
      status: 'failed',
      errorClass: 'unexpected',
      errorMessage: `No connector is registered for provider "${workspace.provider}".`,
      finishedAt: nowIso,
    });
    return;
  }
  if (!workspace.statusMap) {
    await store.updateJob(tenantId, jobId, {
      status: 'failed',
      errorClass: 'unexpected',
      errorMessage: 'Workspace has no status mapping yet.',
      finishedAt: nowIso,
    });
    return;
  }

  await store.updateJob(tenantId, jobId, { status: 'running' });
  try {
    const secret = decryptSecret(workspace.tokenCiphertext, credentialKey);
    const credentials = { params: workspace.connectionParams, secret };

    // The selection may name containers, so what it covers is resolved FRESH on
    // every run rather than frozen when the customer picked. A Space that
    // gained a List since last time genuinely covers more work now, and the
    // artifact records that so the next comparison can refuse to call it a
    // trend.
    const catalogue = await connector.gateway.listScopes(credentials);
    const selectedIds = workspace.scopes.map((s) => s.id);
    const targets = resolveSelection(catalogue, selectedIds);
    if (targets.length === 0) {
      // Every selected scope has vanished, or the ones that remain are empty
      // containers. Analysing nothing and reporting zero friction would be the
      // most misleading possible outcome.
      throw new ImportError(
        'None of the selected scopes are visible to this connection any more. Open the scope step and choose again.',
      );
    }

    const salt = decryptSecret(tenant.saltCiphertext, credentialKey);
    const pseudonymization = buildPseudonymizationContext(tenantId, salt);
    const mappingId = `ws-${workspace.id}`;
    const mappingVersion = '1';

    // Fetch and transform PER ORIGIN, sequentially: a platform rate limit is
    // per token, so firing every scope at once is how a nine-List workspace
    // earns a 429 storm. A scope that fails fails the whole run and says which
    // one — a run that quietly covers eight of nine origins reports a total
    // that has silently shrunk.
    const raws: unknown[] = [];
    const perScopeBatches = [];
    for (const target of targets) {
      let raw;
      try {
        raw = await connector.gateway.fetchAll(credentials, target.id);
      } catch (error) {
        throw error instanceof GatewayError
          ? new GatewayError(
              error.errorClass,
              error.stage,
              `${error.message} (while reading "${target.name}")`,
              error.status,
            )
          : error;
      }
      raws.push(raw);
      perScopeBatches.push(
        connector.buildBatch({
          batchId: `batch-${target.id}`,
          raw,
          scope: { id: target.id, label: target.name },
          mappingId,
          mappingVersion,
          statusMap: workspace.statusMap,
          ...(workspace.actorRoleMap ? { actorRoleMap: workspace.actorRoleMap } : {}),
          importedAt: nowIso,
          pseudonymization,
        }),
      );
    }

    // The run id fingerprints everything the analysis consumed, coverage
    // included: two runs over the same data but a different set of origins are
    // different runs, and must not collide.
    const runId = createHash('sha256')
      .update(JSON.stringify(raws))
      .update(JSON.stringify(targets.map((t) => t.id)))
      .update(JSON.stringify({ mappingId, statusMap: workspace.statusMap }))
      .update(JSON.stringify(workspace.actorRoleMap ?? {}))
      .update(JSON.stringify(workspace.assumptions))
      .update(tenantId)
      .update(nowIso)
      .digest('hex')
      .slice(0, 16);

    const batch = mergeBatches({
      batches: perScopeBatches,
      batchId: `batch-${runId}`,
      importedAt: nowIso,
    });
    const analysisRun = runAnalysis({
      runId,
      now: nowIso,
      batch,
      assumptions: workspace.assumptions,
      mode: 'report',
    });
    const reportMd = renderMarkdown(buildReportModel(analysisRun));
    const telemetryJsonl = serializeTelemetry(deriveRunTelemetry(analysisRun));

    await store.createRun({
      id: runId,
      tenantId,
      workspaceId: workspace.id,
      createdAt: nowIso,
      runJson: JSON.stringify(analysisRun, null, 2) + '\n',
      reportMd,
      telemetryJsonl,
    });
    await store.updateJob(tenantId, jobId, {
      status: 'succeeded',
      runId,
      finishedAt: nowIso,
    });
    record?.('import.finished', context, { status: 'succeeded', provider: workspace.provider });
    if (workspace.onboarding !== 'ready') {
      await store.updateWorkspace(tenantId, workspace.id, { onboarding: 'ready' });
      // The moment a Monitoring Workspace becomes fully configured. Recorded
      // because it is a funnel step, and the funnel can only report how long
      // that step took if the transition itself carries a timestamp.
      record?.('workspace.ready', context, { provider: workspace.provider });
    }
  } catch (error) {
    const { errorClass, message } = classify(error);
    await store.updateJob(tenantId, jobId, {
      status: 'failed',
      errorClass,
      errorMessage: message,
      finishedAt: nowIso,
    });
    record?.('import.finished', context, { status: 'failed', errorClass });
  }
}
