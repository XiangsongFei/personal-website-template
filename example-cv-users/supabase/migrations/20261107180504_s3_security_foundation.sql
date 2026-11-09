-- S3.3-A CANDIDATE ONLY. NOT EXECUTED. Isolated PostgreSQL 17 only.
-- Requires an explicitly approved direct Supabase postgres deployment session.
-- Deliberately fails on role/schema collisions; never adopt an existing role.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $deployment_identity$
BEGIN
 IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR NOT EXISTS (SELECT FROM pg_catalog.pg_roles
                   WHERE rolname = 'postgres' AND NOT rolsuper AND rolcreaterole) THEN
  RAISE EXCEPTION 'S3 requires the PostgreSQL 17 non-superuser postgres deployment session';
 END IF;
END;
$deployment_identity$;
-- Suppress optional self-grants, leaving PostgreSQL's mandatory ADMIN record.
SET LOCAL createrole_self_grant = '';

CREATE ROLE ecv_s3_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE ecv_s3_integrity NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Separate deployment grants from the bootstrap ADMIN records by grantor.
-- Owner inheritance is needed while postgres creates Auth FKs and applies owner DDL.
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
GRANT ecv_s3_integrity TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
CREATE SCHEMA site_data AUTHORIZATION ecv_s3_owner;
CREATE SCHEMA site_private AUTHORIZATION ecv_s3_owner;
CREATE SCHEMA site_api AUTHORIZATION ecv_s3_owner;
REVOKE ALL ON SCHEMA site_data, site_private, site_api FROM PUBLIC, anon, authenticated, service_role, authenticator;
-- Defaults belong to the actual future object creator, not to every role.
SET LOCAL ROLE ecv_s3_owner;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;
SET LOCAL ROLE ecv_s3_integrity;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
RESET ROLE;
ALTER DEFAULT PRIVILEGES IN SCHEMA site_data, site_private, site_api REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA site_data, site_private, site_api REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA site_data, site_private, site_api REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role, authenticator;
-- Explicit per-object revocation below is still required: schema defaults cannot
-- subtract PostgreSQL's global default PUBLIC EXECUTE for the migration creator.

CREATE TABLE site_private.user_security_state (
 auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 security_epoch bigint NOT NULL DEFAULT 0 CHECK (security_epoch >= 0),
 business_enabled boolean NOT NULL DEFAULT false,
 security_hold boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE site_private.business_session_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 auth_user_id uuid NOT NULL REFERENCES site_private.user_security_state(auth_user_id) ON DELETE RESTRICT,
 auth_session_id uuid NOT NULL,
 security_epoch bigint NOT NULL CHECK (security_epoch >= 0),
 purpose text NOT NULL CHECK (purpose = 'business'),
 issued_at timestamptz NOT NULL,
 last_renewed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 absolute_expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 reason text,
 issuer_version text NOT NULL CHECK (length(issuer_version) BETWEEN 1 AND 80),
 UNIQUE (auth_user_id, auth_session_id),
 CHECK (issued_at <= last_renewed_at AND last_renewed_at < expires_at AND expires_at <= absolute_expires_at),
 CHECK (revoked_at IS NULL OR revoked_at >= issued_at),
 CHECK ((revoked_at IS NULL AND reason IS NULL) OR (revoked_at IS NOT NULL AND reason IS NOT NULL))
);
CREATE INDEX business_grants_expiry ON site_private.business_session_grants(expires_at) WHERE revoked_at IS NULL;
CREATE TABLE site_private.grant_proofs (
 proof_id uuid PRIMARY KEY,
 project_ref text NOT NULL CHECK (length(project_ref) BETWEEN 1 AND 80),
 auth_user_id uuid NOT NULL REFERENCES site_private.user_security_state(auth_user_id) ON DELETE RESTRICT,
 auth_session_id uuid NOT NULL,
 action text NOT NULL CHECK (action IN ('issue', 'renew', 'revoke')),
 security_epoch bigint NOT NULL CHECK (security_epoch >= 0),
 request_digest text NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
 consumed_at timestamptz,
 key_id text NOT NULL CHECK (length(key_id) BETWEEN 1 AND 80),
 CHECK (consumed_at IS NULL OR consumed_at BETWEEN issued_at AND expires_at)
);
CREATE INDEX grant_proofs_user_session ON site_private.grant_proofs(auth_user_id, auth_session_id);
-- These are inert fields, NOT a proof verifier or an authorization predicate.
-- BLOCKED: no issuance/renewal/revocation RPC, key, auth.sessions access or policy.

CREATE FUNCTION site_private.guard_security_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id OR NEW.security_epoch < OLD.security_epoch THEN
  RAISE EXCEPTION 'security identity/epoch cannot regress' USING ERRCODE = '23514';
 END IF;
 NEW.created_at := OLD.created_at;
 NEW.updated_at := pg_catalog.clock_timestamp();
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER security_state_guard BEFORE UPDATE ON site_private.user_security_state
FOR EACH ROW EXECUTE FUNCTION site_private.guard_security_state();
ALTER TABLE site_private.user_security_state OWNER TO ecv_s3_owner;
ALTER TABLE site_private.user_security_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.user_security_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_private.user_security_state FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_private.business_session_grants OWNER TO ecv_s3_owner;
ALTER TABLE site_private.business_session_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.business_session_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_private.business_session_grants FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_private.grant_proofs OWNER TO ecv_s3_owner;
ALTER TABLE site_private.grant_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.grant_proofs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_private.grant_proofs FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER FUNCTION site_private.guard_security_state() OWNER TO ecv_s3_owner;
REVOKE ALL ON FUNCTION site_private.guard_security_state() FROM PUBLIC, anon, authenticated, service_role, authenticator;

REVOKE ecv_s3_owner, ecv_s3_integrity FROM postgres GRANTED BY postgres RESTRICT;
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
COMMIT;
