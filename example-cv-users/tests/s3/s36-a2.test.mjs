import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkNativeAuth } from '../../supabase/candidates/s36-a1/preparation.mjs';
import { digestEvidence, openJournal, referenceBundle, verifyCatalog, verifyReference } from '../../supabase/candidates/s36-a2/evidence.mjs';
import { createExecutor } from '../../supabase/candidates/s36-a2/executor.mjs';
import { diskBytes, limits, manifest, PG_IMAGE, phaseBudget, phaseSql, sources,
  verifiedSql } from '../../supabase/candidates/s36-a2/plan.mjs';

const hash = char => char.repeat(64);
const sid = '7712345678901234567';
const otherSid = '7712345678901234568';
const profile = (reference = false) => ({
  sourceCommit: 'a'.repeat(40), runId: reference ? manifest.reference_run_id : manifest.candidate_run_id,
  image: PG_IMAGE, platform: 'linux/arm64', endpoint: 'unix:///supervisor/docker.sock',
  engineFingerprint: hash(reference ? '7' : '1'), vmFingerprint: hash(reference ? '8' : '2'),
  fenceFingerprint: hash('3'), adapterFingerprint: hash('4'), hbaFingerprint: hash('5'),
  excludedSids: ['1234567890123456789'],
});

function observedCatalog(phase02) {
  const rows = sources.source_catalog['01'].concat(phase02 ? sources.source_catalog['02'] : []);
  return {format: 's36-a1-catalog-v1', items: rows.map(([kind, name, body]) => [
    kind, name, kind === 'function' ? [false, false, false, false, false, false, false, body] :
      kind === 'role' ? [false, false, false, false, false, false, false, []] :
        kind === 'relation' ? ['r', 'ecv_s3_owner', true, true] : null,
  ])};
}

const native = () => ({
  artifact_sha256: sources.auth.binary_sha256, archive_sha256: sources.auth.archive_sha256,
  linux_arm64_manifest: sources.auth.arm64_manifest,
  versions: [...sources.auth.initial_versions, ...sources.auth.up_sql_versions],
  users: 0, sessions: 0, relation_owner: 'supabase_auth_admin', rls: true, application_auth_open: false,
  postgres_auth_role_member: false, postgres_auth_schema_usage: true, postgres_auth_schema_create: false,
  postgres_auth_full_table_privileges: false, postgres_auth_grant_options: false, ordinary_auth_data_privileges: false,
  pgcrypto_deployer_capability: true,
  postgres_auth_columns: {
    sessions: {select: ['id', 'not_after', 'user_id']},
    users: {references: ['id'], select: ['banned_until', 'email_confirmed_at', 'id', 'is_anonymous']},
  },
});

const archive = process.env.ECV_A2_ARCHIVE;
function load(key) {
  if (key.startsWith('control/')) {
    if (!archive) throw new Error('HISTORICAL_SQL_NOT_AVAILABLE');
    return readFileSync(join(archive, key), 'utf8');
  }
  const path = /^[0-9]/.test(key) ? 'migrations/' + key :
    'candidates/' + (key === 'initial-readonly.sql' ? 's36-a2' : 's36-a1') + '/' + key;
  return readFileSync(new URL('../../supabase/' + path, import.meta.url), 'utf8');
}

function mock(t, options = {}) {
  const target = profile(options.reference);
  const observedSid = options.reference ? otherSid : sid;
  const root = mkdtempSync(join(realpathSync(tmpdir()), 's36-a2-test-'));
  const journal = openJournal(root, target);
  t.after(() => { journal.close(); rmSync(root, {recursive: true}); });
  const prefix = 's36-a2-' + target.runId;
  const resource = {
    containerId: hash('b'), networkId: hash('c'), containerName: prefix, volumeName: prefix + '-data',
    networkName: prefix + '-internal', ownerRunId: target.runId, volumeDriver: 'local',
    mountTarget: '/var/lib/postgresql/data', networkInternal: true, networkConfigured: true, configuredNetworks: 1,
    image: PG_IMAGE, platform: 'linux/arm64', hostPorts: 0, bindMounts: 0, privileged: false, restart: 'no',
    memoryBytes: limits.memoryBytes, nanoCpus: limits.nanoCpus, pids: limits.pids,
    hbaFingerprint: target.hbaFingerprint, volumeFingerprint: hash('d'), socket: '/var/run/postgresql',
  };
  const actions = [], statements = [];
  let running = false, pid = 400, now = 5;
  const transport = {
    async observe() {
      if (options.consumeTime) now += 6100;
      return {
        ...target, diskBytes, dedicatedBlockDevice: true, dockerAndContainerdOnDisk: true, noHostShares: true,
        diskFullProof: true, workloadLogsBounded: true, applicationAuthOpen: false, imageVerified: true,
        hardWatchdog: true, databaseConnectionLimit: limits.maxConnections, offlineNetwork: true,
        activeBackends: 0, ownedWorkers: 0, unrelatedClients: 0, nameCollisions: 0,
        systemIdentifier: observedSid, resource, running, pid: running ? 9 : 0,
        activeNetworkPeers: running ? [resource.containerId] : options.stopPeers ?? [], ...options.observation,
      };
    },
    async hostAction({id}) {
      actions.push(id);
      if (id === 'START_POSTGRES') running = true;
      if (id === 'STOP_OWNED') running = false;
      return {id, runId: target.runId, ended: true, exitCode: 0, containerId: resource.containerId,
        artifact_sha256: sources.auth.binary_sha256, systemIdentifier: observedSid,
        command: 'auth migrate', role: 'supabase_auth_admin', localSocket: true};
    },
    async openSession({id, role, readOnly, sid: expectedSid}) {
      const backend = {pid: pid++, start: '1795110000.123456'};
      const terminal = ['ACL', 'A03', 'A06', 'M1','M2','M3','M4','M5','M6','M7'].includes(id) ? 'COMMIT' : 'ROLLBACK';
      const step = Object.values(phaseSql).flat().find(step => step.id === id);
      let n = 0;
      return {
        async exchange(input) {
          const marker = /\n\\echo (S36_FRAME_[0-9a-f]+) :ERROR :SQLSTATE\n$/.exec(input)?.[1];
          assert.ok(marker);
          const sql = input.split('\n\\echo ')[0].slice(0, -1);
          statements.push({id, sql});
          const position = n++;
          let body = '', code = '00000';
          if (position === 0) body = JSON.stringify({
            ...backend, systemIdentifier: observedSid, database: 'postgres', version: '170011', local: true,
            sessionRole: role, role, roleOid: role === 'supabase_admin' ? 10 : 111,
            readOnly, statementMs: '5s', lockMs: '1s', transactionMs: '12s', idleMs: '8s', expectedSid,
            priorEnded: id.endsWith('_EXIT') ? options.exitProof ?? true : null,
            ...options.identities?.[id],
          });
          else if (sql.startsWith('BEGIN')) body = 'BEGIN';
          else if (sql === terminal || sql === 'ROLLBACK') body = sql;
          else if (sql === 'SELECT 1 / 0') code = '22012';
          else if (id === 'R0_BIND' && position === step.count - 1) {
            body = JSON.stringify({versions: options.initialLedger ?? [...sources.auth.initial_versions].sort()});
          } else if (id === 'AUTH_READBACK' && position === step.count - 1) {
            body = JSON.stringify({...native(), ...options.authReadback});
          } else if (['REF_01', 'REF_02', 'A07', 'A50'].includes(id) && position === (step?.count ?? 7) - 1) {
            body = JSON.stringify(observedCatalog(id === 'REF_02' || id === 'A07'));
          } else if (id === 'A09' && position === step.count - 1) {
            body = JSON.stringify({kind: 'closed_readback', root_closed: true, write_enabled: false,
              public_read_enabled: false, outbox_enabled: false});
          }
          if (options.breakAt?.id === id && options.breakAt.pos === position) {
            if (options.breakAt.unknown) throw new Error('MOCK_TRANSPORT_LOST');
            code = '42501';
          }
          return (body ? body + '\n' : '') + marker + (code === '00000' ? ' false ' : ' true ') + code + '\n';
        },
        async close() { return true; },
      };
    },
  };
  const args = {profile: target, transport, ledger: journal, load: options.load ?? load,
    authorize: request => request.approval === 'synthetic-only', clock: () => now};
  const executor = createExecutor(args);
  function request(phase, extra = {}) {
    const budgetDigest = Object.hasOwn(phaseSql, phase) ? digestEvidence(phaseBudget(phase)) : null;
    return {phase, authorized: true, runId: target.runId, profileDigest: digestEvidence(target),
      approval: 'synthetic-only', budgetDigest, sid: executor.state().sid, targetDigest: executor.state().targetDigest, ...extra};
  }
  return {executor, root, args, actions, statements, options, request};
}

test('checked-in state grants zero real actions and the controller has no default driver', () => {
  assert.equal(manifest.authorized, false);
  assert.equal(manifest.current_action_budget, 0);
  assert.equal(manifest.system_identifier, 'NOT_YET_OBSERVED');
  assert.deepEqual(manifest.catalog_expectations, {A07: null, A50: null, approval_sha256: null});
  assert.throws(() => createExecutor({profile: profile()}), /EXECUTOR_NOT_BOUND/);
  assert.throws(() => createExecutor({profile: {...profile(), image: 'postgres:latest'}}), /TARGET_PROFILE_DENIED/);
});

test('pins count and transaction shape of checked-in SQL without using a driver', () => {
  assert.equal(phaseSql.R1.filter(step => /^M[1-7]$/.test(step.id)).reduce((sum, step) => sum + step.count, 0), 402);
  for (const step of Object.values(phaseSql).flat().filter(step => !step.key.startsWith('control/'))) {
    assert.equal(verifiedSql(step, load).length, step.count);
  }
  assert.throws(() => verifiedSql(phaseSql.R0[0], key => load(key) + ' '), /PINNED_SQL_DRIFT/);
});

test('absent authority, incorrect scope and undersized budget dispatch no actions', async t => {
  const m = mock(t);
  await assert.rejects(m.executor.run(m.request('R0', {authorized: false})), /PHASE_NOT_AUTHORIZED/);
  await assert.rejects(m.executor.run(m.request('R0', {profileDigest: hash('f')})), /PHASE_NOT_AUTHORIZED/);
  await assert.rejects(m.executor.run(m.request('R0', {budgetDigest: digestEvidence({sql: 1})})), /PHASE_NOT_AUTHORIZED/);
  assert.deepEqual(m.actions, []);
});

test('rejects an unbound journal and refuses duplicated phase or concurrent engine ownership', async t => {
  const m = mock(t);
  const fake = createExecutor({...m.args, ledger: {record() { throw new Error('MUST_NOT_CALL'); }}});
  await assert.rejects(fake.run(m.request('R0')), /JOURNAL_NOT_BOUND/);
  assert.throws(() => openJournal(m.root, m.args.profile), {code: 'EEXIST'});
  const pending = m.executor.run(m.request('R0'));
  await assert.rejects(m.executor.run(m.request('R0')), /EXECUTION_IN_PROGRESS/);
  assert.equal((await pending).next, 'R1');
  assert.equal(m.executor.state().sid, sid);
  assert.equal(m.executor.state().spent.normal.docker, 34);
  await assert.rejects(m.executor.run(m.request('R0')), /PHASE_NOT_AUTHORIZED/);
  assert.equal(m.actions.length, 4);
});

for (const [name, observation, code] of [
  ['wrong target', {engineFingerprint: hash('0')}, 'HOST_FENCE_DENIED'],
  ['wrong image', {imageVerified: false}, 'HOST_FENCE_DENIED'],
  ['missing disk limit', {diskFullProof: false}, 'HOST_FENCE_DENIED'],
  ['application Auth available', {applicationAuthOpen: true}, 'HOST_FENCE_DENIED'],
]) {
  test(name + ' refuses all dispatch', async t => {
    const m = mock(t, {observation});
    assert.equal((await m.executor.run(m.request('R0'))).failureDetail.code, code);
    assert.deepEqual(m.actions, []);
  });
}

test('exhausting the local deadline refuses dispatch and consumes the phase', async t => {
  const m = mock(t, {consumeTime: true});
  assert.equal((await m.executor.run(m.request('R0'))).failureDetail.code, 'DEADLINE_EXCEEDED');
  assert.deepEqual(m.actions, []);
  await assert.rejects(m.executor.run(m.request('R0')), /PHASE_NOT_AUTHORIZED/);
});

test('mismatched SQL SID sends no stage SQL and leaves no authorized stop or retry', async t => {
  const m = mock(t, {identities: {R0_BIND: {systemIdentifier: otherSid}}});
  assert.equal((await m.executor.run(m.request('R0'))).failure, 'UNKNOWN');
  assert.equal(m.statements.length, 1);
  assert.equal(m.executor.state().sid, 'NOT_YET_OBSERVED');
  await assert.rejects(m.executor.stopOwned(m.request('CLOSE')), /STOP_NOT_AUTHORIZED/);
  await assert.rejects(m.executor.run(m.request('R0')), /PHASE_NOT_AUTHORIZED/);
});

test('rejects unexpected ledger and inherited or expanded Auth privileges', async t => {
  const m = mock(t, {initialLedger: []});
  assert.equal((await m.executor.run(m.request('R0'))).failureDetail.code, 'INITIAL_AUTH_LEDGER_DENIED');
  assert.throws(() => checkNativeAuth({...native(), versions: []}), /NATIVE_AUTH_RECEIPT_DENIED/);
  assert.throws(() => checkNativeAuth({...native(), postgres_auth_role_member: true}), /NATIVE_AUTH_RECEIPT_DENIED/);
  assert.throws(() => checkNativeAuth({...native(), postgres_auth_full_table_privileges: true}), /NATIVE_AUTH_RECEIPT_DENIED/);
});

test('only the current resource may be stopped and a stopped run cannot progress', async t => {
  const m = mock(t);
  await m.executor.run(m.request('R0'));
  await assert.rejects(m.executor.stopOwned(m.request('CLOSE', {targetDigest: hash('8')})), /STOP_NOT_AUTHORIZED/);
  assert.equal((await m.executor.stopOwned(m.request('CLOSE'))).stopped, true);
  assert.equal(m.actions.at(-1), 'STOP_OWNED');
  await assert.rejects(m.executor.run(m.request('R1')), /PHASE_NOT_AUTHORIZED/);
});

test('a rebound volume prevents stop dispatch and all retries', async t => {
  const m = mock(t);
  await m.executor.run(m.request('R0'));
  m.options.observation = {resource: {}};
  assert.equal((await m.executor.stopOwned(m.request('CLOSE'))).failure, 'UNKNOWN');
  assert.ok(!m.actions.includes('STOP_OWNED'));
  await assert.rejects(m.executor.stopOwned(m.request('CLOSE')), /STOP_NOT_AUTHORIZED/);
});

test('post-stop missing exit proof or a foreign live endpoint cannot confirm closure', async t => {
  const noExit = mock(t, {exitProof: false});
  assert.equal((await noExit.executor.run(noExit.request('R0'))).failure, 'UNKNOWN');
  const foreign = mock(t, {stopPeers: [hash('f')]});
  await foreign.executor.run(foreign.request('R0'));
  const result = await foreign.executor.stopOwned(foreign.request('CLOSE'));
  assert.equal(result.failureDetail.code, 'NETWORK_PEERS_DENIED');
  assert.equal(result.stopped, false);
  assert.equal(foreign.actions.filter(action => action === 'STOP_OWNED').length, 1);
});

test('A07/A50 need separately observed catalogs and a different approved VM, Engine and SID', () => {
  const ref = referenceBundle(profile(true), otherSid, hash('0'),
    {catalog: observedCatalog(false), receipt: hash('1')}, {catalog: observedCatalog(true), receipt: hash('2')});
  Object.assign(ref.reference, {close: hash('3'), stop: hash('4')});
  const approval = digestEvidence(ref);
  verifyReference(profile(), sid, hash('5'), ref, approval);
  verifyCatalog('A07', observedCatalog(true), ref, approval);
  verifyCatalog('A50', observedCatalog(false), ref, approval);
  assert.throws(() => verifyCatalog('A50', observedCatalog(true), ref, approval), /A50_HAS_PHASE_02_OBJECTS/);
  assert.throws(() => verifyCatalog('A07', observedCatalog(false), ref, approval), /SOURCE_OBJECT_MISSING/);
  assert.throws(() => verifyReference(profile(), otherSid, hash('5'), ref, approval), /REFERENCE_NOT_INDEPENDENT/);
  assert.throws(() => verifyReference(profile(), sid, hash('0'), ref, approval), /REFERENCE_NOT_INDEPENDENT/);
  assert.throws(() => verifyReference({...profile(), vmFingerprint: ref.reference.vmFingerprint},
    sid, hash('5'), ref, approval), /REFERENCE_NOT_INDEPENDENT/);
  const swapped = {...ref, A07: ref.A50, A50: ref.A07};
  assert.throws(() => verifyCatalog('A07', observedCatalog(true), swapped, digestEvidence(swapped)), /CATALOG_DRIFT/);
});

test('without historical SQL, R1 refuses before staging or invoking Auth', async t => {
  const m = mock(t, {load: key => {
    if (key.startsWith('control/')) throw new Error('HISTORICAL_SQL_NOT_AVAILABLE');
    return load(key);
  }});
  await m.executor.run(m.request('R0'));
  await assert.rejects(m.executor.run(m.request('R1')), /HISTORICAL_SQL_NOT_AVAILABLE/);
  assert.equal(m.actions.length, 4);
});

async function bootstrap(m) {
  assert.equal((await m.executor.run(m.request('R0'))).next, 'R1');
  const result = await m.executor.run(m.request('R1'));
  assert.equal(result.next, m.args.profile.runId === manifest.reference_run_id ? 'REF' : 'R2', JSON.stringify(result));
}

async function makeReference(t) {
  const ref = mock(t, {reference: true});
  await bootstrap(ref);
  assert.equal((await ref.executor.run(ref.request('REF'))).failure, null);
  assert.equal(ref.executor.state().reference, null);
  const result = await ref.executor.stopOwned(ref.request('CLOSE'));
  assert.equal(result.failure, null);
  assert.ok(result.reference);
  const rows = readFileSync(join(ref.root, ref.args.profile.runId + '.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const catalogs = rows.filter(row => row.kind === 'REF_CATALOG');
  assert.deepEqual(catalogs.map(row => row.name), ['A50', 'A07']);
  assert.deepEqual(catalogs.map(row => row.receipt), [result.reference.reference.after01, result.reference.reference.after02]);
  return {expectations: result.reference, referenceDigest: digestEvidence(result.reference)};
}

test('reference then candidate consume exact historical SQL through mock frames only', {skip: !archive}, async t => {
  const approval = await makeReference(t);
  const m = mock(t);
  await bootstrap(m);
  const final = await m.executor.run(m.request('R2', approval));
  assert.equal(final.failure, null, JSON.stringify(final.failureDetail));
  assert.deepEqual(final.receipts.filter(r => r.phase === 'R2').map(r => r.id), phaseSql.R2.map(s => s.id));
  assert.deepEqual(final.receipts.filter(r => r.acknowledgedFault).map(r => r.id), ['A01', 'A04']);
  assert.equal((await m.executor.stopOwned(m.request('CLOSE'))).stopped, true);
});

test('controlled R1 refuses wrong SID and halts on Auth ACL anomaly', {skip: !archive}, async t => {
  const invalid = mock(t, {authReadback: {postgres_auth_role_member: true}});
  await invalid.executor.run(invalid.request('R0'));
  await assert.rejects(invalid.executor.run(invalid.request('R1', {sid: otherSid})), /APPROVAL_TARGET_UNBOUND/);
  const result = await invalid.executor.run(invalid.request('R1'));
  assert.equal(result.failureDetail.code, 'NATIVE_AUTH_RECEIPT_DENIED');
  assert.ok(!invalid.statements.some(value => value.id === 'M1'));
});

for (const unknown of [false, true]) {
  test('A50 cannot override ' + (unknown ? 'UNKNOWN' : 'a proven rollback without readback'), {skip: !archive}, async t => {
    const approval = await makeReference(t);
    const m = mock(t, {breakAt: {id: 'A06', pos: 3, unknown}});
    await bootstrap(m);
    const result = await m.executor.run(m.request('R2', approval));
    assert.equal(result.failure, unknown ? 'UNKNOWN' : 'STOP', JSON.stringify(result.failureDetail));
    await assert.rejects(m.executor.run(m.request('R2', approval)), /PHASE_NOT_AUTHORIZED/);
    const reconcile = m.request('A50', {...approval, failureDigest: result.failureDetail.digest});
    const reconciled = await m.executor.reconcile(reconcile);
    assert.equal(reconciled.failure, unknown ? 'UNKNOWN' : 'PARTIAL_CLOSED');
    assert.equal(reconciled.receipts.at(-1).id, 'A50');
    assert.ok(!m.statements.some(value => value.id === 'A07'));
    await assert.rejects(m.executor.reconcile(reconcile), /RECONCILE_NOT_AUTHORIZED/);
    assert.equal((await m.executor.stopOwned(m.request('CLOSE'))).stopped, true);
  });
}
