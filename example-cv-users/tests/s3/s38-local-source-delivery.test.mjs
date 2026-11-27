import assert from 'node:assert/strict';
import test from 'node:test';
import { runS38ClosedFixture } from '../../scripts/s37-hosted/s38-closed-executor.node.mjs';
import * as provenance from '../../scripts/s37-hosted/s38-local-source-provenance.mjs';

const { correlateLocalS38Denials } = provenance;

const fixtureId = '1'.repeat(32);
const decisionFunction = 'site_private.lock_proof_configuration';
const definitionSha256 = '2'.repeat(64);
const branch = 'runtime_closed';
const request = {
  caseId: 'synthetic-closed',
  requestId: '00000000-0000-4000-8000-000000000001',
  uid: '00000000-0000-4000-8000-000000000002',
  sid: '00000000-0000-4000-8000-000000000003',
  requestSha256: '3'.repeat(64),
  decisionFunction,
  decisionRole: 'ecv_s3_authz_reader',
  branches: [branch],
  sqlstate: 'PT503',
  reason: 'NOT_CONFIGURED',
  identityBasis: 'POSTGREST_VERIFIED_CLAIMS',
};
const connectionRole = 'ecv_s3_internal_api_login';
const common = { session_id: 'local.backend', pid: 311, user: connectionRole, dbname: 'postgres', vxid: '3/8' };
const branchEvent = {
  ...common, line_num: 4, error_severity: 'LOG',
  message: 'S38_LOCAL_DB_SOURCE ' + JSON.stringify({
    ...request, fixtureId, function: decisionFunction, definitionSha256, branch,
    statementSha256: '4'.repeat(64), connectionRole, callerRole: 'authenticated',
  }),
};
const engineError = {
  ...common, line_num: 5, error_severity: 'ERROR', state_code: request.sqlstate,
  message: request.reason, context: 'PL/pgSQL function ' + decisionFunction + '()',
};

function verify(events, expectedRequest = request) {
  return correlateLocalS38Denials({
    fixtureId, requests: [expectedRequest],
    raw: Buffer.from(events.map(event => JSON.stringify(event)).join('\n')),
    definitions: { [decisionFunction]: { originalSha256: definitionSha256, branches: [branch] } },
  });
}

test('binds the decision and next native error in the same PostgreSQL session', () => {
  const [result] = verify([branchEvent, engineError]);
  assert.equal(result.requestId, request.requestId);
  assert.equal(result.backendSession, common.session_id);
  assert.equal(result.nativeTransaction, common.vxid);
  assert.equal(result.branch, branch);
  assert.equal(result.sqlstate, request.sqlstate);
  assert.match(result.engineErrorLogSha256, /^[a-f0-9]{64}$/);
});

test('requires the separate native error even when a branch event is present', () => {
  assert.throws(() => verify([branchEvent]), /S38_LOCAL_DB_SOURCE_MISMATCH/);
});

test('refuses an engine error attributed to another backend transaction', () => {
  assert.throws(() => verify([branchEvent, { ...engineError, vxid: '3/9' }]), /S38_LOCAL_DB_SOURCE_MISMATCH/);
});

test('refuses duplicate engine events for one source position', () => {
  assert.throws(() => verify([branchEvent, engineError, engineError]), /S38_LOCAL_DB_SOURCE_DUPLICATE_ENGINE_EVENT/);
});

test('publishes only the standalone evidence correlator', () => {
  assert.deepEqual(Object.keys(provenance), ['correlateLocalS38Denials']);
});

test('rejects a decision claimed for a different request digest', () => {
  const source = JSON.parse(branchEvent.message.slice('S38_LOCAL_DB_SOURCE '.length));
  const mismatched = { ...branchEvent, message: 'S38_LOCAL_DB_SOURCE ' +
    JSON.stringify({ ...source, requestSha256: '5'.repeat(64) }) };
  assert.throws(() => verify([mismatched, engineError]), /S38_LOCAL_DB_SOURCE_MISMATCH/);
});


test('refuses missing or changed database argument evidence for new executor receipts', () => {
  const bodySha256 = '8'.repeat(64);
  const bound = { ...request, bodySha256 };
  const event = JSON.parse(branchEvent.message.slice('S38_LOCAL_DB_SOURCE '.length));
  const actual = { ...branchEvent, message: 'S38_LOCAL_DB_SOURCE ' + JSON.stringify({ ...event, bodySha256 }) };
  assert.equal(verify([actual, engineError], bound)[0].requestId, request.requestId);
  assert.throws(() => verify([branchEvent, engineError], bound), /S38_LOCAL_DB_SOURCE_MISMATCH/);
  assert.throws(() => verify([actual, engineError], { ...bound, bodySha256: '9'.repeat(64) }),
    /S38_LOCAL_DB_SOURCE_MISMATCH/);
});

test('executor rejects unknown routes, cross-lane namespaces, action widening and additional parameters', async () => {
  const valid = { ...request, rpc: 'read_introduction', args: { target: request.uid }, definitionSha256,
    identityBasis: 'jwt_claims' };
  for (const item of [
    { ...valid, rpc: 'unapproved_rpc' },
    { ...valid, rpc: 's37h1_read_file' },
    { ...valid, rpc: 's37e1_file_command', sqlstate: '42501', reason: 'BUSINESS_DENIED', args: {
      target_run: request.sid, target_site: request.uid, operation: 'seal', input: {},
    } },
    { ...valid, args: { ...valid.args, extra: null } },
  ]) await assert.rejects(runS38ClosedFixture({ lane: 'A', cases: [item] }), /S38_CLOSED_EXECUTOR_PLAN/);
});
