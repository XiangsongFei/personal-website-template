import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bytes, lifecycleFixture, memoryStore } from './support/private-png-lifecycle-fixture.mjs';

async function setup(t, fault, store, saved) {
  const root = saved?.root ?? mkdtempSync(join(realpathSync('/tmp'), 'ecv-png-lifecycle-'));
  const authRoot = join(root, 'commands');
  if (!saved) {
    mkdirSync(authRoot, { mode: 0o700 });
    t.after(() => rmSync(root, { recursive: true, force: true }));
  }
  const persistence = store ?? await memoryStore();
  const calls = [];
  return { root, store: persistence, calls, ...await lifecycleFixture({
    root, authRoot, store: persistence, calls, fault, python: realpathSync('/usr/bin/python3'),
  }) };
}

test('Owner and separate Worker complete the single create-only PNG flow', async t => {
  const run = await setup(t);
  const result = await run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes });
  assert.deepEqual(run.calls, ['prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'complete', 'close']);
  assert.equal(result.completed.asset.native_version, run.store.get(run.requests.post).asset.native_version);
  assert.equal(result.completed.completeXid, run.store.get(run.requests.complete).xid);
  assert.equal(result.completed.verifierSha256, run.store.get(run.requests.seal).verifier_sha256);
  assert.equal(run.store.countLeases(), 0);
  assert.equal((await run.lifecycle.recover()).alreadyClosed, true);
  const intent = readFileSync(join(run.root, 'post.intent.json'), 'utf8');
  assert.doesNotMatch(intent, /fixture-worker|Bearer|image\/png/);
});

test('wrong Worker and different bytes cause zero stage effects', async t => {
  const run = await setup(t);
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.owner, bytes }), { code: 'BUSINESS_DENIED' });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes: bytes.subarray(10) }),
    { code: 'INVALID_CONTENT' });
  assert.deepEqual(run.calls, []);
});

for (const option of ['badPermit', 'badVersion', 'cached', 'corrupt', 'revokedAfterRead']) {
  test(option + ' cannot reach Seal or ready', async t => {
    const run = await setup(t, { [option]: true });
    await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
    assert.equal(run.calls.includes('seal'), false);
    assert.equal(run.calls.includes('complete'), false);
    assert.equal(run.calls.filter(step => step === 'post').length, 1);
    assert.equal(run.store.countLeases(), 0);
    assert.equal(run.calls.at(-1), 'close');
  });
}

for (const step of ['post', 'seal']) {
  test('a lost ' + step + ' receipt can only be reconciled by its original key', async t => {
    const run = await setup(t, { lost: step, unknown: step });
    await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
    assert.equal(run.store.countLeases(), 0);
    assert.equal(run.calls.at(-1), 'close');
    assert.equal(run.calls.includes('complete'), false);
    const recovered = await setup(t, {}, run.store, run);
    assert.equal((await recovered.lifecycle.recover()).recovered, true);
    assert.deepEqual(recovered.calls, []);
    assert.equal((await recovered.lifecycle.recover()).alreadyClosed, true);
  });
}

test('terminal protection drift prevents a closed receipt', async t => {
  const run = await setup(t, { drift: true });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
  assert.equal(run.store.countLeases(), 0);
  assert.equal(run.calls.at(-1), 'close');
  assert.equal(run.calls.filter(step => step === 'close').length, 1);
});

test('settled Seal with a different verifier digest or version remains unknown', async t => {
  const run = await setup(t, { lost: 'seal', unknown: 'seal' });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);

  const original = run.store.get(run.requests.seal);
  for (const changed of [
    { verifier_sha256: 'a'.repeat(64) },
    { asset: { ...original.asset, native_version: original.asset.object_version } },
  ]) {
    const wrong = await setup(t, { alter: 'seal', changed }, run.store, run);
    await assert.rejects(wrong.lifecycle.recover(), AggregateError);
    assert.deepEqual(wrong.calls, []);
  }
  const right = await setup(t, {}, run.store, run);
  assert.equal((await right.lifecycle.recover()).recovered, true);
  assert.deepEqual(right.calls, []);
});

test('a changed retained version prevents closed status', async t => {
  const run = await setup(t, { retainedDrift: true });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
  assert.equal(run.calls.at(-1), 'close');
  assert.equal(run.store.countLeases(), 0);
  const restored = await setup(t, {}, run.store, run);
  assert.equal((await restored.lifecycle.recover()).recovered, true);
  assert.deepEqual(restored.calls, []);
});

test('complete evidence pointing at another Seal XID cannot permit closure', async t => {
  const run = await setup(t, { otherSeal: true });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
  assert.equal(run.calls.at(-1), 'close');
  assert.equal(run.store.countLeases(), 0);
  const unresolved = await setup(t, {}, run.store, run);
  await assert.rejects(unresolved.lifecycle.recover(), AggregateError);
  assert.deepEqual(unresolved.calls, []);
});

test('claim that reserved another POST key cannot dispatch bytes', async t => {
  const run = await setup(t, { wrongPostKey: true });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
  assert.deepEqual(run.calls, ['prepare', 'claim', 'close']);
  assert.equal(run.store.countLeases(), 0);
});

test('original POST requires the frozen claim XID on recovery', async t => {
  const run = await setup(t, { otherClaim: true });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
  assert.deepEqual(run.calls, ['prepare', 'claim', 'post', 'close']);
  await assert.rejects(run.lifecycle.recover(), AggregateError);
  assert.equal(run.calls.filter(step => step === 'post').length, 1);
});

test('an unsettled original command scope prevents final closure', async t => {
  const run = await setup(t, { innerLate: 'claim' });
  await assert.rejects(run.lifecycle.run({ owner: run.owner, worker: run.worker, bytes }), AggregateError);
  assert.equal(run.calls.at(-1), 'close');
  const restored = await setup(t, {}, run.store, run);
  assert.equal((await restored.lifecycle.recover()).recovered, true);
  assert.deepEqual(restored.calls, []);
});
