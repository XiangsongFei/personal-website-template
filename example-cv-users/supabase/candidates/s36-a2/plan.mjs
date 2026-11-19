import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { splitSql } from './sql-wire.mjs';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const json = path => freeze(JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')));
export const manifest = json('./manifest.json');
export const sources = json('../s36-a1/sources.json');
const a1 = json('../s36-a1/approval.json');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const isSha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const fail = code => { throw new Error(code); };
export const PG_IMAGE = a1.postgres_image;
export const diskBytes = 4 * 1024 ** 3;
export const limits = Object.freeze({
  memoryBytes: 1024 ** 3, nanoCpus: 1_000_000_000, pids: 128,
  maxConnections: 10, statementMs: 5000, lockMs: 1000, transactionMs: 12000, idleTransactionMs: 8000,
});

const sql = (id, key, pin, count, terminal, role, fault = false) =>
  Object.freeze({id, key, pin, count, terminal, role, fault, timeoutMs: 24_000});
const historic = (id, name, count, terminal, role = 'postgres', fault = false) => {
  const key = 'control/' + name;
  return sql(id, key, manifest.historical_files[key], count, terminal, role, fault);
};
const candidate = (id, key, pin, count, terminal, role = 'supabase_admin') =>
  sql(id, key, pin, count, terminal, role);
export const initial = candidate('R0_BIND', 'initial-readonly.sql', manifest.initial_readonly_sha256, 7, 'ROLLBACK');
const acl = candidate('ACL', 'native-auth-acl.sql', a1.sql.auth_acl_sha256, 16, 'COMMIT');
const authRead = candidate('AUTH_READBACK', 'native-auth-readonly.sql', a1.sql.auth_readback_sha256, 7, 'ROLLBACK');
const baseline = historic('M7_READBACK', 'read/target-receipt.sql', 10, 'ROLLBACK', 'supabase_admin');
const migrations = sources.migrations.filter(item => item.main_tracked)
  .map(item => sql('M' + item.number, item.file, item.sha256, item.top_level_sql, 'COMMIT', 'postgres'));
const a00 = historic('A00', 'read/00-preflight.sql', 10, 'ROLLBACK');
const a03 = historic('A03', 'install/01-checked.sql', 130, 'COMMIT');
const a06 = historic('A06', 'install/02-checked.sql', 38, 'COMMIT');
const catalog = id => candidate(id, 'catalog-readonly.sql', a1.sql.catalog_sha256, 7, 'ROLLBACK');
export const a50 = catalog('A50');
const a07 = catalog('A07');
export const a09 = historic('A09', 'read/40-close-readonly.sql', 7, 'ROLLBACK', 'supabase_admin');
export const phaseSql = Object.freeze({
  R0: Object.freeze([initial]),
  R1: Object.freeze([acl, authRead, ...migrations, baseline]),
  R2: Object.freeze([a00, historic('A01', 'fault/01-rollback.sql', 131, 'ROLLBACK', 'postgres', true),
    historic('A02', 'read/10-after-rollback.sql', 7, 'ROLLBACK'), a03,
    historic('A04', 'fault/02-rollback.sql', 39, 'ROLLBACK', 'postgres', true),
    historic('A05', 'read/20-after-rollback.sql', 7, 'ROLLBACK'), a06, a07, a09]),
  REF: Object.freeze([a00, a03, catalog('REF_01'), a06, catalog('REF_02'), a09]),
});

// One observer connection and identity statement per closure proof, in
// addition to the step's own connection and pre-dispatch identity statement.
const cost = sqlSteps => ({
  sql: sqlSteps.reduce((sum, step) => sum + step.count + 2, 0),
  connections: sqlSteps.length * 2,
  docker: sqlSteps.length * 2,
});
export function phaseBudget(phase) {
  if (!Object.hasOwn(phaseSql, phase)) fail('INVALID_PHASE');
  const normal = cost(phaseSql[phase]);
  // Each engine/target observation may use up to four fixed inspect calls.
  normal.docker += 4 * (phaseSql[phase].length + 1);
  normal.native = 0;
  if (phase === 'R0') normal.docker += 24; // four create/start commands, their observations and bind observation
  if (phase === 'R1') {
    normal.docker += 15; // verify/stage+verify/migrate, and independent native exit observation
    normal.native = 1;
  }
  const reserve = phase === 'R2' ? {...cost([a50]), native: 0} : {sql: 0, connections: 0, docker: 0, native: 0};
  // One rollback plus the subsequent independent exit check on an acknowledged failure.
  if (phase !== 'R0') { reserve.sql += 2; reserve.connections++; reserve.docker++; }
  // Separate inspection and exit check for the original A04/A06 backend before A50.
  if (phase === 'R2') { reserve.sql++; reserve.connections++; reserve.docker += 5; }
  reserve.docker += phase === 'R2' ? 17 : 13; // reconcile observe; stop with three observations
  return {normal, reserve, workMs: {R0: 150_000, R1: 480_000, R2: 270_000, REF: 190_000}[phase],
    reserveMs: 60_000};
}

export function verifiedSql(step, load) {
  const source = load(step.key);
  if (typeof source !== 'string' || !isSha(step.pin) || sha256(source) !== step.pin) fail('PINNED_SQL_DRIFT');
  const statements = splitSql(source);
  const begin = statements[0];
  if (statements.length !== step.count || statements.at(-1) !== step.terminal ||
      (step.terminal === 'COMMIT' || step.fault ? begin !== 'BEGIN' :
        !['BEGIN READ ONLY', 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'].includes(begin)) ||
      statements.slice(1, -1).some(value => /^(?:BEGIN|COMMIT|ROLLBACK|END|ABORT)(?:\s|$)/i.test(value)) ||
      (step.fault && statements.at(-2) !== 'SELECT 1 / 0')) fail('PINNED_SQL_SHAPE');
  return Object.freeze(statements);
}
