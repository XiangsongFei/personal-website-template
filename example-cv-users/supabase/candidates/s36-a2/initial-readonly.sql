-- New isolated profile only. No row contents or business state.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
DO $profile$
BEGIN
  IF current_database() <> 'postgres' OR current_setting('server_version_num') <> '170011'
    OR inet_client_addr() IS NOT NULL OR session_user <> 'supabase_admin' OR current_user <> session_user
    OR NOT EXISTS (SELECT FROM pg_roles WHERE oid = 10 AND rolname = session_user AND rolsuper)
    OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres' AND rolcanlogin AND NOT rolsuper
      AND rolcreaterole AND rolbypassrls)
    OR NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'auth' AND nspowner = 'supabase_auth_admin'::regrole)
    OR EXISTS (SELECT FROM pg_namespace WHERE nspname IN ('site_api','site_data','site_private'))
    OR EXISTS (SELECT FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid())
    OR to_regclass('auth.sessions') IS NOT NULL OR EXISTS (SELECT FROM auth.users)
  THEN RAISE EXCEPTION 'S36_A2_INITIAL_PROFILE_DENIED' USING ERRCODE = '42501'; END IF;
END;
$profile$;
SELECT jsonb_build_object('versions',jsonb_agg(version ORDER BY version::text COLLATE "C"))
FROM auth.schema_migrations;
ROLLBACK;
