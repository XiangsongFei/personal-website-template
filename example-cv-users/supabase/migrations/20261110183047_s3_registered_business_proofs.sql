-- M5 candidate. No credential, LOGIN, key metadata, runtime activation or API exposure.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL createrole_self_grant = '';

DO $preflight$
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'postgres'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolcreaterole AND NOT rolsuper)
    OR to_regprocedure('site_api.create_site(jsonb)') IS NULL
    OR NOT current_setting('check_function_bodies')::boolean THEN
  RAISE EXCEPTION 'M5 target mismatch';
 END IF;
 IF EXISTS (SELECT FROM (VALUES
      ('site_api.apply_business_grant(jsonb)','e8635ef5eebe1cb681ee14b3d14041d324f8b55fcaee801c6610bd61dc749c77'),
      ('site_api.create_site(jsonb)','018ada4d6b24342710fe2619f470490a4d253a5e2b626da5b9e649d3f3402fde'),
      ('site_api.get_my_site()','4b842a6e004ea5ba234f2f7a1a17aeeae47171126bf5cd0e6a1a13fa2bc536db'),
      ('site_api.read_create_operation(jsonb)','394a6c6106bdee2a691f05797e4eac339fcfae46732fdd667b8b7acf839ca5e3'),
      ('site_api.read_introduction(uuid)','26c40603f260c707a099b646e73d222fada1740d66ca6493fcebd5c2b572f9f2'),
      ('site_private.assert_site_integrity()','1aa8c6b6dd838b32b863936c13e5b12fcb335f9b20b238dcae24201fd3933654'),
      ('site_private.auth_source_identity()','7db3478abab4eeb6dd991ee232299899b4565d772bee0534c8dbdcb99199e329'),
      ('site_private.business_identity()','1ef8902b880bb2a3c2979daf4207b0704f2db5ca08253f3ad574083882a5b6bb'),
      ('site_private.business_qualified()','beda745cdcb5af018c3561f96b19f611f4be991f096e91ddb58e05373fa5ae05'),
      ('site_private.business_site_complete(uuid)','5870afd7011b08d2cf83ca4c1ab1b2da5dcb5b52fecf81dccb216325576aa469'),
      ('site_private.business_site_owned(uuid)','e3de7aabc72db5c99c78fbe12d42d556642d19899d074ac1f9f7fdab8727ec48'),
      ('site_private.create_payload(jsonb)','06cc2e88f8dc414ab21c823358bc1282ef949e8dffb46cfcebfa1ff2d9cbcb4c'),
      ('site_private.guard_business_grant()','3fa8eb7ad8675b3cebb50f984d6d6e55d2ae07a0c75a84b5e4f659a446f701e4'),
      ('site_private.guard_identity()','48fb0e02527907dc2af659fa5247d353829dddeb06d681b28cdad51d39588323'),
      ('site_private.guard_security_state()','73b661afbb97bad2ff9626e70e6f13ee2b5e841053ab4e8adcb8234133d6b0ed'),
      ('site_private.lock_business_qualification()','06615d63c92689a1f646ea64c6b8e47381bc6a9325b968b8c1bf5c9b16bf824f'),
      ('site_private.reject_mutation()','77f6fdcb68b54c15eb3ad8ccd72d5bd657e656b536ff970886d505786c2bf334'),
      ('site_private.request_uid()','c047de1153332029c1159103240ad3faec15c725bc1f35d05b429d2a140e74b9'),
      ('site_private.verify_business_proof(jsonb,uuid,uuid)','a1814ca04cd10561dfc63fd4d9dbad61b2e4f2c4a5a3b8b47efc3c8ef98b6d7f')
    ) AS expected(signature,digest)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
    WHERE encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IS DISTINCT FROM expected.digest) THEN
  RAISE EXCEPTION 'M5 prerequisite function differs from accepted M3/M4';
 END IF;
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
CREATE ROLE ecv_s3_proof_registrar NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS
 NOCREATEROLE NOCREATEDB NOREPLICATION;
GRANT ecv_s3_owner, ecv_s3_grant_writer, ecv_s3_authz_reader TO postgres
 WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;

DO $closed$
BEGIN
 IF (SELECT count(*) FROM site_private.business_runtime) <> 1
    OR NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton AND NOT enabled
       AND NOT proof_verifier_ready AND project_ref='ecv-s33a-20261109-7dd22a81'
       AND auth_issuer='http://127.0.0.1:56321/auth/v1')
    OR EXISTS (SELECT FROM site_private.business_proof_keys)
    OR EXISTS (SELECT FROM site_private.grant_proofs)
    OR EXISTS (SELECT FROM site_private.business_session_grants) THEN
  RAISE EXCEPTION 'M5 requires the closed, empty M4 proof baseline';
 END IF;
END;
$closed$;

SET LOCAL ROLE ecv_s3_owner;
CREATE TABLE site_private.proof_generations (
 key_id text PRIMARY KEY CHECK (key_id ~ '^[a-zA-Z0-9_-]{1,40}$'),
 not_before timestamptz NOT NULL,
 sign_until timestamptz NOT NULL,
 verify_until timestamptz NOT NULL,
 revoked_at timestamptz,
 CHECK (isfinite(not_before) AND isfinite(sign_until) AND isfinite(verify_until)
        AND not_before < sign_until AND sign_until <= verify_until)
);
CREATE TABLE site_private.registered_business_tickets (
 proof_id uuid PRIMARY KEY,
 auth_user_id uuid NOT NULL,
 auth_session_id uuid NOT NULL,
 key_id text NOT NULL REFERENCES site_private.proof_generations(key_id),
 proof jsonb NOT NULL CHECK (jsonb_typeof(proof)='object')
);
ALTER TABLE site_private.proof_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.proof_generations FORCE ROW LEVEL SECURITY;
ALTER TABLE site_private.registered_business_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.registered_business_tickets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON site_private.proof_generations, site_private.registered_business_tickets
 FROM PUBLIC, anon, authenticated, authenticator, service_role, ecv_s3_proof_registrar;
GRANT SELECT ON site_private.proof_generations TO ecv_s3_grant_writer, ecv_s3_authz_reader;
CREATE POLICY generation_read ON site_private.proof_generations FOR SELECT
 TO ecv_s3_grant_writer, ecv_s3_authz_reader USING (true);
GRANT SELECT, INSERT ON site_private.registered_business_tickets TO ecv_s3_grant_writer;
CREATE POLICY registration_insert ON site_private.registered_business_tickets FOR INSERT
 TO ecv_s3_grant_writer WITH CHECK (session_user='ecv_s3_proof_registrar' AND current_setting('role')='none');
CREATE POLICY registration_read ON site_private.registered_business_tickets FOR SELECT
 TO ecv_s3_grant_writer USING (auth_user_id=site_private.request_uid());

-- Configuration changes serialize with admission and consumption, even when an
-- operator updates metadata directly. Key IDs cannot be reused or unrevoked.
CREATE FUNCTION site_private.guard_proof_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF TG_LEVEL='STATEMENT' THEN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'PROOF_CONFIG_IMMUTABLE'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(3303, 5);
  RETURN NULL;
 END IF;
 IF (NEW.key_id,NEW.not_before,NEW.sign_until,NEW.verify_until)
      IS DISTINCT FROM (OLD.key_id,OLD.not_before,OLD.sign_until,OLD.verify_until)
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
  RAISE EXCEPTION 'PROOF_GENERATION_IMMUTABLE';
 END IF;
 NEW.revoked_at:=pg_catalog.clock_timestamp();
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION site_private.guard_proof_configuration() FROM PUBLIC, anon, authenticated, authenticator, service_role;
CREATE TRIGGER generation_config_lock BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON site_private.proof_generations FOR EACH STATEMENT EXECUTE FUNCTION site_private.guard_proof_configuration();
CREATE TRIGGER runtime_config_lock BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON site_private.business_runtime FOR EACH STATEMENT EXECUTE FUNCTION site_private.guard_proof_configuration();
CREATE TRIGGER generation_revoke_only BEFORE UPDATE ON site_private.proof_generations
 FOR EACH ROW EXECUTE FUNCTION site_private.guard_proof_configuration();
CREATE TRIGGER registration_append_only BEFORE UPDATE OR DELETE ON site_private.registered_business_tickets
 FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();

CREATE TRIGGER registration_no_truncate BEFORE TRUNCATE ON site_private.registered_business_tickets
 FOR EACH STATEMENT EXECUTE FUNCTION site_private.reject_mutation();

-- Keep the M3 physical CHECK (NOT proof_verifier_ready) for this installation.
-- A future, separately approved arm operation must verify these bodies first.
ALTER TABLE site_private.business_runtime ADD CONSTRAINT business_gates_agree
 CHECK (enabled = proof_verifier_ready);
REVOKE SELECT ON site_private.business_proof_keys FROM ecv_s3_grant_writer;
DROP POLICY proof_key_reader ON site_private.business_proof_keys;
-- A new grant must never implicitly release a missing/unknown security hold.
REVOKE INSERT ON site_private.user_security_state FROM ecv_s3_grant_writer;
DROP POLICY grant_state_insert ON site_private.user_security_state;
GRANT USAGE ON SCHEMA site_private TO ecv_s3_proof_registrar;
GRANT CREATE ON SCHEMA site_private TO ecv_s3_grant_writer, ecv_s3_authz_reader;
GRANT CREATE ON SCHEMA site_api TO ecv_s3_grant_writer;
RESET ROLE;
SET LOCAL ROLE ecv_s3_grant_writer;

-- Global configuration fence, then per-user security state, grant, receipt.
-- VOLATILE functions get a fresh READ COMMITTED snapshot after a lock wait.
CREATE FUNCTION site_private.lock_proof_configuration() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock_shared(3303, 5);
 IF NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton AND enabled AND proof_verifier_ready) THEN
  RAISE EXCEPTION 'NOT_CONFIGURED' USING ERRCODE='PT503';
 END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION site_private.lock_proof_configuration() FROM PUBLIC,anon,authenticated,authenticator,service_role;

-- Fixed scope. The registrar is an independent PostgreSQL principal, not a JWT
-- role or GUC supplied by a caller. This helper itself does not mint a ticket.
CREATE FUNCTION site_private.check_ticket_claims(p jsonb) RETURNS void
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
 IF p->>'version'<>'1' OR p->>'project'<>'ecv-s33a-20261109-7dd22a81' OR p->>'purpose'<>'business'
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

CREATE FUNCTION site_private.register_business_ticket(p jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF session_user<>'ecv_s3_proof_registrar' OR current_setting('role') IS DISTINCT FROM 'none' THEN
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
REVOKE ALL ON FUNCTION site_private.check_ticket_claims(jsonb), site_private.register_business_ticket(jsonb)
 FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT EXECUTE ON FUNCTION site_private.register_business_ticket(jsonb) TO ecv_s3_proof_registrar;

CREATE OR REPLACE FUNCTION site_private.verify_business_proof(envelope jsonb, caller_uid uuid, caller_sid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE p jsonb;
BEGIN
 IF jsonb_typeof(envelope) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF NOT (envelope ? 'proof') OR (SELECT count(*) FROM jsonb_object_keys(envelope))<>1 THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 p:=envelope->'proof';
 PERFORM site_private.check_ticket_claims(p);
 -- Compare only public, previously verified claims. No signature or MAC is stored.
 IF p->>'uid' IS DISTINCT FROM caller_uid::text OR p->>'session_id' IS DISTINCT FROM caller_sid::text
    OR NOT EXISTS (SELECT FROM site_private.registered_business_tickets r WHERE r.proof_id=(p->>'proof_id')::uuid
                   AND r.auth_user_id=caller_uid AND r.auth_session_id=caller_sid AND r.proof=p) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN p;
END;
$fn$;

CREATE OR REPLACE FUNCTION site_private.lock_business_qualification() RETURNS TABLE(uid uuid,sid uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; security site_private.user_security_state%ROWTYPE;
BEGIN
 PERFORM site_private.lock_proof_configuration();
 SELECT * INTO STRICT who FROM site_private.business_identity();
 SELECT * INTO security FROM site_private.user_security_state s WHERE s.auth_user_id=who.uid FOR UPDATE;
 IF NOT FOUND OR NOT site_private.business_qualified() THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT who.uid::uuid,who.sid::uuid;
END;
$fn$;

CREATE OR REPLACE FUNCTION site_api.apply_business_grant(envelope jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; security site_private.user_security_state%ROWTYPE;
 g site_private.business_session_grants%ROWTYPE;
 p jsonb; t timestamptz; fingerprint text; result jsonb; new_expiry timestamptz;
BEGIN
 PERFORM site_private.lock_proof_configuration();
 SELECT * INTO STRICT who FROM site_private.business_identity();
 SELECT * INTO security FROM site_private.user_security_state s WHERE s.auth_user_id=who.uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT who FROM site_private.business_identity();
 -- Validate time/signature AFTER any lock wait, not at transaction start.
 p:=site_private.verify_business_proof(envelope,who.uid,who.sid);
 IF (p->>'epoch')::bigint<>security.security_epoch THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p->>'action'<>'revoke' AND (NOT security.business_enabled OR security.security_hold OR security.hold_reason<>'none') THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 fingerprint:=encode(extensions.digest(convert_to(envelope::text,'UTF8'),'sha256'),'hex');
 IF EXISTS (SELECT FROM site_private.grant_proofs x WHERE x.proof_id=(p->>'proof_id')::uuid) THEN
  RAISE EXCEPTION 'PROOF_ALREADY_CONSUMED' USING ERRCODE='42501';
 END IF;
 SELECT * INTO g FROM site_private.business_session_grants x
  WHERE x.auth_user_id=who.uid AND x.auth_session_id=who.sid FOR UPDATE;
 t:=pg_catalog.clock_timestamp();
 IF p->>'action'='issue' THEN
  IF FOUND THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  INSERT INTO site_private.business_session_grants(auth_user_id,auth_session_id,security_epoch,purpose,
    issued_at,last_renewed_at,expires_at,absolute_expires_at,issuer_version)
   VALUES(who.uid,who.sid,security.security_epoch,'business',t,t,t+interval '30 minutes',t+interval '12 hours','r3-ticket-v1:'||(p->>'key_id')) RETURNING * INTO g;
 ELSIF p->>'action'='renew' THEN
  IF NOT FOUND OR g.issuer_version IS DISTINCT FROM ('r3-ticket-v1:'||(p->>'key_id'))
     OR g.revoked_at IS NOT NULL OR g.security_epoch<>security.security_epoch OR g.expires_at<=t OR g.absolute_expires_at<=t THEN
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
 -- Check again after any wait; exceptions roll back both grant and receipt.
 PERFORM 1 FROM site_private.business_identity();
 IF pg_catalog.clock_timestamp()>=to_timestamp((p->>'expires_at')::bigint) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO site_private.grant_proofs(proof_id,project_ref,auth_user_id,auth_session_id,action,security_epoch,request_digest,
   issued_at,expires_at,consumed_at,key_id,proof_fingerprint,grant_result)
  VALUES((p->>'proof_id')::uuid,p->>'project',who.uid,who.sid,p->>'action',security.security_epoch,p->>'payload_digest',
   to_timestamp((p->>'issued_at')::bigint),to_timestamp((p->>'expires_at')::bigint),pg_catalog.clock_timestamp(),p->>'key_id',fingerprint,result);
 IF pg_catalog.clock_timestamp()>=to_timestamp((p->>'expires_at')::bigint) THEN
  RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501';
 END IF;
 RETURN result;
END;
$fn$;
RESET ROLE;
SET LOCAL ROLE ecv_s3_authz_reader;
CREATE OR REPLACE FUNCTION site_private.business_qualified() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record;
BEGIN
 SELECT * INTO STRICT who FROM site_private.business_identity();
 RETURN EXISTS (SELECT FROM site_private.user_security_state s JOIN site_private.business_session_grants g
  ON g.auth_user_id=s.auth_user_id AND g.security_epoch=s.security_epoch
  JOIN site_private.proof_generations k ON g.issuer_version='r3-ticket-v1:'||k.key_id AND k.revoked_at IS NULL
  WHERE s.auth_user_id=who.uid AND s.business_enabled AND NOT s.security_hold AND s.hold_reason='none'
    AND g.auth_session_id=who.sid AND g.purpose='business' AND g.revoked_at IS NULL
    AND g.issued_at<=pg_catalog.clock_timestamp() AND g.last_renewed_at<=pg_catalog.clock_timestamp()
    AND g.expires_at>pg_catalog.clock_timestamp() AND g.absolute_expires_at>pg_catalog.clock_timestamp());
END;
$fn$;
RESET ROLE;
SET LOCAL ROLE ecv_s3_owner;
REVOKE CREATE ON SCHEMA site_private FROM ecv_s3_authz_reader, ecv_s3_grant_writer;
REVOKE CREATE ON SCHEMA site_api FROM ecv_s3_grant_writer;
RESET ROLE;
DO $catalog$
DECLARE
 registrar oid := 'ecv_s3_proof_registrar'::regrole;
 writer oid := 'ecv_s3_grant_writer'::regrole;
 owner_role oid := 'ecv_s3_owner'::regrole;
 reader oid := 'ecv_s3_authz_reader'::regrole;
 registration oid := 'site_private.register_business_ticket(jsonb)'::regprocedure;
BEGIN
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='site_private' AND p.proname IN ('register_business_ticket','check_ticket_claims',
           'guard_proof_configuration','lock_proof_configuration'))<>4 THEN RAISE EXCEPTION 'M5 function inventory'; END IF;
 IF EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='site_private' AND p.proname IN ('register_business_ticket','check_ticket_claims',
           'guard_proof_configuration','lock_proof_configuration')
       AND (p.prosecdef IS DISTINCT FROM (p.oid=registration)
          OR p.proowner<>(CASE WHEN p.proname='guard_proof_configuration' THEN owner_role ELSE writer END)
          OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']
          OR EXISTS (SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) g
                     WHERE g.grantee<>p.proowner AND NOT (p.oid=registration AND g.grantee=registrar
                       AND g.grantor=writer AND g.privilege_type='EXECUTE' AND NOT g.is_grantable)))) THEN
  RAISE EXCEPTION 'M5 function ACL';
 END IF;
 IF NOT has_function_privilege(registrar,registration,'EXECUTE')
    OR NOT has_schema_privilege(registrar,'site_private','USAGE')
    OR has_schema_privilege(registrar,'site_private','CREATE')
    OR has_schema_privilege(registrar,'site_private','USAGE WITH GRANT OPTION')
    OR EXISTS (SELECT FROM pg_namespace n WHERE n.nspname IN ('site_api','site_data','auth')
        AND (has_schema_privilege(registrar,n.oid,'USAGE') OR has_schema_privilege(registrar,n.oid,'CREATE')))
    OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('site_data','site_api','site_private') AND p.oid<>registration
      AND has_function_privilege(registrar,p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'M5 registrar scope'; END IF;
 IF EXISTS (SELECT FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE',
           'TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) priv(p)
      WHERE (c.relnamespace IN ('site_private'::regnamespace,'site_data'::regnamespace,'site_api'::regnamespace)
             OR c.oid IN ('auth.users'::regclass,'auth.sessions'::regclass))
        AND c.relkind='r' AND (has_table_privilege(registrar,c.oid,priv.p) OR
           (priv.p IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(registrar,c.oid,priv.p)))) THEN
  RAISE EXCEPTION 'M5 registrar has table access';
 END IF;
 IF EXISTS (
  WITH objects AS (
   SELECT * FROM pg_class WHERE oid IN ('site_private.registered_business_tickets'::regclass,
                                        'site_private.proof_generations'::regclass)
  ), actual AS (
   SELECT c.oid, g.grantee, g.grantor, g.privilege_type, g.is_grantable
   FROM objects c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) g
   WHERE g.grantee<>owner_role
  ), expected(oid,grantee,grantor,privilege_type,is_grantable) AS (VALUES
   ('site_private.proof_generations'::regclass::oid,reader,owner_role,'SELECT',false),
   ('site_private.proof_generations'::regclass::oid,writer,owner_role,'SELECT',false),
   ('site_private.registered_business_tickets'::regclass::oid,writer,owner_role,'SELECT',false),
   ('site_private.registered_business_tickets'::regclass::oid,writer,owner_role,'INSERT',false)
  )
  (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  UNION ALL
  (SELECT * FROM actual EXCEPT SELECT * FROM expected)
 ) OR EXISTS (SELECT FROM pg_class c WHERE c.oid IN ('site_private.registered_business_tickets'::regclass,
       'site_private.proof_generations'::regclass) AND (c.relowner<>owner_role OR NOT c.relrowsecurity
        OR NOT c.relforcerowsecurity OR EXISTS (SELECT FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attacl IS NOT NULL))) THEN
  RAISE EXCEPTION 'M5 table ACL';
 END IF;
 IF has_table_privilege(writer,'site_private.business_proof_keys','SELECT')
    OR has_any_column_privilege(writer,'site_private.business_proof_keys','SELECT')
    OR has_any_column_privilege(writer,'site_private.user_security_state','INSERT') THEN
  RAISE EXCEPTION 'M5 legacy key/state access';
 END IF;
END;
$catalog$;
REVOKE ecv_s3_owner, ecv_s3_grant_writer, ecv_s3_authz_reader FROM postgres GRANTED BY postgres RESTRICT;
DO $role_boundary$
DECLARE
 deployer constant oid := 'postgres'::pg_catalog.regrole;
 bootstrap constant oid := 10; -- PostgreSQL 17 BOOTSTRAP_SUPERUSERID
 internal_roles constant oid[] := ARRAY['ecv_s3_owner'::pg_catalog.regrole::oid,
                                         'ecv_s3_integrity'::pg_catalog.regrole::oid,'ecv_s3_authz_reader'::pg_catalog.regrole::oid, 'ecv_s3_grant_writer'::pg_catalog.regrole::oid, 'ecv_s3_command_writer'::pg_catalog.regrole::oid,
                                         'ecv_s3_proof_registrar'::pg_catalog.regrole::oid];
BEGIN
 IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles
                WHERE oid = bootstrap AND rolname = 'supabase_admin' AND rolsuper) THEN
  RAISE EXCEPTION 'S3 bootstrap grantor mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_roles
     WHERE oid = ANY(internal_roles) AND NOT rolcanlogin AND NOT rolsuper
       AND NOT rolbypassrls AND NOT rolinherit AND NOT rolcreaterole
       AND NOT rolcreatedb AND NOT rolreplication) <> 6 THEN
  RAISE EXCEPTION 'S3 internal role attributes mismatch';
 END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_auth_members
     WHERE roleid = ANY(internal_roles) OR member = ANY(internal_roles)) <> 6
    OR (SELECT count(*) FROM pg_catalog.pg_auth_members
        WHERE roleid = ANY(internal_roles) AND member = deployer
          AND grantor = bootstrap AND admin_option AND NOT set_option AND NOT inherit_option) <> 6 THEN
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
