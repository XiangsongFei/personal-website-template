-- Unexecuted bootstrap candidate. Requires an independently bound new local target.
-- Run after official auth migrate and before M1 under the existing OID 10 observer.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '8s';

DO $preflight$
DECLARE
  expected text := current_setting('ecv_s36_a1.expected_system_identifier', true);
  auth_owner oid := to_regrole('supabase_auth_admin');
  deployer oid := to_regrole('postgres');
BEGIN
  IF current_user <> 'supabase_admin' OR session_user <> current_user
    OR NOT EXISTS (SELECT FROM pg_roles WHERE oid = 10 AND rolname = current_user AND rolsuper)
    OR current_database() <> 'postgres' OR current_setting('server_version_num') <> '170011'
    OR inet_client_addr() IS NOT NULL
    OR expected IS NULL OR expected !~ '^[1-9][0-9]{9,19}$'
    OR expected <> (SELECT system_identifier::text FROM pg_control_system())
    OR EXISTS (SELECT FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid())
    OR NOT EXISTS (SELECT FROM pg_roles WHERE oid = deployer AND NOT rolsuper AND rolcreaterole AND rolbypassrls)
    OR NOT EXISTS (SELECT FROM pg_roles WHERE oid = auth_owner AND NOT rolsuper)
    OR NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = 'auth' AND nspowner = auth_owner)
    OR EXISTS (SELECT FROM pg_namespace WHERE nspname IN ('site_api','site_data','site_private'))
    OR EXISTS (SELECT FROM pg_roles WHERE left(rolname,7) = 'ecv_s3_' OR left(rolname,8) = 'ecv_s36_')
  THEN RAISE EXCEPTION 'S36_A1_TARGET_NOT_BOUND' USING ERRCODE = '42501'; END IF;

  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.sessions') IS NULL
    OR to_regclass('auth.schema_migrations') IS NULL
  THEN RAISE EXCEPTION 'S36_A1_NATIVE_AUTH_MISSING' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT FROM auth.users) OR EXISTS (SELECT FROM auth.sessions)
    OR NOT EXISTS (SELECT FROM auth.schema_migrations WHERE version = '20240612123726')
  THEN RAISE EXCEPTION 'S36_A1_NATIVE_AUTH_NOT_EMPTY_OR_UNVERIFIED' USING ERRCODE = '42501'; END IF;

  -- The image can carry this platform membership. Remove only the exact direct
  -- bootstrap grant to postgres. Other grantors or role paths require review.
  IF EXISTS (SELECT FROM pg_auth_members WHERE roleid = auth_owner AND member = deployer
             AND (grantor <> 10 OR admin_option OR NOT set_option))
  THEN RAISE EXCEPTION 'S36_A1_UNEXPECTED_AUTH_ROLE_EDGE' USING ERRCODE = '42501'; END IF;
END;
$preflight$;

REVOKE supabase_auth_admin FROM postgres GRANTED BY supabase_admin RESTRICT;

SET LOCAL ROLE supabase_auth_admin;
DO $native_grants$
DECLARE
  native_tables constant text[] := ARRAY[
    'schema_migrations','instances','users','audit_log_entries','saml_relay_states','refresh_tokens',
    'mfa_factors','sessions','sso_providers','sso_domains','mfa_challenges','mfa_amr_claims',
    'saml_providers','flow_state','identities','one_time_tokens'
  ];
  relation text;
BEGIN
  FOREACH relation IN ARRAY native_tables LOOP
    IF NOT EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = 'auth' AND c.relname = relation AND c.relkind = 'r'
        AND c.relowner = current_user::regrole AND c.relrowsecurity
        AND a.grantor = c.relowner AND a.grantee = 'postgres'::regrole
        AND a.privilege_type = 'SELECT' AND a.is_grantable
    ) THEN RAISE EXCEPTION 'S36_A1_NATIVE_GRANT_DRIFT' USING ERRCODE = '42501'; END IF;
    EXECUTE format('REVOKE SELECT ON TABLE auth.%I FROM postgres RESTRICT', relation);
  END LOOP;
END;
$native_grants$;

GRANT USAGE ON SCHEMA auth TO postgres;
GRANT REFERENCES (id) ON TABLE auth.users TO postgres;
GRANT SELECT (id,email_confirmed_at,banned_until,is_anonymous) ON TABLE auth.users TO postgres;
GRANT SELECT (id,user_id,not_after) ON TABLE auth.sessions TO postgres;
RESET ROLE;

DO $verify$
BEGIN
  IF pg_has_role('postgres','supabase_auth_admin','MEMBER')
    OR NOT has_schema_privilege('postgres','auth','USAGE')
    OR has_schema_privilege('postgres','auth','CREATE,USAGE WITH GRANT OPTION')
    OR NOT has_schema_privilege('postgres','extensions','USAGE WITH GRANT OPTION')
    OR NOT coalesce(has_function_privilege('postgres',to_regprocedure('extensions.hmac(bytea,bytea,text)'),'EXECUTE'),false)
    OR NOT coalesce(has_function_privilege('postgres',to_regprocedure('extensions.digest(bytea,text)'),'EXECUTE'),false)
    OR EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'auth' AND c.relkind IN ('r','p','v','m','f') AND
        has_table_privilege('postgres',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    )
    OR EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN pg_roles r
      WHERE n.nspname = 'auth' AND c.relkind IN ('r','p','v','m','f')
        AND r.rolname IN ('anon','authenticated','authenticator','service_role')
        AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    )
    OR EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'auth' AND c.relkind IN ('r','p','v','m','f') AND (
        has_column_privilege('postgres',c.oid,a.attnum,'SELECT') IS DISTINCT FROM
          ((c.relname = 'users' AND a.attname IN ('id','email_confirmed_at','banned_until','is_anonymous'))
            OR (c.relname = 'sessions' AND a.attname IN ('id','user_id','not_after')))
        OR has_column_privilege('postgres',c.oid,a.attnum,'REFERENCES') IS DISTINCT FROM
          (c.relname = 'users' AND a.attname = 'id')
        OR has_column_privilege('postgres',c.oid,a.attnum,
          'INSERT,UPDATE,SELECT WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      )
    )
  THEN RAISE EXCEPTION 'S36_A1_AUTH_ACL_NOT_NARROW' USING ERRCODE = '42501'; END IF;
END;
$verify$;
COMMIT;
