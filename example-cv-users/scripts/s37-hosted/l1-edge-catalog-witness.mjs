// Offline shape comparison. The caller independently authenticates the
// frozen plan, dispatch record and read-only observations before comparing.
import { uuid } from '../../lib/business/protocol.mjs';

const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,62}$/.test(value);
const xid = value => typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) &&
  Number(value) >= 3 && Number(value) <= 4_294_967_295;
const count = value => Number.isSafeInteger(value) && value >= 0;
const utcTimestamp = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) && Number.isFinite(Date.parse(value));

function validPlan(plan) {
  const { identity, edgeOwner, requestId, sqlSha256, protection } = plan ?? {};
  return identity != null &&
    [identity.project, identity.database, identity.observer].every(identifier) &&
    typeof identity.version === 'string' && /^[1-9][0-9]{5}$/.test(identity.version) &&
    [identity.server, identity.system].every(digest) && utcTimestamp(identity.started) &&
    xid(identity.l1Xid) && xid(identity.forwardXid) && identity.l1Xid !== identity.forwardXid &&
    identifier(edgeOwner) && uuid(requestId) && digest(sqlSha256) &&
    [protection?.catalogSha256, protection?.historySha256, protection?.outboxSha256].every(digest) &&
    count(protection.historyRows) && count(protection.outboxRows);
}

function protectedCatalogMatches(snapshot, plan) {
  const { identity, closure, history } = snapshot ?? {};
  const expected = plan.identity;
  const protection = plan.protection;
  return identity != null && identity.readonly === 'on' &&
    ['project', 'database', 'observer', 'version', 'server', 'system', 'started', 'l1Xid']
      .every(field => identity[field] === expected[field]) &&
    identity.l1Status === 'committed' && identity.forwardIndexXid === expected.forwardXid &&
    identity.forwardConstraintXid === expected.forwardXid && identity.forwardStatus === 'committed' &&
    closure?.closed === true && closure.seedProtected === true &&
    snapshot.protectedSha256 === protection.catalogSha256 &&
    history?.holdsExact === true && history.historyRows === protection.historyRows &&
    history.historyTotal === protection.historyRows && history.historySha256 === protection.historySha256 &&
    history.outboxPending === protection.outboxRows && history.outboxTotal === protection.outboxRows &&
    history.outboxSha256 === protection.outboxSha256;
}

const noGo = Object.freeze({ status: 'NO_GO', writeRetryAllowed: false });
const unknown = Object.freeze({ status: 'UNKNOWN', writeRetryAllowed: false });

export function checkL1EdgeCatalogWitness(plan, { before, after, recordedDispatch } = {}) {
  if (!validPlan(plan) || !protectedCatalogMatches(before, plan) ||
      before.edge?.absent !== true || before.edge.xid !== null || before.edge.status !== null || before.edge.owner !== null ||
      recordedDispatch?.project !== plan.identity.project || recordedDispatch.requestId !== plan.requestId ||
      recordedDispatch.sqlSha256 !== plan.sqlSha256) return noGo;

  // Lack of a matching transaction anchor does not establish non-execution.
  if (after == null) return unknown;
  if (!protectedCatalogMatches(after, plan)) return noGo;
  const edge = after.edge;
  if (edge?.absent !== false || !xid(edge.xid) || edge.status !== 'committed' ||
      [plan.identity.l1Xid, plan.identity.forwardXid].includes(edge.xid) ||
      edge.owner !== plan.edgeOwner ||
      !['consistentXid', 'closes', 'rpcs', 'storage', 'permissions', 'rls'].every(field => edge[field] === true)) return unknown;

  return Object.freeze({
    status: 'HISTORY_CATALOG_SHAPE_MATCH_ONLY',
    requestId: plan.requestId,
    xid: edge.xid,
    writeRetryAllowed: false,
  });
}
