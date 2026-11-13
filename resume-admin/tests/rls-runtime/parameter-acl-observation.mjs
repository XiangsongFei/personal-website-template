import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { compareParameterAcl } from './parameter-acl-comparison.mjs';

// Fixed catalog query only. No caller-supplied identifiers, SQL or connection.
// All raw identities remain inside the disposable child; never log this result.
// LIMITs include an overflow row, which validation rejects rather than truncates.
export const parameterAclQuery = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH parameters AS (
  SELECT parname, paracl FROM pg_catalog.pg_parameter_acl ORDER BY parname LIMIT 33
), entries AS (
  SELECT p.parname, pg_catalog.json_build_object(
    'snapshot', pg_catalog.json_build_object(
      'model','pg17-parameter-acl-v1','complete',true,'parameter',p.parname,
      'catalogState',CASE WHEN p.paracl IS NULL THEN 'null' ELSE 'explicit' END,
      'roles',COALESCE((SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
        'oid',r.oid,'logicalIdentity',r.rolname) ORDER BY r.oid)
        FROM pg_catalog.pg_roles r WHERE r.oid IN (
          SELECT x.grantor FROM pg_catalog.aclexplode(p.paracl) x
          UNION SELECT x.grantee FROM pg_catalog.aclexplode(p.paracl) x)), '[]'::json),
      'rows',COALESCE((SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
        'grantor',x.grantor,'grantee',x.grantee,'privilege_type',x.privilege_type,
        'is_grantable',x.is_grantable) ORDER BY x.grantor,x.grantee,x.privilege_type)
        FROM (SELECT * FROM pg_catalog.aclexplode(p.paracl) LIMIT 257) x), '[]'::json)),
    'capabilities',pg_catalog.json_build_object(
      'set',pg_catalog.has_parameter_privilege(current_user,p.parname,'SET'),
      'alterSystem',pg_catalog.has_parameter_privilege(current_user,p.parname,'ALTER SYSTEM'),
      'setGrant',pg_catalog.has_parameter_privilege(current_user,p.parname,'SET WITH GRANT OPTION'),
      'alterSystemGrant',pg_catalog.has_parameter_privilege(current_user,p.parname,'ALTER SYSTEM WITH GRANT OPTION'))
  ) AS entry FROM parameters p
)
SELECT pg_catalog.json_build_object(
  'model','pg17-parameter-acl-collection-v1',
  'readOnly',pg_catalog.current_setting('transaction_read_only') = 'on',
  'version',pg_catalog.current_setting('server_version_num')::int / 10000,
  'actorVerified',current_user = session_user AND session_user = 'postgres',
  'entries',COALESCE((SELECT pg_catalog.json_agg(entry ORDER BY parname) FROM entries),'[]'::json))::text;
ROLLBACK;
`;

const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const capabilityKeys = ['set','alterSystem','setGrant','alterSystemGrant'];
const collections = new WeakMap();

// Return an opaque handle: raw catalog data cannot accidentally cross IPC.
// SQL/ownership/timeout failures are observationally unverified, never success.
export function collectParameterAcl(read) {
  const handle = Object.freeze({});
  try {
    const text = read(parameterAclQuery);
    if (typeof text !== 'string' || Buffer.byteLength(text) > 2*1024*1024) return handle;
    const raw = JSON.parse(text);
    if (!exact(raw,['model','readOnly','version','actorVerified','entries'])
      || raw.model !== 'pg17-parameter-acl-collection-v1' || raw.readOnly !== true
      || raw.version !== 17 || raw.actorVerified !== true || !Array.isArray(raw.entries)
      || raw.entries.length > 32) return handle;
    const entries = new Map();
    for (const e of raw.entries) {
      if (!exact(e,['snapshot','capabilities']) || !exact(e.capabilities,capabilityKeys)
        || !capabilityKeys.every(k => typeof e.capabilities[k] === 'boolean')) return handle;
      const snapshot = JSON.stringify(e.snapshot);
      if (compareParameterAcl(snapshot,snapshot) !== 'equal' || entries.has(e.snapshot.parameter)) return handle;
      entries.set(e.snapshot.parameter,{snapshot,capabilities:e.capabilities,rows:e.snapshot.rows});
    }
    collections.set(handle,entries);
  } catch { /* No raw exceptions, SQL, catalog identities or stderr escape. */ }
  return handle;
}

export function compareParameterCollections(left,right) {
  const a=collections.get(left),b=collections.get(right);
  if (!a || !b) return 'unverified';
  if (a.size!==b.size || [...a.keys()].some(k=>!b.has(k))) return 'different';
  const results=[...a].map(([k,v])=>compareParameterAcl(v.snapshot,b.get(k).snapshot));
  if (results.includes('unverified')) return 'unverified';
  return results.includes('different')?'different':'equal';
}

function compareObservations(left,right) {
  const acl=compareParameterCollections(left,right);
  if (acl!=='equal') return acl;
  const a=collections.get(left),b=collections.get(right);
  return [...a].every(([k,v])=>capabilityKeys.every(flag=>v.capabilities[flag]===b.get(k).capabilities[flag]))
    ?'equal':'different';
}

// Source ACL privilege types are a conservative requirement set, NOT a proof
// of the dump's exact statements or chosen grantor. Do not treat this boolean
// as permission to skip SQL or to execute with another identity.
function grantCapability(source,target) {
  const a=collections.get(source),b=collections.get(target);
  if (!a || !b || a.size===0) return 'unverified';
  const checks=[];
  for (const [parameter,e] of a) {
    const t=b.get(parameter);
    if (!t) return 'unverified';
    for (const row of e.rows) checks.push(t.capabilities[row.privilege_type==='SET'?'setGrant':'alterSystemGrant']);
  }
  return checks.length ? (checks.every(Boolean)?'true':'false') : 'unverified';
}

const exports = new WeakMap();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function bindParameterExport(before,after,roles) {
  const handle=Object.freeze({});
  if (Buffer.isBuffer(roles) && roles.length>0 && roles.length<=128*1024)
    exports.set(handle,{before,after,digest:digest(roles)});
  return handle;
}
export function summarizeParameterAcl(initial,binding,target,targetAgain,roles) {
  const bound=exports.get(binding);
  const bindingMatches=bound && Buffer.isBuffer(roles) && roles.length>0 && roles.length<=128*1024
    ? (digest(roles)===bound.digest?'equal':'different'):'unverified';
  const stable=bound?compareObservations(bound.before,bound.after):'unverified';
  const targetStable=compareObservations(target,targetAgain);
  return {
    source_collection:bound && collections.has(bound.after)?'success':'unverified',
    target_collection:collections.has(targetAgain)?'success':'unverified',
    source_platform:bound?compareParameterCollections(initial,bound.after):'unverified',
    source_export_stability:stable,
    target_stability:targetStable,
    export_binding:bindingMatches,
    source_target:bound && bindingMatches==='equal' && stable==='equal' && targetStable==='equal'
      ?compareParameterCollections(bound.after,targetAgain):'unverified',
    source_acl_grant_capability:bound && bindingMatches==='equal' && stable==='equal' && targetStable==='equal'
      ?grantCapability(bound.after,targetAgain):'unverified',
    // Digest binding + catalog equality does NOT establish the SQL semantics,
    // grantor context or complete statement coverage. No SQL parser is added.
    export_requirements:'unverified',
  };
}

const diagnosticStates = Object.freeze({
  source_collection:['success','unverified'],target_collection:['success','unverified'],
  source_platform:['equal','different','unverified'],source_export_stability:['equal','different','unverified'],
  target_stability:['equal','different','unverified'],export_binding:['equal','different','unverified'],
  source_target:['equal','different','unverified'],source_acl_grant_capability:['true','false','unverified'],
  export_requirements:['unverified'],
});
export function formatParameterAclDiagnostic(field,status) {
  const name=Object.hasOwn(diagnosticStates,field)?field:'unknown';
  const value=name!=='unknown' && diagnosticStates[name].includes(status)?status:'unverified';
  return `backup_parameter_acl=${name} status=${value}`;
}
