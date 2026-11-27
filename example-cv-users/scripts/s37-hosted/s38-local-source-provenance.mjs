// Correlate source evidence produced by a controlled local PostgreSQL fixture.
import { createHash } from 'node:crypto';

const marker = 'S38_LOCAL_DB_SOURCE ';
const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/.test(value);
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const role = value => typeof value === 'string' && /^ecv_[a-z0-9_]+$/.test(value);
const deny = reason => { throw new Error('S38_LOCAL_DB_SOURCE_' + reason); };

// Match the branch event to the immediately following engine error from the
// same native backend/session. Input is the guarded local PG jsonlog file,
// never client output or HTTP error metadata.
export function correlateLocalS38Denials({ raw, requests, fixtureId, definitions }) {
  if (!Buffer.isBuffer(raw) || !/^[0-9a-f]{32}$/.test(fixtureId) || !definitions ||
      !Array.isArray(requests) || !requests.length || new Set(requests.map(request => request.requestId)).size !== requests.length) {
    deny('INPUT');
  }
  const expected = new Map(requests.map(request => [request.requestId, request]));
  const errors = new Map();
  const events = [];
  for (const line of raw.toString('utf8').split('\n').filter(Boolean)) {
    const log = JSON.parse(line);
    if (log.error_severity === 'ERROR') {
      const id = log.session_id + ':' + log.line_num;
      if (errors.has(id)) deny('DUPLICATE_ENGINE_EVENT');
      errors.set(id, log);
    }
    if (log.error_severity === 'LOG' && log.message?.startsWith(marker)) {
      events.push({ log, evidence: JSON.parse(log.message.slice(marker.length)) });
    }
  }
  const linked = new Map();
  for (const { log, evidence } of events) {
    const request = expected.get(evidence.requestId);
    const definition = definitions[evidence.function];
    const sameBackend = errors.get(log.session_id + ':' + (log.line_num + 1));
    if (!request || linked.has(evidence.requestId) || evidence.fixtureId !== fixtureId || !uuid(evidence.requestId) ||
        !uuid(evidence.uid) || !uuid(evidence.sid) || !role(evidence.decisionRole) ||
        !digest(evidence.statementSha256) || evidence.requestSha256 !== request.requestSha256 ||
        !definition || evidence.definitionSha256 !== definition.originalSha256 ||
        !definition.branches.includes(evidence.branch) || evidence.function !== request.decisionFunction ||
        !request.branches.includes(evidence.branch) ||
        evidence.uid !== request.uid || evidence.sid !== request.sid ||
        evidence.sqlstate !== request.sqlstate || evidence.reason !== request.reason ||
        evidence.decisionRole !== request.decisionRole || evidence.identityBasis !== request.identityBasis ||
        evidence.connectionRole !== 'ecv_s3_internal_api_login' || evidence.callerRole !== 'authenticated' ||
        log.user !== evidence.connectionRole || log.dbname !== 'postgres' || !Number.isInteger(log.pid) ||
        !Number.isInteger(log.line_num) || typeof log.session_id !== 'string' ||
        !sameBackend || sameBackend.pid !== log.pid || sameBackend.user !== log.user || typeof log.vxid !== 'string' ||
        sameBackend.vxid !== log.vxid ||
        sameBackend.state_code !== request.sqlstate || sameBackend.message !== request.reason ||
        !sameBackend.context?.startsWith('PL/pgSQL function ' + evidence.function + '(')) deny('MISMATCH');
    linked.set(evidence.requestId, Object.freeze({
      caseId: request.caseId, requestId: evidence.requestId,
      backendPid: log.pid, backendSession: log.session_id, nativeTransaction:log.vxid, nativeLogLine: log.line_num,
      nativeLoggedAt:log.timestamp,
      sourceId: fixtureId + ':' + log.session_id + ':' + log.line_num,
      nativeLogSha256: sha(JSON.stringify(log)), engineErrorLogSha256: sha(JSON.stringify(sameBackend)),
      decisionFunction: evidence.function, decisionRole: evidence.decisionRole, branch: evidence.branch,
      identityBasis: evidence.identityBasis, callerRole: evidence.callerRole, connectionRole: evidence.connectionRole,
      sqlstate: evidence.sqlstate, reason: evidence.reason,
      requestSha256: evidence.requestSha256, statementSha256: evidence.statementSha256,
    }));
  }
  if (linked.size !== expected.size || errors.size !== expected.size) deny('INCOMPLETE');
  return Object.freeze(requests.map(item => linked.get(item.requestId)));
}
