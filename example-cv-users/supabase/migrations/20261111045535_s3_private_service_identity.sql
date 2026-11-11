-- M7 candidate. Requires the exact M1–M6 catalog with both service accounts closed.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $closed$
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'postgres' OR current_database() <> 'postgres'
    OR current_setting('server_version_num') <> '170011' OR EXISTS (
      SELECT FROM pg_roles WHERE rolname='postgres' AND rolsuper)
    OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('ecv_s3_internal_api_login','ecv_s3_registration_login')
      AND NOT (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication OR rolinherit)) <> 2
    OR EXISTS (SELECT FROM pg_auth_members WHERE member='postgres'::regrole
      AND roleid IN ('ecv_s3_owner'::regrole,'ecv_s3_grant_writer'::regrole)
      AND (inherit_option OR set_option OR grantor<>10::oid)) THEN
  RAISE EXCEPTION 'M7 closed installation identity mismatch';
 END IF;
 IF EXISTS (
   WITH allowed(roleid,member,grantor,admin_option,inherit_option,set_option) AS (VALUES
     ('authenticated'::regrole::oid,'ecv_s3_internal_api_login'::regrole::oid,'postgres'::regrole::oid,false,false,true),
     ('ecv_s3_proof_registrar'::regrole::oid,'ecv_s3_registration_login'::regrole::oid,'postgres'::regrole::oid,false,true,false),
     ('ecv_s3_internal_api_login'::regrole::oid,'postgres'::regrole::oid,10::oid,true,false,false),
     ('ecv_s3_registration_login'::regrole::oid,'postgres'::regrole::oid,10::oid,true,false,false)
   ), actual AS (
     SELECT roleid,member,grantor,admin_option,inherit_option,set_option FROM pg_auth_members
      WHERE roleid IN ('ecv_s3_internal_api_login'::regrole,'ecv_s3_registration_login'::regrole)
         OR member IN ('ecv_s3_internal_api_login'::regrole,'ecv_s3_registration_login'::regrole)
   ) (SELECT * FROM allowed EXCEPT SELECT * FROM actual)
     UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM allowed)
 ) THEN RAISE EXCEPTION 'Unexpected service membership'; END IF;
END;
$closed$;
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_proc WHERE oid='site_private.auth_source_identity()'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='7db3478abab4eeb6dd991ee232299899b4565d772bee0534c8dbdcb99199e329') THEN
  RAISE EXCEPTION 'Unexpected before definition of auth_source_identity()';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_proc WHERE oid='site_private.register_business_ticket(jsonb)'::regprocedure
    AND proowner='ecv_s3_grant_writer'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='66cf2798c1a703b9d3b3f37cc7dcabc022f7c123fea59df7f4087c9dcfea45c0') THEN
  RAISE EXCEPTION 'Unexpected before definition of register_business_ticket(jsonb)';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_policy WHERE polrelid='site_private.registered_business_tickets'::regclass
    AND polname='registration_insert' AND polcmd='a' AND polpermissive
    AND polroles=ARRAY['ecv_s3_grant_writer'::regrole::oid] AND polqual IS NULL
    AND pg_get_expr(polwithcheck,polrelid)=$expr$((SESSION_USER = 'ecv_s3_proof_registrar'::name) AND (current_setting('role'::text) = 'none'::text))$expr$) THEN
  RAISE EXCEPTION 'Unexpected before registration policy';
 END IF;
END;
$guard$;
-- Bootstrap ADMIN permits these grantor-specific transaction-local deployment edges.
GRANT ecv_s3_owner, ecv_s3_grant_writer TO postgres
 WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
DO $runtime$
BEGIN
 IF (SELECT count(*) FROM site_private.business_runtime) <> 1
   OR NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton AND NOT enabled
       AND NOT proof_verifier_ready AND project_ref='ecv-s33a-20261109-7dd22a81'
       AND auth_issuer='http://127.0.0.1:56321/auth/v1') THEN
  RAISE EXCEPTION 'M7 requires the approved closed project';
 END IF;
END;
$runtime$;

CREATE OR REPLACE FUNCTION site_private.auth_source_identity() RETURNS TABLE(uid uuid, sid uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c jsonb; u uuid; s uuid;
BEGIN
 -- Only the dedicated internal PostgREST login may establish this request context.
 -- SQL/GUC simulation by postgres or an authenticated DB login is NOT a JWT.
 IF session_user<>'ecv_s3_internal_api_login' OR pg_catalog.current_setting('role',true) IS DISTINCT FROM 'authenticated' THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 BEGIN
  c:=nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END;
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF c->>'iss' IS DISTINCT FROM 'http://127.0.0.1:56321/auth/v1' OR c->>'aud' IS DISTINCT FROM 'authenticated'
    OR c->>'role' IS DISTINCT FROM 'authenticated' OR c->'is_anonymous' IS DISTINCT FROM 'false'::jsonb
    OR coalesce(c->>'sub','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR coalesce(c->>'session_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR coalesce(c->>'exp','') !~ '^[0-9]{1,12}$' THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 u:=(c->>'sub')::uuid; s:=(c->>'session_id')::uuid;
 IF jsonb_typeof(c->'amr') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(c->'amr') AS entry(value) WHERE value->>'method'='password')
    OR EXISTS(SELECT FROM jsonb_array_elements(c->'amr') AS entry(value) WHERE value->>'method' IN ('otp','recovery')) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF (c->>'exp')::bigint <= extract(epoch FROM pg_catalog.clock_timestamp())
    OR NOT EXISTS (SELECT FROM auth.users a WHERE a.id=u AND a.email_confirmed_at IS NOT NULL
      AND NOT a.is_anonymous AND (a.banned_until IS NULL OR a.banned_until<=pg_catalog.clock_timestamp()))
    OR NOT EXISTS (SELECT FROM auth.sessions a WHERE a.id=s AND a.user_id=u
      AND (a.not_after IS NULL OR a.not_after>pg_catalog.clock_timestamp())) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT u,s;
END;
$fn$;

CREATE OR REPLACE FUNCTION site_private.register_business_ticket(p jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF session_user<>'ecv_s3_registration_login' OR current_setting('role') IS DISTINCT FROM 'none' THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 PERFORM site_private.check_ticket_claims(p);
 INSERT INTO site_private.registered_business_tickets(proof_id,auth_user_id,auth_session_id,key_id,proof)
 VALUES((p->>'proof_id')::uuid,(p->>'uid')::uuid,(p->>'session_id')::uuid,p->>'key_id',p);
 -- A competing registration may have held the unique index until it rolled back.
 PERFORM site_private.check_ticket_claims(p);
 RETURN true;
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'TICKET_ALREADY_REGISTERED' USING ERRCODE='PT409';
END;
$fn$;
ALTER POLICY registration_insert ON site_private.registered_business_tickets
 WITH CHECK (session_user='ecv_s3_registration_login' AND current_setting('role')='none');
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT FROM pg_proc WHERE oid='site_private.auth_source_identity()'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='ce226469471a5b2ac60ac1af7bcdf33caf76187fd43d56c18ac5d83b0d3b385c') THEN
  RAISE EXCEPTION 'Unexpected after definition of auth_source_identity()';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_proc WHERE oid='site_private.register_business_ticket(jsonb)'::regprocedure
    AND proowner='ecv_s3_grant_writer'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='ed7c5f6e2fa40c6f51966fe705ba20b1325a8536f1b67ab14a7c3c04f87e1064') THEN
  RAISE EXCEPTION 'Unexpected after definition of register_business_ticket(jsonb)';
 END IF;
 IF NOT EXISTS (SELECT FROM pg_policy WHERE polrelid='site_private.registered_business_tickets'::regclass
    AND polname='registration_insert' AND polcmd='a' AND polpermissive
    AND polroles=ARRAY['ecv_s3_grant_writer'::regrole::oid] AND polqual IS NULL
    AND pg_get_expr(polwithcheck,polrelid)=$expr$((SESSION_USER = 'ecv_s3_registration_login'::name) AND (current_setting('role'::text) = 'none'::text))$expr$) THEN
  RAISE EXCEPTION 'Unexpected after registration policy';
 END IF;
END;
$guard$;
REVOKE ecv_s3_owner, ecv_s3_grant_writer FROM postgres GRANTED BY postgres RESTRICT;
DO $cleanup$
BEGIN
 IF EXISTS (SELECT FROM pg_auth_members WHERE member='postgres'::regrole
    AND roleid IN ('ecv_s3_owner'::regrole,'ecv_s3_grant_writer'::regrole)
    AND (grantor<>10::oid OR NOT admin_option OR inherit_option OR set_option)) THEN
  RAISE EXCEPTION 'Unexpected deployment membership';
 END IF;
END;
$cleanup$;
COMMIT;
