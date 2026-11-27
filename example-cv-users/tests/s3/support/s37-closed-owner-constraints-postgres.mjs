import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';

import { renderS37ClosedOwnerConstraintsFixture } from '../../../scripts/s37-hosted/closed-owner-constraints-fixture.mjs';

const pgBin = process.env.S37_TEST_PG17_BIN;
assert.ok(isAbsolute(pgBin ?? ''), 'Provide the absolute path to PostgreSQL fixture binaries');
const pg = (binary, args, input) => execFileSync(join(pgBin, binary), args, {
  input, encoding: 'utf8', timeout: 20_000, env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' },
});
assert.match(pg('postgres', ['--version']), /\b17\.12\b/);

const database = 's37_closed_install_fixture';
const installer = 's37_fixture_owner';

test('closed PG17.12 fixture fails closed, rolls back a late DDL fault, then permits serial runs', { timeout: 60_000 }, t => {
  const root = mkdtempSync(join(realpathSync('/tmp'), 'ecv-s37-owner-'));
  const data = join(root, 'db');
  const port = '54857';
  const fixtureMarker = randomBytes(32).toString('hex');
  let started = false;
  t.after(() => {
    if (started) pg('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    rmSync(root, { recursive: true, force: true });
  });
  pg('initdb', ['-D', data, '-U', 'fixture_admin', '--no-locale', '--encoding=UTF8',
    '--auth-local=trust', '--auth-host=reject']);
  pg('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o',
    '-c listen_addresses= -k ' + root + ' -p ' + port + ' -c ecv.s37_fixture_marker=' + fixtureMarker, '-w', 'start']);
  started = true;

  const sql = (text, { role = installer, db = database } = {}) => pg('psql', ['-XqAt', '--no-password',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', root, '-p', port, '-U', role, '-d', db], text).trim();
  sql(`
    CREATE ROLE s37_fixture_owner LOGIN NOINHERIT;
    CREATE DATABASE s37_closed_install_fixture;
  `, { role: 'fixture_admin', db: 'postgres' });
  sql(`
    GRANT EXECUTE ON FUNCTION pg_control_system() TO s37_fixture_owner;
    CREATE SCHEMA s37_fixture_l1 AUTHORIZATION s37_fixture_owner;
    SET ROLE s37_fixture_owner;
    CREATE TABLE s37_fixture_l1.runs (id integer PRIMARY KEY, singleton boolean NOT NULL UNIQUE CHECK (singleton), closed_at timestamptz);
    CREATE TABLE s37_fixture_l1.subjects (
      run_id integer NOT NULL REFERENCES s37_fixture_l1.runs, owner_uid uuid NOT NULL, uploads boolean NOT NULL,
      UNIQUE (run_id, uploads)
    );
    CREATE TABLE s37_fixture_l1.runtime (business_enabled boolean, download_enabled boolean, outbox_enabled boolean,
      sessions integer, grants integer, permits integer);
    CREATE TABLE s37_fixture_l1.retained_history (id integer PRIMARY KEY, run_id integer REFERENCES s37_fixture_l1.runs,
      native_version uuid NOT NULL, hold boolean NOT NULL);
    ALTER TABLE s37_fixture_l1.runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE s37_fixture_l1.subjects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE s37_fixture_l1.runtime ENABLE ROW LEVEL SECURITY;
    ALTER TABLE s37_fixture_l1.retained_history ENABLE ROW LEVEL SECURITY;
    INSERT INTO s37_fixture_l1.runs VALUES (1, true, '2026-01-01 00:00:00+00');
    INSERT INTO s37_fixture_l1.subjects VALUES (1, '40000000-0000-4000-8000-000000000001', true);
    INSERT INTO s37_fixture_l1.runtime VALUES (false, false, false, 0, 0, 0);
    INSERT INTO s37_fixture_l1.retained_history VALUES (1, 1, '40000000-0000-4000-8000-000000000003', true);
  `, { role: 'fixture_admin' });

  const read = query => sql('BEGIN READ ONLY;\n' + query + '\nCOMMIT;', { role: 'fixture_admin' });
  const protectedProjection = () => read(`
    SELECT jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM s37_fixture_l1.runs r),
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY run_id, uploads) FROM s37_fixture_l1.subjects s),
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM s37_fixture_l1.retained_history h));
  `);
  const protection = () => JSON.parse(read(`
    SELECT jsonb_build_object(
      'clusterSha256', encode(sha256(convert_to(system_identifier::text, 'UTF8')), 'hex'),
      'postmasterStarted', to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'retainedSha256', encode(sha256(convert_to(jsonb_build_array(
        (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM s37_fixture_l1.runs r),
        (SELECT jsonb_agg(to_jsonb(s) ORDER BY run_id, uploads) FROM s37_fixture_l1.subjects s),
        (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM s37_fixture_l1.retained_history h))::text, 'UTF8')), 'hex'))
    FROM pg_control_system();
  `));
  const snapshot = () => read(`
    SELECT jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY conname) FROM pg_constraint c WHERE connamespace = 's37_fixture_l1'::regnamespace),
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY indexrelid) FROM pg_index i JOIN pg_class r ON r.oid = i.indrelid
         WHERE r.relnamespace = 's37_fixture_l1'::regnamespace),
      (SELECT jsonb_agg(jsonb_build_array(relname, relowner, relacl, relrowsecurity, relforcerowsecurity) ORDER BY relname)
         FROM pg_class WHERE relnamespace = 's37_fixture_l1'::regnamespace AND relkind = 'r'));
  `);
  const pins = () => ({ ...protection(), fixtureMarker });

  const before = protectedProjection();
  const beforeCatalog = snapshot();
  const rendering = renderS37ClosedOwnerConstraintsFixture(pins());
  assert.throws(() => sql(rendering, { db: 'postgres' }), /42501: S37_FIXTURE_IDENTITY/);
  assert.throws(() => sql(rendering, { role: 'fixture_admin' }), /42501: S37_FIXTURE_IDENTITY/);
  assert.throws(() => sql(renderS37ClosedOwnerConstraintsFixture({ ...pins(), clusterSha256: '0'.repeat(64) })),
    /42501: S37_FIXTURE_CLUSTER/);
  assert.throws(() => sql(renderS37ClosedOwnerConstraintsFixture({ ...pins(), retainedSha256: '0'.repeat(64) })),
    /42501: S37_FIXTURE_RETAINED_DRIFT/);

  sql('UPDATE s37_fixture_l1.runtime SET outbox_enabled = true');
  assert.throws(() => sql(rendering), /42501: S37_FIXTURE_NOT_CLOSED/);
  sql('UPDATE s37_fixture_l1.runtime SET outbox_enabled = false');
  assert.equal(snapshot(), beforeCatalog);

  // This row is allowed by the old compound key. It forces the final ALTER
  // TABLE to fail after the new index and old-constraint removal were attempted.
  sql("INSERT INTO s37_fixture_l1.subjects VALUES (1, '40000000-0000-4000-8000-000000000002', false)");
  const faultRows = protectedProjection();
  assert.throws(() => sql(renderS37ClosedOwnerConstraintsFixture(pins())), /23505:.*one_owner_per_run/);
  assert.equal(protectedProjection(), faultRows);
  assert.equal(snapshot(), beforeCatalog);
  sql('DELETE FROM s37_fixture_l1.subjects WHERE NOT uploads');

  sql(rendering);
  assert.equal(protectedProjection(), before);
  assert.throws(() => sql(rendering), /42501: S37_FIXTURE_BASELINE/);

  sql("INSERT INTO s37_fixture_l1.runs VALUES (2, true, NULL); INSERT INTO s37_fixture_l1.subjects VALUES (2, '40000000-0000-4000-8000-000000000002', true)");
  assert.throws(() => sql('INSERT INTO s37_fixture_l1.runs VALUES (3, true, NULL)'), /23505:.*one_open_run/);
  assert.throws(() => sql("INSERT INTO s37_fixture_l1.subjects VALUES (2, '40000000-0000-4000-8000-000000000001', false)"),
    /23505:.*one_owner_per_run/);
  assert.equal(sql('SELECT count(DISTINCT owner_uid) FROM s37_fixture_l1.subjects'), '2');
  assert.equal(sql('SELECT count(*) FROM s37_fixture_l1.retained_history WHERE run_id = 1 AND hold'), '1');
  sql("UPDATE s37_fixture_l1.runs SET closed_at = '2026-01-02 00:00:00+00' WHERE id = 2");
  sql('INSERT INTO s37_fixture_l1.runs VALUES (3, true, NULL)');
  assert.equal(sql('SELECT count(*) FROM s37_fixture_l1.runs WHERE closed_at IS NULL'), '1');
});
