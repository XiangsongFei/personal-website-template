import { createHash } from 'node:crypto';

// Both input bytes are supplied by the caller from the protected source
// inventory. The reviewed digests are fixed here, never taken from the caller.
const stages = Object.freeze({
  l1: Object.freeze({ sha256: 'ac48cc40ae15bdb509039eda028a1a1e85183480193a21bcdc4a3dbb439247c2',
    stem: 'm8', prefix: 's3m8', lock: 1058 }),
  edge: Object.freeze({ sha256: 'b9a89487f419ec25bb53d5288e0b258a01cde9a91d864188ff4686d0016ee4f4',
    stem: 'm8-edge', prefix: 's3edge', lock: 1358 }),
});
const fixtureProject = 'ecv-s33a-20261109-7dd22a81';
const fixtureIssuer = 'http://127.0.0.1:56321/auth/v1';
const fixtureFunctionSha256 = 'ce226469471a5b2ac60ac1af7bcdf33caf76187fd43d56c18ac5d83b0d3b385c';
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function replaceOnce(sql, before, after) {
  const parts = sql.split(before);
  if (parts.length !== 2) throw new Error('S37_INSTALL_SOURCE_ANCHOR');
  return parts.join(after);
}

function targetChecks({ clusterSha256, localMarker, postmasterStarted }) {
  return ` IF session_user <> 'postgres' OR current_user <> 'postgres'
    OR current_database() <> 'postgres' OR current_setting('server_version_num') <> '170012'
    OR inet_server_addr() IS NOT NULL OR inet_client_addr() IS NOT NULL
    OR current_setting('session_replication_role') <> 'origin'
    OR current_setting('listen_addresses') <> ''
    OR current_setting('s37.fixture',true) IS DISTINCT FROM '${localMarker}'
    OR pg_postmaster_start_time() IS DISTINCT FROM '${postmasterStarted}'::timestamptz
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres'
      AND rolcanlogin AND rolcreaterole AND NOT rolsuper AND NOT rolbypassrls AND NOT rolreplication AND NOT rolcreatedb)
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
 THEN RAISE EXCEPTION 'S37_INSTALL_TARGET' USING ERRCODE='42501'; END IF;
 IF (SELECT encode(sha256(convert_to(system_identifier::text,'UTF8')),'hex') FROM pg_control_system())
      IS DISTINCT FROM '${clusterSha256}'
 THEN RAISE EXCEPTION 'S37_INSTALL_CLUSTER' USING ERRCODE='42501'; END IF;`;
}

function closedChecks() {
  return ` IF (SELECT count(*) FROM pg_catalog.pg_class
      WHERE oid IN ('site_private.business_runtime'::regclass,'site_private.text_publication_runtime'::regclass)
        AND relowner='ecv_s3_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>2
    OR NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton
      AND project_ref='${fixtureProject}' AND auth_issuer='${fixtureIssuer}' AND NOT enabled AND NOT proof_verifier_ready)
    OR NOT EXISTS (SELECT FROM site_private.hosted_session_timebox WHERE singleton
      AND project_ref='${fixtureProject}' AND seconds=0)
    OR NOT EXISTS (SELECT FROM site_private.text_publication_runtime WHERE singleton
      AND NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
 THEN RAISE EXCEPTION 'S37_INSTALL_CLOSED_GATES' USING ERRCODE='42501'; END IF;`;
}

const existingOwnerBoundary = `NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE roleid='ecv_s3_owner'::regrole
      AND member='postgres'::regrole AND grantor=10 AND admin_option AND NOT inherit_option AND NOT set_option)
    OR pg_has_role('postgres','ecv_s3_owner','SET') OR pg_has_role('postgres','ecv_s3_owner','USAGE')`;

function renderS37InstallGuard({target,scope}) {
  const roles = ['owner', 'close_owner', 'verify_login', 'close_login']
    .map(suffix => `'ecv_${scope.prefix}_${suffix}'`).join(',');
  return `DO $target$
BEGIN
${targetChecks(target)}
 PERFORM pg_advisory_xact_lock(3303,5);
 PERFORM pg_advisory_xact_lock(3303,${scope.lockKey});
${closedChecks()}
 IF NOT EXISTS (SELECT FROM pg_catalog.pg_proc
      WHERE oid=to_regprocedure('site_private.auth_source_identity()')
        AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
        AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${fixtureFunctionSha256}')
    OR ${existingOwnerBoundary}
    OR NOT pg_has_role('postgres','supabase_storage_admin','USAGE')
    OR to_regprocedure('storage.allow_only_operation(text)') IS NULL
    OR NOT has_table_privilege('storage.objects','TRIGGER')
    OR (SELECT count(*) FROM pg_catalog.pg_class
        WHERE oid IN ('storage.objects'::regclass,'storage.buckets'::regclass)
          AND relowner='supabase_storage_admin'::regrole AND NOT relforcerowsecurity)<>2
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_class WHERE oid='storage.objects'::regclass AND relrowsecurity)
 THEN RAISE EXCEPTION 'S37_INSTALL_PREREQUISITES' USING ERRCODE='42501'; END IF;
 IF to_regnamespace('${scope.schema}') IS NOT NULL
    OR EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname IN (${roles}))
    OR EXISTS (SELECT FROM storage.buckets WHERE id='${scope.bucket}')
    OR EXISTS (SELECT FROM storage.objects WHERE bucket_id='${scope.bucket}')
    OR EXISTS (SELECT FROM pg_catalog.pg_proc WHERE starts_with(proname,'${scope.prefix}_')
      AND pronamespace='site_api'::regnamespace)
    OR EXISTS (SELECT FROM pg_catalog.pg_policy WHERE starts_with(polname,'${scope.prefix}_'))
    OR EXISTS (SELECT FROM pg_catalog.pg_trigger WHERE starts_with(tgname,'${scope.prefix}_'))
 THEN RAISE EXCEPTION 'S37_INSTALL_SCOPE_EXISTS' USING ERRCODE='42710'; END IF;
END
$target$;`;
}

function renderS37InstallPostcondition({target,scope}) {
  const roles = ['owner', 'close_owner', 'verify_login', 'close_login']
    .map(suffix => `'ecv_${scope.prefix}_${suffix}'`).join(',');
  return `DO $s37_closed_after$
DECLARE candidate_roles oid[];
BEGIN
${targetChecks(target)}
${closedChecks()}
 SELECT array_agg(oid) INTO candidate_roles FROM pg_catalog.pg_roles
   WHERE rolname IN (${roles}) AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper
     AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication;
 IF ${existingOwnerBoundary}
    OR coalesce(cardinality(candidate_roles),0)<>4
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members
        WHERE roleid=ANY(candidate_roles) OR member=ANY(candidate_roles))<>4
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid=ANY(candidate_roles)
        AND member='postgres'::regrole AND grantor=10 AND admin_option AND NOT set_option AND NOT inherit_option)<>4
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_namespace WHERE nspname='${scope.schema}'
        AND nspowner='ecv_${scope.prefix}_owner'::regrole)
    OR EXISTS (SELECT FROM storage.buckets WHERE id='${scope.bucket}')
    OR EXISTS (SELECT FROM storage.objects WHERE bucket_id='${scope.bucket}')
 THEN RAISE EXCEPTION 'S37_INSTALL_POSTCONDITION' USING ERRCODE='42501'; END IF;
END
$s37_closed_after$;`;
}


/**
 * Compile pinned L1 or Edge source for a closed, freshly created local fixture.
 * Caller supplies independently observed database/system pins and verified bytes.
 * Nothing in this module connects to PostgreSQL or executes the returned SQL.
 */
export function renderS37ClosedStorageInstallFixture({ lane, stage, source, target } = {}) {
  if (!['empty', 'legacy'].includes(lane) || !['l1', 'edge'].includes(stage))
    throw new Error('S37_INSTALL_FIXTURE_SCOPE');
  const original = stages[stage];
  if (typeof source !== 'string' || sha256(source) !== original.sha256)
    throw new Error('S37_INSTALL_SOURCE_DRIFT');

  const { clusterSha256, localMarker, postmasterStarted } = target ?? {};
  if (!digest(clusterSha256) || typeof localMarker !== 'string' || !/^[a-f0-9]{32}$/.test(localMarker) ||
      typeof postmasterStarted !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(postmasterStarted) ||
      !Number.isFinite(Date.parse(postmasterStarted)))
    throw new Error('S37_INSTALL_FIXTURE_TARGET');

  const laneIndex = lane === 'empty' ? 0 : 2;
  const stageIndex = stage === 'l1' ? 1 : 2;
  const scope = Object.freeze({
    projectRef: fixtureProject, authIssuer: fixtureIssuer,
    schema: `site_storage_s37_${lane}_${stage}_v1`, bucket: `users-site-assets-private-s37-${lane}-${stage}-v1`,
    batch: `s37-${lane}-${stage}-closed-v1`, prefix: `s37${lane === 'empty' ? 'e' : 'h'}${stageIndex}`,
    lockKey: 3700 + laneIndex + stageIndex,
  });
  const [guard] = source.match(/DO \$target\$\n[\s\S]*?\n\$target\$;/) ?? [];
  const project = guard?.match(/project_ref='([a-z]{20})'/)?.[1];
  const [namespace] = source.match(new RegExp(`site_storage_${original.stem.replaceAll('-', '_')}_[0-9a-f]{8}`)) ?? [];
  if (!project || !namespace) throw new Error('S37_INSTALL_SOURCE_ANCHOR');
  const tag = namespace.slice(-8);
  const bucketStem = `users-site-assets-private-${original.stem}-${tag}`;
  const batchStem = stage === 'l1' ? `s35-m8-lifecycle-${tag}` : `s35-m8-edge-${tag}`;
  const originalIssuer = `https://${project}.supabase.co/auth/v1`;
  const terminalGuard = `OR NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton AND project_ref='${project}')`;
  let sql = replaceOnce(source, guard, '-- S37_CLOSED_INSTALL_GUARD');
  sql = replaceOnce(sql, terminalGuard,
    `OR NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton AND project_ref='${fixtureProject}'` +
    ` AND auth_issuer='${fixtureIssuer}' AND NOT enabled AND NOT proof_verifier_ready)`);
  sql = sql.replaceAll(namespace, scope.schema).replaceAll(bucketStem, scope.bucket).replaceAll(batchStem, scope.batch)
    .replaceAll(`${original.prefix}_`, `${scope.prefix}_`)
    .replaceAll(`pg_advisory_xact_lock(3303,${original.lock})`, `pg_advisory_xact_lock(3303,${scope.lockKey})`)
    .replaceAll(`pg_advisory_xact_lock_shared(3303,${original.lock})`, `pg_advisory_xact_lock_shared(3303,${scope.lockKey})`)
    .replaceAll(`'${originalIssuer}'`, `'${fixtureIssuer}'`).replaceAll(`'${project}'`, `'${fixtureProject}'`);
  if (sql.includes(project) || sql.includes(tag) || /s3(?:m8|edge)_/.test(sql) ||
      sql.split(`3303,${scope.lockKey})`).length !== 8 || sql.split('3303,5)').length !== 9)
    throw new Error('S37_INSTALL_SOURCE_BINDING');
  const pins = { clusterSha256, localMarker, postmasterStarted };
  sql = replaceOnce(sql, '-- S37_CLOSED_INSTALL_GUARD', renderS37InstallGuard({ target: pins, scope }));
  if (!sql.endsWith('\nCOMMIT;\n')) throw new Error('S37_INSTALL_SOURCE_ANCHOR');
  sql = replaceOnce(sql, '\nCOMMIT;\n',
    `
${renderS37InstallPostcondition({ target: pins, scope })}
SELECT pg_current_xact_id()::text AS s37_install_xid;
COMMIT;
`);
  return Object.freeze({ sql, sha256: sha256(sql), sourceSha256: original.sha256, scope });
}
