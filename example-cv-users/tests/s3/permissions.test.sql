-- NOT RUN. Catalog/SET ROLE checks are NOT real JWT or grant evidence.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = pg_catalog;
-- Run the same fail-closed catalog check as the migrations on committed state.
DO $role_boundary$
DECLARE
 deployer constant oid := 'postgres'::pg_catalog.regrole;
 bootstrap constant oid := 10; -- PostgreSQL 17 BOOTSTRAP_SUPERUSERID
 internal_roles constant oid[] := ARRAY['ecv_s3_owner'::pg_catalog.regrole::oid,
                                         'ecv_s3_integrity'::pg_catalog.regrole::oid];
BEGIN
 IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles
                WHERE oid = bootstrap AND rolname = 'supabase_admin' AND rolsuper) THEN
  RAISE EXCEPTION 'S3 bootstrap grantor mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles
     WHERE oid = ANY(internal_roles) AND NOT rolcanlogin AND NOT rolsuper
       AND NOT rolbypassrls AND NOT rolinherit AND NOT rolcreaterole
       AND NOT rolcreatedb AND NOT rolreplication) <> 2 THEN
  RAISE EXCEPTION 'S3 internal role attributes mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_auth_members
     WHERE roleid = ANY(internal_roles) OR member = ANY(internal_roles)) <> 2
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members
        WHERE roleid = ANY(internal_roles) AND member = deployer
          AND grantor = bootstrap AND admin_option AND NOT set_option AND NOT inherit_option) <> 2 THEN
  RAISE EXCEPTION 'S3 internal role membership mismatch';
 END IF;
 IF EXISTS (
  SELECT FROM pg_catalog.pg_roles AS r CROSS JOIN unnest(internal_roles) AS i(roleid)
  WHERE r.oid <> deployer AND r.oid <> ALL(internal_roles)
    AND (NOT r.rolsuper OR r.rolname IN ('anon','authenticated','authenticator','service_role'))
    AND (pg_has_role(r.oid, i.roleid, 'MEMBER')
      OR pg_has_role(r.oid, i.roleid, 'SET')
      OR pg_has_role(r.oid, i.roleid, 'USAGE'))
 ) THEN
  RAISE EXCEPTION 'S3 non-deployer role path to internal role';
 END IF;
 IF EXISTS (
  SELECT FROM unnest(internal_roles) AS i(roleid)
  WHERE pg_has_role(deployer, i.roleid, 'SET') OR pg_has_role(deployer, i.roleid, 'USAGE')
 ) THEN
  RAISE EXCEPTION 'S3 deployer SET/INHERIT remains effective';
 END IF;
END;
$role_boundary$;
-- Permission denials need no Auth fixtures and no deployment grants.
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF;
END;
$fn$;
DO $test$
DECLARE r record; role_name text; privilege_name text;
BEGIN
 PERFORM pg_temp.assert_true((SELECT count(*)=15 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('site_data','site_private') AND c.relkind='r'),'exact table inventory');
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','authenticator'] LOOP
  PERFORM pg_temp.assert_true(NOT has_schema_privilege(role_name,'site_data','USAGE') AND NOT has_schema_privilege(role_name,'site_private','USAGE') AND NOT has_schema_privilege(role_name,'site_api','USAGE'),'schema denial');
 END LOOP;
 FOR r IN SELECT c.oid,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('site_data','site_private') AND c.relkind='r' LOOP
  PERFORM pg_temp.assert_true(r.relrowsecurity AND r.relforcerowsecurity,'RLS '||r.relname);
  PERFORM pg_temp.assert_true(r.relowner='ecv_s3_owner'::regrole,'owner '||r.relname);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','authenticator'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    PERFORM pg_temp.assert_true(NOT has_table_privilege(role_name,r.oid,privilege_name),'table denial '||role_name||r.relname||privilege_name);
   END LOOP;
  END LOOP;
 END LOOP;
 FOR r IN SELECT p.oid,p.proname,p.prosecdef,p.proowner,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('site_private','site_api') LOOP
  PERFORM pg_temp.assert_true(r.proconfig @> ARRAY['search_path=""'],'fixed search_path');
  PERFORM pg_temp.assert_true(r.prosecdef=(r.proname='assert_site_integrity'),'definer allowlist');
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=r.oid AND a.grantee=0 AND a.privilege_type='EXECUTE'),'no PUBLIC execute');
  PERFORM pg_temp.assert_true(r.proowner=(CASE WHEN r.prosecdef THEN 'ecv_s3_integrity' ELSE 'ecv_s3_owner' END)::regrole,'function owner');
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role','authenticator'] LOOP
   PERFORM pg_temp.assert_true(NOT has_function_privilege(role_name,r.oid,'EXECUTE'),'function denial');
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_true(NOT has_schema_privilege('ecv_s3_integrity','site_private','CREATE'),'integrity cannot create');
 PERFORM pg_temp.assert_true(NOT has_table_privilege('ecv_s3_integrity','site_private.business_session_grants','SELECT'),'no grant access');
 PERFORM pg_temp.assert_true((SELECT count(*)=3 FROM pg_policies WHERE schemaname IN ('site_data','site_private')),'three integrity read policies only');
 PERFORM pg_temp.assert_true(NOT EXISTS(
  SELECT FROM pg_roles AS role_meta
  LEFT JOIN pg_default_acl d ON d.defaclrole=role_meta.oid AND d.defaclobjtype='f' AND d.defaclnamespace=0
  CROSS JOIN LATERAL aclexplode(coalesce(d.defaclacl,acldefault('f',role_meta.oid))) a
  WHERE role_meta.rolname IN ('ecv_s3_owner','ecv_s3_integrity') AND a.grantee=0 AND a.privilege_type='EXECUTE'
 ),'internal global function defaults closed');
END;
$test$;
-- SET ROLE uses session_user's role graph, even after switching current_user.
-- The catalog check covers API role paths. These probes do not authenticate JWTs.
SET LOCAL ROLE authenticated;
DO $denials$
DECLARE statement text;
BEGIN
 FOREACH statement IN ARRAY ARRAY[
  'SELECT * FROM site_data.sites',
  'INSERT INTO site_data.sites(owner_auth_user_id) VALUES(gen_random_uuid())',
  'UPDATE site_data.site_members SET role=''owner''',
  'TRUNCATE site_data.site_members',
  'SELECT * FROM site_private.business_session_grants',
  'SELECT site_private.assert_site_integrity()'
 ] LOOP
  BEGIN
   EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN
   CONTINUE;
  END;
  RAISE EXCEPTION 'authenticated unexpectedly succeeded: %', statement;
 END LOOP;
END;
$denials$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $denials$
BEGIN
 BEGIN
  PERFORM 1 FROM site_data.intro_translations;
 EXCEPTION WHEN insufficient_privilege THEN
  RETURN;
 END;
 RAISE EXCEPTION 'anon unexpectedly accessed site_data.intro_translations';
END;
$denials$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
