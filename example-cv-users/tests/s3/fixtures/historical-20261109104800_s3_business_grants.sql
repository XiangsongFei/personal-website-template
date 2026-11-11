-- CANDIDATE / NOT EXECUTED. Local fictional target only; never a production rollout.
-- M1/M2 are immutable prerequisites. Empty keyring + enabled=false => DENY.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL createrole_self_grant = '';
DO $preflight$
BEGIN
 IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolcreaterole)
    OR pg_catalog.to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
    OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
  RAISE EXCEPTION 'S3B deployment/pgcrypto prerequisite missing';
 END IF;
 -- Narrow, explicitly approved postgres-owned Auth bridge; no Auth re-grants.
 -- Existing postgres BYPASSRLS is observed, never created/altered here.
 IF NOT pg_catalog.has_schema_privilege(current_user,'auth','USAGE')
    OR NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='postgres' AND rolbypassrls)
    OR NOT pg_catalog.has_column_privilege(current_user,'auth.users','id','SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user,'auth.users','email_confirmed_at','SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user,'auth.users','banned_until','SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user,'auth.users','is_anonymous','SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user,'auth.sessions','id','SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user,'auth.sessions','user_id','SELECT')
    OR NOT pg_catalog.has_column_privilege(current_user,'auth.sessions','not_after','SELECT') THEN
  RAISE EXCEPTION 'S3B narrow Auth bridge capability NOT VERIFIED';
 END IF;
END;
$preflight$;
-- ROLE_BOUNDARY_BEFORE is expanded below from the already-reviewed PG17 guard.
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
CREATE ROLE ecv_s3_authz_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ecv_s3_grant_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ecv_s3_command_writer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT ecv_s3_owner, ecv_s3_authz_reader, ecv_s3_grant_writer, ecv_s3_command_writer
 TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
GRANT USAGE ON SCHEMA site_private, site_data TO ecv_s3_authz_reader;
GRANT USAGE ON SCHEMA site_private, site_data, site_api, extensions TO ecv_s3_grant_writer;
GRANT USAGE ON SCHEMA site_private, site_data, site_api, extensions TO ecv_s3_command_writer;
-- No Auth definition, policy, owner, session row or platform role is modified.
ALTER TABLE site_private.user_security_state ADD COLUMN hold_reason text NOT NULL DEFAULT 'unclassified'
 CHECK (hold_reason IN ('none','unclassified','administrative','password_change','recovery'));
ALTER TABLE site_private.grant_proofs ADD COLUMN proof_fingerprint text
 CHECK (proof_fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE site_private.grant_proofs ADD COLUMN grant_result jsonb CHECK (jsonb_typeof(grant_result)='object');
CREATE TABLE site_private.business_runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 project_ref text NOT NULL CHECK (project_ref='ecv-s33a-20261109-7dd22a81'),
 auth_issuer text NOT NULL CHECK (auth_issuer='http://127.0.0.1:56321/auth/v1'),
 enabled boolean NOT NULL DEFAULT false,
 proof_verifier_ready boolean NOT NULL DEFAULT false CHECK (NOT proof_verifier_ready)
);
INSERT INTO site_private.business_runtime(singleton,project_ref,auth_issuer,enabled)
 VALUES(true,'ecv-s33a-20261109-7dd22a81','http://127.0.0.1:56321/auth/v1',false);
CREATE TABLE site_private.business_proof_keys (
 key_id text PRIMARY KEY CHECK (key_id ~ '^[a-zA-Z0-9_-]{1,40}$'),
 key_bytes bytea NOT NULL CHECK (octet_length(key_bytes)=32),
 not_before timestamptz NOT NULL, sign_until timestamptz NOT NULL,
 verify_until timestamptz NOT NULL, revoked_at timestamptz,
 CHECK (not_before < sign_until AND sign_until <= verify_until)
);
-- NO key INSERT and NO enablement. Test-only provisioning requires a separate approval.
ALTER TABLE site_private.business_runtime OWNER TO ecv_s3_owner;
ALTER TABLE site_private.business_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.business_runtime FORCE ROW LEVEL SECURITY;
ALTER TABLE site_private.business_proof_keys OWNER TO ecv_s3_owner;
ALTER TABLE site_private.business_proof_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.business_proof_keys FORCE ROW LEVEL SECURITY;
REVOKE ALL ON site_private.business_runtime, site_private.business_proof_keys
 FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT SELECT ON site_private.business_runtime TO ecv_s3_authz_reader, ecv_s3_grant_writer;
CREATE POLICY business_config_reader ON site_private.business_runtime FOR SELECT
 TO ecv_s3_authz_reader, ecv_s3_grant_writer USING (true);
GRANT SELECT ON site_private.business_proof_keys TO ecv_s3_grant_writer;
CREATE POLICY proof_key_reader ON site_private.business_proof_keys FOR SELECT TO ecv_s3_grant_writer USING (true);
GRANT SELECT ON site_private.user_security_state, site_private.business_session_grants TO ecv_s3_authz_reader;
GRANT SELECT ON site_data.sites, site_data.site_members TO ecv_s3_authz_reader;
GRANT CREATE ON SCHEMA site_private TO ecv_s3_authz_reader, ecv_s3_grant_writer;
GRANT CREATE ON SCHEMA site_api TO ecv_s3_grant_writer;

CREATE FUNCTION site_private.auth_source_identity() RETURNS TABLE(uid uuid, sid uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c jsonb; u uuid; s uuid;
BEGIN
 -- Only the trusted PostgREST authenticator may establish this request context.
 -- SQL/GUC simulation by postgres or an authenticated DB login is NOT a JWT.
 IF session_user<>'authenticator' OR pg_catalog.current_setting('role',true) IS DISTINCT FROM 'authenticated' THEN
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
CREATE FUNCTION site_private.business_identity() RETURNS TABLE(uid uuid, sid uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND enabled) THEN
  RAISE EXCEPTION 'NOT_CONFIGURED' USING ERRCODE='PT503'; END IF;
 RETURN QUERY SELECT a.uid,a.sid FROM site_private.auth_source_identity() a;
END;
$fn$;
CREATE FUNCTION site_private.request_uid() RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT x.uid FROM site_private.business_identity() x;
$fn$;
CREATE FUNCTION site_private.business_qualified() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record;
BEGIN
 SELECT * INTO STRICT who FROM site_private.business_identity();
 RETURN EXISTS (SELECT FROM site_private.user_security_state s JOIN site_private.business_session_grants g
  ON g.auth_user_id=s.auth_user_id AND g.security_epoch=s.security_epoch
  WHERE s.auth_user_id=who.uid AND s.business_enabled AND NOT s.security_hold AND s.hold_reason='none'
    AND g.auth_session_id=who.sid AND g.purpose='business' AND g.revoked_at IS NULL
    AND g.issued_at<=pg_catalog.clock_timestamp() AND g.last_renewed_at<=pg_catalog.clock_timestamp()
    AND g.expires_at>pg_catalog.clock_timestamp() AND g.absolute_expires_at>pg_catalog.clock_timestamp());
END;
$fn$;
CREATE FUNCTION site_private.business_site_owned(target uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT FROM site_data.sites s WHERE s.id=target AND s.owner_auth_user_id=site_private.request_uid() AND s.status='active');
$fn$;
CREATE FUNCTION site_private.business_site_complete(target uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $fn$
 SELECT site_private.business_site_owned(target) AND EXISTS(SELECT FROM site_data.site_members m
  WHERE m.site_id=target AND m.auth_user_id=site_private.request_uid() AND m.role='owner' AND m.state='active');
$fn$;
CREATE FUNCTION site_private.lock_business_qualification() RETURNS TABLE(uid uuid,sid uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; security site_private.user_security_state%ROWTYPE;
BEGIN
 SELECT * INTO STRICT who FROM site_private.business_identity();
 SELECT * INTO security FROM site_private.user_security_state s WHERE s.auth_user_id=who.uid FOR UPDATE;
 IF NOT FOUND OR NOT site_private.business_qualified() THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT who.uid::uuid,who.sid::uuid;
END;
$fn$;

CREATE FUNCTION site_private.verify_business_proof(envelope jsonb, caller_uid uuid, caller_sid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE p jsonb; key site_private.business_proof_keys%ROWTYPE; t bigint;
 body bytea; expected bytea; provided bytea; different integer:=0; i integer; digest text;
 fields constant text[]:=ARRAY['version','project','action','purpose','uid','session_id','epoch','proof_id','issued_at','expires_at','payload_digest','key_id','event'];
 k text; message text:='ecv.proof.v1'||chr(10);
BEGIN
 IF NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND enabled AND proof_verifier_ready) THEN
  RAISE EXCEPTION 'NATIVE_PROOF_VERIFIER_NOT_CONFIGURED' USING ERRCODE='PT503'; END IF;
 IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR NOT(envelope ?& ARRAY['proof','signature'])
    OR (SELECT count(*) FROM jsonb_object_keys(envelope))<>2 THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 p:=envelope->'proof';
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT(p ?& fields)
    OR (SELECT count(*) FROM jsonb_object_keys(p))<>13 THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 FOREACH k IN ARRAY fields LOOP
  IF jsonb_typeof(p->k) IS DISTINCT FROM CASE WHEN k IN ('version','epoch','issued_at','expires_at') THEN 'number' ELSE 'string' END THEN
   RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 END LOOP;
 IF jsonb_typeof(envelope->'signature') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p->'version' IS DISTINCT FROM '1'::jsonb OR p->>'project' IS DISTINCT FROM 'ecv-s33a-20261109-7dd22a81'
    OR p->>'purpose' IS DISTINCT FROM 'business' OR p->>'action' NOT IN ('issue','renew','revoke')
    OR p->>'uid' IS DISTINCT FROM caller_uid::text OR p->>'session_id' IS DISTINCT FROM caller_sid::text
    OR p->>'event' IS DISTINCT FROM CASE WHEN p->>'action'='issue' THEN 'password-login' ELSE 'account-session' END
    OR coalesce(p->>'proof_id','') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    OR coalesce(p->>'key_id','') !~ '^[a-zA-Z0-9_-]{1,40}$'
    OR coalesce(p->>'payload_digest','') !~ '^[0-9a-f]{64}$'
    OR coalesce(envelope->>'signature','') !~ '^[0-9a-f]{64}$'
    OR coalesce(p->>'epoch','') !~ '^[0-9]{1,16}$'
    OR coalesce(p->>'issued_at','') !~ '^[0-9]{1,12}$'
    OR coalesce(p->>'expires_at','') !~ '^[0-9]{1,12}$' THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF (p->>'epoch')::numeric>9007199254740991 THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 t:=floor(extract(epoch FROM pg_catalog.clock_timestamp()));
 SELECT * INTO key FROM site_private.business_proof_keys x WHERE x.key_id=p->>'key_id';
 IF NOT FOUND OR key.revoked_at IS NOT NULL OR (p->>'issued_at')::bigint>t OR (p->>'expires_at')::bigint<=t
    OR (p->>'expires_at')::bigint<=(p->>'issued_at')::bigint
    OR (p->>'expires_at')::bigint-(p->>'issued_at')::bigint>60
    OR to_timestamp((p->>'issued_at')::bigint)<key.not_before
    OR to_timestamp((p->>'issued_at')::bigint)>=key.sign_until
    OR to_timestamp((p->>'expires_at')::bigint)>key.verify_until THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 -- Fixed ASCII field grammar and order match proof.mjs; no arbitrary JSON serialization.
 digest:=encode(extensions.digest(convert_to('ecv.business_grant.v1'||chr(10)||
   (p->>'action')||chr(10)||(p->>'purpose')||chr(10)||(p->>'uid')||chr(10)||
   (p->>'session_id')||chr(10)||(p->>'epoch')||chr(10),'UTF8'),'sha256'),'hex');
 IF digest IS DISTINCT FROM p->>'payload_digest' THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 FOREACH k IN ARRAY fields LOOP message:=message||(p->>k)||chr(10); END LOOP;
 body:=convert_to(message,'UTF8'); expected:=extensions.hmac(body,key.key_bytes,'sha256');
 provided:=decode(envelope->>'signature','hex');
 -- Fixed 32-iteration comparison; no prefix early exit. This is NOT a proven
 -- constant-time primitive in PL/pgSQL. Production enablement remains forbidden.
 FOR i IN 0..31 LOOP different:=different | (get_byte(expected,i) # get_byte(provided,i)); END LOOP;
 IF different<>0 THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN p;
END;
$fn$;

CREATE FUNCTION site_api.apply_business_grant(envelope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; security site_private.user_security_state%ROWTYPE;
 g site_private.business_session_grants%ROWTYPE; prior site_private.grant_proofs%ROWTYPE;
 p jsonb; t timestamptz; fingerprint text; result jsonb; new_expiry timestamptz;
BEGIN
 SELECT * INTO STRICT who FROM site_private.business_identity();
 IF envelope->'proof'->>'action'='issue' THEN
  INSERT INTO site_private.user_security_state(auth_user_id,business_enabled,security_hold,hold_reason)
   VALUES(who.uid,true,false,'none') ON CONFLICT(auth_user_id) DO NOTHING;
 END IF;
 SELECT * INTO security FROM site_private.user_security_state s WHERE s.auth_user_id=who.uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT who FROM site_private.business_identity();
 -- Validate time/signature AFTER any lock wait, not at transaction start.
 p:=site_private.verify_business_proof(envelope,who.uid,who.sid);
 IF (p->>'epoch')::bigint<>security.security_epoch THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p->>'action'<>'revoke' AND (NOT security.business_enabled OR security.security_hold OR security.hold_reason<>'none') THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 fingerprint:=encode(extensions.digest(convert_to(envelope::text,'UTF8'),'sha256'),'hex');
 SELECT * INTO prior FROM site_private.grant_proofs x WHERE x.proof_id=(p->>'proof_id')::uuid;
 IF FOUND THEN
  IF prior.proof_fingerprint IS DISTINCT FROM fingerprint OR prior.consumed_at IS NULL OR prior.grant_result IS NULL
     OR (p->>'action'<>'revoke' AND NOT site_private.business_qualified()) THEN
   RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN prior.grant_result;
 END IF;
 SELECT * INTO g FROM site_private.business_session_grants x
  WHERE x.auth_user_id=who.uid AND x.auth_session_id=who.sid FOR UPDATE;
 t:=pg_catalog.clock_timestamp();
 IF p->>'action'='issue' THEN
  IF FOUND THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  INSERT INTO site_private.business_session_grants(auth_user_id,auth_session_id,security_epoch,purpose,
    issued_at,last_renewed_at,expires_at,absolute_expires_at,issuer_version)
   VALUES(who.uid,who.sid,security.security_epoch,'business',t,t,t+interval '30 minutes',t+interval '12 hours','s33b-candidate-v1') RETURNING * INTO g;
 ELSIF p->>'action'='renew' THEN
  IF NOT FOUND OR g.revoked_at IS NOT NULL OR g.security_epoch<>security.security_epoch OR g.expires_at<=t OR g.absolute_expires_at<=t THEN
   RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  new_expiry:=least(t+interval '30 minutes',g.absolute_expires_at);
  UPDATE site_private.business_session_grants SET last_renewed_at=t,expires_at=new_expiry WHERE id=g.id RETURNING * INTO g;
 ELSE
  IF NOT FOUND OR g.security_epoch<>security.security_epoch THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  IF g.revoked_at IS NULL THEN
   UPDATE site_private.business_session_grants SET revoked_at=t,reason='user_logout' WHERE id=g.id RETURNING * INTO g;
  END IF;
 END IF;
 result:=jsonb_build_object('grant_id',g.id,'status',CASE WHEN g.revoked_at IS NULL THEN 'active' ELSE 'revoked' END,'expires_at',g.expires_at);
 IF pg_catalog.clock_timestamp()>=to_timestamp((p->>'expires_at')::bigint) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO site_private.grant_proofs(proof_id,project_ref,auth_user_id,auth_session_id,action,security_epoch,request_digest,
   issued_at,expires_at,consumed_at,key_id,proof_fingerprint,grant_result)
  VALUES((p->>'proof_id')::uuid,p->>'project',who.uid,who.sid,p->>'action',security.security_epoch,p->>'payload_digest',
   to_timestamp((p->>'issued_at')::bigint),to_timestamp((p->>'expires_at')::bigint),pg_catalog.clock_timestamp(),p->>'key_id',fingerprint,result);
 RETURN result;
END;
$fn$;
CREATE FUNCTION site_private.guard_business_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF ROW(NEW.id,NEW.auth_user_id,NEW.auth_session_id,NEW.security_epoch,NEW.purpose,NEW.issued_at,NEW.absolute_expires_at,NEW.issuer_version)
    IS DISTINCT FROM ROW(OLD.id,OLD.auth_user_id,OLD.auth_session_id,OLD.security_epoch,OLD.purpose,OLD.issued_at,OLD.absolute_expires_at,OLD.issuer_version)
    OR OLD.revoked_at IS NOT NULL OR NEW.expires_at<OLD.expires_at OR NEW.last_renewed_at<OLD.last_renewed_at
    OR (OLD.expires_at<=pg_catalog.clock_timestamp() AND ROW(NEW.expires_at,NEW.last_renewed_at) IS DISTINCT FROM ROW(OLD.expires_at,OLD.last_renewed_at)) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE POLICY authz_state_read ON site_private.user_security_state FOR SELECT TO ecv_s3_authz_reader USING (auth_user_id=site_private.request_uid());
CREATE POLICY authz_grant_read ON site_private.business_session_grants FOR SELECT TO ecv_s3_authz_reader USING (auth_user_id=site_private.request_uid());
CREATE POLICY authz_site_read ON site_data.sites FOR SELECT TO ecv_s3_authz_reader USING (owner_auth_user_id=site_private.request_uid());
CREATE POLICY authz_member_read ON site_data.site_members FOR SELECT TO ecv_s3_authz_reader USING (auth_user_id=site_private.request_uid());
GRANT SELECT, INSERT ON site_private.user_security_state TO ecv_s3_grant_writer;
-- A row lock requires UPDATE authority. This is not given to command_writer.
GRANT UPDATE(security_epoch) ON site_private.user_security_state TO ecv_s3_grant_writer;
GRANT SELECT, INSERT ON site_private.business_session_grants, site_private.grant_proofs TO ecv_s3_grant_writer;
GRANT UPDATE(last_renewed_at,expires_at,revoked_at,reason) ON site_private.business_session_grants TO ecv_s3_grant_writer;
CREATE POLICY grant_state_read ON site_private.user_security_state FOR SELECT TO ecv_s3_grant_writer USING (auth_user_id=site_private.request_uid());
CREATE POLICY grant_state_insert ON site_private.user_security_state FOR INSERT TO ecv_s3_grant_writer
 WITH CHECK (auth_user_id=site_private.request_uid() AND security_epoch=0 AND business_enabled AND NOT security_hold AND hold_reason='none');
CREATE POLICY grant_state_lock ON site_private.user_security_state FOR UPDATE TO ecv_s3_grant_writer
 USING (auth_user_id=site_private.request_uid()) WITH CHECK (auth_user_id=site_private.request_uid());
CREATE POLICY grants_read ON site_private.business_session_grants FOR SELECT TO ecv_s3_grant_writer USING (auth_user_id=site_private.request_uid());
CREATE POLICY grants_insert ON site_private.business_session_grants FOR INSERT TO ecv_s3_grant_writer WITH CHECK (auth_user_id=site_private.request_uid());
CREATE POLICY grants_update ON site_private.business_session_grants FOR UPDATE TO ecv_s3_grant_writer
 USING (auth_user_id=site_private.request_uid()) WITH CHECK (auth_user_id=site_private.request_uid());
CREATE POLICY proofs_read ON site_private.grant_proofs FOR SELECT TO ecv_s3_grant_writer USING (auth_user_id=site_private.request_uid());
CREATE POLICY proofs_insert ON site_private.grant_proofs FOR INSERT TO ecv_s3_grant_writer
 WITH CHECK (auth_user_id=site_private.request_uid() AND consumed_at IS NOT NULL AND proof_fingerprint IS NOT NULL AND grant_result IS NOT NULL);
CREATE TRIGGER business_grant_guard BEFORE UPDATE ON site_private.business_session_grants
 FOR EACH ROW EXECUTE FUNCTION site_private.guard_business_grant();
CREATE TRIGGER proof_append_only BEFORE UPDATE OR DELETE ON site_private.grant_proofs
 FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();
SET LOCAL ROLE ecv_s3_authz_reader;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;
SET LOCAL ROLE ecv_s3_grant_writer;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;
SET LOCAL ROLE ecv_s3_command_writer;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;
-- The ONLY postgres-owned definer: fixed Auth reads, no business DML, no args.
ALTER FUNCTION site_private.auth_source_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION site_private.auth_source_identity() FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.auth_source_identity() TO ecv_s3_authz_reader;
ALTER FUNCTION site_private.request_uid() OWNER TO ecv_s3_authz_reader;
REVOKE ALL ON FUNCTION site_private.request_uid() FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.request_uid() TO ecv_s3_grant_writer,ecv_s3_command_writer;
ALTER FUNCTION site_private.business_identity() OWNER TO ecv_s3_authz_reader;
REVOKE ALL ON FUNCTION site_private.business_identity() FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.business_identity() TO ecv_s3_grant_writer,ecv_s3_command_writer;
ALTER FUNCTION site_private.business_qualified() OWNER TO ecv_s3_authz_reader;
REVOKE ALL ON FUNCTION site_private.business_qualified() FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.business_qualified() TO ecv_s3_grant_writer,ecv_s3_command_writer;
ALTER FUNCTION site_private.business_site_owned(uuid) OWNER TO ecv_s3_authz_reader;
REVOKE ALL ON FUNCTION site_private.business_site_owned(uuid) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.business_site_owned(uuid) TO ecv_s3_command_writer;
ALTER FUNCTION site_private.business_site_complete(uuid) OWNER TO ecv_s3_authz_reader;
REVOKE ALL ON FUNCTION site_private.business_site_complete(uuid) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.business_site_complete(uuid) TO ecv_s3_command_writer;
ALTER FUNCTION site_private.lock_business_qualification() OWNER TO ecv_s3_grant_writer;
REVOKE ALL ON FUNCTION site_private.lock_business_qualification() FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.lock_business_qualification() TO ecv_s3_command_writer;
ALTER FUNCTION site_private.verify_business_proof(jsonb,uuid,uuid) OWNER TO ecv_s3_grant_writer;
REVOKE ALL ON FUNCTION site_private.verify_business_proof(jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION site_private.guard_business_grant() OWNER TO ecv_s3_owner;
REVOKE ALL ON FUNCTION site_private.guard_business_grant() FROM PUBLIC,anon,authenticated,authenticator,service_role;
ALTER FUNCTION site_api.apply_business_grant(jsonb) OWNER TO ecv_s3_grant_writer;
REVOKE ALL ON FUNCTION site_api.apply_business_grant(jsonb) FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_api.apply_business_grant(jsonb) TO authenticated;
GRANT USAGE ON SCHEMA site_api TO authenticated;

DO $created_acl$
BEGIN
 IF EXISTS(SELECT FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid=ANY(ARRAY['site_private.auth_source_identity()'::pg_catalog.regprocedure::oid,'site_private.request_uid()'::pg_catalog.regprocedure::oid,'site_private.business_identity()'::pg_catalog.regprocedure::oid,'site_private.business_qualified()'::pg_catalog.regprocedure::oid,'site_private.business_site_owned(uuid)'::pg_catalog.regprocedure::oid,'site_private.business_site_complete(uuid)'::pg_catalog.regprocedure::oid,'site_private.lock_business_qualification()'::pg_catalog.regprocedure::oid,'site_private.verify_business_proof(jsonb,uuid,uuid)'::pg_catalog.regprocedure::oid,'site_private.guard_business_grant()'::pg_catalog.regprocedure::oid,'site_api.apply_business_grant(jsonb)'::pg_catalog.regprocedure::oid]) AND a.grantee<>p.proowner
   AND NOT(a.privilege_type='EXECUTE' AND NOT a.is_grantable AND ((p.oid='site_private.auth_source_identity()'::pg_catalog.regprocedure AND a.grantee='ecv_s3_authz_reader'::pg_catalog.regrole) OR (p.oid='site_private.request_uid()'::pg_catalog.regprocedure AND a.grantee IN ('ecv_s3_grant_writer'::pg_catalog.regrole,'ecv_s3_command_writer'::pg_catalog.regrole)) OR (p.oid='site_private.business_identity()'::pg_catalog.regprocedure AND a.grantee IN ('ecv_s3_grant_writer'::pg_catalog.regrole,'ecv_s3_command_writer'::pg_catalog.regrole)) OR (p.oid='site_private.business_qualified()'::pg_catalog.regprocedure AND a.grantee IN ('ecv_s3_grant_writer'::pg_catalog.regrole,'ecv_s3_command_writer'::pg_catalog.regrole)) OR (p.oid='site_private.business_site_owned(uuid)'::pg_catalog.regprocedure AND a.grantee IN ('ecv_s3_command_writer'::pg_catalog.regrole)) OR (p.oid='site_private.business_site_complete(uuid)'::pg_catalog.regprocedure AND a.grantee IN ('ecv_s3_command_writer'::pg_catalog.regrole)) OR (p.oid='site_private.lock_business_qualification()'::pg_catalog.regprocedure AND a.grantee IN ('ecv_s3_command_writer'::pg_catalog.regrole)) OR (p.oid='site_api.apply_business_grant(jsonb)'::pg_catalog.regprocedure AND a.grantee IN ('authenticated'::pg_catalog.regrole))))) THEN
  RAISE EXCEPTION 'S3B unexpected creator/default function ACL'; END IF;
 IF EXISTS(SELECT FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
  WHERE n.nspname='site_private' AND c.relname IN ('business_runtime','business_proof_keys') AND a.grantee<>c.relowner
   AND NOT(a.privilege_type='SELECT' AND NOT a.is_grantable AND
    (a.grantee='ecv_s3_grant_writer'::regrole OR (c.relname='business_runtime' AND a.grantee='ecv_s3_authz_reader'::regrole)))) THEN
  RAISE EXCEPTION 'S3B unexpected creator/default table ACL'; END IF;
END;
$created_acl$;
REVOKE CREATE ON SCHEMA site_private FROM ecv_s3_authz_reader, ecv_s3_grant_writer;
REVOKE CREATE ON SCHEMA site_api FROM ecv_s3_grant_writer;
REVOKE ecv_s3_owner, ecv_s3_authz_reader, ecv_s3_grant_writer, ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;
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
