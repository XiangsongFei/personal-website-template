-- Offline installation draft for the fixed closed M5 project. Provision authentication separately.
-- Stage names describe their future services. NOLOGIN prevents use during the catalog review.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL createrole_self_grant = '';

DO $check_baseline$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> current_user
     OR current_setting('server_version_num')::integer / 10000 <> 17
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolcreaterole AND NOT rolsuper)
     OR NOT EXISTS (
       SELECT FROM site_private.business_runtime
       WHERE singleton AND project_ref = 'ecv-s33a-20261109-7dd22a81'
         AND NOT enabled AND NOT proof_verifier_ready
     )
     OR NOT EXISTS (
       SELECT FROM pg_roles WHERE rolname = 'ecv_s3_proof_registrar'
         AND NOT (rolcanlogin OR rolcreaterole OR rolsuper OR rolbypassrls OR rolinherit OR rolcreatedb OR rolreplication)
     )
     OR (SELECT count(*) FROM pg_auth_members WHERE roleid = 'ecv_s3_proof_registrar'::regrole) <> 1
     OR NOT EXISTS (
       SELECT FROM pg_auth_members WHERE roleid = 'ecv_s3_proof_registrar'::regrole
         AND member = 'postgres'::regrole AND grantor = 10::oid AND admin_option AND NOT inherit_option AND NOT set_option
     )
     OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'authenticated'::regrole)
     OR EXISTS (SELECT FROM pg_auth_members WHERE member = 'ecv_s3_proof_registrar'::regrole)
     OR NOT EXISTS (
       SELECT FROM pg_proc WHERE oid = 'site_private.register_business_ticket(jsonb)'::regprocedure
         AND encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') = '66cf2798c1a703b9d3b3f37cc7dcabc022f7c123fea59df7f4087c9dcfea45c0'
     ) THEN
    RAISE EXCEPTION 'Closed M5 baseline required';
  END IF;
END;
$check_baseline$;

CREATE ROLE ecv_s3_internal_api_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4;
CREATE ROLE ecv_s3_registration_login NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;

GRANT authenticated TO ecv_s3_internal_api_login
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
GRANT ecv_s3_proof_registrar TO ecv_s3_registration_login
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE GRANTED BY postgres;

DO $check_effective$
DECLARE
  api oid := 'ecv_s3_internal_api_login'::regrole;
  registration oid := 'ecv_s3_registration_login'::regrole;
  registrar oid := 'ecv_s3_proof_registrar'::regrole;
  api_role oid := 'authenticated'::regrole;
  register_fn oid := 'site_private.register_business_ticket(jsonb)'::regprocedure;
BEGIN
  -- Both directions: include bootstrap ADMIN rows for newly created roles.
  IF EXISTS (
    WITH expected(roleid, member, grantor, admin_option, inherit_option, set_option) AS (
      VALUES (api_role, api, 'postgres'::regrole::oid, false, false, true),
             (registrar, registration, 'postgres'::regrole::oid, false, true, false),
             (api, 'postgres'::regrole::oid, 10::oid, true, false, false),
             (registration, 'postgres'::regrole::oid, 10::oid, true, false, false)
    ), actual AS (
      SELECT roleid, member, grantor, admin_option, inherit_option, set_option FROM pg_auth_members
      WHERE roleid IN (api,registration) OR member IN (api,registration)
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  ) OR EXISTS (
    SELECT FROM pg_roles r CROSS JOIN (VALUES(api),(registration)) s(who)
    WHERE r.oid <> s.who AND (
      pg_has_role(s.who,r.oid,'SET') <> (s.who = api AND r.oid = api_role) OR
      pg_has_role(s.who,r.oid,'USAGE') <> (s.who = registration AND r.oid = registrar) OR
      pg_has_role(s.who,r.oid,'MEMBER') <> ((s.who = api AND r.oid = api_role) OR (s.who = registration AND r.oid = registrar))
    )
  ) THEN RAISE EXCEPTION 'Service membership drift'; END IF;

  IF EXISTS (
    SELECT FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator','service_role')
      AND (pg_has_role(r.oid,registrar,'MEMBER') OR pg_has_role(r.oid,registration,'MEMBER')
        OR pg_has_role(r.oid,api,'MEMBER') OR has_function_privilege(r.oid,register_fn,'EXECUTE'))
  ) OR EXISTS (
    SELECT FROM pg_roles r WHERE r.oid IN (api,registration)
      AND (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolinherit)
  ) OR has_schema_privilege(registration,'auth','USAGE')
    OR EXISTS (
    SELECT FROM pg_proc p CROSS JOIN (VALUES(api),(registration),(api_role)) s(who)
    WHERE p.pronamespace IN ('site_data'::regnamespace,'site_private'::regnamespace,'site_api'::regnamespace)
      AND (has_function_privilege(s.who,p.oid,'EXECUTE WITH GRANT OPTION') OR
        has_function_privilege(s.who,p.oid,'EXECUTE') <> (
          (s.who = registration AND p.oid = register_fn) OR
          (s.who = api_role AND p.oid = ANY (ARRAY[
             'site_api.apply_business_grant(jsonb)'::regprocedure::oid,
             'site_api.create_site(jsonb)'::regprocedure::oid,
             'site_api.get_my_site()'::regprocedure::oid,
             'site_api.read_introduction(uuid)'::regprocedure::oid,
             'site_api.read_create_operation(jsonb)'::regprocedure::oid]))
        ))
  ) OR EXISTS (
    SELECT FROM pg_namespace n CROSS JOIN (VALUES(api),(registration),(api_role)) s(who)
    WHERE n.nspname IN ('site_api','site_data','site_private') AND (
       has_schema_privilege(s.who,n.oid,'CREATE') OR has_schema_privilege(s.who,n.oid,'USAGE WITH GRANT OPTION')
       OR has_schema_privilege(s.who,n.oid,'USAGE') <> (
         (s.who=registration AND n.nspname='site_private') OR (s.who=api_role AND n.nspname='site_api')
       ))
  ) OR EXISTS (
    SELECT FROM pg_class r CROSS JOIN (VALUES(api),(registration),(api_role)) s(who)
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN']) p(priv)
    WHERE r.relkind IN ('r','p') AND r.relnamespace IN ('site_data'::regnamespace,'site_private'::regnamespace,'site_api'::regnamespace)
      AND (has_table_privilege(s.who,r.oid,p.priv) OR CASE WHEN p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES')
           THEN has_any_column_privilege(s.who,r.oid,p.priv) ELSE false END)
  ) THEN RAISE EXCEPTION 'Excess or missing service privileges'; END IF;
END;
$check_effective$;

COMMIT;
