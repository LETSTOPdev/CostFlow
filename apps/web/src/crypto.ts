import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { PseudonymizationContext } from '@costflow/domain';

/**
 * Effectful-edge crypto for the self-serve spine (doc 09 P4.1 plan §2).
 * Secrets (provider tokens, tenant salts) are encrypted at rest with
 * AES-256-GCM; plaintext exists only inside connection validation and job
 * execution. Nothing here ever logs or returns key material.
 */

export function requireKey(value: string | undefined, name: string): Buffer {
  if (!value) {
    throw new Error(`${name} is required (32-byte base64 key) — refusing to start without it.`);
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes.`);
  }
  return key;
}

/** payload = base64(iv[12] ‖ authTag[16] ‖ ciphertext) */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptSecret(payload: string, key: Buffer): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function newId(): string {
  return randomUUID();
}

export function newSalt(): string {
  return randomBytes(32).toString('hex');
}

/** Signed session value: base64url(json) + '.' + hmac. */
export function signValue(value: object, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  const mac = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyValue<T>(token: string | undefined, key: Buffer): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac('sha256', key).update(body).digest('base64url');
  if (mac.length !== expected.length || mac !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Same construction as the CLI edge (R-20): HMAC-SHA256(salt, scope + value)
 * → anon-<12hex>. Duplicated here because pure packages may not hold crypto
 * and apps may not import apps; the conformance suite pins the shape.
 */
export function buildPseudonymizationContext(
  scopeId: string,
  salt: string,
): PseudonymizationContext {
  return {
    scopeId,
    pseudonymFor: (rawValue: string) =>
      `anon-${createHmac('sha256', salt).update(`${scopeId}\n${rawValue}`).digest('hex').slice(0, 12)}`,
  };
}
