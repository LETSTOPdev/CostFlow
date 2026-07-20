import { describe, expect, it } from 'vitest';
import { buildPseudonymizationContext } from '../src/pseudonym';

describe('pseudonymization context (R-20 rules 3–6)', () => {
  it('is deterministic: same scope + salt + value → same pseudonym', () => {
    const a = buildPseudonymizationContext('org-1', 'salt-alpha');
    const b = buildPseudonymizationContext('org-1', 'salt-alpha');
    expect(a.pseudonymFor('Sarah Cohen')).toBe(b.pseudonymFor('Sarah Cohen'));
    expect(a.pseudonymFor('Sarah Cohen')).toMatch(/^anon-[0-9a-f]{12}$/);
  });

  it('isolates organizations: different salt or scope → unlinkable pseudonyms', () => {
    const org1 = buildPseudonymizationContext('org-1', 'salt-alpha');
    const org2SameSalt = buildPseudonymizationContext('org-2', 'salt-alpha');
    const org1OtherSalt = buildPseudonymizationContext('org-1', 'salt-beta');
    const value = 'john@company.com';
    expect(org1.pseudonymFor(value)).not.toBe(org2SameSalt.pseudonymFor(value));
    expect(org1.pseudonymFor(value)).not.toBe(org1OtherSalt.pseudonymFor(value));
  });

  it('distinguishes distinct values and never embeds the raw value', () => {
    const ctx = buildPseudonymizationContext('org-1', 'salt-alpha');
    expect(ctx.pseudonymFor('Sarah Cohen')).not.toBe(ctx.pseudonymFor('sarah cohen'));
    expect(ctx.pseudonymFor('Sarah Cohen')).not.toContain('Sarah');
  });
});
