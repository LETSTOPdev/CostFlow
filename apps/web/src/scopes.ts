import type { WorkspaceScope } from './store/contract';

/**
 * How a scope SELECTION is named across the product.
 *
 * One implementation, because a Monitoring Workspace that spans nine Lists is
 * described on the dashboard, in settings, in the admin console, in the job
 * failure message and in the run history — and a customer who sees it named
 * five different ways has to work out five times whether they are looking at
 * the same thing.
 *
 * Coverage — what a run actually fetched — is a different question with a
 * different answer, and lives on the run artifact. See `BatchScope`.
 */

/** Canonical stored order: by name, then id, so display is stable and sorted. */
export function sortSelection(scopes: readonly WorkspaceScope[]): WorkspaceScope[] {
  return [...scopes].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * One line naming the selection, or null when nothing is selected yet. Leads
 * with a real name rather than a count, because "Engineering and 2 more" tells
 * a reader which workspace they are looking at and "3 Lists" does not.
 */
export function describeSelection(scopes: readonly WorkspaceScope[]): string | null {
  const [first, ...rest] = sortSelection(scopes);
  if (!first) return null;
  return rest.length === 0 ? first.name : `${first.name} and ${rest.length} more`;
}

/** The selection in full, for a page with room to show it. */
export function selectionNames(scopes: readonly WorkspaceScope[]): string[] {
  return sortSelection(scopes).map((s) => s.name);
}

/**
 * True when the workspace has been scoped. An empty selection is the same
 * unconfigured state as a null one used to be, and every gate must read it that
 * way — including for a workspace whose onboarding state says otherwise because
 * it was written by an earlier build.
 */
export function hasSelection(scopes: readonly WorkspaceScope[]): boolean {
  return scopes.length > 0;
}
