import type { Connector } from './types';

/**
 * The connector registry (ADR-0005): static, explicit wiring — no plugins,
 * no reflection, no runtime loading (R-11). The composition root (main.ts)
 * builds each connector around its production HTTP gateway; tests build the
 * same registry around stub gateways. Everything downstream resolves
 * connectors ONLY through this interface, so adding a platform = adding one
 * connector module + one line in the composition root.
 */
export interface ConnectorRegistry {
  get(providerId: string): Connector | null;
  /** Stable order for the provider picker (registration order). */
  list(): readonly Connector[];
}

export function buildConnectorRegistry(connectors: readonly Connector[]): ConnectorRegistry {
  const byId = new Map(connectors.map((c) => [c.descriptor.id, c]));
  if (byId.size !== connectors.length) {
    throw new Error('Duplicate connector id in registry.');
  }
  return {
    get: (providerId) => byId.get(providerId) ?? null,
    list: () => connectors,
  };
}
