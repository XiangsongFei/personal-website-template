import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const sources = load('sources.json');
const approval = load('approval.json');
const sha = /^[0-9a-f]{64}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const fail = code => { throw new Error(code); };

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
      Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort(compare)
      .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  fail('INVALID_EVIDENCE');
}

const objectKinds = new Set(['schema', 'relation', 'column', 'function', 'constraint', 'index',
  'trigger', 'policy', 'role', 'membership', 'default_acl', 'acl']);
const rowKey = (kind, name) => JSON.stringify([kind, name]);

function catalogRows(catalog) {
  if (catalog?.format !== 's36-a1-catalog-v1' || !Array.isArray(catalog.items) ||
      catalog.items.length === 0 || catalog.items.length > 20_000) fail('INVALID_CATALOG');
  const rows = new Map();
  for (const row of catalog.items) {
    if (!Array.isArray(row) || row.length !== 3 || !objectKinds.has(row[0]) ||
        typeof row[1] !== 'string' || !row[1].length || row[1].length > 1000) fail('INVALID_CATALOG_ROW');
    const key = rowKey(row[0], row[1]);
    if (rows.has(key)) fail('DUPLICATE_CATALOG_OBJECT');
    rows.set(key, row[2]);
  }
  return rows;
}

export function catalogDigest(catalog) {
  const rows = [...catalogRows(catalog)].sort(([left], [right]) => compare(left, right));
  return digest(canonical(rows));
}

export function checkSourceCatalog(stage, catalog) {
  if (stage !== 'A07' && stage !== 'A50') fail('INVALID_CATALOG_STAGE');
  const rows = catalogRows(catalog);
  const expected = stage === 'A07' ? [...sources.source_catalog['01'], ...sources.source_catalog['02']] :
    sources.source_catalog['01'];
  for (const [kind, name, bodySha] of expected) {
    const key = rowKey(kind, name);
    if (!rows.has(key)) fail('SOURCE_OBJECT_MISSING');
    const value = rows.get(key);
    if (kind === 'function' && (!Array.isArray(value) || value.length !== 8 || value[7] !== bodySha)) {
      fail('SOURCE_FUNCTION_DRIFT');
    }
    if (kind === 'relation' && canonical(value) !== '["r","ecv_s3_owner",true,true]') fail('RELATION_NOT_CLOSED');
    if (kind === 'role' && (!Array.isArray(value) || value.length !== 8 ||
        value.slice(0, 7).some(flag => flag !== false))) fail('ROLE_NOT_CLOSED');
  }
  if (stage === 'A50') {
    for (const [kind, name] of sources.source_catalog['02']) {
      if (rows.has(rowKey(kind, name))) fail('A50_HAS_PHASE_02_OBJECTS');
    }
    for (const row of catalog.items) {
      if (['acl', 'membership', 'default_acl'].includes(row[0]) &&
          row[1].split('/').includes('ecv_s36_outbox_worker')) fail('A50_HAS_WORKER_PRIVILEGES');
    }
  }
  return 'SOURCE_CONTRACT_MATCH';
}

// Labels both expectations by stage and binds them to an external approval digest.
// This pure comparator does not obtain or authenticate the approval itself.
export function compareApprovedCatalog(stage, observed, expectations, approvalDigest) {
  if (!sha.test(approvalDigest ?? '') || digest(canonical(expectations)) !== approvalDigest ||
      !sha.test(expectations?.A07 ?? '') || !sha.test(expectations?.A50 ?? '') ||
      expectations.A07 === expectations.A50 ||
      expectations.source01 !== sources.text_sql[0].checked_sha256 ||
      expectations.source02 !== sources.text_sql[1].checked_sha256 ||
      expectations.projection !== approval.sql.catalog_sha256) fail('CATALOG_EXPECTATIONS_UNBOUND');
  checkSourceCatalog(stage, observed);
  if (catalogDigest(observed) !== expectations[stage]) fail('CATALOG_DRIFT');
  return 'CATALOG_MATCH_PENDING_EXECUTION_RECEIPTS';
}

export function checkNativeAuth(receipt) {
  const allowedColumns = {
    users: { references: ['id'], select: ['banned_until', 'email_confirmed_at', 'id', 'is_anonymous'] },
    sessions: { select: ['id', 'not_after', 'user_id'] },
  };
  const versions = [...sources.auth.initial_versions, ...sources.auth.up_sql_versions].sort(compare);
  if (receipt?.archive_sha256 !== sources.auth.archive_sha256 ||
      receipt?.artifact_sha256 !== sources.auth.binary_sha256 ||
      receipt?.linux_arm64_manifest !== sources.auth.arm64_manifest ||
      !Array.isArray(receipt?.versions) || canonical([...receipt.versions].sort(compare)) !== canonical(versions) ||
      receipt?.users !== 0 || receipt?.sessions !== 0 || receipt?.relation_owner !== 'supabase_auth_admin' ||
      receipt?.rls !== true || receipt?.application_auth_open !== false ||
      receipt?.postgres_auth_role_member !== false || receipt?.postgres_auth_schema_usage !== true ||
      receipt?.postgres_auth_schema_create !== false ||
      receipt?.postgres_auth_full_table_privileges !== false || receipt?.postgres_auth_grant_options !== false ||
      receipt?.ordinary_auth_data_privileges !== false || receipt?.pgcrypto_deployer_capability !== true ||
      canonical(receipt?.postgres_auth_columns) !== canonical(allowedColumns)) fail('NATIVE_AUTH_RECEIPT_DENIED');
  return 'NATIVE_AUTH_CONTRACT_MATCH';
}

export function bindTarget(observation, expectedEndpoint, expectedEngine, excludedSystemIdentifiers) {
  const name = 's36-a1-' + approval.run_id;
  if (!Array.isArray(excludedSystemIdentifiers) || excludedSystemIdentifiers.length === 0 ||
      excludedSystemIdentifiers.some(id => typeof id !== 'string' || !/^[1-9][0-9]{9,19}$/.test(id)) ||
      typeof expectedEndpoint !== 'string' || !/^unix:\/\/\/[^?#\r\n]+\/docker\.sock$/.test(expectedEndpoint) ||
      typeof expectedEngine !== 'string' || !expectedEngine || observation?.endpoint !== expectedEndpoint ||
      observation.engine !== expectedEngine || observation.run_id !== approval.run_id ||
      observation.context !== 'desktop-linux' || observation.platform !== 'linux/arm64' ||
      observation.image !== approval.postgres_image || observation.postgres_version !== 170011 ||
      observation.database !== 'postgres' || observation.observer !== 'supabase_admin' ||
      observation.observer_oid !== 10 || observation.socket !== '/var/run/postgresql' ||
      !sha.test(observation.hba_sha256 ?? '') || !sha.test(observation.baseline_receipt_sha256 ?? '') ||
      observation.client_backends !== 1 ||
      typeof observation.system_identifier !== 'string' || !/^[1-9][0-9]{9,19}$/.test(observation.system_identifier) ||
      BigInt(observation.system_identifier) > 18446744073709551615n ||
      excludedSystemIdentifiers.includes(observation.system_identifier)) fail('TARGET_IDENTITY_DENIED');
  const {container, volume, network} = observation;
  if (!sha.test(container?.id ?? '') || container.name !== name || container.run_label !== approval.run_id ||
      container.host_ports !== 0 || container.binds !== 0 || container.privileged !== false ||
      container.restart !== 'no' || container.memory_bytes !== approval.resource_ceiling.memory_bytes ||
      container.nano_cpus !== approval.resource_ceiling.nano_cpus || container.pids_limit !== approval.resource_ceiling.pids ||
      volume?.name !== name + '-data' || volume.driver !== 'local' || volume.run_label !== approval.run_id ||
      volume.container_id !== container.id || volume.target !== '/var/lib/postgresql/data' ||
      !sha.test(network?.id ?? '') || network.name !== name + '-internal' || network.run_label !== approval.run_id ||
      network.internal !== true || canonical(network.containers) !== canonical([container.id])) fail('TARGET_RESOURCE_DENIED');
  return digest(canonical(observation));
}

export function verifySameTarget(receiptDigest, observation, expectedEndpoint, expectedEngine, excludedSystemIdentifiers) {
  if (!sha.test(receiptDigest ?? '') || bindTarget(observation, expectedEndpoint, expectedEngine, excludedSystemIdentifiers) !== receiptDigest) {
    fail('TARGET_REBIND_DENIED');
  }
}

// Check the preserved PG-only schedule's maximums. The native bootstrap has
// no approved complete budget and cannot be admitted through this meter.
export function createPgOnlyMeter(start) {
  const ceiling = approval.prepared_target_ceiling;
  if (!Number.isSafeInteger(start) || start < 0) fail('INVALID_CLOCK');
  let lastTime = start;
  let reconciliationUsed = false;
  let normalStopped = false;
  const used = { sql: 0, connections: 0, docker_cli: 0 };
  return function reserve(cost, time, reconcile = false) {
    if (reconciliationUsed || (normalStopped && !reconcile)) fail('BUDGET_STOPPED');
    const reserveForReconciliation = {sql: ceiling.reconcile_sql, connections: 1, docker_cli: 1};
    if (typeof reconcile !== 'boolean' || !Number.isSafeInteger(time) || time < lastTime ||
        time - start >= (reconcile ? ceiling.total_ms : ceiling.work_ms) ||
        Object.keys(used).some(key => !Number.isSafeInteger(cost?.[key]) ||
          cost[key] < 0 || used[key] + cost[key] > ceiling[key] - (reconcile ? 0 : reserveForReconciliation[key])) ||
        (reconcile && (cost.connections !== 1 || cost.sql < 1 || cost.sql > ceiling.reconcile_sql || cost.docker_cli !== 1))) {
      normalStopped = true;
      if (time >= lastTime && Number.isSafeInteger(time)) lastTime = time;
      if (reconcile) reconciliationUsed = true;
      fail('BUDGET_DENIED');
    }
    lastTime = time;
    reconciliationUsed ||= reconcile;
    for (const key of Object.keys(used)) used[key] += cost[key];
    return Object.freeze({...used});
  };
}

export function classifyTermination(evidence) {
  if (!evidence || Object.getPrototypeOf(evidence) !== Object.prototype) return 'UNKNOWN';
  const {dispatched, refusalBeforeDispatch, terminal, identityProven, backendEnded} = evidence;
  if (identityProven !== undefined && typeof identityProven !== 'boolean') return 'UNKNOWN';
  // A terminal tag or a backend-exit observation belongs to a dispatched step.
  // A future transport must supply the explicit refusal from its preflight gate.
  if (refusalBeforeDispatch === true) {
    return dispatched === false && terminal == null && backendEnded == null ? 'STOP' : 'UNKNOWN';
  }
  if ((refusalBeforeDispatch !== undefined && refusalBeforeDispatch !== false) ||
      dispatched !== true || identityProven !== true || backendEnded !== true) return 'UNKNOWN';
  if (terminal === 'ROLLBACK') return 'ROLLBACK_OBSERVED';
  if (terminal === 'COMMIT') return 'COMMIT_OBSERVED';
  return 'UNKNOWN';
}
