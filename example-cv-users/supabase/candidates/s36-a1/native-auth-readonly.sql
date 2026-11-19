-- Post-bridge independent readback before M1. No user or session row contents.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
DO $observer$
DECLARE expected text := current_setting('ecv_s36_a1.expected_system_identifier', true);
BEGIN
  IF session_user <> 'supabase_admin' OR current_user <> session_user
    OR NOT EXISTS (SELECT FROM pg_roles WHERE oid = 10 AND rolname = current_user AND rolsuper)
    OR current_database() <> 'postgres' OR current_setting('server_version_num') <> '170011'
    OR inet_client_addr() IS NOT NULL OR current_setting('transaction_read_only') <> 'on'
    OR expected IS NULL OR expected !~ '^[1-9][0-9]{9,19}$'
    OR expected <> (SELECT system_identifier::text FROM pg_control_system())
    OR EXISTS (SELECT FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid())
    OR EXISTS (SELECT FROM pg_namespace WHERE nspname IN ('site_api','site_data','site_private'))
  THEN RAISE EXCEPTION 'S36_A1_NATIVE_AUTH_READBACK_UNBOUND' USING ERRCODE = '42501'; END IF;
END;
$observer$;

WITH relations AS (
  SELECT c.oid,c.relname,c.relowner,c.relrowsecurity FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'auth' AND c.relkind IN ('r','p','v','m','f')
), columns AS (
  SELECT r.relname,a.attname,
    has_column_privilege('postgres',r.oid,a.attnum,'SELECT') AS can_read,
    has_column_privilege('postgres',r.oid,a.attnum,'REFERENCES') AS can_reference,
    has_column_privilege('postgres',r.oid,a.attnum,
      'INSERT,UPDATE,SELECT WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') AS elevated
  FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
), by_table AS (
  SELECT relname,
    coalesce(jsonb_agg(attname ORDER BY attname::text COLLATE "C") FILTER (WHERE can_read),'[]'::jsonb) AS read_columns,
    coalesce(jsonb_agg(attname ORDER BY attname::text COLLATE "C") FILTER (WHERE can_reference),'[]'::jsonb) AS reference_columns
  FROM columns WHERE can_read OR can_reference GROUP BY relname
)
SELECT jsonb_build_object(
  'versions',(SELECT jsonb_agg(version ORDER BY version::text COLLATE "C") FROM auth.schema_migrations),
  'users',(SELECT count(*) FROM auth.users),'sessions',(SELECT count(*) FROM auth.sessions),
  'relation_owner',(SELECT CASE WHEN count(*)=3 AND bool_and(relowner='supabase_auth_admin'::regrole)
    THEN 'supabase_auth_admin' END FROM relations WHERE relname IN ('schema_migrations','users','sessions')),
  'rls',(SELECT count(*)=3 AND bool_and(relrowsecurity) FROM relations WHERE relname IN ('schema_migrations','users','sessions')),
  'postgres_auth_role_member',pg_has_role('postgres','supabase_auth_admin','MEMBER'),
  'postgres_auth_schema_usage',has_schema_privilege('postgres','auth','USAGE'),
  'postgres_auth_schema_create',has_schema_privilege('postgres','auth','CREATE'),
  'postgres_auth_full_table_privileges',EXISTS (SELECT FROM relations
    WHERE has_table_privilege('postgres',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')),
  'postgres_auth_grant_options',has_schema_privilege('postgres','auth','USAGE WITH GRANT OPTION')
    OR EXISTS (SELECT FROM columns WHERE elevated),
  'ordinary_auth_data_privileges',EXISTS (SELECT FROM relations CROSS JOIN pg_roles r
    WHERE r.rolname IN ('anon','authenticated','authenticator','service_role')
      AND (has_table_privilege(r.oid,relations.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege(r.oid,relations.oid,'SELECT,INSERT,UPDATE,REFERENCES'))),
  'pgcrypto_deployer_capability',has_schema_privilege('postgres','extensions','USAGE WITH GRANT OPTION')
    AND coalesce(has_function_privilege('postgres',to_regprocedure('extensions.hmac(bytea,bytea,text)'),'EXECUTE'),false)
    AND coalesce(has_function_privilege('postgres',to_regprocedure('extensions.digest(bytea,text)'),'EXECUTE'),false),
  'postgres_auth_columns',(SELECT jsonb_object_agg(relname,
    CASE WHEN relname='sessions' AND reference_columns='[]'::jsonb THEN jsonb_build_object('select',read_columns)
    ELSE jsonb_build_object('select',read_columns,'references',reference_columns) END) FROM by_table)
);
ROLLBACK;
