import { execFileSync, spawn } from 'node:child_process';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const modulePath = fileURLToPath(import.meta.url);
const identifier = value => typeof value === 'string' && /^[a-z_][a-z0-9_]*$/.test(value);
const jwt = value => typeof value === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
const fail = code => { throw new Error('PRIVATE_POSTGREST_' + code); };

function ownedDirectory(path) {
  const info = lstatSync(path);
  if (realpathSync(path) !== path || !info.isDirectory() || info.uid !== process.getuid() ||
      (info.mode & 0o7777) !== 0o700) fail('DIRECTORY');
  return info;
}

function socketIdentity(path, directoryIdentity) {
  const parent = ownedDirectory(dirname(path));
  if (parent.dev !== directoryIdentity.dev || parent.ino !== directoryIdentity.ino) fail('DIRECTORY_CHANGED');
  const socket = lstatSync(path, { throwIfNoEntry: false });
  if (!socket?.isSocket() || socket.uid !== parent.uid || socket.gid !== parent.gid ||
      (socket.mode & 0o7777) !== 0o600) fail('SOCKET');
  return [parent.dev, parent.ino, socket.dev, socket.ino].join('/');
}

function inspect(binary, env) {
  let values;
  try {
    const dump = execFileSync(binary, ['--dump-config'], {
      env, encoding: 'utf8', timeout: 5000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'ignore'],
    });
    values = new Map(dump.split('\n').map(line => {
      const split = line.indexOf(' = ');
      return [line.slice(0, split), line.slice(split + 3)];
    }));
  } catch {
    fail('CONFIG');
  }
  for (const [key, value] of Object.entries({
    'db-config': 'false', 'db-channel-enabled': 'false', 'db-anon-role': '""',
    'db-schemas': JSON.stringify(env.PGRST_DB_SCHEMAS),
    'db-tx-end': JSON.stringify(env.PGRST_DB_TX_END),
    'jwt-aud': JSON.stringify(env.PGRST_JWT_AUD), 'jwt-role-claim-key': '"$$.role"',
    'openapi-mode': '"disabled"',
    'server-unix-socket': JSON.stringify(env.PGRST_SERVER_UNIX_SOCKET), 'server-unix-socket-mode': '"600"',
  })) if (values.get(key) !== value) fail('CONFIG');
}

function observeIdentity(path, rpc, token, signal) {
  return new Promise((resolve, reject) => {
    const pending = request({
      socketPath: path, path: '/rpc/' + rpc, method: 'GET', agent: false, signal,
      headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    }, async response => {
      try {
        if (response.statusCode === 503) {
          response.destroy();
          resolve(null);
          return;
        }
        if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0] !== 'application/json')
          fail('IDENTITY');
        const chunks = [];
        let bytes = 0;
        for await (const chunk of response) {
          bytes += chunk.length;
          if (bytes > 4096) fail('IDENTITY');
          chunks.push(chunk);
        }
        if (!response.complete) fail('IDENTITY');
        resolve(JSON.parse(Buffer.concat(chunks)));
      } catch {
        response.destroy();
        reject(new Error('PRIVATE_POSTGREST_IDENTITY'));
      }
    });
    pending.on('error', () => resolve(null));
    pending.end();
  });
}

// The caller supplies the approved database URI, JWT configuration and a
// read-only SECURITY INVOKER identity RPC in the selected schema.
export async function startPrivatePostgrest({
  binary, databaseUri, jwtSecret, audience, schema, socketPath, transactionEnd = 'rollback',
  identityRpc, identityToken, connectionRole, executionRole, targetFingerprint, signal, startupMs = 5000,
} = {}) {
  if (!isAbsolute(binary ?? '') || !isAbsolute(socketPath ?? '') ||
      !/^postgres(?:ql)?:\/\//.test(databaseUri ?? '') || typeof jwtSecret !== 'string' || !jwtSecret.length ||
      ![audience, schema, identityRpc, connectionRole, executionRole].every(identifier) ||
      !jwt(identityToken) || !/^[a-f0-9]{64}$/.test(targetFingerprint ?? '') || !['rollback', 'commit'].includes(transactionEnd) ||
      !Number.isInteger(startupMs) || startupMs < 1 || startupMs > 15000) fail('OPTIONS');
  signal?.throwIfAborted();
  const directory = dirname(socketPath);
  ownedDirectory(dirname(directory));
  // The caller's enclosing directory is private. An exclusive per-launch
  // directory prevents two launchers from accepting each other's socket.
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) {
    if (error.code === 'EEXIST') fail('SOCKET_DIRECTORY_EXISTS');
    throw error;
  }
  const directoryIdentity = ownedDirectory(directory);
  // Do not inherit PGRST_*, PG*, or other configuration from the launcher.
  const env = {
    PGRST_DB_URI: databaseUri, PGRST_DB_CONFIG: 'false', PGRST_DB_CHANNEL_ENABLED: 'false',
    PGRST_DB_SCHEMAS: schema, PGRST_DB_TX_END: transactionEnd,
    PGRST_JWT_SECRET: jwtSecret, PGRST_JWT_AUD: audience,
    PGRST_OPENAPI_MODE: 'disabled', PGRST_SERVER_UNIX_SOCKET: socketPath, PGRST_SERVER_UNIX_SOCKET_MODE: '600',
  };
  inspect(binary, env);
  const supervisor = spawn(process.execPath, [modulePath, binary], { env, stdio: ['pipe', 'ignore', 'ignore'] });
  supervisor.stdin.on('error', () => {});
  let outcome;
  const exited = new Promise(resolve => {
    supervisor.once('error', () => resolve(outcome = { code: null, signal: null }));
    supervisor.once('close', (code, exitSignal) => resolve(outcome = { code, signal: exitSignal }));
  });
  const stop = () => supervisor.stdin.end();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  void exited.then(() => signal?.removeEventListener('abort', stop));
  try {
    const expired = AbortSignal.timeout(startupMs);
    const startupSignal = signal ? AbortSignal.any([signal, expired]) : expired;
    while (!startupSignal.aborted && !outcome) {
      if (!lstatSync(socketPath, { throwIfNoEntry: false })) {
        await delay(25);
        continue;
      }
      const before = socketIdentity(socketPath, directoryIdentity);
      const who = await observeIdentity(socketPath, identityRpc, identityToken,
        AbortSignal.any([startupSignal, AbortSignal.timeout(400)]));
      if (before !== socketIdentity(socketPath, directoryIdentity)) fail('SOCKET_CHANGED');
      if (who) {
        if (who.connection_role !== connectionRole || who.execution_role !== executionRole ||
            who.target_fingerprint !== targetFingerprint) fail('IDENTITY');
        if (startupSignal.aborted || outcome) break;
        return Object.freeze({ socketPath, connectionRole, executionRole, targetFingerprint, exited,
          close: async () => { stop(); return exited; } });
      }
      await delay(25);
    }
    fail(outcome ? 'EXIT' : 'NOT_READY');
  } catch (error) {
    stop();
    const exit = await exited;
    throw Object.assign(error, { exit });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [binary] = process.argv.slice(2);
  if (process.argv.length !== 3 || !isAbsolute(binary)) process.exit(1);
  // The socket must be private from bind(), before PostgREST applies its chmod.
  // This dedicated supervisor does not change the caller's process mask.
  process.umask(0o177);
  const child = spawn(binary, [], { env: process.env, stdio: 'ignore' });
  let force;
  function stop() {
    if (force) return;
    child.kill('SIGTERM');
    force = setTimeout(() => child.kill('SIGKILL'), 1000);
    force.unref();
  }
  process.stdin.on('end', stop).on('error', stop).resume();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  child.once('error', () => process.exit(1));
  child.once('close', code => {
    clearTimeout(force);
    process.stdin.destroy();
    process.exitCode = force ? 0 : code ?? 1;
  });
}
