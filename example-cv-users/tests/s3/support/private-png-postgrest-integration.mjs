import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bindPrivatePngLifecyclePlan } from '../../../lib/business/private-png-lifecycle.node.mjs';
import { createPrivatePngPostgrestAdapters } from '../../../lib/business/private-png-postgrest.node.mjs';
import { prepareAssetDigest } from '../../../lib/business/asset-protocol.mjs';
import { id } from './private-png-authorization-fixture.mjs';
import { startPrivatePostgrest } from '../../../scripts/shared/private-postgrest.node.mjs';
import { bytes, lifecycleFixture, memoryStore } from './private-png-lifecycle-fixture.mjs';

const pgBin = process.env.S35_TEST_PG17_BIN;
const binary = process.env.S35_TEST_POSTGREST;
assert.ok(isAbsolute(pgBin ?? '') && isAbsolute(binary ?? ''));
const systemEnv = { LC_ALL: 'C', PATH: '/usr/bin:/bin' };
const pg = (name, args, input) => execFileSync(join(pgBin, name), args, {
  input, encoding: 'utf8', timeout: 20_000, env: systemEnv,
});
assert.match(pg('postgres', ['--version']), /\b17\.12\b/);
assert.match(execFileSync(binary, ['--version'], { encoding: 'utf8', env: systemEnv }), /\b16\.6\b/);
const sqlFixture = readFileSync(new URL('./private-png-postgrest-fixture.sql', import.meta.url), 'utf8');
const commandSQL = readFileSync(new URL('./private-png-command-fixture.sql', import.meta.url), 'utf8');
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const writerSteps = ['seal', 'complete', 'close'];

async function fixture(t, fault, front = false, existing) {
  const tmp = realpathSync('/tmp');
  const root = existing?.root ?? mkdtempSync(join(tmp, 'ecv-png-tail-'));
  const marker = join(root, 'fixture-nonce');
  const nonce = existing?.nonce ?? randomUUID();
  if (existing) {
    assert.ok(root.startsWith(tmp + '/ecv-png-tail-') && realpathSync(root) === root);
    const stat = lstatSync(root);
    assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o700);
    assert.match(nonce, /^[a-f0-9-]{36}$/);
    assert.equal(readFileSync(marker, 'utf8'), nonce);
  } else {
    writeFileSync(marker, nonce, { mode: 0o600, flag: 'wx' });
  }
  const data = join(root, 'db');
  const journal = join(root, 'journal');
  const sockets = existing ? mkdtempSync(join(tmp, 'ecv-png-recover-')) : root;
  if (!existing) {
    mkdirSync(journal, { mode: 0o700 });
    mkdirSync(join(journal, 'commands'), { mode: 0o700 });
  }
  const leases = [];
  let started = false;
  t.after(async () => {
    try {
      await Promise.all(leases.map(handle => handle.close()));
      if (started) pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    } finally {
      rmSync(sockets, { recursive: true, force: true });
    }
  });
  const port = '54838';
  if (!existing) {
    pg('initdb', ['-D', data, '-U', 'fixture_admin', '--no-locale', '--encoding=UTF8',
      '--auth-local=trust', '--auth-host=reject']);
    pg('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o',
      '-c listen_addresses= -k ' + root + ' -p ' + port, '-w', 'start']);
    started = true;
  }
  const admin = query => pg('psql', ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', root, '-p', port, '-U', 'fixture_admin', '-d', 'postgres'], query).trim();
  if (!existing) {
    admin(sqlFixture);
    if (front) admin(commandSQL);
  }
  const reader = query => pg('psql', ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', root, '-p', port, '-U', 'fixture_png_reader', '-d', 'postgres'],
  'BEGIN READ ONLY; SET LOCAL ROLE fixture_png_observe;\n' + query + '\nROLLBACK;').trim();
  const fixtureStorage = query => {
    try {
      return pg('psql', ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
        '-h', root, '-p', port, '-U', 'fixture_png_storage', '-d', 'postgres'], query).trim();
    } catch {
      throw Error('fixture Storage rejected');
    }
  };
  const fingerprint = admin(`SELECT encode(sha256(convert_to(
    (SELECT system_identifier::text FROM pg_control_system()) || '/' ||
      (SELECT oid::text FROM pg_database WHERE datname=current_database()),'UTF8')),'hex');`);
  const jwtSecret = randomBytes(32).toString('hex');
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  function token(role) {
    const input = encoded({ alg: 'HS256' }) + '.' + encoded({
      aud: 'fixture_png', role, exp: Math.floor(Date.now() / 1000) + 600,
    });
    return input + '.' + createHmac('sha256', jwtSecret).update(input).digest('base64url');
  }
  let credentialReads = 0;
  async function openStep(step) {
    const executionRole = 'fixture_png_' + step;
    const connectionRole = step === 'observe' ? 'fixture_png_reader' : 'fixture_png_writer';
    const runtime = await startPrivatePostgrest({
      binary, jwtSecret, transactionEnd: step === 'observe' ? 'rollback' : 'commit',
      databaseUri: 'postgresql://' + connectionRole + '@localhost/postgres?host=' + encodeURIComponent(root) + '&port=' + port,
      audience: 'fixture_png', schema: 'site_api', socketPath: join(sockets, step, 'rpc.sock'),
      identityRpc: 'observe_identity', identityToken: token(executionRole),
      connectionRole, executionRole, targetFingerprint: fingerprint,
    });
    leases.push(runtime);
    return { runtime, credential: async () => {
      credentialReads++;
      return token(executionRole);
    } };
  }
  const runtimes = [];
  const steps = [...writerSteps, 'observe', ...(front ? ['command', 'command_close'] : [])];
  for (const step of steps) runtimes.push(await openStep(step));
  const [seal, complete, close, observer, command, commandClose] = runtimes;
  const writers = { seal, complete, close };
  const store = await memoryStore();
  const calls = [];
  let captured;
  let proofUnavailable = fault === 'lost-seal';
  async function createTail({ binding, plan: input, pending, asset }) {
    const { plan, planSha256 } = bindPrivatePngLifecyclePlan(binding, input);
    const intent = step => ({ plan, plan_sha256: planSha256, step, request_id: plan.requests[step],
      intent_sha256: sha([planSha256, step]) });
    const frontSteps = ['prepare', 'claim', 'authorize-verify'];
    const ids = Object.fromEntries([...writerSteps, ...frontSteps].map(step => [step, intent(step).intent_sha256]));
    const options = { binding, plan: input, targetFingerprint: fingerprint, closeRole: 'fixture_png_close', writers, observer,
      ...(front ? { authorization: { command, close: commandClose, commandRole: 'fixture_png_command',
        closeRole: 'fixture_png_command_close' } } : {}) };
    const adapters = createPrivatePngPostgrestAdapters(options);
    captured = { ...captured, intent, adapters, options };
    const prior = admin('SELECT count(*) FROM fixture_png.pin;');
    if (existing) assert.equal(prior, '1');
    else if (prior === '0') admin(`INSERT INTO fixture_png.pin(run_id,project,keys,intents)
      VALUES (${literal(plan.run_id)}, ${literal(plan.project)}, ${literal(JSON.stringify(plan.requests))}, ${literal(JSON.stringify(ids))});`);
    const run = literal(plan.run_id);
    const getUpload = () => JSON.parse(reader(`SELECT row_to_json(u) FROM fixture_png.upload u WHERE run_id=${run};`) || 'null');
    const assetDigest = await prepareAssetDigest(plan.png);
    const frozen = Object.fromEntries(frontSteps.map(step => {
      const scope = step === 'claim' ? pending : asset;
      const permit = step === 'prepare' ? null : Object.fromEntries(
        ['id', 'intent_id', 'asset_id', 'object_version', 'native_version', 'bucket_id', 'object_key']
          .map(key => [key, scope[key]]));
      return [step, sha(['ecv.private-png.authorization.v1', plan.project, binding.authIssuer,
        plan.owner_uid, plan.owner_sid, plan.png.site_id, step, plan.requests[step], plan.grant_id,
        plan.epoch, plan.generation, plan.png.request_id, assetDigest, permit])];
    }));
    if (front && prior === '0') admin(`INSERT INTO fixture_png.scope
      (run_id,asset,command_intents,issuer,grant_id,owner_epoch,generation,valid_from,valid_to,generation_to)
      VALUES (${run},${literal(JSON.stringify(pending))},${literal(JSON.stringify(frozen))},
        ${literal(binding.authIssuer)},${literal(plan.grant_id)},
        ${plan.epoch},${literal(plan.generation)},clock_timestamp()-interval '1 minute',
        clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes');`);
    const integrated = {
      ...(front ? {
        proveWrongActors() {
          const actor = { uid: plan.owner_uid, sid: plan.owner_sid, site: plan.png.site_id,
            issuer: binding.authIssuer, grant: plan.grant_id, epoch: plan.epoch, generation: plan.generation,
            prepare: plan.requests.prepare, sha256: plan.png.sha256, size: plan.png.byte_size, mime: plan.png.mime_type };
          for (const mismatch of [{ uid: id(75) }, { sid: id(76) }, { site: id(77) },
            { grant: id(78) }, { epoch: plan.epoch - 1 }, { generation: 'retired' }]) {
            const denied = admin(`BEGIN; SET LOCAL SESSION AUTHORIZATION fixture_png_writer;
              SET LOCAL ROLE fixture_png_command;
              SELECT site_api.s35_png_command(${literal(plan.project)},${run},${literal(plan.requests.prepare)},
                ${literal(frozen.prepare)},'prepare',NULL,${literal(JSON.stringify({ ...actor, ...mismatch }))}) IS NOT NULL;
              SELECT accepted FROM fixture_png.command_effect WHERE run_id=${run} AND step='prepare';
              SELECT count(*) FROM fixture_png.prepared_asset WHERE run_id=${run}; ROLLBACK;`);
            assert.equal(denied, 't\nf\n0');
          }
        },
        authorization: { observer: adapters.authorization.observer, writer: {
          ...adapters.authorization.writer,
          async applyAtomically(bound, signal) {
            calls.push(bound.intent.operation);
            if (fault === 'expired' && bound.intent.operation === 'claim') {
              admin(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${run},35));
                UPDATE fixture_png.scope SET valid_to=clock_timestamp() WHERE run_id=${run}; COMMIT;`);
            }
            if (fault === 'competing-claim' && bound.intent.operation === 'claim') {
              const results = await Promise.allSettled([0, 1].map(() =>
                adapters.authorization.writer.applyAtomically(bound, signal)));
              assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
              return;
            }
            return adapters.authorization.writer.applyAtomically(bound, signal);
          },
        } },
        readClaim: () => adapters.observer.lookup(intent('claim')),
        readRetainedPost: getUpload,
        readVerified(intent) {
          const row = JSON.parse(reader(`SELECT json_build_object('receipt',receipt,'digest',verifier_sha256,'open',lifecycle_open)
            FROM fixture_png.pin WHERE run_id=${run};`));
          const observed = row.receipt !== null;
          const absent = !row.open && !observed;
          return { verifier_receipt: row.receipt, verifier_sha256: row.digest, request_id: intent.request_id,
            intent_sha256: intent.intent_sha256, project: plan.project, step: 'verify',
            settled: observed || absent, late_write_possible: !observed && !absent,
            disposition: observed ? 'committed' : absent ? 'absent' : undefined, xid: null,
            receipt_sha256: sha([row.receipt, row.digest]) };
        },
        readFixturePost(intent) {
          const witness = JSON.parse(reader(`SELECT json_build_object('open',f.lifecycle_open,'upload',row_to_json(u))
            FROM fixture_png.pin f LEFT JOIN fixture_png.upload u USING(run_id) WHERE f.run_id=${run};`));
          const row = witness.upload;
          const absent = !witness.open && !row;
          return { asset: row?.asset, state: 'pending', upload_request_id: row?.request_id,
            claim_xid: row?.claim_xid, permit_consumed: !!row,
            storage_request_id: row?.storage_request_id, storage_request_role: 'authenticated',
            native_session_user: 'supabase_storage_admin', native_effective_role: 'service_role',
            request_id: intent.request_id, intent_sha256: intent.intent_sha256, project: plan.project, step: 'post',
            settled: !!row || absent, late_write_possible: !row && !absent,
            disposition: row ? 'committed' : absent ? 'absent' : undefined, xid: row?.xid ?? null,
            receipt_sha256: sha(row) };
        },
        async recordFixturePost(context, effect, worker) {
          // Synthetic Storage side effect. The real database enforces the once-only lease consumption.
          if (fault === 'revoked-before-post') {
            admin(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${run},35));
              UPDATE fixture_png.scope SET revoked=true WHERE run_id=${run}; COMMIT;`);
          }
          const record = fixtureStorage(`SELECT fixture_png.fixture_store(${run},${literal(context.intent.request_id)},
            ${literal(context.claim_xid)},${literal(JSON.stringify(effect.asset))},${literal(effect.storage_request_id)},
            ${literal(worker.uid)},${literal(worker.session_id)});`);
          assert.match(record.trim(), /^\d+$/);
          if (fault === 'lost-post') throw Error('fixture POST response lost after database commit');
        },
        closeCommandStates() {
          return frontSteps.map(step => {
            const active = Number(reader(`SELECT count(*) FROM fixture_png.command_effect e JOIN fixture_png.pin f USING(run_id)
              WHERE e.run_id=${run} AND e.step=${literal(step)} AND e.accepted AND f.lifecycle_open
              AND NOT EXISTS (SELECT FROM fixture_png.command_effect c WHERE c.run_id=e.run_id AND c.step=e.step||'-close');`));
            const open = reader(`SELECT lifecycle_open FROM fixture_png.pin WHERE run_id=${run};`) === 't';
            return { request_id: plan.requests[step], close_request_id: plan.requests[step + '-close'],
              command_leases: active, in_flight: 0, late_write_possible: open };
          });
        },
        scopeClosure() {
          const open = Number(reader(`SELECT count(*) FROM fixture_png.pin WHERE run_id=${run} AND lifecycle_open;`));
          const leases = Number(reader(`SELECT count(*) FROM fixture_png.lease WHERE run_id=${run};`));
          return { active_runs: open, grants: open, permits: leases, leases, late_write_possible: open !== 0 };
        },
      } : {}),
      writer: {
        ...adapters.writer,
        async seal(...args) {
          if (fault === 'revoked-before-seal') {
            admin(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${run},35));
              UPDATE fixture_png.scope SET revoked=true WHERE run_id=${run}; COMMIT;`);
          }
          await adapters.writer.seal(...args);
          if (fault === 'lost-seal') throw Error('fixture receipt lost after real PostgREST commit');
        },
        complete(intent, receipt, digest, sealRef, signal) {
          return adapters.writer.complete(intent, receipt, digest,
            fault === 'wrong-seal-xid' ? { ...sealRef, xid: '3' } : sealRef, signal);
        },
      },
      observer: {
        ...adapters.observer,
        async lookup(request, signal) {
          if (proofUnavailable && request.step === 'seal') throw Error('fixture original read temporarily unavailable');
          return adapters.observer.lookup(request, signal);
        },
      },
      async registerFixtureReceipt(_intent, receipt, digest) {
        captured = { ...captured, receipt, digest };
        admin(`UPDATE fixture_png.pin SET receipt=${literal(JSON.stringify(receipt))}, verifier_sha256=${literal(digest)}
          WHERE run_id=${literal(plan.run_id)} AND verifier_sha256 IS NULL AND lifecycle_open;`);
      },
    };
    captured = { ...captured, proveWrongActors: integrated.proveWrongActors };
    return integrated;
  }
  const makeLifecycle = () => lifecycleFixture({ root: journal, authRoot: join(journal, 'commands'),
    python: realpathSync('/usr/bin/python3'), store, calls, createTail,
    fault: fault === 'corrupt-verifier' ? { corrupt: true } : undefined,
    roles: { seal: 'fixture_png_seal', complete: 'fixture_png_complete' } });
  return { ...(await makeLifecycle()), calls, admin, makeLifecycle, captured: () => captured,
    recoverInNewProcess() {
      const receipt = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'recover'], {
        timeout: 25_000, encoding: 'utf8', env: { ...systemEnv, S35_TEST_PG17_BIN: pgBin,
          S35_TEST_POSTGREST: binary, S35_FRONT_RECOVER_ROOT: root, S35_FRONT_RECOVER_NONCE: nonce },
      }));
      assert.notEqual(receipt.pid, process.pid);
      assert.equal(receipt.recovered, true);
      assert.deepEqual(receipt.calls, []);
    },
    credentialReads: () => credentialReads,
    restoreObserver() { proofUnavailable = false; } };
}

if (process.argv[2] === 'recover') {
  const cleanup = [];
  try {
    const local = await fixture({ after: task => cleanup.push(task) }, undefined, true, {
      root: process.env.S35_FRONT_RECOVER_ROOT, nonce: process.env.S35_FRONT_RECOVER_NONCE,
    });
    const { recovered } = await local.lifecycle.recover();
    console.log(JSON.stringify({ recovered, calls: local.calls, pid: process.pid }));
  } finally {
    for (const task of cleanup) await task();
  }
} else {
test('PG17.12 and PostgREST16.6 complete and independently close the actual lifecycle tail', { timeout: 50000 }, async t => {
  const local = await fixture(t);
  const result = await local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes });
  const { intent, adapters } = local.captured();
  assert.deepEqual(local.calls, ['prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'complete', 'close']);
  const seal = await adapters.observer.lookup(intent('seal'));
  const ready = await adapters.observer.lookup(intent('complete'));
  const end = await adapters.observer.closed(intent('close'));
  assert.equal(seal.xid, result.completed.sealXid);
  assert.equal(ready.xid, result.completed.completeXid);
  assert.equal(ready.seal_xid, seal.xid);
  assert.equal(ready.verifier_sha256, result.completed.verifierSha256);
  assert.equal(ready.execution_role, 'fixture_png_complete');
  assert.equal(ready.reader, 'fixture_png_observe');
  assert.equal(ready.connection_role, 'fixture_png_reader');
  assert.equal(ready.readonly, 'on');
  assert.equal(end.closed, true);
  assert.equal(end.retained_png.native_version, result.completed.asset.native_version);
  assert.equal(local.admin('SELECT count(DISTINCT txid) FROM fixture_png.effects;'), '3');
  assert.equal(local.admin(`SELECT has_table_privilege('fixture_png_observe','fixture_png.effects','INSERT')
    OR has_column_privilege('fixture_png_observe','fixture_png.pin','lifecycle_open','UPDATE');`), 'f');
});

test('a real committed Seal with lost ACK is reconciled on the original XID, never completed or resent', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'lost-seal');
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }), AggregateError);
  const original = local.admin("SELECT txid FROM fixture_png.effects WHERE step='seal';");
  assert.match(original, /^[1-9][0-9]*$/);
  assert.deepEqual(local.calls, ['prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'close']);
  local.restoreObserver();
  const newRunner = await local.makeLifecycle();
  assert.equal((await newRunner.lifecycle.recover()).recovered, true);
  assert.equal(local.admin("SELECT txid FROM fixture_png.effects WHERE step='seal';"), original);
  assert.equal(local.admin("SELECT string_agg(step,',' ORDER BY step) FROM fixture_png.effects;"), 'close,seal');
  assert.equal(local.calls.filter(step => step === 'seal').length, 1);
});

test('modified scoped inputs stop locally and a mismatched Seal XID cannot create ready', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'wrong-seal-xid');
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }), AggregateError);
  const { intent, adapters, receipt, digest, options } = local.captured();
  const sealChannel = options.writers.seal;
  assert.throws(() => createPrivatePngPostgrestAdapters({
    ...options, plan: { ...options.plan, complete_role: sealChannel.runtime.executionRole },
    writers: { ...options.writers, complete: sealChannel },
  }), { code: 'NOT_CONFIGURED' });
  assert.throws(() => createPrivatePngPostgrestAdapters({
    ...options, writers: { ...options.writers, complete: {
      ...options.writers.complete, runtime: { ...options.writers.complete.runtime, socketPath: sealChannel.runtime.socketPath },
    } },
  }), { code: 'NOT_CONFIGURED' });
  const key = intent('seal');
  const credentialsBefore = local.credentialReads();
  for (const forged of [{ ...key, plan: { ...key.plan, owner_sid: key.plan.worker_sid } },
    { ...key, step: 'prepare' }]) {
    assert.throws(() => adapters.writer.seal(forged, receipt, digest), { code: 'PNG_RPC_UNPROVEN' });
  }
  for (const unbound of [{ ...receipt, bucket_id: 'other-fixture-bucket' },
    { ...receipt, object_key: 'different.png' }]) {
    assert.throws(() => adapters.writer.seal(key, unbound, sha(['ecv.private-png.verifier.v1', unbound])),
      { code: 'PNG_RPC_UNPROVEN' });
  }
  assert.equal(local.credentialReads(), credentialsBefore);
  const wrong = await adapters.observer.lookup(intent('complete'));
  assert.equal(wrong.disposition, 'absent');
  assert.equal(wrong.late_write_possible, false);
  assert.equal((await adapters.observer.closed(intent('close'))).closed, true);
  assert.equal(local.admin("SELECT string_agg(step,',' ORDER BY step) FROM fixture_png.effects;"), 'close,seal');
});

test('real prepare, claim and closure compose with the PostgREST lifecycle tail', { timeout: 50000 }, async t => {
  const local = await fixture(t, undefined, true);
  local.captured().proveWrongActors();
  const result = await local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes });
  assert.deepEqual(local.calls, ['prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'complete', 'close']);
  assert.ok(result.completed.asset.native_version);
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.command_effect WHERE accepted;'), '6');
  assert.equal(local.admin(`SELECT count(*) FROM fixture_png.prepared_asset p JOIN fixture_png.command_effect e
    ON e.run_id=p.run_id AND e.step='prepare' AND e.request_id=p.request_id AND e.xid=p.prepare_xid;`), '1');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.lease;'), '0');
  assert.equal(local.admin(`SELECT count(*) FROM fixture_png.upload u JOIN fixture_png.command_effect e
    ON e.run_id=u.run_id AND e.step='claim' AND e.xid=u.claim_xid;`), '1');
  assert.equal(local.admin('SELECT lifecycle_open FROM fixture_png.pin;'), 'f');
});

test('database-clock expiry between prepare and claim fences POST and claims', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'expired', true);
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }));
  assert.deepEqual(local.calls, ['prepare', 'claim', 'close']);
  assert.equal(local.admin("SELECT accepted FROM fixture_png.command_effect WHERE step='claim';"), 'f');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.lease;'), '0');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.upload;'), '0');
  assert.equal(local.admin('SELECT lifecycle_open FROM fixture_png.pin;'), 'f');
});

test('POST lost after lease consumption is independently reconciled with no second POST', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'lost-post', true);
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }));
  const original = local.admin('SELECT xid FROM fixture_png.upload;');
  assert.match(original, /^\d+$/);
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.lease;'), '0');
  local.recoverInNewProcess();
  assert.equal(local.admin('SELECT xid FROM fixture_png.upload;'), original);
  assert.equal(local.admin("SELECT count(*) FROM fixture_png.effects WHERE step='seal';"), '0');
  assert.deepEqual(local.calls, ['prepare', 'claim', 'post', 'close']);
});

test('Seal lost after commit is independently recovered by a fresh process using persisted verifier evidence', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'lost-seal', true);
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }));
  const original = local.admin("SELECT txid FROM fixture_png.effects WHERE step='seal';");
  assert.match(original, /^\d+$/);
  local.recoverInNewProcess();
  assert.equal(local.admin("SELECT txid FROM fixture_png.effects WHERE step='seal';"), original);
  assert.equal(local.admin("SELECT string_agg(step,',' ORDER BY step) FROM fixture_png.effects;"), 'close,seal');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.lease;'), '0');
  assert.deepEqual(local.calls, ['prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'close']);
});

test('revocation after the verifier leaves no Seal or complete effect', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'revoked-before-seal', true);
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }));
  local.recoverInNewProcess();
  assert.equal(local.admin("SELECT string_agg(step,',' ORDER BY step) FROM fixture_png.effects;"), 'close');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.upload;'), '1');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.lease;'), '0');
});

test('revocation before Storage consumes the lease leaves a settled absence after the write fence', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'revoked-before-post', true);
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }));
  local.recoverInNewProcess();
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.upload;'), '0');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.lease;'), '0');
  assert.deepEqual(local.calls, ['prepare', 'claim', 'post', 'close']);
});

test('two simultaneous claim calls win one claim XID and consume it for one POST', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'competing-claim', true);
  await local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes });
  assert.equal(local.admin("SELECT count(*) FROM fixture_png.command_effect WHERE step='claim' AND accepted;"), '1');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.upload;'), '1');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.lease;'), '0');
  assert.equal(local.calls.filter(step => step === 'post').length, 1);
});

test('a corrupt Verifier body fences the missing receipt and retains only the original object', { timeout: 50000 }, async t => {
  const local = await fixture(t, 'corrupt-verifier', true);
  await assert.rejects(local.lifecycle.run({ owner: local.owner, worker: local.worker, bytes }));
  local.recoverInNewProcess();
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.upload;'), '1');
  assert.equal(local.admin("SELECT string_agg(step,',' ORDER BY step) FROM fixture_png.effects;"), 'close');
  assert.equal(local.admin('SELECT count(*) FROM fixture_png.pin WHERE receipt IS NOT NULL;'), '0');
});
}
