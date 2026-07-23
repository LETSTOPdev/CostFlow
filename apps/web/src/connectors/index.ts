import type { ConnectorRegistry } from './contract';
import { clickupConnector } from './clickup';
import { jiraConnector } from './jira';

export {
  GatewayError,
  connectorFor,
  type Connection,
  type ConnectorRegistry,
  type CredentialField,
  type ScopeRef,
  type TransformArgs,
  type WebConnector,
} from './contract';
export { jiraConnector, type JiraFetchPayload } from './jira';
export { clickupConnector, type ClickUpFetchPayload } from './clickup';

/**
 * The production registry (doc 18 §4.1) — static data, R-11 discipline: no
 * plugins, no reflection. monday/asana transforms exist in the engine (P2);
 * wiring them here is a bounded add per the doc 18 §7 effort map.
 */
export function buildConnectors(
  fetchFn: typeof fetch = fetch,
  sleepFn?: (ms: number) => Promise<void>,
): ConnectorRegistry {
  return {
    jira: jiraConnector(fetchFn),
    clickup: clickupConnector(fetchFn, sleepFn),
  };
}
