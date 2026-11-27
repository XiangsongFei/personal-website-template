import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';
import { bindPrivatePngLifecyclePlan } from '../../../lib/business/private-png-lifecycle.node.mjs';
import { createPrivatePngPostgrestAdapters } from '../../../lib/business/private-png-postgrest.node.mjs';
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
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const writerSteps = ['seal', 'complete', 'close'];

async function fixture(t, fault) {
  const root = mkdtempSync(join(realpathSync('/tmp'), 'ecv-png-tail-'));
  const data = join(root, 'db');
  const journal = join(root, 'journal');
  mkdirSync(journal, { mode: 0o700 });
  mkdirSync(join(journal, 'commands'), { mode: 0o700 });
  const leases = [];
  let started = false;
  t.after(async () => {
    try {
      await Promise.all(leases.map(handle => handle.close()));
      if (started) pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const port = '54838';
  pg('initdb', ['-D', data, '-U', 'fixture_admin', '--no-locale', '--encoding=UTF8',
    '--auth-local=trust', '--auth-host=reject']);
  pg('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o',
    '-c listen_addresses= -k ' + root + ' -p ' + port, '-w', 'start']);
  started = true;
  const admin = query => pg('psql', ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', root, '-p', port, '-U', 'fixture_admin', '-d', 'postgres'], query).trim();
  admin(sqlFixture);
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
      audience: 'fixture_png', schema: 'site_api', socketPath: join(root, step, 'rpc.sock'),
      identityRpc: 'observe_identity', identityToken: token(executionRole),
      connectionRole, executionRole, targetFingerprint: fingerprint,
    });
    leases.push(runtime);
    return { runtime, credential: async () => {
      credentialReads++;
      return token(executionRole);
    } };
  }
  const [seal, complete, close, observer] = await Promise.all([...writerSteps, 'observe'].map(openStep));
  const writers = { seal, complete, close };
  const store = await memoryStore();
  const calls = [];
  let captured;
  let proofUnavailable = fault === 'lost-seal';
  async function createTail({ binding, plan: input }) {
    const { plan, planSha256 } = bindPrivatePngLifecyclePlan(binding, input);
    const intent = step => ({ plan, plan_sha256: planSha256, step, request_id: plan.requests[step],
      intent_sha256: sha([planSha256, step]) });
    const ids = Object.fromEntries(writerSteps.map(step => [step, intent(step).intent_sha256]));
    const options = { binding, plan: input, targetFingerprint: fingerprint, closeRole: 'fixture_png_close', writers, observer };
    const adapters = createPrivatePngPostgrestAdapters(options);
    captured = { ...captured, intent, adapters, options };
    const prior = admin('SELECT count(*) FROM fixture_png.pin;');
    if (prior === '0') admin(`INSERT INTO fixture_png.pin(run_id,project,keys,intents)
      VALUES (${literal(plan.run_id)}, ${literal(plan.project)}, ${literal(JSON.stringify(plan.requests))}, ${literal(JSON.stringify(ids))});`);
    return {
      writer: {
        ...adapters.writer,
        async seal(...args) {
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
  }
  const makeLifecycle = () => lifecycleFixture({ root: journal, authRoot: join(journal, 'commands'),
    python: realpathSync('/usr/bin/python3'), store, calls, createTail,
    roles: { seal: 'fixture_png_seal', complete: 'fixture_png_complete' } });
  return { ...(await makeLifecycle()), calls, admin, makeLifecycle, captured: () => captured,
    credentialReads: () => credentialReads,
    restoreObserver() { proofUnavailable = false; } };
}

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
