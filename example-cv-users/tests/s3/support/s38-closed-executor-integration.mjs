import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createIdentityAdapter, withCredential } from '../../../lib/business/identity.mjs';
import { createS38AuthBinding, proveS38AuthClosed } from '../../../scripts/s37-hosted/s38-auth-binding.node.mjs';
import { buildS38ClosedPlan, freezeS38ClosedCases } from '../../../scripts/s37-hosted/s38-closed-case-plan.mjs';
import { checkS38IndependentSourceReview } from '../../../scripts/s37-hosted/s38-reviewed-source.mjs';
import { runS38ClosedFixture } from '../../../scripts/s37-hosted/s38-closed-executor.node.mjs';
import { runPrivateRecovery } from '../../../scripts/shared/recovery-journal.node.mjs';
import { startS38NativeGoTrue } from './s38-native-gotrue.mjs';

const pgBin = process.env.S38_TEST_PG17_BIN;
const binary = process.env.S38_TEST_POSTGREST;
const python = realpathSync('/usr/bin/python3');
const env = { LC_ALL: 'C', PATH: '/usr/bin:/bin' };
const postgres = (name, ...args) => execFileSync(join(pgBin, name), args, { env, timeout: 15_000, encoding: 'utf8' });
const sha = value => createHash('sha256').update(value).digest('hex');
const issuer = 'https://s38.fixture.invalid/auth/v1';
const id = n => '58a30000-0000-4000-8000-' + String(n).padStart(12, '0');
assert.ok(isAbsolute(pgBin ?? '') && isAbsolute(binary ?? ''), 'Use absolute PG17.12 and PostgREST 16.6 binary paths');
assert.match(postgres('postgres', '--version'), /17\.12\b/);
assert.match(execFileSync(binary, ['--version'], { env, encoding: 'utf8' }), /16\.6\b/);

function fixture(t, nativeLane) {
  const root = mkdtempSync(join(realpathSync('/tmp'), 'ecv-s38-closed-'));
  const data = join(root, 'db');
  const directory = join(root, 'journal');
  mkdirSync(directory, { mode: 0o700 });
  // Make the private socket 0600 at bind time, before PostgREST's chmod.
  const restrictedPostgrest = join(root, 'postgrest');
  const executable = "'" + binary.replaceAll("'", "'\\''") + "'";
  writeFileSync(restrictedPostgrest, '#!/bin/sh\numask 0177\nexec ' + executable + ' "$@"\n', { mode: 0o700 });
  const fixtureId = randomBytes(16).toString('hex');
  const port = '54837';
  const sql = (who, statement) => postgres('psql', '-XqAt', '--no-password', '-v', 'ON_ERROR_STOP=1',
    '-h', root, '-p', port, '-U', who, '-d', 'postgres', '-c', statement).trim();
  let started;
  t.after(() => {
    if (started) postgres('pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop');
    rmSync(root, { recursive: true, force: true });
  });
  postgres('initdb', '-D', data, '-U', 'fixture_admin', '--auth-local=trust', '--auth-host=reject',
    '--no-locale', '--encoding=UTF8');
  postgres('pg_ctl', '-D', data, '-l', join(root, 'startup.log'), '-o',
    '-c listen_addresses= -k ' + root + ' -p ' + port +
    ' -c logging_collector=on -c log_destination=jsonlog -c log_min_error_statement=panic -c log_directory=log -c log_timezone=UTC' +
    ' -c s38.fixture=' + fixtureId,
    '-w', 'start');
  started = true;
  const admin = statement => sql('fixture_admin', statement);
  const observe = statement => sql('fixture_observer', statement);
  const fingerprint = "encode(sha256(convert_to((SELECT system_identifier::text FROM pg_control_system())" +
    " || '/' || (SELECT oid::text FROM pg_database WHERE datname=current_database()),'UTF8')),'hex')";
  const targetFingerprint = admin('SELECT ' + fingerprint);
  admin(`
    CREATE ROLE ecv_s3_internal_api_login LOGIN NOINHERIT NOBYPASSRLS;
    CREATE ROLE authenticated NOLOGIN NOBYPASSRLS;
    CREATE ROLE ecv_s38_fixture_decider NOLOGIN NOBYPASSRLS;
    CREATE ROLE fixture_observer LOGIN NOBYPASSRLS;
    GRANT authenticated TO ecv_s3_internal_api_login;
    GRANT pg_read_all_stats TO fixture_observer;
    CREATE SCHEMA site_api;
    CREATE SCHEMA fixture_guard;
    REVOKE ALL ON SCHEMA site_api, fixture_guard FROM PUBLIC;
    GRANT USAGE ON SCHEMA site_api TO authenticated;
    GRANT USAGE ON SCHEMA fixture_guard TO ecv_s38_fixture_decider, fixture_observer;
    CREATE TABLE fixture_guard.state (gate_open boolean NOT NULL CHECK (NOT gate_open), sentinel text NOT NULL);
    CREATE TABLE fixture_guard.effects (req uuid PRIMARY KEY);
    INSERT INTO fixture_guard.state VALUES (false,'protected fixture row');
    GRANT SELECT ON fixture_guard.state TO ecv_s38_fixture_decider, fixture_observer;
    GRANT INSERT ON fixture_guard.effects TO ecv_s38_fixture_decider;
    GRANT SELECT ON fixture_guard.effects TO fixture_observer;
    GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO authenticated, fixture_observer;
    CREATE FUNCTION site_api.observe_identity() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER AS
    $$ SELECT jsonb_build_object('connection_role',session_user,'execution_role',current_user,
         'target_fingerprint',${fingerprint}) $$;
    REVOKE ALL ON FUNCTION site_api.observe_identity() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION site_api.observe_identity() TO authenticated;
  `);

  const definitions = [
    { rpc: 's37e1_read_file', kind: 'read' },
    { rpc: 'read_introduction', kind: 'text' },
  ];
  if (nativeLane) {
    const prefixes = nativeLane === 'A' ? ['s37e1', 's37e2'] : ['s37h1', 's37h2'];
    definitions.splice(0, 1, ...prefixes.flatMap(prefix => [
      { rpc: prefix + '_read_file', kind: 'read' },
      { rpc: prefix + '_file_access', kind: 'history' },
      { rpc: prefix + '_file_command', kind: 'prepare' },
    ]));
  }
  const cases = definitions.map(({ rpc, kind }, index) => {
    // A real exception is emitted by PostgreSQL after an attempted fixture
    // insert, so independent observation can verify that nothing persisted.
    const [sqlstate, reason] = kind === 'text' ? ['PT503', 'NOT_CONFIGURED'] : ['42501', 'BUSINESS_DENIED'];
    const deny = `IF NOT gate_open THEN RAISE EXCEPTION USING ERRCODE='${sqlstate}', MESSAGE='${reason}'; END IF;`;
    const definitionSha256 = sha(deny);
    const planArgs = kind === 'read' ? [['target', 'uuid'], ['asset_id', 'uuid'], ['storage_version', 'uuid']] :
      kind === 'text' ? [['target', 'uuid']] :
        [['target_run', 'uuid'], ['target_site', 'uuid'], ['operation', 'text'], ['input', 'json']];
    const signature = planArgs.map(([name, type]) => name + ' ' + type).join(', ');
    const types = planArgs.map(([, type]) => type).join(', ');
    const body = planArgs.map(([name, type]) => `'"${name}":' || ${type === 'json' ? name : 'to_json(' + name + ')'}::text`).join(" || ',' || ");
    const gate = nativeLane ? `
        IF NOT EXISTS (SELECT FROM auth.sessions s JOIN auth.users u ON s.user_id=u.id
          WHERE s.id=(claims->>'session_id')::uuid AND s.user_id=(claims->>'sub')::uuid
            AND coalesce(u.banned_until<=clock_timestamp(),true)
            AND coalesce(s.not_after>clock_timestamp(),true)) THEN RAISE insufficient_privilege; END IF;
      ` : '';
    const identityBasis = nativeLane ? 'jwt_and_auth_session' : 'jwt_claims';
    admin(`
      CREATE FUNCTION site_api.${rpc}(${signature}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = '' AS $fixture$
      DECLARE
        h jsonb := current_setting('request.headers')::jsonb;
        claims jsonb := current_setting('request.jwt.claims')::jsonb;
        gate_open boolean;
        statement_text text := '{' || ${body} || '}';
      BEGIN
        ${gate}
        SELECT s.gate_open INTO STRICT gate_open FROM fixture_guard.state s;
        INSERT INTO fixture_guard.effects VALUES ((h->>'x-request-id')::uuid);
        RAISE LOG '%', 'S38_LOCAL_DB_SOURCE ' || json_build_object(
          'fixtureId','${fixtureId}', 'requestId',h->>'x-request-id', 'uid',claims->>'sub', 'sid',claims->>'session_id',
          'requestSha256',h->>'x-s38-case-sha256',
          'bodySha256',encode(sha256(convert_to(statement_text,'UTF8')),'hex'),
          'statementSha256',encode(sha256(convert_to(statement_text,'UTF8')),'hex'),
          'connectionRole',session_user, 'callerRole',current_setting('role'), 'decisionRole',current_user,
          'function','site_api.${rpc}', 'definitionSha256','${definitionSha256}', 'branch','closed_gate',
          'identityBasis','${identityBasis}', 'sqlstate','${sqlstate}', 'reason','${reason}'
        )::text;
        ${deny}
        RETURN '{}'::jsonb;
      END $fixture$;
      ALTER FUNCTION site_api.${rpc}(${types}) OWNER TO ecv_s38_fixture_decider;
      REVOKE ALL ON FUNCTION site_api.${rpc}(${types}) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION site_api.${rpc}(${types}) TO authenticated;
    `);
    return { caseId: rpc.replaceAll('_', '-'), requestId: id(10 + index), uid: id(20 + index),
      sid: id(30 + index), args: { target: id(40 + index),
        ...(kind === 'read' ? { asset_id: id(50), storage_version: id(51) } : {}) }, rpc, sqlstate, reason, definitionSha256,
      branches: ['closed_gate'], decisionRole: 'ecv_s38_fixture_decider', identityBasis };
  });

  const jwtSecret = randomBytes(32).toString('hex');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claimsByToken = new Map();
  const tokens = cases.map(({ uid, sid }) => {
    const claims = { iss: issuer, aud: 'authenticated', role: 'authenticated', sub: uid, session_id: sid,
      exp: Math.floor(Date.now() / 1000) + 180, is_anonymous: false, amr: [{ method: 'password' }] };
    const unsigned = encode({ alg: 'HS256' }) + '.' + encode(claims);
    const token = unsigned + '.' + createHmac('sha256', jwtSecret).update(unsigned).digest('base64url');
    claimsByToken.set(token, claims);
    return token;
  });
  const identity = createIdentityAdapter({ issuer, auth: {
    async verifyTokenAndUser(token) {
      const claims = claimsByToken.get(token);
      return { data: { claims, user: { id: claims?.sub, is_anonymous: false, email_confirmed_at: '2026-01-01' } } };
    },
  } });
  const logs = () => readdirSync(join(data, 'log')).filter(file => file.endsWith('.json'))
    .flatMap(file => readFileSync(join(data, 'log', file), 'utf8').trim().split('\n').filter(Boolean));
  async function readSource({ requestId, signal }) {
    const marker = 'S38_LOCAL_DB_SOURCE ';
    for (let attempt = 0; attempt < 100; attempt++) {
      signal.throwIfAborted();
      const lines = logs().map(line => ({ line, payload: JSON.parse(line) }));
      const branch = lines.filter(({ payload }) => payload.message?.startsWith(marker) &&
        JSON.parse(payload.message.slice(marker.length)).requestId === requestId);
      if (branch.length === 1) {
        const { session_id: session, line_num: n } = branch[0].payload;
        const engine = lines.find(({ payload }) => payload.session_id === session && payload.line_num === n + 1);
        if (engine) return Buffer.from(branch[0].line + '\n' + engine.line + '\n');
      }
      await delay(15);
    }
    throw Error('fixture source event absent');
  }

  const state = () => JSON.parse(observe(`SELECT json_build_object(
    'gate_open',gate_open,'sentinel',sentinel,'effects',(SELECT count(*) FROM fixture_guard.effects))
    FROM fixture_guard.state;`));
  const protectedSha256 = sha(JSON.stringify(state()));
  const connections = () => Number(observe("SELECT count(*) FROM pg_stat_activity WHERE usename='ecv_s3_internal_api_login';"));
  async function readClosure({ requestIds }) {
    for (let attempt = 0; attempt < 30 && connections(); attempt++) await delay(50);
    const row = state();
    const counts = connections();
    return { fixtureId, requestIds, targetFingerprint: observe('SELECT ' + fingerprint), protectedSha256: sha(JSON.stringify(row)),
      gatesClosed: row.gate_open === false, runtimeStopped: !existsSync(join(root, 'api', 'rpc.sock')),
      connections: counts, lateWritePossible: counts !== 0,
      receiptSha256: sha(JSON.stringify([fixtureId, requestIds, row, counts])) };
  }

  return {
    logs, tokens, identity, cases, connections, state, readSource, readClosure, directory, admin, observe,
    root, fixtureId, targetFingerprint, postgresPort: port, fingerprint,
    async options() {
      const handles = await Promise.all(tokens.map(token => identity.verifyAccount(token)));
      return { lane: 'A', cases, fixtureId, targetFingerprint, protectedSha256, directory, python, identity,
        handles: new Map(cases.map((item, index) => [item.sid, handles[index]])),
        runtime: { binary: restrictedPostgrest, jwtSecret, identityToken: tokens[0],
          databaseUri: 'postgresql://ecv_s3_internal_api_login@localhost/postgres?host=' +
            encodeURIComponent(root) + '&port=' + port },
        readSource, readClosure };
    },
  };
}

test('local PG17.12/PostgREST 16.6 correlates both wire denials and proves independent rollback', { timeout: 30000 }, async t => {
  const local = fixture(t);
  const result = await runS38ClosedFixture(await local.options());
  assert.equal(result.evidence, 'LOCAL_FIXTURE_ONLY');
  assert.deepEqual(result.denials.map(item => [item.requestId, item.wire.status, item.event.sqlstate, item.event.decisionRole]),
    [[id(10), 403, '42501', 'ecv_s38_fixture_decider'], [id(11), 503, 'PT503', 'ecv_s38_fixture_decider']]);
  assert.equal(local.connections(), 0);
  assert.equal(local.state().effects, 0);
  for (const entry of readdirSync(local.directory).filter(name => name.endsWith('.json'))) {
    const bytes = readFileSync(join(local.directory, entry), 'utf8');
    assert.ok(local.tokens.every(token => !bytes.includes(token)));
  }
});

test('pinned ES256 synthetic Auth plus independent PG UID/SID drives real PostgREST and zero-Actor closure', { timeout: 30000 }, async t => {
  const local = fixture(t);
  const options = await local.options();
  const { targetFingerprint, protectedSha256 } = options;
  const [probe] = options.cases;
  const { uid, sid } = probe;
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const key = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', kid: 's38-local-es256', use: 'sig' };
  const jwks = Buffer.from(JSON.stringify({ keys: [key] }));
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = encode({ alg: 'ES256', kid: key.kid }) + '.' + encode({
    iss: issuer, aud: 'authenticated', role: 'authenticated', sub: uid, session_id: sid,
    iat: now, exp: now + 120, is_anonymous: false, amr: [{ method: 'password' }],
  });
  const token = unsigned + '.' + sign('sha256', Buffer.from(unsigned), {
    key: privateKey, dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const user = { id: uid, email: 'actor@example.invalid', is_anonymous: false, email_confirmed_at: '2026-01-01' };
  local.admin(`
    CREATE TABLE fixture_guard.actors(uid uuid PRIMARY KEY);
    CREATE TABLE fixture_guard.sessions(sid uuid PRIMARY KEY, uid uuid NOT NULL REFERENCES fixture_guard.actors,
      created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())), refresh boolean NOT NULL);
    CREATE VIEW fixture_guard.closed_role AS
      SELECT rolcanlogin, rolpassword IS NULL AS password_null
      FROM pg_catalog.pg_authid WHERE rolname='ecv_s3_internal_api_login';
    REVOKE ALL ON fixture_guard.actors, fixture_guard.sessions FROM PUBLIC;
    REVOKE ALL ON fixture_guard.closed_role FROM PUBLIC;
    GRANT SELECT ON fixture_guard.actors, fixture_guard.sessions, fixture_guard.closed_role TO fixture_observer;
    ALTER ROLE fixture_observer SET default_transaction_read_only=on;
  `);
  const counts = () => JSON.parse(local.observe(`SELECT json_build_object(
    'accountCount',(SELECT count(*) FROM fixture_guard.actors),
    'sessions',(SELECT count(*) FROM fixture_guard.sessions),
    'refresh',(SELECT count(*) FROM fixture_guard.sessions WHERE refresh));`));
  assert.deepEqual(counts(), { accountCount: 0, sessions: 0, refresh: 0 });
  const calls = [];
  const auth = createS38AuthBinding({ issuer, targetFingerprint, jwks, jwksSha256: sha(jwks), maxLifetimeSeconds: 180,
    async transport({ method, path, token: bearer, requestId }) {
      calls.push([method, path, requestId]);
      if (method === 'POST') {
        local.admin(`BEGIN; INSERT INTO fixture_guard.actors VALUES ('${uid}');
          INSERT INTO fixture_guard.sessions (sid,uid,refresh) VALUES ('${sid}','${uid}',true); COMMIT;`);
        return { status: 200, body: { access_token: token, user } };
      }
      assert.equal(bearer, token);
      return { status: 200, body: user };
    },
    async readSession({ uid: requestedUid, sid: requestedSid, requestId }) {
      assert.equal(requestedUid, uid);
      assert.equal(requestedSid, sid);
      const data = local.observe(`SELECT json_build_object('uid',uid,'sid',sid,'createdAt',created_at,
        'active',true,'refreshPresent',refresh,'observedAt',floor(extract(epoch FROM clock_timestamp())),
        'observer',current_user,'readOnly',current_setting('transaction_read_only'),
        'targetFingerprint',encode(sha256(convert_to((SELECT system_identifier::text FROM pg_control_system())
          || '/' || (SELECT oid::text FROM pg_database WHERE datname=current_database()),'UTF8')),'hex'))
        FROM fixture_guard.sessions WHERE uid='${uid}' AND sid='${sid}';`);
      const row = JSON.parse(data);
      assert.equal(row.observer, 'fixture_observer');
      assert.equal(row.readOnly, 'on');
      return { ...row, requestId, receiptSha256: sha(data) };
    },
  });
  const directory = join(local.directory, 'auth-journal');
  mkdirSync(directory, { mode: 0o700 });
  const lifecycle = await runPrivateRecovery({ directory, python, scopeSha256: auth.scopeSha256,
    operations: { business: ['signin'], close: ['revoke'] },
    async work(journal) {
      const actor = await auth.openPasswordActor({ uid, email: user.email, requestId: id(70), userRequestId: id(73),
        baselineAt: now - 1, retiredSids: [id(72)],
        operation: 'signin', dispatch: journal.dispatch, credentials: { email: user.email, password: 'synthetic fixture' } });
      const { denials } = await runS38ClosedFixture({ ...options, cases: [probe], identity: undefined,
        handles: new Map([[sid, actor.handle]]), authBinding: auth, authScopeSha256: auth.scopeSha256,
        runtime: { ...options.runtime, jwtSecret: jwks.toString('utf8'), identityToken: token } });
      assert.deepEqual(denials.map(item => [item.requestId, item.event.sqlstate]), [[probe.requestId, '42501']]);
      const marker = 'S38_LOCAL_DB_SOURCE ';
      const events = local.logs().map(line => JSON.parse(line).message).filter(message => message?.startsWith(marker))
        .map(message => JSON.parse(message.slice(marker.length)));
      assert.deepEqual(events.map(item => [item.requestId, item.uid, item.sid]), [[probe.requestId, uid, sid]]);
    },
    async close(journal) {
      await journal.dispatch('revoke', sha(JSON.stringify([targetFingerprint, uid, sid, id(71)])), async () => {
        local.admin(`BEGIN; DELETE FROM fixture_guard.sessions WHERE uid='${uid}' AND sid='${sid}';
          DELETE FROM fixture_guard.actors WHERE uid='${uid}';
          ALTER ROLE ecv_s3_internal_api_login NOLOGIN PASSWORD NULL; COMMIT;`);
        return { disposition: 'committed', receiptSha256: sha(JSON.stringify(counts())) };
      });
    },
    async observeClosed({ inspect }) {
      const end = await local.readClosure({ requestIds: [probe.requestId] });
      const role = JSON.parse(local.observe(`SELECT json_build_object('roleLogins',rolcanlogin::int,
        'rolePasswordNull',password_null) FROM fixture_guard.closed_role;`));
      const state = { ...end, ...counts(), accounts: [], grants: 0, permits: 0, generations: 0, openRuns: 0,
        ...role };
      return proveS38AuthClosed({ lane: 'A', row: { ...state, receiptSha256: sha(JSON.stringify(state)) },
        targetFingerprint, protectedSha256, expectedDisabledUids: [],
        unresolved: ['signin', 'revoke'].filter(id => inspect(id).state === 'unknown') });
    },
  });
  assert.match(lifecycle.receiptSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(calls, [['POST', '/token?grant_type=password', id(70)], ['GET', '/user', id(73)]]);
  assert.equal(local.connections(), 0);
  assert.deepEqual(counts(), { accountCount: 0, sessions: 0, refresh: 0 });
});

test('loss of source ACK stops later dispatch, requires closure and reopens on the original request only', { timeout: 30000 }, async t => {
  const local = fixture(t);
  const options = await local.options();
  await assert.rejects(runS38ClosedFixture({ ...options,
    readSource: async () => { throw Error('fixture source reply lost'); } }), /PRIVATE_JOURNAL_RUN_FAILED/);
  assert.ok(existsSync(join(local.directory, 'case-' + id(10) + '.intent.json')));
  assert.equal(existsSync(join(local.directory, 'case-' + id(11) + '.intent.json')), false);
  assert.equal(existsSync(join(local.directory, 'closed.json')), false);
  assert.equal(local.connections(), 0);
  const { identity, handles, runtime, ...recovery } = options;
  await assert.rejects(runS38ClosedFixture({ ...recovery,
    readClosure: async request => ({ ...await local.readClosure(request), lateWritePossible: true }) }), /PRIVATE_JOURNAL_RUN_FAILED/);
  assert.equal(existsSync(join(local.directory, 'closed.json')), false);
  const result = await runS38ClosedFixture(recovery);
  assert.equal(result.recovered, true);
  assert.equal(existsSync(join(local.directory, 'closed.json')), true);
  const events = local.logs().filter(line => line.includes('S38_LOCAL_DB_SOURCE'));
  assert.equal(events.length, 1);
  assert.equal(local.state().effects, 0);
});

test('real denial can settle original mutation absence from a fresh process without inventing its missing wire receipt', { timeout: 30000 }, async t => {
  const local = fixture(t);
  const options = await local.options();
  await assert.rejects(runS38ClosedFixture({ ...options,
    readSource: async () => { throw Error('fixture source reply lost'); } }));
  const { identity, handles, runtime, ...recovery } = options;
  const executorModule = new URL('../../../scripts/s37-hosted/s38-closed-executor.node.mjs', import.meta.url).href;
  const program = `
    import { readFileSync } from 'node:fs';
    import { runS38ClosedFixture } from ${JSON.stringify(executorModule)};
    const { options, source, closure } = JSON.parse(readFileSync(0, 'utf8'));
    const result = await runS38ClosedFixture({ ...options,
      readSource: async () => Buffer.from(source, 'base64'), readClosure: async () => closure });
    process.stdout.write(JSON.stringify(result));
  `;
  const source = await local.readSource({ requestId: id(10), signal: AbortSignal.timeout(3000) });
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], {
    env, encoding: 'utf8', timeout: 10_000,
    input: JSON.stringify({ options: recovery, source: source.toString('base64'), closure: await local.readClosure({ requestIds: recovery.cases.map(item => item.requestId) }) }),
  }));
  assert.equal(result.recovered, true);
  assert.deepEqual(result.denials.map(item => [item.requestId, item.wire, item.event.sqlstate]), [[id(10), null, '42501']]);
  assert.equal(local.logs().filter(line => line.includes('S38_LOCAL_DB_SOURCE')).length, 1);
});


test('a separate local review binds genuine PostgreSQL log slices to #64 wire receipts', { timeout: 30000 }, async t => {
  const local = fixture(t);
  const options = await local.options();
  const beforeAt = new Date().toISOString();
  const { denials } = await runS38ClosedFixture(options);
  const plan = freezeS38ClosedCases(options.lane, options.cases, { fixture: true });
  const artifacts = await Promise.all(denials.map(item => local.readSource({ requestId: item.requestId,
    signal: AbortSignal.timeout(3000) })));
  const original = Buffer.concat(artifacts);
  const artifactSha256 = sha(original);
  const contract = { realm: 'local-fixture', lane: options.lane, project: 's38-local-fixture', authIssuer: issuer,
    databaseSha256: options.targetFingerprint, collectorId: 'fixture-reviewer', beforeAt, afterAt: new Date().toISOString() };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const approved = { ...contract, reviewerKeySha256: sha(publicKey.export({ type: 'spki', format: 'der' })),
    contractSha256: sha(JSON.stringify({ ...contract, caseSha256: plan.map(item => item.requestSha256) })) };
  const transportReceipts = denials.map(({ wire }, index) => ({ caseId: plan[index].caseId,
    requestId: plan[index].requestId, requestSha256: plan[index].requestSha256,
    requestBodySha256: plan[index].bodySha256, status: wire.status, replySha256: wire.bodySha256 }));
  let position = 0;
  const rows = denials.map(({ event }, index) => {
    const item = plan[index];
    const start = position;
    position += artifacts[index].length;
    return { caseId: event.caseId, requestId: event.requestId, uid: item.uid, sid: item.sid,
      requestSha256: event.requestSha256, bodySha256: item.bodySha256, sourceId: event.sourceId,
      recordedAt: new Date(event.nativeLoggedAt).toISOString(), connectionRole: event.connectionRole,
      callerRole: event.callerRole, decisionRole: event.decisionRole, decisionFunction: event.decisionFunction,
      definitionSha256: item.definitionSha256, branch: event.branch, identityBasis: event.identityBasis,
      sqlstate: event.sqlstate, reason: event.reason, statementSha256: event.statementSha256,
      backendId: event.backendSession, transactionId: event.nativeTransaction,
      original: { artifactSha256, start, end: position, sha256: sha(artifacts[index]) } };
  });
  const archive = Buffer.from(JSON.stringify({ collectorId: approved.collectorId, databaseSha256: approved.databaseSha256, rows }));
  const review = Buffer.from(JSON.stringify({ version: 1, realm: approved.realm, project: approved.project, lane: approved.lane,
    contractSha256: approved.contractSha256, transportSha256: sha(JSON.stringify(transportReceipts)), archiveSha256: sha(archive),
    artifacts: [{ kind: 'LOCAL_POSTGRES_JSONLOG', sha256: artifactSha256 }] }));
  const result = checkS38IndependentSourceReview({ approved, cases: options.cases, transportReceipts, archive, originals: [original],
    review, signature: sign(null, review, privateKey), reviewerPublicKey: publicKey.export({ type: 'spki', format: 'pem' }) });
  assert.equal(result.realm, 'local-fixture');
  assert.equal(result.linkedCases, 2);
  assert.equal(result.hostedAcceptance, false);
  assert.equal(local.connections(), 0);
});

function nativeClosedCases(lane, actors, local) {
  const sites = actors.map((actor, index) => ({ ...actor, site: id(200 + index) }));
  const files = actors.map((_actor, index) => ({ asset: id(210 + index), version: id(220 + index), run: id(230 + index) }));
  const prefixes = lane === 'A' ? ['s37e1', 's37e2'] : ['s37h1', 's37h2'];
  const rules = {};
  for (const [index] of sites.entries()) {
    const owner = 'business-owner-' + (index + 1) + '-';
    for (const relation of ['same', 'cross']) {
      rules[owner + relation + '-text'] = local.cases.find(item => item.rpc === 'read_introduction');
      for (const [file] of files.entries()) {
        for (const [layer, prefix] of prefixes.entries()) {
          const id = owner + relation + '-file-' + (file + 1) + '-' + (layer ? 's3edge' : 's3m8') + '-';
          for (const [label, rpc] of [['read', 'read_file'], ['history', 'file_access'], ['prepare', 'file_command']])
            rules[id + label] = local.cases.find(item => item.rpc === prefix + '_' + rpc);
        }
      }
    }
  }
  return buildS38ClosedPlan({ lane, actors: sites, files, otherSite: lane === 'A' ? id(201) : null,
    edgeRun: id(239), sourceRules: rules, requestIds: Array.from({ length: lane === 'A' ? 14 : 52 }, () => randomUUID()) });
}

function nativeObserver(local) {
  local.admin(`
    GRANT USAGE ON SCHEMA "auth" TO fixture_observer, ecv_s38_fixture_decider;
    GRANT SELECT (id, user_id, created_at, not_after) ON auth.sessions TO fixture_observer, ecv_s38_fixture_decider;
    GRANT SELECT (id, banned_until) ON auth.users TO fixture_observer, ecv_s38_fixture_decider;
    GRANT SELECT (session_id, revoked) ON auth.refresh_tokens TO fixture_observer;
    CREATE POLICY fixture_auth_session_witness ON auth.sessions FOR SELECT TO fixture_observer, ecv_s38_fixture_decider USING (true);
    CREATE POLICY fixture_auth_user_witness ON auth.users FOR SELECT TO fixture_observer, ecv_s38_fixture_decider USING (true);
    CREATE POLICY fixture_auth_refresh_witness ON auth.refresh_tokens FOR SELECT TO fixture_observer USING (true);
    ALTER ROLE fixture_observer SET default_transaction_read_only=on;
    CREATE VIEW fixture_guard.native_role_end AS
      SELECT count(*) FILTER (WHERE rolcanlogin) AS "roleLogins", bool_and(rolpassword IS NULL) AS "rolePasswordNull",
        count(*) AS catalog_roles
      FROM pg_catalog.pg_authid WHERE rolname IN ('ecv_s3_internal_api_login','supabase_auth_admin');
    REVOKE ALL ON fixture_guard.native_role_end FROM PUBLIC;
    GRANT SELECT ON fixture_guard.native_role_end TO fixture_observer;
  `);
  return () => JSON.parse(local.observe(`SELECT json_build_object(
    'accountCount',(SELECT count(*) FROM auth.users),
    'accounts', coalesce((SELECT json_agg(json_build_object('uid',id,'disabled',
      coalesce(banned_until>clock_timestamp(),false)) ORDER BY id) FROM auth.users),'[]'::json),
    'sessions',(SELECT count(*) FROM auth.sessions), 'refresh',(SELECT count(*) FROM auth.refresh_tokens),
    'readOnly',current_setting('transaction_read_only'),
    'roleLogins',CASE WHEN catalog_roles=2 THEN "roleLogins" ELSE -1 END,
    'rolePasswordNull',catalog_roles=2 AND "rolePasswordNull",
    'apiCanSetRole',pg_has_role('ecv_s3_internal_api_login','authenticated','SET'),
    'authDbCreate',has_database_privilege('supabase_auth_admin',current_database(),'CREATE'),
    'authCreateRole',(SELECT rolcreaterole FROM pg_roles WHERE rolname='supabase_auth_admin'),
    'connections',(SELECT count(*) FROM pg_stat_activity WHERE usename IN ('ecv_s3_internal_api_login','supabase_auth_admin'))
  ) FROM fixture_guard.native_role_end;`));
}

for (const [lane, loseSource] of [['A', false], ['B', false], ['A', true]]) {
  test('real local GoTrue lifecycle and ' + (loseSource ? 'cross-process original-key recovery' : 'full S3.8 closed schedule ' + lane), {
    skip: !process.env.S38_TEST_GOTRUE, timeout: 90000,
  }, async t => {
    const local = fixture(t, lane);
    const options = await local.options();
    const { targetFingerprint, protectedSha256 } = options;
    const native = await startS38NativeGoTrue({ ...local, binary: process.env.S38_TEST_GOTRUE });
    try {
      const counts = nativeObserver(local);
      const words = Array.from({ length: lane === 'A' ? 1 : 3 }, () => ({
        email: 's38-' + randomBytes(12).toString('hex') + '@example.invalid',
        password: randomBytes(32).toString('hex'),
      }));
      const historical = [];
      if (lane === 'B') for (const credentials of words) {
        const uid = await native.create(credentials, randomUUID());
        await native.blocked(uid, true, randomUUID());
        historical.push(uid);
      }
      const initial = counts();
      assert.equal(initial.readOnly, 'on');
      assert.equal(initial.accountCount, historical.length);
      assert.deepEqual(initial.accounts, historical.toSorted().map(uid => ({ uid, disabled: true })));
      assert.equal(initial.sessions + initial.refresh, 0);

      const ownerCount = lane === 'A' ? 1 : 2;
      const actors = [];
      const admitted = new Map();
      const labels = operation => Array.from({ length: ownerCount }, (_, index) => operation + '-' + index);
      const setup = labels(lane === 'A' ? 'create' : 'enable');
      const signin = labels('signin');
      const signout = labels('signout');
      const retire = labels(lane === 'A' ? 'remove' : 'disable');
      const directory = join(local.directory, 'native-auth');
      mkdirSync(directory, { mode: 0o700 });
      const requestIds = Object.fromEntries([...setup, ...signin, ...signout, ...retire, ...labels('user')].
        map(step => [step, randomUUID()]));
      const closed = await runPrivateRecovery({ directory, python,
        scopeSha256: sha(JSON.stringify([native.auth.scopeSha256, lane, historical, requestIds])),
        operations: { business: [...setup, ...signin], close: [...signout, ...retire, 'close-roles'] },
        async work(journal) {
          for (const [index] of setup.entries()) {
            const step = setup[index];
            await journal.dispatch(step, sha(JSON.stringify([lane, requestIds[step], historical[index] ?? sha(words[index].email)])), async () => {
              let uid = historical[index];
              if (lane === 'A') uid = await native.create(words[index], requestIds[step]);
              else await native.blocked(uid, false, requestIds[step]);
              admitted.set(index, uid);
              assert.ok(counts().accounts.some(account => account.uid === uid && account.disabled === false));
              return { disposition: 'committed', receiptSha256: sha(JSON.stringify([requestIds[step], uid])) };
            });
            const baselineAt = Math.floor(Date.now() / 1000);
            await delay(1000);
            const actor = await native.auth.openPasswordActor({ uid: admitted.get(index), email: words[index].email,
              baselineAt, retiredSids: [], requestId: requestIds[signin[index]], userRequestId: requestIds['user-' + index],
              operation: signin[index], dispatch: journal.dispatch, credentials: words[index] });
            actors.push(actor);
          }
          const cases = nativeClosedCases(lane, actors, local);
          const execute = { ...options, lane, cases, identity: undefined,
            handles: new Map(actors.map(actor => [actor.sid, actor.handle])),
            authBinding: native.auth, authScopeSha256: native.auth.scopeSha256,
            runtime: { ...options.runtime, jwtSecret: native.jwks, identityToken: withCredential(actors[0].handle, token => token) } };
          if (loseSource) {
            await assert.rejects(runS38ClosedFixture({ ...execute, readSource: async () => { throw Error('lost source read'); } }));
            const first = cases[0];
            assert.equal(existsSync(join(local.directory, 'case-' + cases[1].requestId + '.intent.json')), false);
            const nativeSource = await local.readSource({ requestId: first.requestId, signal: AbortSignal.timeout(3000) });
            const closed = await local.readClosure({ requestIds: cases.map(item => item.requestId) });
            const recovery = { lane, cases, fixtureId: options.fixtureId, targetFingerprint, protectedSha256,
              directory: options.directory, python, authScopeSha256: native.auth.scopeSha256 };
            const module = new URL('../../../scripts/s37-hosted/s38-closed-executor.node.mjs', import.meta.url).href;
            const program = `
              import { readFileSync } from 'node:fs';
              import { runS38ClosedFixture } from ${JSON.stringify(module)};
              const { recovery, nativeSource, closed, requestId } = JSON.parse(readFileSync(0, 'utf8'));
              const result = await runS38ClosedFixture({ ...recovery, readClosure: async () => closed,
                readSource: async request => {
                  if (request.requestId !== requestId) throw Error('different original');
                  return Buffer.from(nativeSource, 'base64');
                } });
              process.stdout.write(JSON.stringify(result));
            `;
            const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', program], {
              env, encoding: 'utf8', timeout: 15_000,
              input: JSON.stringify({ recovery, nativeSource: nativeSource.toString('base64'), closed, requestId: first.requestId }),
            }));
            assert.equal(result.recovered, true);
            assert.deepEqual(result.denials.map(row => [row.requestId, row.wire, row.event.identityBasis]),
              [[first.requestId, null, 'jwt_and_auth_session']]);
            assert.equal(local.logs().filter(line => line.includes('S38_LOCAL_DB_SOURCE')).length, 1);
          } else {
            const result = await runS38ClosedFixture(execute);
            assert.equal(result.evidence, 'LOCAL_FIXTURE_ONLY');
            assert.equal(result.denials.length, lane === 'A' ? 14 : 52);
            assert.equal(new Set(result.denials.map(row => row.requestId)).size, cases.length);
            assert.ok(result.denials.every(row => row.event.identityBasis === 'jwt_and_auth_session'));
          }
          assert.equal(counts().sessions, ownerCount);
          assert.equal(counts().refresh, ownerCount);
        },
        async close(journal) {
          for (const [index, actor] of actors.entries()) {
            const step = signout[index];
            await journal.dispatch(step, sha(JSON.stringify([requestIds[step], actor.uid, actor.sid])), async () => {
              await withCredential(actor.handle, token => native.logout(token, requestIds[step]));
              await assert.rejects(native.auth.observeActor({ ...actor, requestId: randomUUID(),
                signal: AbortSignal.timeout(3000) }), /S38_AUTH_SESSION_UNPROVEN/);
              return { disposition: 'committed', receiptSha256: sha(JSON.stringify([requestIds[step], actor.sid, 'revoked'])) };
            });
          }
          for (const [index, uid] of admitted) {
            const step = retire[index];
            await journal.dispatch(step, sha(JSON.stringify([requestIds[step], uid])), async () => {
              if (lane === 'A') await native.remove(uid, requestIds[step]);
              else await native.blocked(uid, true, requestIds[step]);
              const row = counts();
              const kept = row.accounts.filter(account => account.uid === uid);
              assert.deepEqual(kept, lane === 'A' ? [] : [{ uid, disabled: true }]);
              return { disposition: 'committed', receiptSha256: sha(JSON.stringify([requestIds[step], row.accounts])) };
            });
          }
          await native.close();
          await journal.dispatch('close-roles', sha(JSON.stringify([targetFingerprint, 'close-roles'])), async () => {
            local.admin(`BEGIN;
              ALTER ROLE ecv_s3_internal_api_login NOLOGIN PASSWORD NULL;
              ALTER ROLE supabase_auth_admin NOLOGIN NOCREATEROLE PASSWORD NULL;
              REVOKE CREATE ON DATABASE postgres FROM supabase_auth_admin;
              REVOKE authenticated FROM ecv_s3_internal_api_login;
              DROP POLICY fixture_auth_session_witness ON auth.sessions;
              DROP POLICY fixture_auth_user_witness ON auth.users;
              CREATE POLICY fixture_auth_session_witness ON auth.sessions FOR SELECT TO fixture_observer USING (true);
              CREATE POLICY fixture_auth_user_witness ON auth.users FOR SELECT TO fixture_observer USING (true);
              REVOKE SELECT (id, user_id, created_at, not_after) ON auth.sessions FROM ecv_s38_fixture_decider;
              REVOKE SELECT (id, banned_until) ON auth.users FROM ecv_s38_fixture_decider;
              REVOKE USAGE ON SCHEMA auth FROM ecv_s38_fixture_decider;
            COMMIT;`);
            return { disposition: 'committed', receiptSha256: sha(JSON.stringify(counts())) };
          });
        },
        async observeClosed({ inspect }) {
          const state = { ...counts(), targetFingerprint, protectedSha256: sha(JSON.stringify(local.state())),
            runtimeStopped: !existsSync(join(local.root, 'api', 'rpc.sock')), lateWritePossible: false,
            gatesClosed: local.state().gate_open === false, grants: 0, permits: 0, generations: 0, openRuns: 0 };
          assert.equal(state.readOnly, 'on');
          assert.equal(state.apiCanSetRole || state.authDbCreate || state.authCreateRole, false);
          assert.equal(local.state().effects, 0);
          return proveS38AuthClosed({ lane, row: { ...state, receiptSha256: sha(JSON.stringify(state)) },
            targetFingerprint, protectedSha256, expectedDisabledUids: historical,
            unresolved: [...setup, ...signin, ...signout, ...retire, 'close-roles'].filter(step => inspect(step).state === 'unknown') });
        },
      });
      assert.match(closed.receiptSha256, /^[a-f0-9]{64}$/);
      const retained = counts();
      assert.equal(retained.accountCount, historical.length);
      assert.equal(retained.sessions + retained.refresh + retained.roleLogins + retained.connections, 0);
      assert.equal(retained.rolePasswordNull, true);
    } finally {
      await native.close();
    }
  });
}
