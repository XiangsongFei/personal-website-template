import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  readFileSync, realpathSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const operationId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const fail = code => { throw new Error('PRIVATE_JOURNAL_' + code); };

const leaseProgram = [
  'import fcntl, os, stat, sys',
  'try:',
  '    fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)',
  '    info = os.fstat(fd)',
  '    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:',
  '        sys.exit(3)',
  '    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)',
  '    print("locked", flush=True)',
  '    sys.stdin.buffer.read()',
  'except OSError:',
  '    sys.exit(4)',
].join('\n');

async function lock(directory, python) {
  const child = spawn(python, ['-I', '-c', leaseProgram, join(directory, 'runner.lock')], {
    env: { LC_ALL: 'C' }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.stdin.on('error', () => {});
  const lease = new AbortController();
  const done = new Promise(resolve => {
    child.once('error', resolve);
    child.once('close', resolve);
  }).then(() => lease.abort(new Error('PRIVATE_JOURNAL_LEASE_LOST')));
  const release = async () => { child.stdin.end(); await done; };
  const locked = await Promise.race([
    once(child.stdout, 'data').then(([value]) => value.toString('ascii') === 'locked\n', () => false),
    done.then(() => false),
    delay(3000, false, { ref: false }),
  ]);
  if (!locked || lease.signal.aborted) {
    child.kill();
    await release();
    fail('BUSY');
  }
  return { signal: lease.signal, release };
}

function read(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600 || stat.size > 8192)
      fail('UNSAFE_RECORD');
    const record = JSON.parse(readFileSync(fd, 'utf8'));
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail('UNSAFE_RECORD');
    return record;
  } finally {
    closeSync(fd);
  }
}

// A complete, fsynced record is visible before the caller can dispatch.
function write(directory, name, value) {
  const temporary = join(directory, '.record-' + randomUUID());
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      writeFileSync(fd, JSON.stringify(value) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    linkSync(temporary, join(directory, name));
  } finally {
    unlinkSync(temporary);
  }
  const dir = openSync(directory, 'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

function verifiedReceipt(value) {
  if (!value || !['committed', 'absent'].includes(value.disposition) || !digest(value.receiptSha256))
    fail('EVIDENCE');
  return { disposition: value.disposition, receiptSha256: value.receiptSha256 };
}

// A reopened run receives only the close lane. The adapters retain the
// authorized target, operation semantics and independent source of evidence.
export async function runPrivateRecovery({
  directory, python, scopeSha256, operations, signal, work, close, observeClosed,
} = {}) {
  if (!isAbsolute(directory ?? '') || !isAbsolute(python ?? '') || !digest(scopeSha256) ||
      !Array.isArray(operations?.business) || !Array.isArray(operations?.close) ||
      ![work, close, observeClosed].every(value => typeof value === 'function') || close === observeClosed)
    fail('OPTIONS');
  const lanes = { business: [...operations.business], close: [...operations.close] };
  const names = [...lanes.business, ...lanes.close];
  if (!names.every(operationId) || new Set(names).size !== names.length) fail('OPERATIONS');
  const stat = lstatSync(directory);
  if (realpathSync(directory) !== directory || !stat.isDirectory() || stat.uid !== process.getuid() ||
      (stat.mode & 0o7777) !== 0o700) fail('DIRECTORY');
  const config = { scopeSha256, operations: lanes };
  const lease = await lock(directory, python);
  const workSignal = signal ? AbortSignal.any([signal, lease.signal]) : lease.signal;
  let current = null;
  let pending;
  let pendingOperation;

  const inspect = id => {
    if (!names.includes(id)) fail('OPERATION');
    const intent = read(join(directory, id + '.intent.json'));
    const result = read(join(directory, id + '.result.json'));
    if (!intent) {
      if (result) fail('INCONSISTENT');
      return Object.freeze({ state: 'not-started' });
    }
    if (intent.id !== id || intent.scopeSha256 !== scopeSha256 || !digest(intent.intentSha256)) fail('INCONSISTENT');
    if (result && (result.id !== id || result.scopeSha256 !== scopeSha256 ||
      result.intentSha256 !== intent.intentSha256)) fail('INCONSISTENT');
    return Object.freeze({ state: result ? 'resolved' : 'unknown', id, scopeSha256, intentSha256: intent.intentSha256,
      ...(result ? verifiedReceipt(result) : {}) });
  };

  function interfaceFor(lane, laneSignal) {
    const active = () => {
      if (current !== lane) fail('INACTIVE');
      laneSignal.throwIfAborted();
    };
    const record = (id, receipt) => {
      active();
      const intent = inspect(id);
      if (intent.state !== 'unknown') fail('STATE');
      const result = verifiedReceipt(receipt);
      write(directory, id + '.result.json', { scopeSha256, id, intentSha256: intent.intentSha256, ...result });
      return result;
    };
    return Object.freeze({
      signal: laneSignal,
      inspect(id) { active(); return inspect(id); },
      // A recovery observer resolves the original intent. It cannot dispatch it.
      reconcile(id, receipt) {
        if (lane !== 'close') fail('LANE');
        if (pendingOperation === id) fail('IN_FLIGHT');
        return record(id, receipt);
      },
      dispatch(id, intentSha256, effect) {
        active();
        if (!lanes[lane].includes(id) || !digest(intentSha256) || typeof effect !== 'function') fail('OPERATION');
        if (pending) fail('IN_FLIGHT');
        if (inspect(id).state !== 'not-started') fail('ALREADY_RESERVED');
        write(directory, id + '.intent.json', { scopeSha256, id, intentSha256 });
        active();
        const dispatched = Promise.resolve().then(() => {
          active();
          return effect(laneSignal);
        }).then(receipt => record(id, receipt));
        pending = dispatched;
        pendingOperation = id;
        const settled = () => { pending = undefined; pendingOperation = undefined; };
        dispatched.then(settled, settled);
        return dispatched;
      },
    });
  }

  try {
    const old = read(join(directory, 'run.json'));
    const priorClosure = read(join(directory, 'closed.json'));
    if ((old && JSON.stringify(old) !== JSON.stringify(config)) || (!old && priorClosure)) fail('BINDING');
    if (priorClosure) {
      if (priorClosure.scopeSha256 !== scopeSha256 || !digest(priorClosure.receiptSha256)) fail('INCONSISTENT');
      return { recovered: true, alreadyClosed: true, receiptSha256: priorClosure.receiptSha256 };
    }
    if (!old) write(directory, 'run.json', config);
    const failures = [];
    if (!old) {
      current = 'business';
      try {
        workSignal.throwIfAborted();
        await work(interfaceFor('business', workSignal));
      } catch (error) { failures.push(error); }
      try { await pending; } catch (error) { failures.push(error); }
    }
    current = 'close';
    try {
      lease.signal.throwIfAborted();
      await close(interfaceFor('close', lease.signal));
    } catch (error) { failures.push(error); }
    try { await pending; } catch (error) { failures.push(error); }
    current = null;
    let receiptSha256;
    try {
      lease.signal.throwIfAborted();
      const evidence = await observeClosed(Object.freeze({
        signal: lease.signal,
        inspect(id) { lease.signal.throwIfAborted(); return inspect(id); },
      }));
      lease.signal.throwIfAborted();
      if (evidence?.closed !== true || !digest(evidence.receiptSha256)) fail('CLOSURE_UNPROVEN');
      if (names.some(id => inspect(id).state === 'unknown')) fail('UNRESOLVED');
      receiptSha256 = evidence.receiptSha256;
      write(directory, 'closed.json', { scopeSha256, receiptSha256 });
    } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'PRIVATE_JOURNAL_RUN_FAILED');
    return { recovered: Boolean(old), alreadyClosed: false, receiptSha256 };
  } finally {
    current = null;
    await lease.release();
  }
}
