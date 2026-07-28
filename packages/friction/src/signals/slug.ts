export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Grouping key for one (origin, stage) pair. A NUL separator cannot occur in a
 * provider id or a status name, so no pair of distinct inputs can collide into
 * one key — which would silently merge two teams' queues.
 */
export const locationKey = (originScopeId: string | null, stageName: string): string =>
  `${originScopeId ?? ''}\u0000${stageName}`;

/**
 * Deterministic instance id. The origin is omitted when null so that every
 * import without scope structure keeps the ids it already had.
 */
export const locationId = (
  signalId: string,
  originScopeId: string | null,
  stageName: string,
): string =>
  originScopeId === null
    ? `${signalId}:${slugify(stageName)}`
    : `${signalId}:${slugify(originScopeId)}:${slugify(stageName)}`;
