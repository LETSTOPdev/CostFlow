import { createHash } from 'node:crypto';
import { ImportError } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { deriveRunTelemetry, serializeTelemetry } from '@costflow/telemetry';
import { buildPseudonymizationContext, decryptSecret } from './crypto';
import { GatewayError } from './connectors/types';
import type { ConnectorRegistry } from './connectors/registry';
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
  const { store, connectors, credentialKey } = deps;
  const nowIso = (deps.nowFn ?? (() => new Date(Date.now()).toISOString()))();
  const job = await store.getJob(tenantId, jobId);
  if (!job) return;
  const workspace = await store.getWorkspace(tenantId, job.workspaceId);
  const tenant = await store.getTenant(tenantId);
  if (!workspace || !tenant || !workspace.scopeId || !workspace.assumptions) {
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
    const raw = await connector.gateway.fetchAll(
      { params: workspace.connectionParams, secret },
      workspace.scopeId,
    );

    const salt = decryptSecret(tenant.saltCiphertext, credentialKey);
    const pseudonymization = buildPseudonymizationContext(tenantId, salt);
    const mappingId = `ws-${workspace.id}`;
    const mappingVersion = '1';
    const runId = createHash('sha256')
      .update(JSON.stringify(raw))
      .update(JSON.stringify({ mappingId, statusMap: workspace.statusMap }))
      .update(JSON.stringify(workspace.actorRoleMap ?? {}))
      .update(JSON.stringify(workspace.assumptions))
      .update(tenantId)
      .update(nowIso)
      .digest('hex')
      .slice(0, 16);

    const batch = connector.buildBatch({
      batchId: `batch-${runId}`,
      raw,
      mappingId,
      mappingVersion,
      statusMap: workspace.statusMap,
      ...(workspace.actorRoleMap ? { actorRoleMap: workspace.actorRoleMap } : {}),
      importedAt: nowIso,
      pseudonymization,
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
    if (workspace.onboarding !== 'ready') {
      await store.updateWorkspace(tenantId, workspace.id, { onboarding: 'ready' });
    }
  } catch (error) {
    const { errorClass, message } = classify(error);
    await store.updateJob(tenantId, jobId, {
      status: 'failed',
      errorClass,
      errorMessage: message,
      finishedAt: nowIso,
    });
  }
}
