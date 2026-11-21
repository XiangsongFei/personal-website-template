-- Execute on the approved, new project with a verified TLS connection as postgres.
-- No credentials, user records, tokens, Auth ledger rows or schema changes.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '8s';
SELECT current_database() AS database, current_setting('server_version_num') AS version,
       session_user AS login, current_user AS role,
       (SELECT rolsuper AND rolname='supabase_admin' FROM pg_roles WHERE oid=10) AS pg17_bootstrap_contract,
       (SELECT NOT rolsuper AND rolcreaterole AND rolbypassrls FROM pg_roles WHERE rolname='postgres') AS deployer_contract,
       coalesce(pg_has_role('postgres',to_regrole('authenticated'),'MEMBER WITH ADMIN OPTION'),false) AS m6_can_delegate_authenticated,
       ARRAY(SELECT nspname FROM pg_namespace WHERE nspname IN ('site_api','site_data','site_private') ORDER BY 1) AS schema_collisions,
       ARRAY(SELECT rolname FROM pg_roles WHERE left(rolname,7)='ecv_s3_' OR left(rolname,8)='ecv_s36_' ORDER BY 1) AS role_collisions,
       current_setting('check_function_bodies') AS check_function_bodies;
SELECT has_schema_privilege(current_user,'auth','USAGE') AS auth_usage,
       coalesce(has_column_privilege(current_user,to_regclass('auth.users'),'id','REFERENCES'),false) AS auth_user_fk,
       NOT EXISTS (
         SELECT FROM (VALUES ('auth.users','id'),('auth.users','email_confirmed_at'),('auth.users','is_anonymous'),
                             ('auth.users','banned_until'),('auth.sessions','id'),('auth.sessions','user_id'),
                             ('auth.sessions','not_after')) AS cols(relation,column_name)
         WHERE NOT coalesce(has_column_privilege(current_user,to_regclass(relation),column_name,'SELECT'),false)
       ) AS current_auth_columns,
       has_schema_privilege(current_user,'extensions','USAGE WITH GRANT OPTION') AS extensions_delegable_usage,
       coalesce(has_function_privilege(current_user,to_regprocedure('extensions.digest(bytea,text)'),'EXECUTE'),false) AS pgcrypto_digest,
       coalesce(has_function_privilege(current_user,to_regprocedure('extensions.hmac(bytea,bytea,text)'),'EXECUTE'),false) AS pgcrypto_hmac,
       has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION') AS public_create_delegable;
DO $permission_gate$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>session_user
    OR current_setting('server_version_num')::int / 10000<>17 OR NOT current_setting('check_function_bodies')::boolean
    OR NOT EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
    OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolcreaterole AND rolbypassrls)
    OR NOT coalesce(pg_has_role('postgres',to_regrole('authenticated'),'MEMBER WITH ADMIN OPTION'),false)
    OR EXISTS(SELECT FROM pg_namespace WHERE nspname IN ('site_api','site_data','site_private'))
    OR EXISTS(SELECT FROM pg_roles WHERE left(rolname,7)='ecv_s3_' OR left(rolname,8)='ecv_s36_')
    OR NOT has_schema_privilege(current_user,'auth','USAGE')
    OR NOT coalesce(has_column_privilege(current_user,to_regclass('auth.users'),'id','REFERENCES'),false)
    OR EXISTS(SELECT FROM (VALUES ('auth.users','id'),('auth.users','email_confirmed_at'),('auth.users','is_anonymous'),
          ('auth.users','banned_until'),('auth.sessions','id'),('auth.sessions','user_id'),('auth.sessions','not_after')) a(rel,col)
          WHERE NOT coalesce(has_column_privilege(current_user,to_regclass(rel),col,'SELECT'),false))
    OR NOT has_schema_privilege(current_user,'extensions','USAGE WITH GRANT OPTION')
    OR NOT coalesce(has_function_privilege(current_user,to_regprocedure('extensions.digest(bytea,text)'),'EXECUTE'),false)
    OR NOT coalesce(has_function_privilege(current_user,to_regprocedure('extensions.hmac(bytea,bytea,text)'),'EXECUTE'),false)
    OR NOT has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION')
 THEN RAISE EXCEPTION 'HOSTED_INSTALL_BLOCKED_PRECHECK'; END IF;
 IF EXISTS(SELECT FROM auth.users) OR EXISTS(SELECT FROM auth.sessions)
 THEN RAISE EXCEPTION 'HOSTED_TARGET_AUTH_NOT_EMPTY'; END IF;
END;
$permission_gate$;
ROLLBACK;
