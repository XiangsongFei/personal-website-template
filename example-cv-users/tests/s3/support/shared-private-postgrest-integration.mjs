import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { startPrivatePostgrest } from '../../../scripts/shared/private-postgrest.node.mjs';

const pgBin = process.env.SHARED_TEST_PG17_BIN;
const binary = process.env.SHARED_TEST_POSTGREST;
assert.ok(isAbsolute(pgBin ?? '') && isAbsolute(binary ?? ''), 'Provide absolute fixture binary paths');
assert.match(execFileSync(join(pgBin, 'postgres'), ['--version'], { encoding: 'utf8' }), /17\.12\b/);
assert.match(execFileSync(binary, ['--version'], { encoding: 'utf8' }), /16\.6\b/);

test('isolated PostgREST proves the actual roles and disconnects after close or role mismatch', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(realpathSync('/tmp'), 'ecv-shared-pg-'));
  const data = join(directory, 'database');
  const socketDir = join(directory, 'api');
  const port = '54831';
  const pg = (name, ...args) => execFileSync(join(pgBin, name), args, {
    encoding: 'utf8', timeout: 15000, env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' },
  });
  const sql = text => pg('psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-h', directory, '-p', port,
    '-U', 'fixture_admin', '-d', 'postgres', '-c', text).trim();
  let started = false;
  t.after(() => {
    if (started) pg('pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop');
    rmSync(directory, { recursive: true, force: true });
  });
  pg('initdb', '-D', data, '-U', 'fixture_admin', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8');
  pg('pg_ctl', '-D', data, '-l', join(directory, 'server.log'), '-o', '-c listen_addresses= -k ' + directory + ' -p ' + port,
    '-w', 'start');
  started = true;
  const fingerprint = [
    'pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(',
    '(SELECT system_identifier::text FROM pg_catalog.pg_control_system())',
    "|| '/' || (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),",
    "'UTF8')), 'hex')",
  ].join(' ');
  const targetFingerprint = sql('SELECT ' + fingerprint);
  sql([
    'CREATE ROLE shared_login LOGIN NOINHERIT;',
    'CREATE ROLE shared_actor NOLOGIN;',
    'GRANT shared_actor TO shared_login;',
    'CREATE SCHEMA shared_probe;',
    'REVOKE ALL ON SCHEMA shared_probe FROM PUBLIC;',
    'GRANT USAGE ON SCHEMA shared_probe TO shared_actor;',
    'GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO shared_actor;',
    "CREATE FUNCTION shared_probe.observe_identity() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER",
    "AS $$ SELECT jsonb_build_object('connection_role', session_user, 'execution_role', current_user, " +
      "'target_fingerprint', " + fingerprint + ") $$;",
    'REVOKE ALL ON FUNCTION shared_probe.observe_identity() FROM PUBLIC;',
    'GRANT EXECUTE ON FUNCTION shared_probe.observe_identity() TO shared_actor;',
  ].join('\n'));
  const secret = randomBytes(32).toString('hex');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'HS256' }) + '.' +
    encode({ role: 'shared_actor', aud: 'fixture_audience', exp: Math.floor(Date.now() / 1000) + 60 });
  const authenticated = unsigned + '.' + createHmac('sha256', secret).update(unsigned).digest('base64url');
  const options = {
    binary, databaseUri: 'postgresql://shared_login@localhost/postgres?host=' + encodeURIComponent(directory) + '&port=' + port,
    jwtSecret: secret, audience: 'fixture_audience', schema: 'shared_probe', socketPath: join(socketDir, 'proof.sock'),
    identityRpc: 'observe_identity', identityToken: authenticated, targetFingerprint,
    connectionRole: 'shared_login', executionRole: 'shared_actor',
  };
  const count = () => Number(sql("SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE usename = 'shared_login';"));
  assert.equal(count(), 0);
  const runtime = await startPrivatePostgrest(options);
  t.after(() => runtime.close());
  assert.equal(runtime.connectionRole, 'shared_login');
  assert.equal(runtime.executionRole, 'shared_actor');
  assert.ok(count() > 0);
  await assert.rejects(startPrivatePostgrest(options), /PRIVATE_POSTGREST_SOCKET_DIRECTORY_EXISTS/);
  assert.equal((await runtime.close()).code, 0);
  assert.equal(count(), 0);

  const other = join(directory, 'other');
  await assert.rejects(startPrivatePostgrest({ ...options, socketPath: join(other, 'proof.sock'), executionRole: 'wrong_role' }),
    /PRIVATE_POSTGREST_IDENTITY/);
  assert.equal(count(), 0);

  await assert.rejects(startPrivatePostgrest({ ...options, socketPath: join(directory, 'foreign', 'proof.sock'),
    targetFingerprint: '9'.repeat(64) }), /PRIVATE_POSTGREST_IDENTITY/);
  assert.equal(count(), 0);

  const abandoned = join(directory, 'abandoned');
  const program = [
    'import { readFileSync } from "node:fs";',
    'import { startPrivatePostgrest } from ' +
      JSON.stringify(new URL('../../../scripts/shared/private-postgrest.node.mjs', import.meta.url).href) + ';',
    'const runtime = await startPrivatePostgrest(JSON.parse(readFileSync(0, "utf8")));',
    'console.log("ready"); await runtime.exited;',
  ].join('\n');
  const launcher = spawn(process.execPath, ['--input-type=module', '-e', program], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  launcher.stdin.on('error', () => {});
  t.after(() => launcher.kill('SIGKILL'));
  launcher.stdin.end(JSON.stringify({ ...options, socketPath: join(abandoned, 'proof.sock') }));
  const childExit = once(launcher, 'exit');
  const readiness = await Promise.race([
    once(launcher.stdout, 'data').then(([value]) => value.toString('utf8').trim()),
    childExit.then(() => 'early exit'),
    delay(8000, 'timeout', { ref: false }),
  ]);
  assert.equal(readiness, 'ready');
  assert.ok(count() > 0);
  launcher.kill('SIGKILL');
  await childExit;
  for (let attempt = 0; attempt < 40 && count() > 0; attempt++) await delay(50);
  assert.equal(count(), 0);
});
