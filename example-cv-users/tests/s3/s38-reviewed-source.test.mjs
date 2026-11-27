import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { buildS38ClosedPlan, freezeS38ClosedCases } from '../../scripts/s37-hosted/s38-closed-case-plan.mjs';
import { checkS38IndependentSourceReview } from '../../scripts/s37-hosted/s38-reviewed-source.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const id = n => '58110000-0000-4000-8000-' + String(n).padStart(12, '0');
const rule = {
  branches: ['runtime_closed'], definitionSha256: 'a'.repeat(64), decisionRole: 'ecv_fixture_decision',
  decisionFunction: 'site_private.fixture_decide', identityBasis: 'POSTGREST_VERIFIED_CLAIMS',
};

function bindings(lane) {
  const ownerCount = lane === 'A' ? 1 : 2;
  const actors = Array.from({ length: ownerCount }, (_, i) => ({ uid: id(1 + i), sid: id(3 + i), site: id(5 + i) }));
  const files = Array.from({ length: ownerCount }, (_, i) => ({ asset: id(7 + i), version: id(9 + i), run: id(11 + i) }));
  const cases = ['same-text', 'cross-text'];
  for (let file = 1; file <= files.length; file++) {
    for (const relation of ['same', 'cross']) {
      for (const scope of ['s3m8', 's3edge']) {
        for (const operation of ['read', 'history', 'prepare']) cases.push(relation + '-file-' + file + '-' + scope + '-' + operation);
      }
    }
  }
  const ids = actors.flatMap((_, i) => cases.map(item => 'business-owner-' + (i + 1) + '-' + item));
  return { lane, actors, files, otherSite: lane === 'A' ? id(15) : null, edgeRun: id(16),
    requestIds: ids.map((_, i) => id(100 + i)), sourceRules: Object.fromEntries(ids.map(key => [key, { ...rule }])) };
}

test('reconstructs all A14 and B52 in original order with exact Owner, target, storage version and closed RPC', () => {
  for (const lane of ['A', 'B']) {
    const binding = bindings(lane);
    const cases = buildS38ClosedPlan(binding);
    const frozen = freezeS38ClosedCases(lane, cases, { requireFull: true });
    assert.equal(cases.length, lane === 'A' ? 14 : 52);
    assert.deepEqual(cases.map(item => item.requestId), binding.requestIds);
    assert.equal(cases[0].args.target, binding.actors[0].site);
    assert.equal(cases[1].args.target, lane === 'A' ? binding.otherSite : binding.actors[1].site);
    assert.deepEqual(cases[2].args, { target: binding.actors[0].site, asset_id: binding.files[0].asset,
      storage_version: binding.files[0].version });
    assert.equal(cases[4].args.operation, 'prepare');
    assert.equal(cases[7].args.target_run, binding.edgeRun);
    assert.equal(cases.at(-1).args.target_site, lane === 'A' ? binding.otherSite : binding.actors[0].site);
    assert.equal(cases.at(-1).uid, binding.actors.at(-1).uid);
    assert.equal(frozen.at(-1).sid, binding.actors.at(-1).sid);
    assert.ok(Object.isFrozen(cases[4].args.input));
  }
});

test('rejects truncated/widened plans, duplicated SIDs and changed operation targets', () => {
  const base = bindings('B');
  assert.throws(() => buildS38ClosedPlan({ ...base, requestIds: base.requestIds.slice(1) }), /PLAN/);
  assert.throws(() => buildS38ClosedPlan({ ...base, actors: [base.actors[0], { ...base.actors[1], sid: base.actors[0].sid }] }), /PLAN/);
  const full = buildS38ClosedPlan(base);
  assert.throws(() => freezeS38ClosedCases('B', [full[0], { ...full[1], caseId: full[0].caseId }]), /PLAN/);
  assert.throws(() => freezeS38ClosedCases('A', [full[2]]), /PLAN/);
});

function packet() {
  const planInputs = bindings('A');
  const cases = buildS38ClosedPlan(planInputs);
  const plan = freezeS38ClosedCases('A', cases);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const contract = {
    realm: 'supplier', lane: 'A', project: 'fixtureproject000001', authIssuer: 'https://fixtureproject000001.supabase.co/auth/v1',
    databaseSha256: 'b'.repeat(64),
    collectorId: 'test-reviewer', beforeAt: '2026-01-01T12:00:00.000Z', afterAt: '2026-01-01T12:01:00.000Z',
  };
  const approved = { ...contract, reviewerKeySha256: sha(publicKey.export({ type: 'spki', format: 'der' })), planInputs,
    contractSha256: sha(json({ ...contract, caseSha256: plan.map(item => item.requestSha256) })) };
  const originals = [Buffer.concat(plan.map(item => Buffer.from(item.requestId)))];
  const transportReceipts = plan.map(item => ({ caseId: item.caseId, requestId: item.requestId,
    requestSha256: item.requestSha256, requestBodySha256: item.bodySha256, status: item.sqlstate === '42501' ? 403 : 503,
    replySha256: 'c'.repeat(64) }));
  const rows = plan.map((item, index) => {
    const { caseId, requestId, uid, sid, requestSha256, bodySha256, decisionRole, decisionFunction, definitionSha256,
      identityBasis, sqlstate, reason } = item;
    return { caseId, requestId, uid, sid, requestSha256, bodySha256, sourceId: 'fixture-' + index,
      recordedAt: '2026-01-01T12:00:15.000Z', connectionRole: 'ecv_s3_internal_api_login', callerRole: 'authenticated',
      decisionRole, decisionFunction, definitionSha256, branch: item.branches[0], identityBasis, sqlstate, reason,
      statementSha256: 'd'.repeat(64), backendId: 'pg-backend', transactionId: '3/' + index,
      original: { artifactSha256: sha(originals[0]), start: index * 36, end: (index + 1) * 36, sha256: sha(requestId) } };
  });
  function signed(input = {}) {
    const archive = json({ collectorId: approved.collectorId, databaseSha256: approved.databaseSha256, rows: input.rows ?? rows });
    const wire = input.transportReceipts ?? transportReceipts;
    const review = json({ version: 1, realm: approved.realm, project: approved.project, lane: approved.lane,
      contractSha256: approved.contractSha256, transportSha256: sha(json(wire)), archiveSha256: sha(archive),
      artifacts: [{ kind: input.kind ?? 'SUPABASE_POSTGRES_SOURCE_EXPORT', sha256: sha(originals[0]) }] });
    return { approved, cases, transportReceipts: wire, originals, archive, review,
      reviewerPublicKey: publicKey.export({ type: 'spki', format: 'pem' }), signature: sign(null, review, privateKey) };
  }
  return { signed, rows, transportReceipts };
}

test('signed review binds complete original bytes and source decisions only', () => {
  const fixture = packet();
  const result = checkS38IndependentSourceReview(fixture.signed());
  assert.equal(result.status, 'REVIEWED_SOURCE_BINDING_ONLY');
  assert.equal(result.linkedCases, 14);
  assert.equal(result.hostedAcceptance, false);
});

test('tampering with raw source, review signature, trusted plan or key fails closed', () => {
  const fixture = packet().signed();
  assert.throws(() => checkS38IndependentSourceReview({ ...fixture, originals: [Buffer.from('replaced')] }), /ORIGINAL_PIN/);
  assert.throws(() => checkS38IndependentSourceReview({ ...fixture, signature: Buffer.alloc(64) }), /SIGNATURE/);
  const replacement = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });
  assert.throws(() => checkS38IndependentSourceReview({ ...fixture, reviewerPublicKey: replacement }), /SIGNATURE/);
  assert.throws(() => checkS38IndependentSourceReview({ ...fixture,
    approved: { ...fixture.approved, beforeAt: '2026-01-01T12:00:14.000Z' } }), /APPROVAL/);
  assert.throws(() => checkS38IndependentSourceReview({ ...fixture,
    approved: { ...fixture.approved, authIssuer: 'https://different.fixture.invalid/auth/v1' } }), /APPROVAL/);
  const cases = [...fixture.cases];
  cases[1] = { ...cases[1], uid: cases[0].sid };
  assert.throws(() => checkS38IndependentSourceReview({ ...fixture, cases }), /APPROVAL/);
});

test('a signed packet still rejects nonmatching role, native branch, wire, timestamp, and recycled raw ranges', () => {
  const { signed, rows, transportReceipts } = packet();
  for (const update of [{ decisionRole: 'postgres' }, { branch: 'filtered_other_owner' }, { bodySha256: 'e'.repeat(64) },
    { recordedAt: '2026-01-01T12:01:00.001Z' }, { sid: id(999) }]) {
    assert.throws(() => checkS38IndependentSourceReview(signed({ rows: [{ ...rows[0], ...update }, ...rows.slice(1)] })), /ROW/);
  }
  assert.throws(() => checkS38IndependentSourceReview(signed({ kind: 'LOCAL_POSTGRES_JSONLOG' })), /ORIGINAL_PIN/);
  assert.throws(() => checkS38IndependentSourceReview(signed({
    rows: [rows[0], { ...rows[1], original: rows[0].original }, ...rows.slice(2)],
  })), /ORIGINAL_RANGE/);
  assert.throws(() => checkS38IndependentSourceReview(signed({
    transportReceipts: [{ ...transportReceipts[0], status: 200 }, ...transportReceipts.slice(1)],
  })), /WIRE/);
});


test('#64 fixture request and journal scope hashes stay compatible on both lanes', () => {
  const common = { uid: id(1), sid: id(2), branches: ['closed_gate'], definitionSha256: 'a'.repeat(64),
    decisionRole: 'ecv_fixture_decision', identityBasis: 'jwt_claims' };
  const text = { ...common, caseId: 'text', requestId: id(3), rpc: 'read_introduction', sqlstate: 'PT503',
    reason: 'NOT_CONFIGURED', args: { target: id(4) } };
  const file = { ...common, caseId: 'file', requestId: id(5), sqlstate: '42501', reason: 'BUSINESS_DENIED',
    args: { target: id(6), asset_id: id(7), storage_version: id(8) } };
  assert.deepEqual(freezeS38ClosedCases('A', [text, { ...file, rpc: 's37e1_read_file' }], { fixture: true })
    .map(item => item.requestSha256), [
    '8a61c3d746f69632d9cb47669a77011114b8a6aed50f10b18ee8f0d94c40a7c7',
    '5da2a895cbea1832ea7996109eeae0dc8125544a917f0b7ff80e32e1b61a0edf',
  ]);
  assert.deepEqual(freezeS38ClosedCases('B', [text, { ...file, rpc: 's37h2_read_file' }], { fixture: true })
    .map(item => item.requestSha256), [
    '8a61c3d746f69632d9cb47669a77011114b8a6aed50f10b18ee8f0d94c40a7c7',
    'cdf4e669189c3bdfe3804befebb91160afd784150dd4b34909fc1b76d4f99eea',
  ]);
});
