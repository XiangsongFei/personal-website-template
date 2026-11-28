// @vitest-environment node
// Synthetic catalog-shaped data only: no PostgreSQL or restore verification.
import { describe, expect, it, vi } from 'vitest';

const { compareParameterAcl } = await import(new URL('./rls-runtime/parameter-acl-comparison.mjs', import.meta.url).href) as {
  compareParameterAcl: (source: unknown, target: unknown) => 'equal' | 'different' | 'unverified';
};
type Snapshot = {
  model: string; complete: boolean; parameter: string; catalogState: string;
  roles: { oid: number; logicalIdentity: string }[];
  rows: { grantor: number; grantee: number; privilege_type: string; is_grantable: boolean }[];
};
const fixture = (): Snapshot => ({
  model: 'pg17-parameter-acl-v1', complete: true, parameter: 'synthetic.setting', catalogState: 'explicit',
  roles: [{ oid: 10, logicalIdentity: 'synthetic_grantor' }, { oid: 20, logicalIdentity: 'synthetic_reader' }],
  rows: [
    { grantor: 10, grantee: 20, privilege_type: 'SET', is_grantable: false },
    { grantor: 10, grantee: 20, privilege_type: 'ALTER SYSTEM', is_grantable: true },
  ],
});
const encode = (value: unknown) => JSON.stringify(value);
const compare = (a: Snapshot, b: Snapshot) => compareParameterAcl(encode(a), encode(b));

describe('parameter ACL comparison (synthetic, no database)', () => {
  it('accepts strictly identical explicit ACLs', () => expect(compare(fixture(), fixture())).toBe('equal'));
  it('ignores only row and mapping order', () => {
    const b = fixture(); b.roles.reverse(); b.rows.reverse();
    expect(compare(fixture(), b)).toBe('equal');
  });
  it('compares logical identities instead of cross-cluster OIDs', () => {
    const b = fixture(); b.roles[0].oid = 90; b.roles[1].oid = 80;
    b.rows.forEach(r => { r.grantor = 90; r.grantee = 80; });
    expect(compare(fixture(), b)).toBe('equal');
  });
  it.each([
    ['parameter', (s: Snapshot) => { s.parameter = 'synthetic.other'; }],
    ['grantee', (s: Snapshot) => { s.roles[1].logicalIdentity = 'synthetic_other'; }],
    ['grantor', (s: Snapshot) => { s.roles[0].logicalIdentity = 'synthetic_other'; }],
    ['grant option', (s: Snapshot) => { s.rows[0].is_grantable = true; }],
    ['role identity case', (s: Snapshot) => { s.roles[1].logicalIdentity = 'Synthetic_reader'; }],
  ] as const)('detects a different %s', (_name, mutate) => {
    const a = fixture(), b = fixture(); mutate(b);
    expect(compare(a, b)).toBe('different'); expect(compare(b, a)).toBe('different');
  });
  it('distinguishes SET from ALTER SYSTEM', () => {
    const a = fixture(), b = fixture(); a.rows = [a.rows[0]]; b.rows = [b.rows[1]];
    b.rows[0].is_grantable = false;
    expect(compare(a, b)).toBe('different');
  });
  it('detects missing and extra grants even when both snapshots claim completeness', () => {
    const a = fixture(), b = fixture(); b.rows.pop();
    expect(compare(a, b)).toBe('different'); expect(compare(b, a)).toBe('different');
  });
  it('does not conflate PUBLIC with a real role bearing the same display name', () => {
    const a = fixture(), b = fixture(); a.rows = [a.rows[0]]; b.rows = [b.rows[0]];
    a.rows[0].grantee = 0; a.roles.pop(); b.roles[1].logicalIdentity = 'public';
    expect(compare(a, b)).toBe('different'); expect(compare(a, a)).toBe('equal');
  });
  it('accepts verified explicit empty ACLs without treating missing rows as empty', () => {
    const a = fixture(); a.rows = []; a.roles = [];
    expect(compare(a, a)).toBe('equal'); expect(compare(a, fixture())).toBe('different');
  });
  it.each(['null', 'default'])('leaves %s ACL expansion unverified, including two identical inputs', state => {
    const a = fixture(); a.catalogState = state; a.rows = []; a.roles = [];
    expect(compare(a, a)).toBe('unverified');
    expect(compare(a, fixture())).toBe('unverified'); expect(compare(fixture(), a)).toBe('unverified');
  });
  it.each([
    ['duplicate record', (s: Snapshot) => { s.rows.push({ ...s.rows[0] }); }],
    ['conflicting duplicate', (s: Snapshot) => { s.rows.push({ ...s.rows[0], is_grantable: true }); }],
    ['missing grantor mapping', (s: Snapshot) => { s.roles.shift(); }],
    ['missing grantee mapping', (s: Snapshot) => { s.roles.pop(); }],
    ['duplicate OID', (s: Snapshot) => { s.roles[1].oid = s.roles[0].oid; }],
    ['ambiguous logical identity', (s: Snapshot) => { s.roles[1].logicalIdentity = s.roles[0].logicalIdentity; }],
    ['unused mapping', (s: Snapshot) => { s.roles.push({ oid: 30, logicalIdentity: 'synthetic_unused' }); }],
    ['incomplete snapshot', (s: Snapshot) => { s.complete = false; }],
    ['unknown model', (s: Snapshot) => { s.model = 'unknown'; }],
    ['unknown catalog state', (s: Snapshot) => { s.catalogState = 'unknown'; }],
    ['unknown privilege', (s: Snapshot) => { s.rows[0].privilege_type = 'UNKNOWN'; }],
    ['parameter case not canonical', (s: Snapshot) => { s.parameter = 'Synthetic.setting'; }],
    ['invalid grantor zero', (s: Snapshot) => { s.rows[0].grantor = 0; }],
    ['negative OID', (s: Snapshot) => { s.rows[0].grantee = -1; }],
    ['fractional OID', (s: Snapshot) => { s.roles[0].oid = 1.5; }],
    ['oversized OID', (s: Snapshot) => { s.roles[0].oid = 4294967296; }],
    ['PUBLIC grant option', (s: Snapshot) => { s.rows[1].grantee = 0; }],
    ['control character', (s: Snapshot) => { s.roles[0].logicalIdentity = 'synthetic\nsecret'; }],
    ['invalid unicode', (s: Snapshot) => { s.roles[0].logicalIdentity = '\ud800'; }],
    ['oversized role identity', (s: Snapshot) => { s.roles[0].logicalIdentity = '界'.repeat(22); }],
    ['oversized parameter', (s: Snapshot) => { s.parameter = 'x'.repeat(257); }],
    ['too many rows', (s: Snapshot) => { s.rows = Array.from({ length: 257 }, () => ({ ...s.rows[0] })); }],
    ['too many mappings', (s: Snapshot) => { s.roles = Array.from({ length: 129 }, (_, i) => ({ oid: i + 1, logicalIdentity: `synthetic_${i}` })); }],
  ] as const)('rejects %s in either input', (_name, mutate) => {
    const a = fixture(), b = fixture(); mutate(b);
    expect(compare(a, b)).toBe('unverified'); expect(compare(b, a)).toBe('unverified');
    expect(compare(b, b)).toBe('unverified');
  });
  it.each([
    undefined, null, 0, false, {}, [], '', 'null', '[]', '{', ' '.repeat(32769),
    '{"model":1,"model":2}',
  ])('rejects invalid transport %# without throwing', input => {
    expect(compareParameterAcl(input, encode(fixture()))).toBe('unverified');
  });
  it('rejects duplicate JSON keys even when the last value is valid', () => {
    const input = encode(fixture()).replace('"complete":true', '"complete":false,"complete":true');
    expect(compareParameterAcl(input, encode(fixture()))).toBe('unverified');
  });
  it('rejects missing fields, wrong types and unknown properties', () => {
    const original = fixture();
    for (const key of Object.keys(original)) {
      const value = { ...original } as Record<string, unknown>; delete value[key];
      expect(compareParameterAcl(encode(value), encode(original))).toBe('unverified');
    }
    for (const key of Object.keys(original.rows[0])) {
      const row = { ...original.rows[0] } as Record<string, unknown>; delete row[key];
      expect(compareParameterAcl(encode({ ...original, rows: [row] }), encode(original))).toBe('unverified');
    }
    for (const value of ['false', 0, null]) {
      const row = { ...original.rows[0], is_grantable: value };
      expect(compareParameterAcl(encode({ ...original, rows: [row] }), encode(original))).toBe('unverified');
    }
    expect(compareParameterAcl(encode({ ...original, extra: true }), encode(original))).toBe('unverified');
    const row = { ...original.rows[0], extra: true };
    expect(compareParameterAcl(encode({ ...original, rows: [row] }), encode(original))).toBe('unverified');
  });
  it('never evaluates untrusted JS objects or echoes malicious input', () => {
    let touched = false;
    const input = { get rows() { touched = true; throw new Error('synthetic-secret'); } };
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    try {
      for (const value of [input, 'synthetic-secret\n\\! command', '{"__proto__":{"polluted":true}}']) {
        expect(compareParameterAcl(value, encode(fixture()))).toBe('unverified');
      }
      expect(touched).toBe(false);
      expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
      expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
    } finally { log.mockRestore(); error.mockRestore(); warn.mockRestore(); }
  });
  it('bounds UTF-8 input size and rejects SQL-shaped parameter identities', () => {
    const a = fixture(); a.parameter = 'synthetic.setting; injected';
    expect(compare(a, a)).toBe('unverified');
    const text = encode({ extra: '界'.repeat(12000) });
    expect(compareParameterAcl(text, text)).toBe('unverified');
  });
});
