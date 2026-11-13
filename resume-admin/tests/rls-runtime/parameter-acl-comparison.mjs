import { Buffer } from 'node:buffer';

// Pure comparison only: no database access, SQL parsing, logging or restore hook.
// The future owned-stage collector must supply complete pg_parameter_acl rows,
// expanded by aclexplode, and resolve BOTH role OIDs through its own pg_roles.
// logicalIdentity is the exact, case-sensitive role identity, not an OID or alias
// assigned by row order. PUBLIC is represented by grantee OID 0, never a role.
// "complete" is a collector assertion, not proof that a snapshot came from a DB.
// This model compares one parameter's explicit ACL, not effective privileges,
// role membership, role attributes, or the authority to execute a GRANT.
const maxBytes = 32768;
const maxRows = 256;
const maxRoles = 128;

function fields(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length
    && names.every(name => Object.hasOwn(value, name));
}

function oid(value, allowPublic = false) {
  return Number.isInteger(value) && value >= (allowPublic ? 0 : 1) && value <= 4294967295;
}

function identity(value) {
  return typeof value === 'string' && value.length > 0 && value.isWellFormed()
    && Buffer.byteLength(value, 'utf8') <= 63
    && [...value].every(char => char.codePointAt(0) >= 32
      && (char.codePointAt(0) < 127 || char.codePointAt(0) > 159));
}

function normalize(input) {
  // A bounded canonical JSON transport rejects duplicate JSON keys, alternate
  // numeric encodings and extra material before any ACL comparison is possible.
  // Callers serialize decoded catalog results with JSON.stringify; arbitrary JS
  // objects/accessors/proxies are not accepted and are never inspected.
  if (typeof input !== 'string' || input.length > maxBytes || Buffer.byteLength(input) > maxBytes) return null;
  const snapshot = JSON.parse(input);
  if (JSON.stringify(snapshot) !== input
    || !fields(snapshot, ['model', 'complete', 'parameter', 'catalogState', 'roles', 'rows'])
    || snapshot.model !== 'pg17-parameter-acl-v1' || snapshot.complete !== true
    || typeof snapshot.parameter !== 'string'
    || !/^[a-z][a-z0-9_.]{0,255}$/.test(snapshot.parameter)
    || !['explicit', 'null', 'default'].includes(snapshot.catalogState)
    || !Array.isArray(snapshot.roles) || snapshot.roles.length > maxRoles
    || !Array.isArray(snapshot.rows) || snapshot.rows.length > maxRows) return null;

  // No-row/default and NULL ACL require native default expansion and its owner
  // context. That collection contract is not verified yet; never collapse them
  // to [] or infer equivalence from matching catalogState labels.
  if (snapshot.catalogState !== 'explicit') return null;

  const roles = new Map(), identities = new Set();
  for (const role of snapshot.roles) {
    if (!fields(role, ['oid', 'logicalIdentity']) || !oid(role.oid) || !identity(role.logicalIdentity)
      || roles.has(role.oid) || identities.has(role.logicalIdentity)) return null;
    roles.set(role.oid, role.logicalIdentity);
    identities.add(role.logicalIdentity);
  }

  const used = new Set(), seen = new Set(), rows = [];
  for (const row of snapshot.rows) {
    if (!fields(row, ['grantor', 'grantee', 'privilege_type', 'is_grantable'])
      || !oid(row.grantor) || !oid(row.grantee, true)
      || !['SET', 'ALTER SYSTEM'].includes(row.privilege_type)
      || typeof row.is_grantable !== 'boolean'
      || !roles.has(row.grantor) || (row.grantee !== 0 && !roles.has(row.grantee))
      || (row.grantee === 0 && row.is_grantable)) return null;
    used.add(row.grantor);
    if (row.grantee !== 0) used.add(row.grantee);
    const grantee = row.grantee === 0 ? ['public'] : ['role', roles.get(row.grantee)];
    const key = [grantee, roles.get(row.grantor), row.privilege_type];
    const keyText = JSON.stringify(key);
    // Includes contradictory duplicate rows with different grant options.
    if (seen.has(keyText)) return null;
    seen.add(keyText);
    rows.push(JSON.stringify([...key, row.is_grantable]));
  }
  // This is a scoped mapping, not a dump of the cluster's full role catalog.
  if (used.size !== roles.size) return null;
  return JSON.stringify([snapshot.parameter, rows.sort()]);
}

/** Returns only equal, different or unverified; never exposes input or errors. */
export function compareParameterAcl(source, target) {
  try {
    const left = normalize(source), right = normalize(target);
    if (left === null || right === null) return 'unverified';
    return left === right ? 'equal' : 'different';
  } catch {
    return 'unverified';
  }
}
