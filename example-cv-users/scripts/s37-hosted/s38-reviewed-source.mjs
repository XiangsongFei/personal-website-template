// Offline acceptance of an independently reviewed database source bundle.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { buildS38ClosedPlan, freezeS38ClosedCases } from './s38-closed-case-plan.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonSha = value => sha(JSON.stringify(value));
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const label = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value);
const projectId = value => typeof value === 'string' && /^[a-z0-9]{20}$/.test(value);
const utc = value => {
  if (typeof value !== 'string') return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
};
const exact = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const stop = code => { throw Error('S38_REVIEWED_SOURCE_' + code); };
const kinds = Object.freeze({
  'local-fixture': ['LOCAL_POSTGRES_JSONLOG'],
  supplier: ['SUPABASE_POSTGRES_SOURCE_EXPORT', 'SUPABASE_ATTESTED_INTERNAL_TRACE'],
});
const signedFields = ['version', 'realm', 'lane', 'project', 'contractSha256', 'transportSha256', 'archiveSha256', 'artifacts'];
const wireFields = ['caseId', 'requestId', 'requestSha256', 'requestBodySha256', 'status', 'replySha256'];
const sourceFields = ['caseId', 'requestId', 'uid', 'sid', 'requestSha256', 'bodySha256', 'sourceId', 'recordedAt',
  'connectionRole', 'callerRole', 'decisionRole', 'decisionFunction', 'definitionSha256', 'branch', 'identityBasis',
  'sqlstate', 'reason', 'statementSha256', 'backendId', 'transactionId', 'original'];

function parse(bytes, max) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > max) stop('STRUCTURE');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    if (JSON.stringify(value) !== text || Buffer.byteLength(text) !== bytes.length) stop('STRUCTURE');
    return value;
  } catch {
    stop('STRUCTURE');
  }
}

function signedReview(bytes, signature, keyPem, expectedSha256) {
  if (typeof keyPem !== 'string' || !keyPem.startsWith('-----BEGIN PUBLIC KEY-----\n') || keyPem.length > 1024 || !Buffer.isBuffer(signature) || signature.length !== 64 ||
      !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16_384) stop('SIGNATURE');
  let key;
  try { key = createPublicKey(keyPem); }
  catch { stop('SIGNATURE'); }
  if (key.asymmetricKeyType !== 'ed25519' || sha(key.export({ type: 'spki', format: 'der' })) !== expectedSha256 ||
      !verify(null, bytes, key, signature)) stop('SIGNATURE');
  return parse(bytes, 16_384);
}

function originalSlices(rows, artifacts) {
  const ranges = new Map();
  for (const row of rows) {
    const ref = row.original;
    if (!exact(ref, ['artifactSha256', 'start', 'end', 'sha256']) || !digest(ref.sha256) ||
        !Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end) || ref.start < 0 || ref.end <= ref.start)
      stop('ORIGINAL_REF');
    const raw = artifacts.get(ref.artifactSha256);
    if (!raw || ref.end > raw.length || sha(raw.subarray(ref.start, ref.end)) !== ref.sha256) stop('ORIGINAL_REF');
    const used = ranges.get(ref.artifactSha256) ?? [];
    if (used.some(range => ref.start < range.end && ref.end > range.start)) stop('ORIGINAL_RANGE');
    used.push(ref);
    ranges.set(ref.artifactSha256, used);
  }
}

// The approval and raw event transport must come from a separate, trusted
// operator. The signature authenticates that operator's review of the source
// originals. It is not issued by Supabase and grants no dispatch permission.
export function checkS38IndependentSourceReview({ approved, reviewerPublicKey, cases, transportReceipts,
  archive, originals, review, signature } = {}) {
  const { realm, lane, project, authIssuer, databaseSha256, collectorId, beforeAt, afterAt, reviewerKeySha256, contractSha256 } = approved ?? {};
  const start = utc(beforeAt);
  const end = utc(afterAt);
  if (!Object.hasOwn(kinds, realm) || !(realm === 'supplier' ? projectId(project) : project === 's38-local-fixture') ||
      authIssuer !== (realm === 'supplier' ? 'https://' + project + '.supabase.co/auth/v1' : 'https://s38.fixture.invalid/auth/v1') ||
      !digest(databaseSha256) || !label(collectorId) || !(start < end) ||
      !digest(reviewerKeySha256) || !digest(contractSha256)) stop('APPROVAL');
  const plan = freezeS38ClosedCases(lane, cases, { requireFull: realm === 'supplier', fixture: realm === 'local-fixture' });
  const caseSha256 = plan.map(item => item.requestSha256);
  if (realm === 'supplier') {
    const expected = buildS38ClosedPlan({ ...approved.planInputs, lane });
    const approvedCases = freezeS38ClosedCases(lane, expected, { requireFull: true });
    if (!approvedCases.every((item, index) => item.requestSha256 === caseSha256[index])) stop('APPROVAL');
  }
  if (jsonSha({ realm, lane, project, authIssuer, databaseSha256, collectorId, beforeAt, afterAt,
    caseSha256 }) !== contractSha256) stop('APPROVAL');

  const attested = signedReview(review, signature, reviewerPublicKey, reviewerKeySha256);
  if (!exact(attested, signedFields) || attested.version !== 1 ||
      attested.realm !== realm || attested.project !== project || attested.lane !== lane ||
      attested.contractSha256 !== contractSha256 || !Array.isArray(transportReceipts) ||
      transportReceipts.length !== plan.length || attested.transportSha256 !== jsonSha(transportReceipts) ||
      !Buffer.isBuffer(archive) || archive.length > 256 * 1024 || attested.archiveSha256 !== sha(archive)) stop('SCOPE');

  if (!Array.isArray(originals) || !Array.isArray(attested.artifacts) || !originals.length || originals.length > 4 ||
      originals.length !== attested.artifacts.length) stop('ORIGINAL_PIN');
  const artifacts = new Map();
  for (const [index, bytes] of originals.entries()) {
    const pin = attested.artifacts[index];
    if (!exact(pin, ['kind', 'sha256']) || !kinds[realm].includes(pin.kind) || !Buffer.isBuffer(bytes) || !bytes.length ||
        bytes.length > 8 * 1024 * 1024 || pin.sha256 === attested.archiveSha256 ||
        artifacts.has(pin.sha256) || sha(bytes) !== pin.sha256) stop('ORIGINAL_PIN');
    artifacts.set(pin.sha256, bytes);
  }

  const normalized = parse(archive, 256 * 1024);
  if (!exact(normalized, ['collectorId', 'databaseSha256', 'rows']) || normalized.collectorId !== collectorId ||
      normalized.databaseSha256 !== databaseSha256 || !Array.isArray(normalized.rows) ||
      normalized.rows.length !== plan.length) stop('ARCHIVE');
  const sourceIds = new Set();
  for (const [index, item] of plan.entries()) {
    const wire = transportReceipts[index];
    if (!exact(wire, wireFields) || wire.caseId !== item.caseId || wire.requestId !== item.requestId ||
        wire.requestSha256 !== item.requestSha256 || wire.requestBodySha256 !== item.bodySha256 ||
        wire.status !== (item.sqlstate === '42501' ? 403 : 503) || !digest(wire.replySha256)) stop('WIRE');
    const row = normalized.rows[index];
    if (!exact(row, sourceFields) ||
        !['caseId', 'requestId', 'uid', 'sid', 'requestSha256', 'bodySha256', 'decisionRole', 'decisionFunction',
          'definitionSha256', 'identityBasis', 'sqlstate', 'reason'].every(field => row[field] === item[field]) ||
        !item.branches.includes(row.branch) || row.connectionRole !== 'ecv_s3_internal_api_login' ||
        row.callerRole !== 'authenticated' || !digest(row.statementSha256) || !label(row.sourceId) ||
        !label(row.backendId) || !label(row.transactionId) || sourceIds.has(row.sourceId) ||
        !(utc(row.recordedAt) >= start && utc(row.recordedAt) <= end)) stop('ROW');
    sourceIds.add(row.sourceId);
  }
  originalSlices(normalized.rows, artifacts);
  return Object.freeze({ status: 'REVIEWED_SOURCE_BINDING_ONLY', realm, lane, linkedCases: sourceIds.size,
    archiveSha256: attested.archiveSha256, reviewSha256: sha(review), hostedAcceptance: false });
}
