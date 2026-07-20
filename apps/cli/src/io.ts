import { readFileSync } from 'node:fs';
import type { z } from 'zod';

/** User-facing input errors: one line, no stack trace (R-08). */
export class CliError extends Error {}

export function readTextFile(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new CliError(`Cannot read ${label} at "${path}": ${(error as Error).message}`);
  }
}

export function readJsonFile<T>(
  path: string,
  label: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  const text = readTextFile(path, label);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CliError(`${label} at "${path}" is not valid JSON: ${(error as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new CliError(`Invalid ${label} at "${path}":\n${issues}`);
  }
  return result.data;
}
