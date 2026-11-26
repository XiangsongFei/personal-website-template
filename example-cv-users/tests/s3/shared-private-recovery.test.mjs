import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runPrivateRecovery } from '../../scripts/shared/recovery-journal.node.mjs';

const python = execFileSync('/bin/sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim();
const scope = '1'.repeat(64);
const operation = '2'.repeat(64);
const receipt = { disposition: 'committed', receiptSha256: '3'.repeat(64) };
const closure = { closed: true, receiptSha256: '4'.repeat(64) };
const temp = t => {
  const path = mkdtempSync(join(realpathSync(tmpdir()), 'shared-recovery-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
};
const config = directory => ({
  directory, python, scopeSha256: scope, operations: { business: ['business'], close: ['close'] },
  work() {}, close() {}, observeClosed: () => closure,
});

test('writes the exact intent before dispatch and resolves it once', async t => {
  const options = config(temp(t));
  const calls = [];
  const outcome = await runPrivateRecovery({
    ...options,
    async work(journal) {
      await journal.dispatch('business', operation, () => {
        const intent = JSON.parse(readFileSync(join(options.directory, 'business.intent.json')));
        assert.deepEqual(intent, { scopeSha256: scope, id: 'business', intentSha256: operation });
        calls.push('work');
        return receipt;
      });
      assert.throws(() => journal.dispatch('business', operation, assert.fail), /ALREADY_RESERVED/);
      assert.throws(() => journal.dispatch('close', operation, assert.fail), /OPERATION/);
    },
    async close(journal) {
      calls.push('close');
      const closing = journal.dispatch('close', operation, () => receipt);
      assert.throws(() => journal.reconcile('close', receipt), /IN_FLIGHT/);
      await closing;
    },
    observeClosed(journal) {
      calls.push('observe');
      assert.equal(journal.inspect('close').state, 'resolved');
      return closure;
    },
  });
  assert.deepEqual(calls, ['work', 'close', 'observe']);
  assert.equal(outcome.recovered, false);
  assert.equal((await runPrivateRecovery({ ...options, work: assert.fail, close: assert.fail })).alreadyClosed, true);
  await assert.rejects(runPrivateRecovery({ ...options, scopeSha256: '5'.repeat(64) }), /BINDING/);
});

test('does not let an unawaited effect race close or a second dispatch', async t => {
  const calls = [];
  await runPrivateRecovery({
    ...config(temp(t)),
    work(journal) {
      void journal.dispatch('business', operation, async () => {
        await new Promise(resolve => setImmediate(resolve));
        calls.push('effect completed');
        return receipt;
      });
      assert.throws(() => journal.dispatch('business', operation, assert.fail), /IN_FLIGHT/);
    },
    close() { calls.push('close'); },
  });
  assert.deepEqual(calls, ['effect completed', 'close']);
});

test('abort leaves uncertainty for independent reconciliation and keeps closure authority', async t => {
  const signal = new AbortController();
  const options = config(temp(t));
  await assert.rejects(runPrivateRecovery({
    ...options, signal: signal.signal,
    async work(journal) {
      await journal.dispatch('business', operation, () => {
        signal.abort(new Error('stop business'));
        throw new Error('receipt lost');
      });
    },
    async close(journal) {
      assert.equal(journal.inspect('business').state, 'unknown');
      await journal.dispatch('close', operation, () => receipt);
    },
  }), /PRIVATE_JOURNAL_RUN_FAILED/);
  let observed = false;
  const outcome = await runPrivateRecovery({
    ...options, work: assert.fail,
    close(journal) {
      assert.equal(journal.inspect('close').state, 'resolved');
      journal.reconcile('business', receipt);
      assert.throws(() => journal.dispatch('business', operation, assert.fail), /OPERATION/);
    },
    observeClosed(journal) {
      observed = true;
      assert.equal(journal.inspect('business').state, 'resolved');
      return closure;
    },
  });
  assert.equal(outcome.recovered, true);
  assert.equal(observed, true);
});

test('a killed process releases the kernel lock but its intent stays non-replayable', { timeout: 10000 }, async t => {
  const options = config(temp(t));
  const launcher = [
    'import { runPrivateRecovery } from ' + JSON.stringify(new URL('../../scripts/shared/recovery-journal.node.mjs', import.meta.url).href) + ';',
    'await runPrivateRecovery({ ...JSON.parse(process.argv[1]),',
    'work: journal => journal.dispatch("business", "' + operation + '", () => {',
    'console.log("dispatched"); return new Promise(() => {});',
    '}), close() {}, observeClosed() {} });',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', launcher, JSON.stringify(options)],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => child.kill('SIGKILL'));
  const [ready] = await once(child.stdout, 'data');
  assert.match(ready.toString(), /dispatched/);
  await assert.rejects(runPrivateRecovery(options), /BUSY/);
  const finished = once(child, 'exit');
  child.kill('SIGKILL');
  await finished;
  let outcome;
  for (let i = 0; i < 40 && !outcome; i++) {
    try {
      outcome = await runPrivateRecovery({
        ...options, work: assert.fail,
        close(journal) {
          assert.equal(journal.inspect('business').state, 'unknown');
          journal.reconcile('business', { disposition: 'absent', receiptSha256: receipt.receiptSha256 });
        },
      });
    } catch (error) {
      if (!/BUSY/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  assert.equal(outcome?.recovered, true);
});

test('refuses an outcome detached from the original intent', async t => {
  const options = config(temp(t));
  await assert.rejects(runPrivateRecovery({
    ...options,
    async work(journal) { await journal.dispatch('business', operation, () => receipt); },
    observeClosed: () => ({ closed: false }),
  }), /PRIVATE_JOURNAL_RUN_FAILED/);
  const path = join(options.directory, 'business.result.json');
  const original = JSON.parse(readFileSync(path));
  writeFileSync(path, JSON.stringify({ ...original, intentSha256: '9'.repeat(64) }));
  let checked = false;
  await assert.rejects(runPrivateRecovery({
    ...options, work: assert.fail,
    close(journal) {
      assert.throws(() => journal.inspect('business'), /INCONSISTENT/);
      checked = true;
    },
  }), /PRIVATE_JOURNAL_RUN_FAILED/);
  assert.equal(checked, true);
});
