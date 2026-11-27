import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

function sizedOperations(bytes) {
  const slots = bytes === 9222 ? 140 : 124;
  const ids = Array.from({ length: slots }, (_, i) => ('id-' + i).padEnd(62, 'x'));
  const operations = { business: bytes === 9222 ? ids : ['business', ...ids], close: ['close'] };
  const size = () => Buffer.byteLength(JSON.stringify({ scopeSha256: scope, operations }) + '\n', 'utf8');
  const last = operations.business.length - 1;
  const excess = size() - bytes;
  assert.ok(excess > 0 && excess < 20);
  operations.business[last] = operations.business[last].slice(0, -excess);
  assert.equal(size(), bytes);
  return operations;
}

for (const bytes of [8193, 9222]) {
  test(bytes + '-byte configuration is rejected before any journal files or adapters', async t => {
    const directory = temp(t);
    await assert.rejects(runPrivateRecovery({
      ...config(directory), operations: sizedOperations(bytes),
      work: assert.fail, close: assert.fail, observeClosed: () => assert.fail('closure observer ran'),
    }), /PRIVATE_JOURNAL_RECORD_TOO_LARGE/);
    assert.deepEqual(readdirSync(directory), []);
  });
}

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

test('seals business and close intake before detached continuations can reserve intents', async t => {
  const directory = temp(t);
  const calls = [];
  const permissions = new Set();
  let lateBusiness;
  let lateClose;
  await runPrivateRecovery({
    ...config(directory),
    operations: { business: ['first', 'second', 'late-business'], close: ['close', 'late-close'] },
    async work(journal) {
      await journal.dispatch('first', operation, () => {
        calls.push('first');
        permissions.add('first');
        return receipt;
      });
      const second = journal.dispatch('second', operation, async () => {
        await new Promise(resolve => setImmediate(resolve));
        calls.push('second');
        permissions.add('second');
        return receipt;
      });
      lateBusiness = second.then(() => assert.rejects(
        async () => journal.dispatch('late-business', operation, assert.fail), /INACTIVE/,
      ));
    },
    close(journal) {
      calls.push('close-started');
      assert.equal(journal.inspect('first').state, 'resolved');
      assert.equal(journal.inspect('second').state, 'resolved');
      const closing = journal.dispatch('close', operation, async () => {
        await new Promise(resolve => setImmediate(resolve));
        permissions.clear();
        calls.push('close-completed');
        return receipt;
      });
      lateClose = closing.then(() => assert.rejects(
        async () => journal.dispatch('late-close', operation, assert.fail), /INACTIVE/,
      ));
    },
    observeClosed(journal) {
      calls.push('observe');
      assert.equal(journal.inspect('close').state, 'resolved');
      assert.equal(journal.inspect('late-business').state, 'not-started');
      assert.equal(journal.inspect('late-close').state, 'not-started');
      assert.equal(permissions.size, 0);
      return closure;
    },
  });
  await Promise.all([lateBusiness, lateClose]);
  assert.deepEqual(calls, ['first', 'second', 'close-started', 'close-completed', 'observe']);
  for (const id of ['late-business', 'late-close']) {
    assert.ok(!readdirSync(directory).includes(id + '.intent.json'));
  }
});

test('rejects detached microtasks queued before an async callback settles', async t => {
  const directory = temp(t);
  const late = [];
  function checkDetached(journal, id) {
    late.push(new Promise((resolve, reject) => queueMicrotask(() => {
      assert.rejects(async () => journal.dispatch(id, operation, assert.fail), /INACTIVE/)
        .then(resolve, reject);
    })));
  }
  await runPrivateRecovery({
    ...config(directory),
    operations: { business: ['business'], close: ['close'] },
    async work(journal) { checkDetached(journal, 'business'); },
    async close(journal) { checkDetached(journal, 'close'); },
    observeClosed(journal) {
      assert.equal(journal.inspect('business').state, 'not-started');
      assert.equal(journal.inspect('close').state, 'not-started');
      return closure;
    },
  });
  await Promise.all(late);
  assert.ok(!readdirSync(directory).some(name => name.endsWith('.intent.json')));
});

test('drains an accepted effect on callback failure and reconciles its lost receipt before closing', async t => {
  const directory = temp(t);
  const evidence = join(directory, 'observed-effect');
  const options = config(directory);
  const calls = [];
  await assert.rejects(runPrivateRecovery({
    ...options,
    work(journal) {
      void journal.dispatch('business', operation, async () => {
        await new Promise(resolve => setImmediate(resolve));
        writeFileSync(evidence, 'committed', { flag: 'wx' });
        calls.push('effect');
        throw new Error('receipt lost');
      });
      throw new Error('work stopped');
    },
    async close(journal) {
      const original = journal.inspect('business');
      assert.equal(original.state, 'unknown');
      assert.equal(original.intentSha256, operation);
      assert.equal(readFileSync(evidence, 'utf8'), 'committed');
      journal.reconcile('business', receipt);
      await journal.dispatch('close', operation, () => {
        calls.push('close');
        return receipt;
      });
    },
    observeClosed(journal) {
      assert.equal(journal.inspect('business').disposition, 'committed');
      assert.equal(journal.inspect('close').state, 'resolved');
      return closure;
    },
  }), error => error instanceof AggregateError &&
    error.errors.some(cause => cause.message === 'receipt lost'));
  assert.deepEqual(calls, ['effect', 'close']);
  const reopened = await runPrivateRecovery({
    ...options, work: assert.fail, close: assert.fail, observeClosed: () => assert.fail('already closed'),
  });
  assert.equal(reopened.alreadyClosed, true);
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

test('an 8192-byte run recovers its original intent after a killed process', { timeout: 10000 }, async t => {
  const options = config(temp(t));
  options.operations = sizedOperations(8192);
  const effectPath = join(options.directory, 'synthetic-effect');
  const launcher = [
    'import { runPrivateRecovery } from ' + JSON.stringify(new URL('../../scripts/shared/recovery-journal.node.mjs', import.meta.url).href) + ';',
    'import { writeFileSync } from "node:fs";',
    'await runPrivateRecovery({ ...JSON.parse(process.argv[1]),',
    'work: journal => { void journal.dispatch("business", "' + operation + '", () => {',
    'writeFileSync(process.argv[2], "committed", {flag:"wx", mode:0o600});',
    'console.log("dispatched"); return new Promise(() => {});',
    '}); }, close() {}, observeClosed() {} });',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '-e', launcher, JSON.stringify(options), effectPath],
    { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => child.kill('SIGKILL'));
  const [ready] = await once(child.stdout, 'data');
  assert.match(ready.toString(), /dispatched/);
  assert.equal(readFileSync(join(options.directory, 'run.json')).length, 8192);
  await assert.rejects(runPrivateRecovery(options), /BUSY/);
  const finished = once(child, 'exit');
  child.kill('SIGKILL');
  await finished;
  let outcome;
  for (let i = 0; i < 40 && !outcome; i++) {
    try {
      outcome = await runPrivateRecovery({
        ...options, work: assert.fail,
        async close(journal) {
          const original = journal.inspect('business');
          assert.equal(original.state, 'unknown');
          assert.equal(original.intentSha256, operation);
          assert.equal(readFileSync(effectPath, 'utf8'), 'committed');
          assert.throws(() => journal.dispatch('business', operation, assert.fail), /OPERATION/);
          journal.reconcile('business', receipt);
          await journal.dispatch('close', operation, () => receipt);
        },
        observeClosed(journal) {
          assert.equal(journal.inspect('business').disposition, 'committed');
          assert.equal(journal.inspect('close').state, 'resolved');
          return closure;
        },
      });
    } catch (error) {
      if (!/BUSY/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  assert.equal(outcome?.recovered, true);
  assert.equal((await runPrivateRecovery({ ...options, work: assert.fail, close: assert.fail })).alreadyClosed, true);
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
