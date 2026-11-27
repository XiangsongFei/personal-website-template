import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createIdentityAdapter } from '../../../lib/business/identity.mjs';
import { freezeS38ClosedCases } from '../../../scripts/s37-hosted/s38-closed-case-plan.mjs';
import { checkS38IndependentSourceReview } from '../../../scripts/s37-hosted/s38-reviewed-source.mjs';
import { runS38ClosedFixture } from '../../../scripts/s37-hosted/s38-closed-executor.node.mjs';

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

function fixture(t) {
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
    ' -c logging_collector=on -c log_destination=jsonlog -c log_min_error_statement=panic -c log_directory=log -c log_timezone=UTC',
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
    { rpc: 's37e1_read_file', sqlstate: '42501', reason: 'BUSINESS_DENIED' },
    { rpc: 'read_introduction', sqlstate: 'PT503', reason: 'NOT_CONFIGURED' },
  ];
  const cases = definitions.map(({ rpc, sqlstate, reason }, index) => {
    // A real exception is emitted by PostgreSQL after an attempted fixture
    // insert, so independent observation can verify that nothing persisted.
    const deny = `IF NOT gate_open THEN RAISE EXCEPTION USING ERRCODE='${sqlstate}', MESSAGE='${reason}'; END IF;`;
    const definitionSha256 = sha(deny);
    const extraArgs = index === 0 ? ', asset_id uuid, storage_version uuid' : '';
    const extraTypes = index === 0 ? ', uuid, uuid' : '';
    const extraBody = index === 0 ? ` || ',"asset_id":' || to_json(asset_id)::text || ',"storage_version":' || to_json(storage_version)::text` : '';
    admin(`
      CREATE FUNCTION site_api.${rpc}(target uuid${extraArgs}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = '' AS $fixture$
      DECLARE
        h jsonb := current_setting('request.headers')::jsonb;
        claims jsonb := current_setting('request.jwt.claims')::jsonb;
        gate_open boolean;
        statement_text text := '{"target":' || to_json(target)::text${extraBody} || '}';
      BEGIN
        SELECT s.gate_open INTO STRICT gate_open FROM fixture_guard.state s;
        INSERT INTO fixture_guard.effects VALUES ((h->>'x-request-id')::uuid);
        RAISE LOG '%', 'S38_LOCAL_DB_SOURCE ' || json_build_object(
          'fixtureId','${fixtureId}', 'requestId',h->>'x-request-id', 'uid',claims->>'sub', 'sid',claims->>'session_id',
          'requestSha256',h->>'x-s38-case-sha256',
          'bodySha256',encode(sha256(convert_to(statement_text,'UTF8')),'hex'),
          'statementSha256',encode(sha256(convert_to(statement_text,'UTF8')),'hex'),
          'connectionRole',session_user, 'callerRole',current_setting('role'), 'decisionRole',current_user,
          'function','site_api.${rpc}', 'definitionSha256','${definitionSha256}', 'branch','closed_gate',
          'identityBasis','jwt_claims', 'sqlstate','${sqlstate}', 'reason','${reason}'
        )::text;
        ${deny}
        RETURN '{}'::jsonb;
      END $fixture$;
      ALTER FUNCTION site_api.${rpc}(uuid${extraTypes}) OWNER TO ecv_s38_fixture_decider;
      REVOKE ALL ON FUNCTION site_api.${rpc}(uuid${extraTypes}) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION site_api.${rpc}(uuid${extraTypes}) TO authenticated;
    `);
    return { caseId: rpc.replaceAll('_', '-'), requestId: id(10 + index), uid: id(20 + index),
      sid: id(30 + index), args: { target: id(40 + index),
        ...(index === 0 ? { asset_id: id(50), storage_version: id(51) } : {}) }, rpc, sqlstate, reason, definitionSha256,
      branches: ['closed_gate'], decisionRole: 'ecv_s38_fixture_decider', identityBasis: 'jwt_claims' };
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
    logs, tokens, identity, cases, connections, state, readSource, readClosure, directory,
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
