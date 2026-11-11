-- B1: only the new physical clean cluster; no historical migration editing.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>current_user
  OR current_setting('server_version_num')<>'170011' OR current_setting('ssl')<>'on'
  OR EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN RAISE EXCEPTION 'B1 target identity'; END IF;
 IF (SELECT count(*) FROM site_private.business_runtime)<>1 OR NOT EXISTS(SELECT FROM site_private.business_runtime
   WHERE singleton AND NOT enabled AND NOT proof_verifier_ready AND project_ref='ecv-s33a-20261109-7dd22a81' AND auth_issuer='http://127.0.0.1:56321/auth/v1')
  OR EXISTS(SELECT FROM site_private.registered_business_tickets) OR EXISTS(SELECT FROM site_private.proof_generations)
  OR EXISTS(SELECT FROM site_private.business_session_grants) OR EXISTS(SELECT FROM site_private.grant_proofs)
  OR EXISTS(SELECT FROM site_private.business_proof_keys) THEN RAISE EXCEPTION 'B1 closed baseline'; END IF;
 IF encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='site_private.auth_source_identity()'::regprocedure),'UTF8')),'hex')<>'ce226469471a5b2ac60ac1af7bcdf33caf76187fd43d56c18ac5d83b0d3b385c'
  OR encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='site_private.check_ticket_claims(jsonb)'::regprocedure),'UTF8')),'hex')<>'d02ff32f8978a8f1f50f3a1915b122e06b06aecf1c0d558d3d383deb055df897' THEN RAISE EXCEPTION 'B1 before source'; END IF;
END;
$guard$;
GRANT ecv_s3_owner,ecv_s3_grant_writer TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
ALTER TABLE site_private.business_runtime DROP CONSTRAINT business_runtime_project_ref_check;
ALTER TABLE site_private.business_runtime DROP CONSTRAINT business_runtime_auth_issuer_check;
ALTER TABLE site_private.business_runtime ADD CONSTRAINT business_runtime_project_ref_check CHECK(project_ref='ecv-r3-clean-20261111-e449c25f') NOT VALID;
ALTER TABLE site_private.business_runtime ADD CONSTRAINT business_runtime_auth_issuer_check CHECK(auth_issuer='http://gateway.ecv-r3-clean-20261111-e449c25f.internal.test:8000/auth/v1') NOT VALID;
UPDATE site_private.business_runtime SET project_ref='ecv-r3-clean-20261111-e449c25f',auth_issuer='http://gateway.ecv-r3-clean-20261111-e449c25f.internal.test:8000/auth/v1' WHERE singleton AND NOT enabled AND NOT proof_verifier_ready;
ALTER TABLE site_private.business_runtime VALIDATE CONSTRAINT business_runtime_project_ref_check;
ALTER TABLE site_private.business_runtime VALIDATE CONSTRAINT business_runtime_auth_issuer_check;
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
 IF c->>'iss' IS DISTINCT FROM 'http://gateway.ecv-r3-clean-20261111-e449c25f.internal.test:8000/auth/v1' OR c->>'aud' IS DISTINCT FROM 'authenticated'
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
CREATE OR REPLACE FUNCTION site_private.check_ticket_claims(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE
 fields constant text[]:=ARRAY['version','project','action','purpose','uid','session_id','epoch','proof_id',
                               'issued_at','expires_at','payload_digest','key_id','event'];
 field_name text;
 issued bigint;
 expires bigint;
 t timestamptz;
 computed_digest text;
BEGIN
 PERFORM site_private.lock_proof_configuration();
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>2048 THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 IF NOT (p ?& fields) OR (SELECT count(*) FROM jsonb_object_keys(p))<>cardinality(fields) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 FOREACH field_name IN ARRAY fields LOOP
  IF jsonb_typeof(p->field_name) IS DISTINCT FROM
    (CASE WHEN field_name IN ('version','epoch','issued_at','expires_at') THEN 'number' ELSE 'string' END) THEN
   RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
  END IF;
 END LOOP;
 IF p->>'version'<>'1' OR p->>'project'<>'ecv-r3-clean-20261111-e449c25f' OR p->>'purpose'<>'business'
    OR p->>'action' NOT IN ('issue','renew','revoke')
    OR p->>'event'<>(CASE WHEN p->>'action'='issue' THEN 'password-login' ELSE 'account-session' END)
    OR p->>'key_id' !~ '^[a-zA-Z0-9_-]{1,40}$'
    OR p->>'uid' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR p->>'session_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR p->>'proof_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR p->>'epoch' !~ '^[0-9]{1,16}$'
    OR p->>'issued_at' !~ '^[0-9]{1,12}$' OR p->>'expires_at' !~ '^[0-9]{1,12}$' THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 issued:=(p->>'issued_at')::bigint;
 expires:=(p->>'expires_at')::bigint;
 t:=clock_timestamp();
 IF (p->>'epoch')::bigint>9007199254740991 OR expires<=issued OR expires-issued>60
    OR issued>extract(epoch FROM t) OR expires<=extract(epoch FROM t)
    OR NOT EXISTS (SELECT FROM site_private.proof_generations k
       WHERE k.key_id=p->>'key_id' AND k.revoked_at IS NULL AND to_timestamp(issued)>=k.not_before
       AND to_timestamp(issued)<k.sign_until AND to_timestamp(expires)<=k.verify_until) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 computed_digest:=encode(pg_catalog.sha256(convert_to('ecv.business_grant.v1'||chr(10)||
    (p->>'action')||chr(10)||(p->>'purpose')||chr(10)||(p->>'uid')||chr(10)||
    (p->>'session_id')||chr(10)||(p->>'epoch')||chr(10),'UTF8')),'hex');
 IF computed_digest<>p->>'payload_digest' THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
END;
$fn$;
DO $after$
BEGIN
 IF (SELECT count(*) FROM site_private.business_runtime WHERE singleton AND NOT enabled AND NOT proof_verifier_ready AND project_ref='ecv-r3-clean-20261111-e449c25f' AND auth_issuer='http://gateway.ecv-r3-clean-20261111-e449c25f.internal.test:8000/auth/v1')<>1
  OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.business_runtime'::regclass AND conname='business_runtime_proof_verifier_ready_check' AND convalidated AND pg_get_constraintdef(oid)='CHECK ((NOT proof_verifier_ready))')
  OR encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='site_private.auth_source_identity()'::regprocedure),'UTF8')),'hex')<>'794f8b9b8edc04e844f53bd1077f2d78758a8e795a060de8f1aa4680528e4600'
  OR encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid='site_private.check_ticket_claims(jsonb)'::regprocedure),'UTF8')),'hex')<>'c6ff783707d2e360402236bcb4bf41fe26b8407af45d7cc9a295900274cbf014' THEN RAISE EXCEPTION 'B1 after binding'; END IF;
END;
$after$;
REVOKE ecv_s3_owner,ecv_s3_grant_writer FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;
