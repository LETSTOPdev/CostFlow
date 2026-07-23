import { createHash } from 'node:crypto';
import { ImportError } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { deriveRunTelemetry, serializeTelemetry } from '@costflow/telemetry';
import { buildPseudonymizationContext, decryptSecret } from './crypto';
import { connectorFor, GatewayError, type ConnectorRegistry } from './connectors';
import type { JobErrorClass, Store } from './store/contract';

/**
 * Analysis job execution (doc 09 P4.1 plan §3, generalized in doc 18 §4):
 * connector fetch (raw pages) → the provider's pure transform → runAnalysis
 * (report mode) → render → persist an append-only run with its artifacts.
 * The runner dispatches on workspace.provider through the registry and never
 * names a provider. The token is decrypted only inside this function;
 * failures are sanitized to a class + message. Retry is a NEW job, never
 * mutation of a finished one.
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
  if (!workspace || !tenant || !workspace.scopeKey || !workspace.assumptions) {
    await store.updateJob(tenantId, jobId, {
      status: 'failed',
      errorClass: 'unexpected',
      errorMessage: 'Workspace is not fully configured.',
      finishedAt: nowIso,
    });
    return;
  }

  await store.updateJob(tenantId, jobId, { status: 'running' });
  try {
    if (!workspace.statusMap) throw new Error('Workspace has no status mapping yet.');
    const connector = connectorFor(connectors, workspace.provider);
    const secret = decryptSecret(workspace.tokenCiphertext, credentialKey);
    const connection = connector.connectionFrom(workspace, secret);
    const payload = await connector.fetchAll(connection, workspace.scopeKey);

    const mapping = {
      id: `ws-${workspace.id}`,
      version: '1',
      statusMap: workspace.statusMap,
      ...(workspace.actorRoleMap ? { actorRoleMap: workspace.actorRoleMap } : {}),
    };
    const salt = decryptSecret(tenant.saltCiphertext, credentialKey);
    const pseudonymization = buildPseudonymizationContext(tenantId, salt);
    const runId = createHash('sha256')
      .update(JSON.stringify(payload))
      .update(JSON.stringify(mapping))
      .update(JSON.stringify(workspace.assumptions))
      .update(tenantId)
      .update(nowIso)
      .digest('hex')
      .slice(0, 16);

    const batch = connector.transform(payload, {
      batchId: `batch-${runId}`,
      statusMap: workspace.statusMap,
      actorRoleMap: workspace.actorRoleMap ?? undefined,
      mappingId: mapping.id,
      mappingVersion: mapping.version,
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
