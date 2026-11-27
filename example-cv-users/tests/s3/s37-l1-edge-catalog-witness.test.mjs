import assert from 'node:assert/strict';
import test from 'node:test';
import { checkL1EdgeCatalogWitness } from '../../scripts/s37-hosted/l1-edge-catalog-witness.mjs';

function fixture() {
  const requestId = '40000000-0000-4000-8000-000000000001';
  const plan = {
    identity: { project: 'project-fixture', database: 'catalog_fixture', observer: 'catalog_observer',
      version: '170012', server: '1'.repeat(64), system: '2'.repeat(64),
      started: '2026-01-01T00:00:00.000000Z', l1Xid: '100', forwardXid: '101' },
    protection: { catalogSha256: '3'.repeat(64), historySha256: '4'.repeat(64), outboxSha256: '5'.repeat(64),
      historyRows: 2, outboxRows: 1 },
    edgeOwner: 'edge_owner',
    requestId,
    sqlSha256: '6'.repeat(64),
  };
  const before = {
    identity: { ...plan.identity, readonly: 'on', l1Status: 'committed', forwardIndexXid: '101',
      forwardConstraintXid: '101', forwardStatus: 'committed' },
    closure: { closed: true, seedProtected: true },
    protectedSha256: plan.protection.catalogSha256,
    history: { holdsExact: true, historyRows: 2, historyTotal: 2, historySha256: plan.protection.historySha256,
      outboxPending: 1, outboxTotal: 1, outboxSha256: plan.protection.outboxSha256 },
    edge: { absent: true, status: null, xid: null, owner: null },
  };
  const after = structuredClone(before);
  after.edge = { absent: false, xid: '102', status: 'committed', owner: 'edge_owner',
    consistentXid: true, closes: true, rpcs: true, storage: true, permissions: true, rls: true };
  const recordedDispatch = { project: plan.identity.project, requestId, sqlSha256: plan.sqlSha256 };
  return { plan, observations: { before, after, recordedDispatch } };
}

test('matches a committed Edge anchor against the independent protected L1 baseline', () => {
  const { plan, observations } = fixture();
  const result = checkL1EdgeCatalogWitness(plan, observations);
  assert.deepEqual(result, { status: 'HISTORY_CATALOG_SHAPE_MATCH_ONLY',
    requestId: plan.requestId, xid: '102', writeRetryAllowed: false });
  assert.ok(Object.isFrozen(result));
});

const cases = [
  ['pre-existing Edge', 'NO_GO', ({ before }) => { before.edge.absent = false; }],
  ['pre-existing Edge owner', 'NO_GO', ({ before }) => { before.edge.owner = 'edge_owner'; }],
  ['wrong request key', 'NO_GO', ({ recordedDispatch }) => {
    recordedDispatch.requestId = '40000000-0000-4000-8000-000000000002';
  }],
  ['wrong SQL digest', 'NO_GO', ({ recordedDispatch }) => { recordedDispatch.sqlSha256 = '7'.repeat(64); }],
  ['writable observation', 'NO_GO', ({ after }) => { after.identity.readonly = 'off'; }],
  ['wrong cluster', 'NO_GO', ({ after }) => { after.identity.system = '8'.repeat(64); }],
  ['changed forward constraint', 'NO_GO', ({ after }) => { after.identity.forwardConstraintXid = '102'; }],
  ['changed protected catalog', 'NO_GO', ({ after }) => { after.protectedSha256 = '0'.repeat(64); }],
  ['changed role closure', 'NO_GO', ({ after }) => { after.closure.closed = false; }],
  ['missing hold', 'NO_GO', ({ after }) => { after.history.holdsExact = false; }],
  ['changed Outbox', 'NO_GO', ({ after }) => { after.history.outboxPending = 0; }],
  ['missing post-commit observation', 'UNKNOWN', observations => { delete observations.after; }],
  ['no catalog transition', 'UNKNOWN', observations => { observations.after = structuredClone(observations.before); }],
  ['old XID reused as Edge XID', 'UNKNOWN', ({ after }) => { after.edge.xid = '101'; }],
  ['reserved XID', 'UNKNOWN', ({ after }) => { after.edge.xid = '2'; }],
  ['unconfirmed XID', 'UNKNOWN', ({ after }) => { after.edge.status = 'in progress'; }],
  ['inconsistent catalog anchors', 'UNKNOWN', ({ after }) => { after.edge.consistentXid = false; }],
  ['unexpected ACL', 'UNKNOWN', ({ after }) => { after.edge.permissions = false; }],
];
for (const [name, status, mutate] of cases) {
  test(`preserves the write fence after ${name}`, () => {
    const { plan, observations } = fixture();
    mutate(observations);
    assert.deepEqual(checkL1EdgeCatalogWitness(plan, observations), { status, writeRetryAllowed: false });
  });
}
