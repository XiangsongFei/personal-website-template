import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  bindTarget, catalogDigest, checkNativeAuth, checkSourceCatalog, classifyTermination,
  compareApprovedCatalog, createPgOnlyMeter, verifySameTarget,
} from '../../supabase/candidates/s36-a1/preparation.mjs';

const candidate = name => new URL('../../supabase/candidates/s36-a1/' + name, import.meta.url);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const sources = JSON.parse(readFileSync(candidate('sources.json')));
const approval = JSON.parse(readFileSync(candidate('approval.json')));
const fakeDigest = c => c.repeat(64);

function catalog(...parts) {
  return {
    format: 's36-a1-catalog-v1',
    items: parts.flatMap(part => sources.source_catalog[part]).map(([kind, name, body]) => {
      const values = {
        function: ['example', true, 'v', false, 'sql', 'jsonb', ['search_path=""'], body],
        relation: ['r', 'ecv_s3_owner', true, true],
        role: [false, false, false, false, false, false, false, -1],
      };
      return [kind, name, values[kind] ?? null];
    }),
  };
}

function target() {
  const name = approval.resources.container;
  return {
    endpoint: 'unix:///fake/docker.sock', engine: 'synthetic-local-engine',
    run_id: approval.run_id, context: 'desktop-linux', platform: 'linux/arm64',
    image: approval.postgres_image, postgres_version: 170011, database: 'postgres',
    observer: 'supabase_admin', observer_oid: 10, socket: '/var/run/postgresql',
    hba_sha256: fakeDigest('a'), baseline_receipt_sha256: fakeDigest('b'),
    client_backends: 1, system_identifier: '7700000000000123456',
    container: { id: fakeDigest('c'), name, run_label: approval.run_id, host_ports: 0, binds: 0,
      privileged: false, restart: 'no', memory_bytes: approval.resource_ceiling.memory_bytes,
      nano_cpus: approval.resource_ceiling.nano_cpus, pids_limit: approval.resource_ceiling.pids },
    volume: { name: name + '-data', driver: 'local', run_label: approval.run_id,
      container_id: fakeDigest('c'), target: '/var/lib/postgresql/data' },
    network: { id: fakeDigest('d'), name: name + '-internal', run_label: approval.run_id,
      internal: true, containers: [fakeDigest('c')] },
  };
}

const excluded = ['7700000000011111111'];
const bind = observation => bindTarget(observation, 'unix:///fake/docker.sock', 'synthetic-local-engine', excluded);

function nativeReceipt() {
  return {
    archive_sha256: sources.auth.archive_sha256, artifact_sha256: sources.auth.binary_sha256,
    linux_arm64_manifest: sources.auth.arm64_manifest,
    versions: [...sources.auth.initial_versions, ...sources.auth.up_sql_versions],
    users: 0, sessions: 0, relation_owner: 'supabase_auth_admin', rls: true, application_auth_open: false,
    postgres_auth_role_member: false, postgres_auth_schema_usage: true, postgres_auth_schema_create: false,
    postgres_auth_full_table_privileges: false, postgres_auth_grant_options: false,
    ordinary_auth_data_privileges: false, pgcrypto_deployer_capability: true,
    postgres_auth_columns: {
      users: { references: ['id'], select: ['banned_until', 'email_confirmed_at', 'id', 'is_anonymous'] },
      sessions: { select: ['id', 'not_after', 'user_id'] },
    },
  };
}

test('A1 pins unchanged main migrations, original candidates and non-authorizing resources', () => {
  assert.equal(approval.authorized, false);
  assert.equal(approval.current_action_budget, 0);
  assert.equal(approval.system_identifier, 'NOT_YET_OBSERVED');
  assert.equal(approval.bootstrap.joint_ceiling, 'UNESTABLISHED');
  assert.deepEqual(approval.catalog_expectations, {A07: null, A50: null, external_approval_digest: null});
  assert.equal(sources.migrations.length, 11);
  const shipped = sources.migrations.filter(m => m.main_tracked);
  assert.equal(shipped.length, 7);
  assert.equal(shipped.reduce((sum, m) => sum + m.top_level_sql, 0), 402);
  for (const item of shipped) {
    const original = readFileSync(new URL('../../supabase/migrations/' + item.file, import.meta.url));
    assert.equal(sha256(original), item.sha256);
  }
  assert.equal(sources.auth.initial_versions.length, 7);
  assert.equal(sources.auth.up_sql_versions.length, 75);
  assert.equal(new Set([...sources.auth.initial_versions, ...sources.auth.up_sql_versions]).size, 82);
});

test('A1 Auth candidate pins transactional ACL cleanup and projection uses read-only snapshot', () => {
  for (const [file, hash] of [['native-auth-acl.sql', approval.sql.auth_acl_sha256],
    ['catalog-readonly.sql', approval.sql.catalog_sha256], ['native-auth-readonly.sql', approval.sql.auth_readback_sha256]]) {
    assert.equal(sha256(readFileSync(candidate(file))), hash);
  }
  const bridge = readFileSync(candidate('native-auth-acl.sql'), 'utf8');
  assert.match(bridge, /REVOKE supabase_auth_admin FROM postgres GRANTED BY supabase_admin RESTRICT/);
  assert.match(bridge, /REVOKE SELECT ON TABLE auth\.%I FROM postgres RESTRICT/);
  assert.match(bridge, /GRANT REFERENCES \(id\) ON TABLE auth\.users TO postgres/);
  assert.match(bridge, /SET LOCAL ROLE supabase_auth_admin[\s\S]*RESET ROLE[\s\S]*S36_A1_AUTH_ACL_NOT_NARROW[\s\S]*COMMIT;/);
  assert.doesNotMatch(bridge, /^ *(?:ALTER (ROLE|TABLE)|CREATE (ROLE|FUNCTION)|GRANT[^;\n]*WITH GRANT OPTION)/im);
  const observed = readFileSync(candidate('catalog-readonly.sql'), 'utf8');
  assert.match(observed, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.match(observed, /polpermissive/);
  assert.match(observed, /roleid IN \(SELECT oid FROM roles\) OR member IN \(SELECT oid FROM roles\)/);
  assert.match(observed, /aclexplode[\s\S]*ROLLBACK;\s*$/);
});

test('A1 denies malformed, inherited, broad or simulated native Auth receipts', () => {
  assert.equal(checkNativeAuth(nativeReceipt()), 'NATIVE_AUTH_CONTRACT_MATCH');
  for (const mutation of [
    r => {r.versions.pop();},
    r => {r.versions.push(r.versions[0]);},
    r => {r.artifact_sha256 = fakeDigest('a');},
    r => {r.sessions = 1;},
    r => {r.postgres_auth_role_member = true;},
    r => {r.postgres_auth_schema_create = true;},
    r => {r.postgres_auth_schema_usage = false;},
    r => {r.postgres_auth_grant_options = true;},
    r => {r.ordinary_auth_data_privileges = true;},
    r => {r.application_auth_open = true;},
    r => {r.postgres_auth_columns.users.select.push('encrypted_password');},
  ]) {
    const receipt = nativeReceipt();
    mutation(receipt);
    assert.throws(() => checkNativeAuth(receipt), /NATIVE_AUTH_RECEIPT_DENIED/);
  }
});

test('A07 requires both source slices and function bodies; A50 rejects residual 02 privileges', () => {
  assert.equal(checkSourceCatalog('A07', catalog('01', '02')), 'SOURCE_CONTRACT_MATCH');
  assert.equal(checkSourceCatalog('A50', catalog('01')), 'SOURCE_CONTRACT_MATCH');
  assert.throws(() => checkSourceCatalog('A07', catalog('01')), /SOURCE_OBJECT_MISSING/);
  assert.throws(() => checkSourceCatalog('A50', catalog('01', '02')), /A50_HAS_PHASE_02/);
  const partial = catalog('01');
  partial.items.push(['acl', 'relation/site_private.publication_outbox/owner/ecv_s36_outbox_worker/SELECT', false]);
  assert.throws(() => checkSourceCatalog('A50', partial), /A50_HAS_WORKER_PRIVILEGES/);
  const full = catalog('01', '02');
  full.items.find(row => row[0] === 'function')[2][7] = fakeDigest('1');
  assert.throws(() => checkSourceCatalog('A07', full), /SOURCE_FUNCTION_DRIFT/);
});

test('A1 catalog hashes preserve ACL grantor, policy mode and memberships and reject duplicates', () => {
  const observed = catalog('01');
  observed.items.push(['membership', 'a/b/c', [true, false, true]]);
  observed.items.push(['policy', 'schema.table.policy', [false, 'r', ['user'], null, null]]);
  const stable = catalogDigest(observed);
  assert.equal(catalogDigest({...observed, items: [...observed.items].reverse()}), stable);
  const altered = structuredClone(observed);
  altered.items.at(-2)[1] = 'a/b/other-grantor';
  assert.notEqual(catalogDigest(altered), stable);
  altered.items.at(-1)[2][0] = true;
  assert.notEqual(catalogDigest(altered), stable);
  observed.items.push(observed.items[0]);
  assert.throws(() => catalogDigest(observed), /DUPLICATE_CATALOG_OBJECT/);
});

test('A1 requires a separately pinned pair, never one observation used for both catalog stages', () => {
  const full = catalog('01', '02'), partial = catalog('01');
  const approved = {A07: catalogDigest(full), A50: catalogDigest(partial), projection: approval.sql.catalog_sha256,
    source01: sources.text_sql[0].checked_sha256, source02: sources.text_sql[1].checked_sha256};
  // The plain object is built in signature key order for this synthetic test.
  const approvedDigest = sha256(JSON.stringify(approved));
  assert.equal(compareApprovedCatalog('A07', full, approved, approvedDigest), 'CATALOG_MATCH_PENDING_EXECUTION_RECEIPTS');
  assert.equal(compareApprovedCatalog('A50', partial, approved, approvedDigest), 'CATALOG_MATCH_PENDING_EXECUTION_RECEIPTS');
  assert.throws(() => compareApprovedCatalog('A07', full, approval.catalog_expectations, fakeDigest('0')),
    /CATALOG_EXPECTATIONS_UNBOUND/);
  assert.throws(() => compareApprovedCatalog('A50', partial, {...approved, A50: approved.A07}, approvedDigest),
    /CATALOG_EXPECTATIONS_UNBOUND/);
  full.items.push(['membership', 'a/b/c', [false, false, true]]);
  assert.throws(() => compareApprovedCatalog('A07', full, approved, approvedDigest), /CATALOG_DRIFT/);
});

test('A1 target binder rejects old IDs, rebinding and resource drift', () => {
  const proof = bind(target());
  assert.equal(proof.length, 64);
  verifySameTarget(proof, target(), 'unix:///fake/docker.sock', 'synthetic-local-engine', excluded);
  assert.throws(() => bindTarget(target(), 'unix:///fake/docker.sock', 'synthetic-local-engine', []), /TARGET_IDENTITY_DENIED/);
  for (const mutation of [
    o => {o.system_identifier = 'NOT_YET_OBSERVED';},
    o => {o.system_identifier = excluded[0];},
    o => {o.run_id = '11111111-1111-4111-8111-111111111111';},
    o => {o.observer_oid = 11;},
    o => {o.client_backends = 2;},
    o => {o.container.host_ports = 1;},
    o => {o.container.memory_bytes++;},
    o => {o.volume.container_id = fakeDigest('e');},
    o => {o.network.internal = false;},
    o => {o.network.containers.push(fakeDigest('e'));},
  ]) {
    const observed = target();
    mutation(observed);
    assert.throws(() => bind(observed), /TARGET_(IDENTITY|RESOURCE)_DENIED/);
  }
  const newTarget = {...target(), system_identifier: '7700000000000654321'};
  assert.throws(() => verifySameTarget(proof, newTarget, 'unix:///fake/docker.sock', 'synthetic-local-engine', excluded),
    /TARGET_REBIND_DENIED/);
});

test('A1 bounds new work and preserves one read-only reconciliation slot on known budget stop', () => {
  const reserve = createPgOnlyMeter(100);
  assert.deepEqual(reserve({sql: 394, connections: 9, docker_cli: 18}, 200),
    {sql: 394, connections: 9, docker_cli: 18});
  assert.throws(() => reserve({sql: 1, connections: 0, docker_cli: 0}, 201), /BUDGET_DENIED/);
  assert.deepEqual(reserve({sql: 17, connections: 1, docker_cli: 1}, 150_100, true),
    {sql: 411, connections: 10, docker_cli: 19});
  assert.throws(() => reserve({sql: 1, connections: 1, docker_cli: 1}, 150_101, true), /BUDGET_STOPPED/);
  const late = createPgOnlyMeter(100);
  assert.throws(() => late({sql: 1, connections: 1, docker_cli: 1}, 210_100, true), /BUDGET_DENIED/);
  assert.throws(() => late({sql: 1, connections: 1, docker_cli: 1}, 101, true), /BUDGET_STOPPED/);
});

test('A1 uncertain post-dispatch results stay UNKNOWN and known rollback never means acceptance', () => {
  const receipt = {dispatched: true, identityProven: true, backendEnded: true, terminal: 'COMMIT'};
  assert.equal(classifyTermination(receipt), 'COMMIT_OBSERVED');
  assert.equal(classifyTermination({...receipt, terminal: 'ROLLBACK'}), 'ROLLBACK_OBSERVED');
  assert.equal(classifyTermination({...receipt, terminal: null}), 'UNKNOWN');
  assert.equal(classifyTermination({...receipt, backendEnded: false}), 'UNKNOWN');
  assert.equal(classifyTermination({...receipt, identityProven: false}), 'UNKNOWN');
  const refused = {dispatched: false, refusalBeforeDispatch: true};
  assert.equal(classifyTermination(refused), 'STOP');
  assert.equal(classifyTermination({dispatched: false}), 'UNKNOWN');
  assert.equal(classifyTermination({...refused, terminal: 'COMMIT'}), 'UNKNOWN');
  assert.equal(classifyTermination({...refused, backendEnded: true}), 'UNKNOWN');
  assert.equal(classifyTermination({...refused, backendEnded: false}), 'UNKNOWN');
  assert.equal(classifyTermination({...refused, identityProven: 'true'}), 'UNKNOWN');
  assert.equal(classifyTermination(Object.create(refused)), 'UNKNOWN');
  assert.equal(classifyTermination({...receipt, refusalBeforeDispatch: true}), 'UNKNOWN');
  assert.equal(classifyTermination({...receipt, refusalBeforeDispatch: 'true'}), 'UNKNOWN');
  assert.equal(classifyTermination({...receipt, dispatched: false}), 'UNKNOWN');
  for (const dispatched of [undefined, null, 'false', 'true', 0]) {
    assert.equal(classifyTermination({dispatched, identityProven: false}), 'UNKNOWN');
  }
  assert.equal(classifyTermination(), 'UNKNOWN');
});
