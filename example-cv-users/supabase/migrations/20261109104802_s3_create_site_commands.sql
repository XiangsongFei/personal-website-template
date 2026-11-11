-- CANDIDATE / NOT EXECUTED. Depends on M1, M2 and s3_business_grants.
-- This never changes PostgREST exposed schemas or enables the signer/keyring.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $preflight$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
  OR current_setting('server_version_num')::integer/10000<>17
  OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolcreaterole)
  OR pg_catalog.to_regprocedure('site_private.lock_business_qualification()') IS NULL THEN
  RAISE EXCEPTION 'S3B command prerequisites missing'; END IF;
END;
$preflight$;
DO $role_boundary$
DECLARE
 deployer constant oid := 'postgres'::pg_catalog.regrole;
 bootstrap constant oid := 10; -- PostgreSQL 17 BOOTSTRAP_SUPERUSERID
 internal_roles constant oid[] := ARRAY['ecv_s3_owner'::pg_catalog.regrole::oid,
                                         'ecv_s3_integrity'::pg_catalog.regrole::oid,'ecv_s3_authz_reader'::pg_catalog.regrole::oid, 'ecv_s3_grant_writer'::pg_catalog.regrole::oid, 'ecv_s3_command_writer'::pg_catalog.regrole::oid];
BEGIN
 IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles
                WHERE oid = bootstrap AND rolname = 'supabase_admin' AND rolsuper) THEN
  RAISE EXCEPTION 'S3 bootstrap grantor mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles
     WHERE oid = ANY(internal_roles) AND NOT rolcanlogin AND NOT rolsuper
       AND NOT rolbypassrls AND NOT rolinherit AND NOT rolcreaterole
       AND NOT rolcreatedb AND NOT rolreplication) <> 5 THEN
  RAISE EXCEPTION 'S3 internal role attributes mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_auth_members
     WHERE roleid = ANY(internal_roles) OR member = ANY(internal_roles)) <> 5
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members
        WHERE roleid = ANY(internal_roles) AND member = deployer
          AND grantor = bootstrap AND admin_option AND NOT set_option AND NOT inherit_option) <> 5 THEN
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
GRANT ecv_s3_owner, ecv_s3_command_writer TO postgres
 WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA site_private, site_api TO ecv_s3_command_writer;
GRANT INSERT ON site_data.sites, site_data.site_members, site_data.site_domains,
 site_data.site_locales, site_data.site_settings, site_data.section_state,
 site_data.site_publications, site_data.intro_entries, site_data.intro_translations,
 site_data.draft_revisions, site_private.operation_requests, site_private.site_audit_events TO ecv_s3_command_writer;
GRANT SELECT(id,owner_auth_user_id,status,draft_revision) ON site_data.sites TO ecv_s3_command_writer;
GRANT SELECT(site_id,auth_user_id,role,state) ON site_data.site_members TO ecv_s3_command_writer;
GRANT SELECT(site_id,state,snapshot_id,publication_revision) ON site_data.site_publications TO ecv_s3_command_writer;
GRANT SELECT(site_id,locale,enabled) ON site_data.site_locales TO ecv_s3_command_writer;
GRANT SELECT(id,site_id,position) ON site_data.intro_entries TO ecv_s3_command_writer;
GRANT SELECT(site_id,parent_id,locale,text) ON site_data.intro_translations TO ecv_s3_command_writer;
GRANT SELECT(id,site_id,actor_auth_user_id,operation,request_id,payload_digest,result) ON site_private.operation_requests TO ecv_s3_command_writer;
CREATE POLICY command_sites_read ON site_data.sites FOR SELECT TO ecv_s3_command_writer
 USING(owner_auth_user_id=site_private.request_uid() AND site_private.business_qualified());
CREATE POLICY command_sites_insert ON site_data.sites FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(owner_auth_user_id=site_private.request_uid() AND status='active' AND draft_revision=0 AND site_private.business_qualified());
CREATE POLICY command_members_read ON site_data.site_members FOR SELECT TO ecv_s3_command_writer
 USING(auth_user_id=site_private.request_uid() AND site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_members_insert ON site_data.site_members FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(auth_user_id=site_private.request_uid() AND role='owner' AND state='active' AND site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_site_domains_insert ON site_data.site_domains FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_site_locales_insert ON site_data.site_locales FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_site_locales_read ON site_data.site_locales FOR SELECT TO ecv_s3_command_writer
 USING(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_site_settings_insert ON site_data.site_settings FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_section_state_insert ON site_data.section_state FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_site_publications_insert ON site_data.site_publications FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_site_publications_read ON site_data.site_publications FOR SELECT TO ecv_s3_command_writer
 USING(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_intro_entries_insert ON site_data.intro_entries FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_intro_entries_read ON site_data.intro_entries FOR SELECT TO ecv_s3_command_writer
 USING(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_intro_translations_insert ON site_data.intro_translations FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_intro_translations_read ON site_data.intro_translations FOR SELECT TO ecv_s3_command_writer
 USING(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_draft_revisions_insert ON site_data.draft_revisions FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_operation_requests_insert ON site_private.operation_requests FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(actor_auth_user_id=site_private.request_uid() AND site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_site_audit_events_insert ON site_private.site_audit_events FOR INSERT TO ecv_s3_command_writer
 WITH CHECK(actor_auth_user_id=site_private.request_uid() AND site_private.business_site_owned(site_id) AND site_private.business_qualified());
CREATE POLICY command_operations_read ON site_private.operation_requests FOR SELECT TO ecv_s3_command_writer
 USING(actor_auth_user_id=site_private.request_uid() AND site_private.business_site_owned(site_id) AND site_private.business_qualified());


CREATE FUNCTION site_private.create_payload(input jsonb) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 IF NOT(input ?& ARRAY['schema_version','request_id','slug','default_locale'])
  OR (SELECT count(*) FROM jsonb_object_keys(input))<>4
  OR input->'schema_version' IS DISTINCT FROM '1'::jsonb
  OR jsonb_typeof(input->'schema_version') IS DISTINCT FROM 'number'
  OR jsonb_typeof(input->'request_id') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'slug') IS DISTINCT FROM 'string'
  OR jsonb_typeof(input->'default_locale') IS DISTINCT FROM 'string'
  OR coalesce(input->>'request_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR coalesce(input->>'slug','') !~ '^[a-z][a-z0-9-]{1,46}[a-z0-9]$'
  OR input->>'slug' IN ('admin','cms-admin','www','api','auth','hr','mail','support','static','assets')
  OR coalesce(input->>'default_locale','') NOT IN ('zh','en') THEN
  RAISE EXCEPTION 'INVALID_INPUT' USING ERRCODE='22023'; END IF;
 RETURN encode(extensions.digest(convert_to('ecv.create_site.v1'||chr(10)||(input->>'slug')||chr(10)||
  (input->>'default_locale')||chr(10),'UTF8'),'sha256'),'hex');
END;
$fn$;
CREATE FUNCTION site_api.create_site(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; digest text; prior record; site uuid; operation_id uuid; entry uuid;
 response jsonb; baseline jsonb; conflict_name text;
BEGIN
 SELECT * INTO STRICT who FROM site_private.lock_business_qualification();
 digest:=site_private.create_payload(input);
 SELECT r.payload_digest,r.result,r.site_id INTO prior FROM site_private.operation_requests r
  WHERE r.actor_auth_user_id=who.uid AND r.operation='create_site' AND r.request_id=(input->>'request_id')::uuid;
 IF FOUND THEN
  IF prior.payload_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF NOT site_private.business_site_complete(prior.site_id) THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN prior.result;
 END IF;
 IF EXISTS(SELECT FROM site_data.sites s WHERE s.owner_auth_user_id=who.uid) THEN
  RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='PT409'; END IF;
 INSERT INTO site_data.sites(owner_auth_user_id) VALUES(who.uid) RETURNING id INTO site;
 INSERT INTO site_data.site_members(site_id,auth_user_id,role,state) VALUES(site,who.uid,'owner','active');
 INSERT INTO site_data.site_publications(site_id,changed_by) VALUES(site,who.uid);
 INSERT INTO site_data.site_domains(site_id,slug,hostname_normalized)
  VALUES(site,input->>'slug',(input->>'slug')||'.sites.example.test');
 INSERT INTO site_data.site_locales(site_id,locale) VALUES(site,'zh'),(site,'en');
 INSERT INTO site_data.site_settings(site_id,default_locale) VALUES(site,input->>'default_locale');
 INSERT INTO site_data.section_state(site_id,section_key) VALUES(site,'introduction');
 INSERT INTO site_data.intro_entries(site_id,position) VALUES(site,0) RETURNING id INTO entry;
 INSERT INTO site_data.intro_translations(site_id,parent_id,locale,text)
  VALUES(site,entry,'zh','请填写个人介绍。'),(site,entry,'en','Add your introduction.');
 response:=jsonb_build_object('schema_version',1,'request_id',input->>'request_id','site_id',site,'persisted',true,
  'publication',jsonb_build_object('state','unpublished','snapshot_id',NULL,'publication_revision',0));
 INSERT INTO site_private.operation_requests(site_id,actor_auth_user_id,actor_session_id,operation,request_id,
  payload_digest,state,result_schema_version,result,expires_at)
  VALUES(site,who.uid,who.sid,'create_site',(input->>'request_id')::uuid,digest,'succeeded',1,response,
  pg_catalog.clock_timestamp()+interval '7 days') RETURNING id INTO operation_id;
 baseline:=jsonb_build_object('schema_version',1,'entries',jsonb_build_array(jsonb_build_object('id',entry,'position',0,
  'translations',jsonb_build_object('zh','请填写个人介绍。','en','Add your introduction.'))));
 INSERT INTO site_data.draft_revisions(site_id,site_revision,section_key,section_revision,schema_version,
  payload,digest,actor_auth_user_id,operation_id)
  VALUES(site,0,'introduction',0,1,baseline,encode(extensions.digest(convert_to(baseline::text,'UTF8'),'sha256'),'hex'),who.uid,operation_id);
 INSERT INTO site_private.site_audit_events(site_id,actor_auth_user_id,action,section,operation_id,result)
  VALUES(site,who.uid,'create_site','introduction',operation_id,'succeeded');
 SET CONSTRAINTS site_data.sites_integrity,site_data.members_integrity,site_data.publications_integrity IMMEDIATE;
 RETURN response;
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS conflict_name=CONSTRAINT_NAME;
 IF conflict_name IN ('sites_owner_auth_user_id_key','site_domains_hostname_normalized_key','create_site_request_key') THEN
  RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='PT409';
 END IF;
 RAISE;
END;
$fn$;
CREATE FUNCTION site_api.read_create_operation(input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; digest text; prior record;
BEGIN
 SELECT * INTO STRICT who FROM site_private.lock_business_qualification();
 digest:=site_private.create_payload(input);
 SELECT r.payload_digest,r.result,r.site_id INTO prior FROM site_private.operation_requests r
  WHERE r.actor_auth_user_id=who.uid AND r.operation='create_site' AND r.request_id=(input->>'request_id')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','not_observed'); END IF;
 IF prior.payload_digest IS DISTINCT FROM digest THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='PT409'; END IF;
 IF NOT site_private.business_site_complete(prior.site_id) THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('status','succeeded','result',prior.result);
END;
$fn$;
CREATE FUNCTION site_api.get_my_site() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; site record;
BEGIN
 SELECT * INTO STRICT who FROM site_private.lock_business_qualification();
 SELECT s.id,s.status,s.draft_revision INTO site FROM site_data.sites s WHERE s.owner_auth_user_id=who.uid AND s.status='active';
 IF NOT FOUND THEN RETURN jsonb_build_object('schema_version',1,'site',NULL); END IF;
 IF NOT site_private.business_site_complete(site.id) THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('schema_version',1,'site',jsonb_build_object('id',site.id,'draft_revision',site.draft_revision),
  'capabilities',jsonb_build_object('read',true,'edit',false,'publish',false));
END;
$fn$;
CREATE FUNCTION site_api.read_introduction(target uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; entries jsonb;
BEGIN
 SELECT * INTO STRICT who FROM site_private.lock_business_qualification();
 IF NOT site_private.business_site_complete(target) THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'position',e.position,'translations',
  (SELECT jsonb_object_agg(t.locale,t.text) FROM site_data.intro_translations t WHERE t.site_id=target AND t.parent_id=e.id)) ORDER BY e.position,e.id),'[]'::jsonb)
  INTO entries FROM site_data.intro_entries e WHERE e.site_id=target;
 RETURN jsonb_build_object('schema_version',1,'site_id',target,'section_revision',0,'draft_revision',0,'entries',entries);
END;
$fn$;
ALTER FUNCTION site_private.create_payload(jsonb) OWNER TO ecv_s3_command_writer;
REVOKE ALL ON FUNCTION site_private.create_payload(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION site_api.create_site(jsonb) OWNER TO ecv_s3_command_writer;
REVOKE ALL ON FUNCTION site_api.create_site(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_api.create_site(jsonb) TO authenticated;
ALTER FUNCTION site_api.read_create_operation(jsonb) OWNER TO ecv_s3_command_writer;
REVOKE ALL ON FUNCTION site_api.read_create_operation(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_api.read_create_operation(jsonb) TO authenticated;
ALTER FUNCTION site_api.get_my_site() OWNER TO ecv_s3_command_writer;
REVOKE ALL ON FUNCTION site_api.get_my_site() FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_api.get_my_site() TO authenticated;
ALTER FUNCTION site_api.read_introduction(uuid) OWNER TO ecv_s3_command_writer;
REVOKE ALL ON FUNCTION site_api.read_introduction(uuid) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_api.read_introduction(uuid) TO authenticated;

DO $created_acl$
BEGIN
 IF EXISTS(SELECT FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid=ANY(ARRAY['site_private.create_payload(jsonb)'::pg_catalog.regprocedure::oid,'site_api.create_site(jsonb)'::pg_catalog.regprocedure::oid,'site_api.read_create_operation(jsonb)'::pg_catalog.regprocedure::oid,'site_api.get_my_site()'::pg_catalog.regprocedure::oid,'site_api.read_introduction(uuid)'::pg_catalog.regprocedure::oid]) AND a.grantee<>p.proowner
   AND NOT(a.privilege_type='EXECUTE' AND NOT a.is_grantable AND ((p.oid='site_api.create_site(jsonb)'::pg_catalog.regprocedure AND a.grantee IN ('authenticated'::pg_catalog.regrole)) OR (p.oid='site_api.read_create_operation(jsonb)'::pg_catalog.regprocedure AND a.grantee IN ('authenticated'::pg_catalog.regrole)) OR (p.oid='site_api.get_my_site()'::pg_catalog.regprocedure AND a.grantee IN ('authenticated'::pg_catalog.regrole)) OR (p.oid='site_api.read_introduction(uuid)'::pg_catalog.regprocedure AND a.grantee IN ('authenticated'::pg_catalog.regrole))))) THEN
  RAISE EXCEPTION 'S3B unexpected creator/default function ACL'; END IF;
END;
$created_acl$;
REVOKE CREATE ON SCHEMA site_private, site_api FROM ecv_s3_command_writer;
REVOKE ecv_s3_owner, ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;
DO $role_boundary$
DECLARE
 deployer constant oid := 'postgres'::pg_catalog.regrole;
 bootstrap constant oid := 10; -- PostgreSQL 17 BOOTSTRAP_SUPERUSERID
 internal_roles constant oid[] := ARRAY['ecv_s3_owner'::pg_catalog.regrole::oid,
                                         'ecv_s3_integrity'::pg_catalog.regrole::oid,'ecv_s3_authz_reader'::pg_catalog.regrole::oid, 'ecv_s3_grant_writer'::pg_catalog.regrole::oid, 'ecv_s3_command_writer'::pg_catalog.regrole::oid];
BEGIN
 IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles
                WHERE oid = bootstrap AND rolname = 'supabase_admin' AND rolsuper) THEN
  RAISE EXCEPTION 'S3 bootstrap grantor mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles
     WHERE oid = ANY(internal_roles) AND NOT rolcanlogin AND NOT rolsuper
       AND NOT rolbypassrls AND NOT rolinherit AND NOT rolcreaterole
       AND NOT rolcreatedb AND NOT rolreplication) <> 5 THEN
  RAISE EXCEPTION 'S3 internal role attributes mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_auth_members
     WHERE roleid = ANY(internal_roles) OR member = ANY(internal_roles)) <> 5
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members
        WHERE roleid = ANY(internal_roles) AND member = deployer
          AND grantor = bootstrap AND admin_option AND NOT set_option AND NOT inherit_option) <> 5 THEN
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
COMMIT;
