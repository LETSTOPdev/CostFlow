import { createHash } from 'node:crypto';
import { transformJira, ImportError, type JiraMapping } from '@costflow/ingestion';
import { runAnalysis } from '@costflow/analysis';
import { buildReportModel, renderMarkdown } from '@costflow/reporting';
import { deriveRunTelemetry, serializeTelemetry } from '@costflow/telemetry';
import { buildPseudonymizationContext, decryptSecret } from './crypto';
import { GatewayError, type JiraGateway } from './jira-gateway';
import type { JobErrorClass, Store, WorkspaceRecord } from './store/contract';

/**
 * Analysis job execution (doc 09 P4.1 plan §3): fetch raw pages → pure
 * transform → runAnalysis (report mode) → render → persist an append-only
 * run with its artifacts (run.json, report.md, telemetry.jsonl). The token
 * is decrypted only inside this function; failures are sanitized to a class
 * + message. Retry is a NEW job, never mutation of a finished one.
 */

export interface JobDeps {
  readonly store: Store;
  readonly gateway: JiraGateway;
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

function workspaceMapping(workspace: WorkspaceRecord): JiraMapping {
  if (!workspace.statusMap) throw new Error('Workspace has no status mapping yet.');
  return {
    id: `ws-${workspace.id}`,
    version: '1',
    statusMap: workspace.statusMap,
    ...(workspace.actorRoleMap ? { actorRoleMap: workspace.actorRoleMap } : {}),
  };
}

export async function executeJob(deps: JobDeps, tenantId: string, jobId: string): Promise<void> {
  const { store, gateway, credentialKey } = deps;
  const nowIso = (deps.nowFn ?? (() => new Date(Date.now()).toISOString()))();
  const job = await store.getJob(tenantId, jobId);
  if (!job) return;
  const workspace = await store.getWorkspace(tenantId, job.workspaceId);
  const tenant = await store.getTenant(tenantId);
  if (!workspace || !tenant || !workspace.projectKey || !workspace.assumptions) {
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
    const token = decryptSecret(workspace.tokenCiphertext, credentialKey);
    const connection = { site: workspace.site, email: workspace.email, token };
    const { searchPages, supplementaryChangelogs } = await gateway.fetchAll(
      connection,
      workspace.projectKey,
    );

    const mapping = workspaceMapping(workspace);
    const salt = decryptSecret(tenant.saltCiphertext, credentialKey);
    const pseudonymization = buildPseudonymizationContext(tenantId, salt);
    const runId = createHash('sha256')
      .update(JSON.stringify(searchPages))
      .update(JSON.stringify(supplementaryChangelogs))
      .update(JSON.stringify(mapping))
      .update(JSON.stringify(workspace.assumptions))
      .update(tenantId)
      .update(nowIso)
      .digest('hex')
      .slice(0, 16);

    const batch = transformJira({
      batchId: `batch-${runId}`,
      searchPages,
      supplementaryChangelogs,
      mapping,
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
