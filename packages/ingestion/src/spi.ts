/**
 * Provider SPI v2 (doc 15 P1) — the permanent integration contract.
 *
 * A provider is two halves with a hard purity boundary between them:
 *  - FETCH (effectful, lives in apps/*): talks to the provider's API, writes
 *    raw response documents to disk verbatim. Never transforms.
 *  - TRANSFORM (pure, lives here): raw document strings + mapping +
 *    pseudonymization context → canonical ImportBatch. Never does I/O.
 *
 * Descriptors are static data — no plugins, no reflection, no runtime
 * loading (R-11 discipline applies to providers exactly as to cost models).
 */
export interface ProviderDescriptor {
  readonly id: string;
  readonly name: string;
  /** What the effectful edge must collect to fetch. */
  readonly auth:
    | { readonly kind: 'none' }
    | {
        readonly kind: 'token';
        /** Names of required inputs (values never appear in configs or argv). */
        readonly inputs: readonly string[];
      };
  /** What this provider CAN deliver — actual delivery is per-batch (capability profile). */
  readonly deliverable: {
    readonly items: true;
    readonly eventHistory: boolean;
    readonly dueDates: boolean;
    readonly actors: boolean;
  };
}

export const CSV_DESCRIPTOR: ProviderDescriptor = {
  id: 'csv',
  name: 'CSV export',
  auth: { kind: 'none' },
  deliverable: { items: true, eventHistory: true, dueDates: true, actors: true },
};

export const JIRA_DESCRIPTOR: ProviderDescriptor = {
  id: 'jira',
  name: 'Jira Cloud',
  auth: { kind: 'token', inputs: ['site', 'email', 'token-file'] },
  deliverable: { items: true, eventHistory: true, dueDates: true, actors: true },
};

export const MONDAY_DESCRIPTOR: ProviderDescriptor = {
  id: 'monday',
  name: 'monday.com',
  auth: { kind: 'token', inputs: ['token-file'] },
  deliverable: { items: true, eventHistory: true, dueDates: true, actors: true },
};

export const ASANA_DESCRIPTOR: ProviderDescriptor = {
  id: 'asana',
  name: 'Asana',
  auth: { kind: 'token', inputs: ['token-file'] },
  deliverable: { items: true, eventHistory: true, dueDates: true, actors: true },
};

export const CLICKUP_DESCRIPTOR: ProviderDescriptor = {
  id: 'clickup',
  name: 'ClickUp',
  auth: { kind: 'token', inputs: ['token-file'] },
  deliverable: { items: true, eventHistory: true, dueDates: true, actors: true },
};

export const PROVIDER_DESCRIPTORS: Readonly<Record<string, ProviderDescriptor>> = {
  [CSV_DESCRIPTOR.id]: CSV_DESCRIPTOR,
  [JIRA_DESCRIPTOR.id]: JIRA_DESCRIPTOR,
  [MONDAY_DESCRIPTOR.id]: MONDAY_DESCRIPTOR,
  [ASANA_DESCRIPTOR.id]: ASANA_DESCRIPTOR,
  [CLICKUP_DESCRIPTOR.id]: CLICKUP_DESCRIPTOR,
};
