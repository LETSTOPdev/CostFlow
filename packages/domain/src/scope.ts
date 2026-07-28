/**
 * What an import batch actually covered.
 *
 * A Monitoring Workspace analyses several origins at once — several ClickUp
 * Lists, several Jira projects, and whatever a future platform calls its
 * containers. That raises a question the single-scope model never had to
 * answer: when a number moves between two runs, did the work change, or did
 * the set of things being measured change?
 *
 * The distinction that answers it, and the reason this type exists:
 *
 *   SELECTION is what the customer asked to monitor. It can name a CONTAINER
 *   ("the Engineering Space"), it lives in workspace configuration, and it does
 *   not change when the platform does.
 *
 *   COVERAGE is what a particular run actually fetched, resolved from the
 *   selection at run time. Selecting a Space and later adding a List to it
 *   leaves the selection identical and the coverage wider.
 *
 * Coverage is what belongs on the immutable artifact, because it is the only
 * one of the two that states what the numbers were computed from. A run that
 * silently grew from four Lists to five is a run whose total went up without
 * the work changing, and `packages/comparison` refuses to draw a trend across
 * it precisely because coverage is recorded here.
 *
 * Deliberately absent: a scope KIND. "List", "Folder", "Space", "project" are
 * provider vocabulary, and the domain does not learn provider vocabulary (doc
 * 06 N4) — the same rule that keeps platform names out of the diagnostics
 * layer. The engine never needs to know whether an origin was a Space or a
 * List; it needs to know they were distinct, what they were called, and how
 * much each contributed. Kind lives in the connector layer, where it is used to
 * render a hierarchy the customer recognises.
 */
export interface BatchScope {
  /**
   * Provider-native identity of one fetchable origin. Opaque here: compared for
   * equality, never parsed.
   */
  readonly id: string;
  /**
   * How the customer sees this origin, as the connector labelled it. Customer
   * content — safe on the artifact and in the report, never in a log line.
   */
  readonly label: string;
  /** Items this origin contributed AFTER drops and cross-scope de-duplication. */
  readonly itemCount: number;
}

/**
 * Canonical order for a coverage set: by id, which is stable across runs
 * regardless of the order the connector happened to fetch in. Determinism is
 * the point — two runs over the same origins must produce byte-identical
 * coverage, or every comparison between them reports a change that did not
 * happen.
 */
export function sortScopes(scopes: readonly BatchScope[]): BatchScope[] {
  return [...scopes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
