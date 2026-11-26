import assert from 'node:assert/strict';
import test from 'node:test';
import { correlateLocalS38Denials, instrumentLocalS38Denials } from '../../scripts/s37-hosted/s38-local-source-provenance.mjs';

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

function verify(events) {
  return correlateLocalS38Denials({
    fixtureId, requests: [request],
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

const localDefinition = `CREATE OR REPLACE FUNCTION ${decisionFunction}()
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'NOT_CONFIGURED' USING ERRCODE = 'PT503';
END
$function$;`;

test('keeps function replacement inside the guarded PostgreSQL statement', () => {
  const { sql, branches } = instrumentLocalS38Denials({
    name: decisionFunction, definition: localDefinition, fixtureId,
  });
  const [prefix, statement, suffix] = sql.split('$s38_source_local$');
  assert.equal(prefix, 'DO ');
  assert.equal(suffix, ';');
  assert.match(statement, /RAISE EXCEPTION 'S38_LOCAL_DB_SOURCE_TARGET'; END IF;\s*EXECUTE \$s38_source_definition\$CREATE OR REPLACE FUNCTION/);
  assert.match(statement, /RAISE LOG/);
  assert.deepEqual(branches, [branch]);
});

test('rejects definitions that would delimit the guarded statement', () => {
  for (const tag of ['$s38_source_local$', '$s38_source_definition$']) {
    assert.throws(() => instrumentLocalS38Denials({
      name: decisionFunction, definition: localDefinition + '\n-- ' + tag, fixtureId,
    }), /S38_LOCAL_DB_SOURCE_DEFINITION/);
  }
});
