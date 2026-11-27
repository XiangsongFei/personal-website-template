import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { bytes, lifecycleFixture } from './private-png-lifecycle-fixture.mjs';

const pgBin = process.env.S35_TEST_PG17_BIN;
assert.ok(isAbsolute(pgBin ?? ''));
const systemEnv = { LC_ALL: 'C', PATH: '/usr/bin:/bin' };
const pg = (name, args, input) => execFileSync(join(pgBin, name), args, {
  input, encoding: 'utf8', timeout: 20_000, env: systemEnv,
});
assert.match(pg('postgres', ['--version']), /\b17\.12\b/);
const tmp = realpathSync('/tmp');
const port = '54834';
const psql = (root, role, query) => pg('psql', ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
  '-h', root, '-p', port, '-U', role, '-d', 'postgres'], query).trim();
const literal = value => "'" + value.replaceAll("'", "''") + "'";

function fixtureStore(root) {
  const write = query => psql(root, 'fixture_writer', query);
  const read = query => psql(root, 'fixture_observer', query);
  return {
    add(id, value, effect) {
      if (value.verifier_receipt) {
        writeFileSync(join(root, 'verified-' + id + '.json'), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        return;
      }
      const key = literal(id);
      const sql = effect === 'open' ? 'INSERT INTO fixture_leases VALUES (' + key + ');' :
        effect === 'close' ? 'DELETE FROM fixture_leases;' :
          effect?.closeLease ? 'DELETE FROM fixture_leases WHERE request_id=' + literal(effect.closeLease) + ';' : '';
      write(`BEGIN;
        INSERT INTO fixture_effects VALUES (${key}, ${literal(JSON.stringify(value))}, pg_current_xact_id());
        ${sql}
        COMMIT;`);
    },
    get(id) {
      const receipt = join(root, 'verified-' + id + '.json');
      if (lstatSync(receipt, { throwIfNoEntry: false })?.isFile()) return JSON.parse(readFileSync(receipt, 'utf8'));
      const row = read(`SELECT payload || jsonb_build_object('xid',db_xid::text) FROM fixture_effects
        WHERE request_id=${literal(id)};`);
      return row ? JSON.parse(row) : undefined;
    },
    hasLease(id) { return read('SELECT EXISTS(SELECT FROM fixture_leases WHERE request_id=' + literal(id) + ');') === 't'; },
    countLeases() { return Number(read('SELECT count(*) FROM fixture_leases;')); },
  };
}

const phase = process.env.S35_PNG_FIXTURE_PHASE;
if (phase) {
  const root = process.env.S35_PNG_FIXTURE_ROOT;
  const nonce = process.env.S35_PNG_FIXTURE_NONCE;
  assert.ok(root?.startsWith(tmp + '/ecv-png-life-pg-') && isAbsolute(root) && realpathSync(root) === root);
  const stat = lstatSync(root);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o700);
  assert.match(nonce, /^[0-9a-f-]{36}$/);
  assert.equal(readFileSync(join(root, 'fixture-nonce'), 'utf8'), nonce);
  assert.equal(readFileSync(join(root, 'data', 'PG_VERSION'), 'utf8').trim(), '17');
  const work = join(root, process.env.S35_PNG_FIXTURE_CASE);
  assert.ok(['post', 'seal'].includes(process.env.S35_PNG_FIXTURE_CASE));
  const calls = [];
  const { lifecycle, owner, worker } = await lifecycleFixture({
    root: work, authRoot: join(work, 'commands'), calls, store: fixtureStore(root),
    python: realpathSync('/usr/bin/python3'), fault: phase === 'dispatch' ? { kill: process.env.S35_PNG_FIXTURE_CASE } : {},
  });
  if (phase === 'dispatch') {
    await lifecycle.run({ owner, worker, bytes });
    assert.fail('The prior process must end before recording its result');
  }
  assert.equal(phase, 'recover');
  assert.equal((await lifecycle.recover()).recovered, true);
  assert.deepEqual(calls, ['close']);
} else {
  test('PG17.12 holds POST and Seal originals across a killed process and exact close', { timeout: 80_000 }, async t => {
    const root = mkdtempSync(join(tmp, 'ecv-png-life-pg-'));
    const data = join(root, 'data');
    const nonce = randomUUID();
    writeFileSync(join(root, 'fixture-nonce'), nonce, { mode: 0o600, flag: 'wx' });
    let started = false;
    t.after(() => {
      if (started) pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
      rmSync(root, { recursive: true, force: true });
    });
    pg('initdb', ['-D', data, '-U', 'fixture_admin', '--no-locale', '--encoding=UTF8',
      '--auth-local=trust', '--auth-host=reject']);
    pg('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o',
      '-c listen_addresses= -k ' + root + ' -p ' + port, '-w', 'start']);
    started = true;
    const admin = statement => psql(root, 'fixture_admin', statement);
    admin(`
      CREATE ROLE fixture_writer LOGIN NOBYPASSRLS;
      CREATE ROLE fixture_observer LOGIN NOBYPASSRLS;
      CREATE TABLE fixture_effects (request_id uuid PRIMARY KEY, payload jsonb NOT NULL, db_xid xid8 NOT NULL);
      CREATE TABLE fixture_leases (request_id uuid PRIMARY KEY);
      GRANT INSERT ON fixture_effects TO fixture_writer;
      GRANT INSERT, DELETE ON fixture_leases TO fixture_writer;
      GRANT SELECT (request_id) ON fixture_leases TO fixture_writer;
      GRANT SELECT ON fixture_effects, fixture_leases TO fixture_observer;
    `);
    const run = (subphase, faultCase) => spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      encoding: 'utf8', timeout: 20_000, env: { ...systemEnv, S35_TEST_PG17_BIN: pgBin,
        S35_PNG_FIXTURE_PHASE: subphase, S35_PNG_FIXTURE_CASE: faultCase,
        S35_PNG_FIXTURE_ROOT: root, S35_PNG_FIXTURE_NONCE: nonce },
    });
    for (const faultCase of ['post', 'seal']) {
      const work = join(root, faultCase);
      mkdirSync(work, { mode: 0o700 });
      mkdirSync(join(work, 'commands'), { mode: 0o700 });
      const dispatched = run('dispatch', faultCase);
      assert.equal(dispatched.signal, 'SIGKILL', dispatched.stderr);
      assert.equal(admin('SELECT count(*) FROM fixture_leases;'), '1');
      const original = admin("SELECT db_xid FROM fixture_effects WHERE payload ? 'permit_consumed';");
      assert.match(original, /^[1-9][0-9]*$/);
      const recovery = run('recover', faultCase);
      assert.equal(recovery.status, 0, recovery.stderr);
      assert.equal(admin("SELECT db_xid FROM fixture_effects WHERE payload ? 'permit_consumed';"), original);
      assert.equal(admin('SELECT count(*) FROM fixture_leases;'), '0');
      assert.equal(admin("SELECT count(*) FROM fixture_effects WHERE payload->>'state'='ready';"), '0');
      assert.equal(admin("SELECT count(*) FROM fixture_effects WHERE payload->>'state'='sealed';"),
        faultCase === 'seal' ? '1' : '0');
      assert.doesNotThrow(() => lstatSync(join(work, 'closed.json')));
      admin('TRUNCATE fixture_effects;');
    }
  });
}
