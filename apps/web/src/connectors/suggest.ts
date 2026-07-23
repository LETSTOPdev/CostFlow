import type { StageKind } from '@costflow/domain';

/**
 * Name-based stage suggestion for common status names, shared by every
 * connector. Purely a FORM DEFAULT: nothing is stored until the user reviews
 * and submits, so the "you approved every mapping" invariant is untouched —
 * this only turns N dropdown selections into a review pass for typical
 * boards. Connector-specific metadata hints (ObservedWorkspace.statusHints)
 * take precedence over this generic guess where present.
 */
export const guessStageKind = (status: string): StageKind | null => {
  const s = status.toLowerCase();
  if (/(done|closed|complete|resolved|released|shipped|deployed|live)/.test(s)) return 'done';
  if (/(cancel|abandon|won'?t|rejected|discard|invalid|obsolete)/.test(s)) return 'abandoned';
  if (/(block|on hold|hold|stuck|imped|paused|waiting)/.test(s)) return 'blocked';
  if (/(review|approv|qa|test|verif|validat)/.test(s)) return 'review';
  if (/(progress|develop|doing|active|implement|build|working|started)/.test(s)) return 'active';
  if (/(backlog|to ?do|open|new|triage|queue|ready|selected|refin|planned)/.test(s)) return 'queue';
  return null;
};
