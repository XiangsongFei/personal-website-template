import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { runPrivateRecovery } from '../shared/recovery-journal.node.mjs';
import { renderS37ClosedStorageInstallFixture } from './closed-storage-install-fixture.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const role = value => typeof value === 'string' && /^s37_observer_[a-z0-9]{1,20}$/.test(value);
const xid = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const request = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fail = message => { throw new Error('S37_PORTABLE_' + message); };

class SqlRejected extends Error {
  constructor() { super('S37_PORTABLE_SQL_REJECTED'); }
}

function localSocket(directory, port) {
  if (!isAbsolute(directory ?? '') || realpathSync(directory) !== directory || !Number.isInteger(port) ||
      port < 1 || port > 65535) fail('SOCKET');
  const dir = lstatSync(directory);
  const socket = lstatSync(join(directory, '.s.PGSQL.' + port));
  if (!dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o7777) !== 0o700 ||
      !socket.isSocket() || socket.uid !== dir.uid) fail('SOCKET');
  return [dir.dev, dir.ino, socket.dev, socket.ino].join('/');
}

function packet(bound) {
  const { requestId, candidate, expectedProtection, observerRole } = bound;
  const original = 'SELECT pg_current_xact_id()::text AS s37_install_xid;\nCOMMIT;\n';
  const parts = candidate.sql.split(original);
  if (parts.length !== 2 || parts[1] !== '') fail('ANCHOR');
  return parts[0] +
    `INSERT INTO s37_install_guard.receipts(request_key,scope,render_sha256,protection_sha256,observer_role,installed_xid)
      VALUES ('${requestId}','${candidate.scope.schema}','${candidate.sha256}','${expectedProtection}','${observerRole}',pg_current_xact_id());
` + original;
}

function queryObserver(bound) {
  const { requestId, candidate, observerRole, writerLabel, target } = bound;
  const { schema, prefix } = candidate.scope;
  const scopedRoles = ['owner', 'close_owner', 'verify_login', 'close_login'].map(suffix => "'ecv_" + prefix + '_' + suffix + "'").join(',');
  return `BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SELECT json_build_object(
  'identity', session_user = '${observerRole}' AND current_user = '${observerRole}'
    AND current_database() = 'postgres' AND current_setting('server_version_num') = '170012'
    AND current_setting('listen_addresses') = '' AND inet_server_addr() IS NULL AND inet_client_addr() IS NULL
    AND current_setting('transaction_read_only') = 'on'
    AND current_setting('s37.fixture',true) = '${target.localMarker}'
    AND pg_postmaster_start_time() = '${target.postmasterStarted}'::timestamptz
    AND (SELECT encode(sha256(convert_to(system_identifier::text,'UTF8')),'hex') = '${target.clusterSha256}' FROM pg_control_system())
    AND EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolcanlogin
      AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls AND NOT rolreplication)
    AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member=current_user::regrole)
    AND NOT has_table_privilege('s37_install_guard.receipts','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege('s37_install_guard.receipts','INSERT,UPDATE')
    AND NOT has_schema_privilege('s37_install_guard','CREATE')
    AND has_table_privilege('postgres','s37_install_guard.receipts','INSERT')
    AND NOT has_table_privilege('postgres','s37_install_guard.receipts','UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege('postgres','s37_install_guard.receipts','UPDATE')
    AND NOT has_schema_privilege('postgres','s37_install_guard','CREATE'),
  'activeWriter', EXISTS (SELECT FROM pg_stat_activity WHERE datname=current_database()
    AND usename='postgres' AND application_name='${writerLabel}'),
  'catalogClosed', EXISTS (SELECT FROM pg_namespace WHERE nspname='${schema}' AND nspowner=to_regrole('ecv_${prefix}_owner'))
    AND (SELECT count(*) FROM pg_roles WHERE rolname IN (${scopedRoles})
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolbypassrls AND NOT rolreplication) = 4
    AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN (${scopedRoles})) = 4
    AND (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      WHERE r.rolname IN (${scopedRoles}) AND m.member='postgres'::regrole AND m.grantor=10
        AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option) = 4
    AND NOT EXISTS (SELECT FROM pg_stat_activity WHERE usename IN (${scopedRoles}))
    AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='${schema}' AND c.relkind='r') = 10
    AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='${schema}' AND c.relkind='r' AND c.relowner=to_regrole('ecv_${prefix}_owner')
        AND c.relrowsecurity AND c.relforcerowsecurity) = 8,
  'namespaceXid', (SELECT xmin::text FROM pg_namespace WHERE nspname='${schema}'),
  'scopeReserved', EXISTS (SELECT FROM s37_install_guard.receipts WHERE scope='${schema}'),
  'receipt', (SELECT json_build_object('scope',scope,'sql',render_sha256,'protection',protection_sha256,
    'observer',observer_role,'xid',installed_xid::text,'committed',pg_xact_status(installed_xid)='committed')
    FROM s37_install_guard.receipts WHERE request_key='${requestId}')
);
ROLLBACK;`;
}

function runPsql({ binary, directory, port, user, application, signal }, sql) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, ['-X', '-w', '-qAt', '-h', directory, '-p', String(port),
      '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      env: { LC_ALL: 'C', PGAPPNAME: application, PGTZ: 'UTC', PGCONNECT_TIMEOUT: '3', PGPASSFILE: '/dev/null' },
      encoding: 'utf8', signal, timeout: 45_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      // psql reserves 3 for a script statement error with ON_ERROR_STOP. The
      // final statement is COMMIT, and a lost connection instead exits with 2.
      if (error?.code === 3 && !error.killed && !error.signal) reject(new SqlRejected());
      else if (error) reject(new Error('S37_PORTABLE_PSQL_FAILED'));
      else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(sql);
  });
}

/** The observer projection is a reviewed, independent read-only collaborator. */
export async function runS37PortableClosedInstall({
  lane, stage, source, target, requestId, psql, socketDirectory, socketPort, observerRole,
  expectedProtection, readProtection, directory, python, signal,
} = {}) {
  if (!request(requestId) || !role(observerRole) || !digest(expectedProtection) ||
      typeof readProtection !== 'function' || !isAbsolute(psql ?? '') ||
      realpathSync(psql) !== psql || !lstatSync(psql).isFile()) fail('OPTIONS');
  const identityTarget = Object.freeze({
    clusterSha256: target?.clusterSha256, localMarker: target?.localMarker, postmasterStarted: target?.postmasterStarted,
  });
  const candidate = renderS37ClosedStorageInstallFixture({ lane, stage, source, target: identityTarget });
  const identity = localSocket(socketDirectory, socketPort);
  const writerLabel = 's37-install-' + requestId;
  const bound = { requestId, candidate, observerRole, expectedProtection, target: identityTarget, writerLabel };
  const sql = packet(bound);
  const dispatchSha256 = sha(sql);
  const scopeSha256 = sha(JSON.stringify([requestId, identity, candidate.scope.schema, identityTarget.clusterSha256,
    identityTarget.localMarker, identityTarget.postmasterStarted, expectedProtection, observerRole, dispatchSha256]));
  const operation = 'install-' + requestId;
  const pg = (query, user, application, dbSignal) => {
    if (localSocket(socketDirectory, socketPort) !== identity) fail('SOCKET_CHANGED');
    dbSignal.throwIfAborted();
    return runPsql({ binary: psql, directory: socketDirectory, port: socketPort, user, application, signal: dbSignal }, query);
  };
  const projection = queryObserver(bound);
  async function read(dbSignal) {
    const row = JSON.parse(await pg(projection, observerRole, 's37-readonly-witness', dbSignal));
    if (row?.identity !== true || row.activeWriter !== false) fail('INDEPENDENT_IDENTITY');
    return row;
  }
  async function proof(row, dbSignal) {
    const { receipt, namespaceXid } = row;
    if (row.catalogClosed !== true || !receipt || !xid(namespaceXid) || receipt.xid !== namespaceXid || receipt.committed !== true ||
        receipt.scope !== candidate.scope.schema || receipt.sql !== candidate.sha256 ||
        receipt.protection !== expectedProtection || receipt.observer !== observerRole) fail('COMMIT_UNPROVEN');
    const witness = await readProtection({ phase: 'after', scope: candidate.scope, xid: namespaceXid, signal: dbSignal });
    if (witness?.closed !== true || witness.protectionSha256 !== expectedProtection) fail('PROTECTION');
    return { disposition: 'committed', receiptSha256: sha(JSON.stringify([scopeSha256, namespaceXid, expectedProtection])) };
  }
  async function beforeProof(row, dbSignal) {
    if (row.receipt !== null || row.namespaceXid !== null || row.scopeReserved !== false) fail('SCOPE_OCCUPIED');
    const before = await readProtection({ phase: 'before', scope: candidate.scope, signal: dbSignal });
    if (before?.closed !== true || before.protectionSha256 !== expectedProtection) fail('PROTECTION');
    return { disposition: 'absent', receiptSha256: sha(JSON.stringify([scopeSha256, null, expectedProtection])) };
  }

  let writerRejected = false;
  return runPrivateRecovery({
    directory, python, scopeSha256, signal, operations: { business: [operation], close: [] },
    async work(journal) {
      await beforeProof(await read(journal.signal), journal.signal);
      await journal.dispatch(operation, dispatchSha256, async dbSignal => {
        let declaredXid;
        try {
          declaredXid = await pg(sql, 'postgres', writerLabel, dbSignal);
        } catch (error) {
          writerRejected = error instanceof SqlRejected;
          throw error;
        }
        const independent = await read(dbSignal);
        if (declaredXid !== independent.namespaceXid) fail('WRITER_RECEIPT');
        return proof(independent, dbSignal);
      });
    },
    async close(journal) {
      if (journal.inspect(operation).state === 'unknown') {
        const row = await read(journal.signal);
        // After a vanished process, empty catalog alone cannot exclude late work.
        const result = writerRejected && row.receipt === null
          ? await beforeProof(row, journal.signal) : await proof(row, journal.signal);
        journal.reconcile(operation, result);
      }
    },
    async observeClosed(journal) {
      const state = journal.inspect(operation);
      const row = await read(journal.signal);
      const result = state.disposition === 'absent'
        ? await beforeProof(row, journal.signal) : await proof(row, journal.signal);
      if (state.disposition !== result.disposition || state.receiptSha256 !== result.receiptSha256) fail('CLOSURE');
      return { closed: true, receiptSha256: result.receiptSha256 };
    },
  });
}
