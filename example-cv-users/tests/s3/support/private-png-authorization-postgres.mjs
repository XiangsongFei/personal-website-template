import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createPrivatePngAuthorization } from '../../../lib/business/private-png-authorization.node.mjs';
import { binding, closeRequest, command, identityFixture, originalAccount, qualification } from './private-png-authorization-fixture.mjs';

const pgBin = process.env.S35_TEST_PG17_BIN;
assert.ok(isAbsolute(pgBin ?? ''));
const systemEnv = { LC_ALL: 'C', PATH: '/usr/bin:/bin' };
const pg = (name, args, input) => execFileSync(join(pgBin, name), args, {
  input, encoding: 'utf8', timeout: 20_000, env: systemEnv,
});
assert.match(pg('postgres', ['--version']), /\b17\.12\b/);

const port = '54833';
const psqlArgs = (root, role) => ['-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
  '-h', root, '-p', port, '-U', role, '-d', 'postgres'];
const sql = (root, role, query) => pg('psql', psqlArgs(root, role), query).trim();
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const hash = text => createHash('sha256').update(text).digest('hex');
const clock = '(extract(epoch FROM clock_timestamp())*1000)::bigint';

async function inTransaction(root, work) {
  const child = spawn(join(pgBin, 'psql'), psqlArgs(root, 'fixture_writer'), {
    env: systemEnv, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const exited = once(child, 'close');
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  async function query(statement) {
    child.stdin.write(statement + '\n\\echo :END:\n');
    const result = [];
    for (;;) {
      const { value, done } = await lines.next();
      if (done) throw Error('fixture transaction ended without a result');
      if (value === ':END:') return result.join('\n');
      result.push(value);
    }
  }
  try {
    await query('BEGIN; SET LOCAL statement_timeout = 5000;');
    await work(query);
    await query('COMMIT;');
  } finally {
    // Exiting without COMMIT rolls back the scratch transaction.
    child.stdin.end();
    await exited;
  }
}

function runtime(root, journalRoot, fault = false) {
  const identity = identityFixture();
  const read = query => sql(root, 'fixture_observer', query);
  const writer = {
    async transaction(bound, { handle, signal }, work) {
      assert.ok(handle);
      await inTransaction(root, async query => {
        await work({
          async qualification() {
            const proof = await query('SELECT proof FROM fixture_source FOR SHARE;');
            return { ...JSON.parse(proof), now: Number(await query('SELECT ' + clock + ';')) };
          },
          async apply() {
            signal.throwIfAborted();
            await query(`INSERT INTO fixture_events (request_id,intent_sha,lane,db_xid)
              VALUES (${literal(bound.intent.request_id)}, ${literal(bound.intentSha256)}, 'command', pg_current_xact_id());
              INSERT INTO fixture_command_leases VALUES (${literal(bound.intentSha256)});`);
          },
        });
      });
      if (fault) throw Error('fixture reply lost after SQL COMMIT');
    },
    async close(bound, closeId) {
      await inTransaction(root, async query => {
        const owned = await query(`SELECT count(*) FROM fixture_events
          WHERE (request_id,intent_sha,lane)=(${literal(bound.intent.request_id)},${literal(bound.intentSha256)},'command');`);
        assert.equal(owned, '1');
        await query(`DELETE FROM fixture_command_leases WHERE intent_sha=${literal(bound.intentSha256)};
          INSERT INTO fixture_events (request_id,intent_sha,lane,db_xid)
          VALUES (${literal(closeId)},${literal(bound.intentSha256)},'close',pg_current_xact_id());`);
      });
    },
  };
  const observer = {
    async lookup(bound, { request_id, lane }) {
      const row = read(`SELECT row_to_json(e) FROM fixture_events e WHERE request_id=${literal(request_id)};`);
      const event = row && JSON.parse(row);
      return { request_id, lane: event?.lane ?? lane, intent_sha256: event?.intent_sha ?? bound.intentSha256,
        settled: !fault || lane === 'close', disposition: event ? 'committed' : 'absent',
        xid: event?.db_xid ?? null, receipt_sha256: hash(row) };
    },
    async closed(bound, { request_id }) {
      const count = read(`SELECT count(*) FROM fixture_command_leases WHERE intent_sha=${literal(bound.intentSha256)};`);
      return { request_id, intent_sha256: bound.intentSha256, active_command_leases: Number(count),
        in_flight: 0, late_write_possible: fault, closed: count === '0', receipt_sha256: hash(count + request_id) };
    },
  };
  const auth = createPrivatePngAuthorization({ binding, identity, writer, observer, journalRoot,
    python: realpathSync('/usr/bin/python3') });
  return { auth, identity };
}

const phase = process.env.S35_AUTH_FIXTURE_CHILD;
if (phase === 'recover') {
  const root = process.env.S35_AUTH_FIXTURE_ROOT;
  const nonce = process.env.S35_AUTH_FIXTURE_NONCE;
  const tmp = realpathSync('/tmp');
  assert.ok(root?.startsWith(tmp + '/ecv-png-auth-pg-') && isAbsolute(root) && realpathSync(root) === root);
  const stat = lstatSync(root);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o7777) === 0o700);
  assert.equal(readFileSync(join(root, 'fixture-nonce'), 'utf8'), nonce);
  assert.match(nonce, /^[0-9a-f-]{36}$/);
  assert.equal(readFileSync(join(root, 'db', 'PG_VERSION'), 'utf8').trim(), '17');
  const { auth } = runtime(root, join(root, 'journal'));
  const result = await auth.recover({ input: command(), close_request_id: closeRequest, original_account: originalAccount });
  assert.equal(result.recovered, true);
} else {
  test('PG17.12 preserves one committed request and closes it from a fresh process', { timeout: 60_000 }, async t => {
    const root = mkdtempSync(join(realpathSync('/tmp'), 'ecv-png-auth-pg-'));
    const data = join(root, 'db');
    const journalRoot = join(root, 'journal');
    mkdirSync(journalRoot, { mode: 0o700 });
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
    const admin = statement => sql(root, 'fixture_admin', statement);
    admin(`
      CREATE ROLE fixture_writer LOGIN NOBYPASSRLS;
      CREATE ROLE fixture_observer LOGIN NOBYPASSRLS;
      CREATE TABLE fixture_source (proof jsonb);
      CREATE TABLE fixture_events (request_id uuid PRIMARY KEY, intent_sha text NOT NULL, lane text NOT NULL, db_xid xid8 NOT NULL);
      CREATE TABLE fixture_command_leases (intent_sha text PRIMARY KEY);
      GRANT SELECT, UPDATE ON fixture_source TO fixture_writer;
      GRANT SELECT, INSERT ON fixture_events TO fixture_writer;
      GRANT SELECT, INSERT, DELETE ON fixture_command_leases TO fixture_writer;
      GRANT SELECT ON fixture_events, fixture_command_leases TO fixture_observer;
    `);
    const input = command();
    const now = Number(admin('SELECT ' + clock + ';'));
    admin('INSERT INTO fixture_source VALUES (' + literal(JSON.stringify(qualification(input, now))) + ');');
    const { auth, identity } = runtime(root, journalRoot, true);
    const handle = await identity.verifyAccount('fixture-identity');
    await assert.rejects(auth.run({ input, handle, close_request_id: closeRequest }), error =>
      error.errors?.some(cause => cause.message === 'fixture reply lost after SQL COMMIT'));
    assert.equal(admin('SELECT lane FROM fixture_events;'), 'command');
    assert.equal(admin('SELECT count(*) FROM fixture_command_leases;'), '1');
    execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: 'pipe', timeout: 20_000, env: { ...systemEnv, S35_TEST_PG17_BIN: pgBin,
        S35_AUTH_FIXTURE_CHILD: 'recover', S35_AUTH_FIXTURE_ROOT: root, S35_AUTH_FIXTURE_NONCE: nonce },
    });
    assert.equal(admin("SELECT string_agg(lane, ',' ORDER BY lane) FROM fixture_events;"), 'close,command');
    assert.equal(admin('SELECT count(DISTINCT db_xid) FROM fixture_events;'), '2');
    assert.equal(admin('SELECT count(*) FROM fixture_command_leases;'), '0');
  });
}
