// Offline, secret-free plans for the two service identities. No network, driver,
// credential provider, SQL execution, or mutation capability lives here.
import { isIPv4 } from 'node:net';
import { PROJECT } from './fixtures/binding.mjs';
import { registrarHost } from './fixtures/binding.mjs';

const roles = Object.freeze({
  api: 'ecv_s3_internal_api_login',
  registration: 'ecv_s3_registration_login'
});
const database = 'postgres';
const socketDir = '/var/run/postgresql';
const socketServerUser = 'postgres'; // Candidate OS owner; must be independently observed.

function target(service, mode, source) {
  if (!Object.hasOwn(roles,service)) throw new Error('UNAPPROVED_SERVICE');
  if (mode === 'peer' && source === undefined) return roles[service];
  if (mode === 'tls' && isIPv4(source) && /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(source)) return roles[service];
  throw new Error('UNBOUND_CONNECTION_MODE_OR_SOURCE');
}

function selector(column, literal) {
  // pg_hba_file_rules does not retain all quoting semantics. Only a single
  // explicit service/database identifier can positively qualify a permit.
  return `CASE
    WHEN ${column} = ARRAY['${literal}']::text[] THEN 'exact'
    WHEN '${literal}' = ANY(${column}) OR 'all' = ANY(${column}) THEN 'broad'
    WHEN ${column} IS NULL OR cardinality(${column}) = 0 OR EXISTS (
      SELECT FROM unnest(${column}) word WHERE word IS NULL OR word !~ '^[a-z0-9_]+$'
        OR word IN ('sameuser','samegroup','samerole','replication')) THEN 'unknown'
    ELSE 'miss' END`;
}

// For a separately approved, scoped catalog reader. The caller captures command
// tags and exit status independently. No file paths, auth options, usernames,
// match regexes, addresses from the HBA file, or raw diagnostic text are returned.
export function hbaObservationSql(service, mode, source) {
  const role = target(service,mode,source);
  const address = mode === 'peer' ? "'local'" : `CASE
    WHEN address = 'all' THEN 'broad'
    WHEN pg_input_is_valid(address,'inet') AND pg_input_is_valid(netmask,'inet') THEN
      CASE WHEN family(address::inet) = 4 AND family(netmask::inet) = 4
              AND masklen(address::inet) = 32 AND masklen(netmask::inet) = 32 THEN
        CASE WHEN ('${source}'::inet & netmask::inet) <> (address::inet & netmask::inet) THEN 'miss'
             WHEN netmask::inet = '255.255.255.255'::inet THEN 'exact' ELSE 'broad' END
      ELSE 'unknown' END
    ELSE 'unknown' END`;
  const link = mode === 'peer'
    ? "CASE WHEN type = 'local' THEN 'exact' WHEN type IN ('host','hostssl','hostnossl','hostgssenc','hostnogssenc') THEN 'miss' ELSE 'unknown' END"
    : "CASE WHEN type = 'hostssl' THEN 'exact' WHEN type IN ('host','hostnogssenc') THEN 'broad' WHEN type IN ('local','hostnossl','hostgssenc') THEN 'miss' ELSE 'unknown' END";
  return `BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
WITH h AS MATERIALIZED (SELECT * FROM pg_hba_file_rules),
r AS (
 SELECT rule_number AS n, ${link} AS link,
    ${selector('database',database)} AS db,
    ${selector('user_name',role)} AS principal, ${address} AS address,
    (auth_method='${mode === 'peer' ? 'peer' : 'cert'}' AND coalesce(cardinality(options),0)=0) AS method_ok
 FROM h WHERE error IS NULL
)
SELECT json_build_object(
 'database',current_database(),'service','${role}','mode','${mode}',
 'source',${mode === 'peer' ? 'NULL::text' : "'"+source+"'::text"},
 'version',current_setting('server_version_num')::integer,'tls_enabled',current_setting('ssl')='on',
 'errors',(SELECT count(*) FROM h WHERE error IS NOT NULL),
 'total',(SELECT count(*) FROM h),
 'rules',coalesce((SELECT json_agg(row_to_json(r) ORDER BY n) FROM r),'[]'::json));
ROLLBACK;`;
}

const status = (decision, reason, firstRule = null) => Object.freeze({decision,reason,firstRule});
const scopes = new Set(['exact','broad','unknown','miss']);

// Classifies the FILE observation only. Neither SQL nor this code can certify
// that those exact bytes are loaded in the running postmaster. No fallback.
export function classifyHba(service, mode, source, receipt) {
  const role = target(service,mode,source);
  if (!receipt || receipt.service !== role || receipt.database !== database || receipt.version !== 170011 ||
      receipt.mode !== mode || receipt.source !== (source ?? null) || typeof receipt.tls_enabled !== 'boolean' ||
      receipt.errors !== 0 || !Array.isArray(receipt.rules) || receipt.total !== receipt.rules.length)
    return status('UNKNOWN','INCOMPLETE_OR_WRONG_CATALOG');
  if (mode === 'tls' && !receipt.tls_enabled) return status('BLOCKED','SERVER_SSL_OFF');
  for (let i=0;i<receipt.rules.length;i++) {
    const row = receipt.rules[i];
    if (!row || row.n !== i+1 || typeof row.method_ok !== 'boolean' ||
        ![row.link,row.db,row.principal].every(value => scopes.has(value)) ||
        (mode === 'peer' ? row.address !== 'local' : !scopes.has(row.address)))
      return status('UNKNOWN','RULE_SEQUENCE_OR_SHAPE');
  }
  for (const row of receipt.rules) {
    const dimensions = [row.link,row.db,row.principal];
    if (mode === 'tls') dimensions.push(row.address);
    if (dimensions.includes('miss')) continue;
    if (dimensions.includes('unknown')) return status('UNKNOWN','AMBIGUOUS_EARLIER_RULE',row.n);
    if (dimensions.includes('broad') || !row.method_ok) return status('BLOCKED','FIRST_RULE_OUTSIDE_CONTRACT',row.n);
    return status('FILE_MATCH','EXACT_RULE_REQUIRES_LIVE_CONFIRMATION',row.n);
  }
  return status('BLOCKED','NO_MATCHING_RULE');
}

// Private deployment tooling only. These plans never contain secret values or
// user-supplied DSNs. Seal the source IP, HBA receipt, OS namespace, service
// executable, certificate paths and mounts before a separately authorized use.
export function connectionPlan(service, mode, source, receipt) {
  const decision = classifyHba(service,mode,source,receipt);
  if (decision.decision !== 'FILE_MATCH') throw new Error(decision.reason);
  const user = roles[service];
  // Use one host and a fresh process with an empty ambient PG*/HOME configuration.
  // libpq ignores sslmode on UDS. requirepeer checks the *server* OS identity.
  const options = { user, dbname:database, port:5432, connect_timeout:5,
    application_name:'ecv-s33-'+service+'-probe', passfile:'/dev/null' };
  if (mode === 'peer') {
    Object.assign(options,{host:socketDir,requirepeer:socketServerUser});
  } else {
    const dir='/run/ecv-s33-credentials/'+service;
    Object.assign(options,{host:registrarHost,sslmode:'verify-full',ssl_min_protocol_version:'TLSv1.2',
      gssencmode:'disable',sslcertmode:'require',sslrootcert:dir+'/root.crt',
      sslcert:dir+'/client.crt',sslkey:dir+'/client.key'});
  }
  return Object.freeze({scope:'PLAN_ONLY', project:PROJECT, firstRule:decision.firstRule,
    source:source ?? null, service, mode, options:Object.freeze(options)});
}

// The future probe is run as the actual service, before SET ROLE. Never send a
// business statement on this diagnostic connection. SYSTEM_USER proves the
// observed authentication method/identity; a successful TCP connect alone cannot.
export function serviceObservationSql(service, mode, source) {
  const user=target(service,mode,source);
  const transport = mode === 'peer'
    ? `inet_client_addr() IS NULL AND NOT s.ssl AND SYSTEM_USER='peer:${user}'`
    : `s.ssl AND s.version IN ('TLSv1.2','TLSv1.3') AND inet_client_addr()='${source}'::inet
       AND s.client_dn='/CN=${user}' AND split_part(SYSTEM_USER,':',1)='cert'`;
  return `BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
SELECT json_build_object(
 'session_ok',session_user='${user}' AND current_user=session_user AND current_setting('role')='none',
 'database_ok',current_database()='postgres' AND current_setting('server_version_num')='170011',
 'transport_ok',coalesce((${transport}),false),'readonly',current_setting('transaction_read_only')='on')
FROM pg_stat_ssl s WHERE s.pid=pg_backend_pid();
ROLLBACK;`;
}

// pg17 libpq is also used by the future dedicated PostgREST service. Emit only
// its non-secret subset. The operator must independently supply the audited
// JWT verification material, pinned executable, OS identity and private mount.
// Never merge these into the public gateway or inherit PG*/PGRST_* variables.
export function privatePostgrestPlan(mode, source, receipt) {
  const {options} = connectionPlan('api',mode,source,receipt);
  const params = new URLSearchParams();
  for (const [key,value] of Object.entries(options)) {
    if (!['user','dbname','port'].includes(key)) params.set(key,String(value));
  }
  params.set('port',String(options.port));
  params.set('user',options.user);
  return Object.freeze({
    PGRST_DB_URI:'postgresql:///'+options.dbname+'?'+params.toString(),
    PGRST_DB_SCHEMAS:'site_api', PGRST_DB_EXTRA_SEARCH_PATH:'pg_catalog',
    PGRST_DB_CONFIG:'false', PGRST_DB_CHANNEL_ENABLED:'false',
    PGRST_DB_POOL:'4', PGRST_DB_POOL_AUTOMATIC_RECOVERY:'false',
    PGRST_DB_PREPARED_STATEMENTS:'false', PGRST_JWT_AUD:'authenticated',
    PGRST_JWT_ROLE_CLAIM_KEY:'.role', PGRST_OPENAPI_MODE:'disabled',
    PGRST_SERVER_UNIX_SOCKET:'/run/ecv-s33a-internal/postgrest.sock',
    PGRST_SERVER_UNIX_SOCKET_MODE:'660'
  });
}
