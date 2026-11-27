// Renders a transaction for a freshly initialized PostgreSQL fixture only.
// No connection, credential, hosted destination, or permission grant is provided.
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const utc = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) && Number.isFinite(Date.parse(value));

const projection = `encode(sha256(convert_to(jsonb_build_array(
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id), '[]'::jsonb) FROM s37_fixture_l1.runs r),
    (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY run_id, uploads), '[]'::jsonb) FROM s37_fixture_l1.subjects s),
    (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id), '[]'::jsonb) FROM s37_fixture_l1.retained_history h)
  )::text, 'UTF8')), 'hex')`;

export function renderS37ClosedOwnerConstraintsFixture(pins) {
  const { clusterSha256, fixtureMarker, postmasterStarted, retainedSha256 } = pins ?? {};
  if (!pins || Object.keys(pins).sort().join(',') !== 'clusterSha256,fixtureMarker,postmasterStarted,retainedSha256' ||
      ![clusterSha256, fixtureMarker, retainedSha256].every(digest) || !utc(postmasterStarted))
    throw new Error('S37_FIXTURE_INVALID_PINS');

  return `BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DO $identity$
BEGIN
  IF current_database() <> 's37_closed_install_fixture'
     OR session_user <> 's37_fixture_owner' OR current_user <> session_user
     OR inet_server_addr() IS NOT NULL OR inet_client_addr() IS NOT NULL
     OR current_setting('server_version_num') <> '170012'
     OR current_setting('session_replication_role') <> 'origin'
     OR current_setting('ecv.s37_fixture_marker', true) IS DISTINCT FROM '${fixtureMarker}'
     OR pg_postmaster_start_time() IS DISTINCT FROM '${postmasterStarted}'::timestamptz
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user
       AND rolcanlogin AND NOT (rolinherit OR rolsuper OR rolbypassrls OR rolreplication OR rolcreatedb OR rolcreaterole))
  THEN RAISE EXCEPTION 'S37_FIXTURE_IDENTITY' USING ERRCODE = '42501'; END IF;

  IF (SELECT encode(sha256(convert_to(system_identifier::text, 'UTF8')), 'hex') FROM pg_control_system())
        IS DISTINCT FROM '${clusterSha256}'
  THEN RAISE EXCEPTION 'S37_FIXTURE_CLUSTER' USING ERRCODE = '42501'; END IF;
END
$identity$;

LOCK TABLE s37_fixture_l1.runtime, s37_fixture_l1.runs, s37_fixture_l1.subjects, s37_fixture_l1.retained_history
  IN ACCESS EXCLUSIVE MODE;

DO $migration$
BEGIN
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 's37_fixture_l1' AND n.nspowner = current_user::regrole
          AND c.relname IN ('runtime', 'runs', 'subjects', 'retained_history')
          AND c.relkind = 'r' AND c.relowner = current_user::regrole AND c.relrowsecurity AND NOT c.relforcerowsecurity) <> 4
     OR NOT EXISTS (SELECT FROM pg_constraint
       WHERE conrelid = 's37_fixture_l1.runs'::regclass AND conname = 'runs_singleton_key'
         AND contype = 'u' AND convalidated AND pg_get_constraintdef(oid) = 'UNIQUE (singleton)')
     OR NOT EXISTS (SELECT FROM pg_constraint
       WHERE conrelid = 's37_fixture_l1.subjects'::regclass AND conname = 'subjects_run_id_uploads_key'
         AND contype = 'u' AND convalidated AND pg_get_constraintdef(oid) = 'UNIQUE (run_id, uploads)')
     OR (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 's37_fixture_l1.subjects'::regclass AND attname IN ('run_id', 'owner_uid', 'uploads')
         AND attnum > 0 AND NOT attisdropped AND attnotnull) <> 3
  THEN RAISE EXCEPTION 'S37_FIXTURE_BASELINE' USING ERRCODE = '42501'; END IF;

  IF (SELECT count(*) FROM s37_fixture_l1.runtime) <> 1
     OR NOT EXISTS (SELECT FROM s37_fixture_l1.runtime
       WHERE NOT business_enabled AND NOT download_enabled AND NOT outbox_enabled
         AND sessions = 0 AND grants = 0 AND permits = 0)
     OR EXISTS (SELECT FROM s37_fixture_l1.runs WHERE closed_at IS NULL)
  THEN RAISE EXCEPTION 'S37_FIXTURE_NOT_CLOSED' USING ERRCODE = '42501'; END IF;

  IF ${projection} IS DISTINCT FROM '${retainedSha256}'
  THEN RAISE EXCEPTION 'S37_FIXTURE_RETAINED_DRIFT' USING ERRCODE = '42501'; END IF;

  CREATE UNIQUE INDEX one_open_run ON s37_fixture_l1.runs ((true)) WHERE closed_at IS NULL;
  ALTER TABLE s37_fixture_l1.runs DROP CONSTRAINT runs_singleton_key;
  ALTER TABLE s37_fixture_l1.subjects ADD CONSTRAINT one_owner_per_run UNIQUE (run_id);

  IF ${projection} IS DISTINCT FROM '${retainedSha256}'
     OR NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = 's37_fixture_l1.one_open_run'::regclass
       AND indrelid = 's37_fixture_l1.runs'::regclass AND indisunique AND indisvalid AND indisready
       AND pg_get_expr(indexprs, indrelid) = 'true' AND pg_get_expr(indpred, indrelid) = '(closed_at IS NULL)')
     OR NOT EXISTS (SELECT FROM pg_constraint
       WHERE conrelid = 's37_fixture_l1.subjects'::regclass AND conname = 'one_owner_per_run'
         AND contype = 'u' AND convalidated AND pg_get_constraintdef(oid) = 'UNIQUE (run_id)')
  THEN RAISE EXCEPTION 'S37_FIXTURE_POSTCONDITION' USING ERRCODE = '42501'; END IF;
END
$migration$;
COMMIT;
`;
}
