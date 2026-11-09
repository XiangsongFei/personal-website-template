-- S3.3-A CANDIDATE ONLY. Depends on s3_security_foundation. NOT EXECUTED.
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
-- Reject existing drift or a leftover deployment grant before taking privileges.
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
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
GRANT ecv_s3_integrity TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;

CREATE TABLE site_data.sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
 draft_revision bigint NOT NULL DEFAULT 0 CHECK (draft_revision = 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE (id, owner_auth_user_id),
 CHECK ((status = 'active' AND deleted_at IS NULL) OR (status = 'deleted' AND deleted_at IS NOT NULL))
);
CREATE TABLE site_data.site_members (
 site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 role text NOT NULL CHECK (role = 'owner'), state text NOT NULL CHECK (state = 'active'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (site_id, auth_user_id),
 FOREIGN KEY (site_id, auth_user_id) REFERENCES site_data.sites(id, owner_auth_user_id)
  DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX site_members_one_active_owner ON site_data.site_members(site_id) WHERE role = 'owner' AND state = 'active';
CREATE INDEX site_members_user_state ON site_data.site_members(auth_user_id, state, site_id);
CREATE TABLE site_data.site_domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 slug text NOT NULL CHECK (slug ~ '^[a-z][a-z0-9-]{1,46}[a-z0-9]$'),
 hostname_normalized text NOT NULL UNIQUE,
 kind text NOT NULL DEFAULT 'test' CHECK (kind = 'test'),
 state text NOT NULL DEFAULT 'reserved' CHECK (state = 'reserved'),
 is_primary boolean NOT NULL DEFAULT true, verified_at timestamptz CHECK (verified_at IS NULL),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (site_id, id),
 CHECK (slug NOT IN ('admin','cms-admin','www','api','auth','hr','mail','support','static','assets')),
 CHECK (hostname_normalized = slug || '.sites.example.test')
);
CREATE UNIQUE INDEX site_domains_one_primary ON site_data.site_domains(site_id) WHERE is_primary;
CREATE TABLE site_data.site_locales (
 site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 locale text NOT NULL CHECK (locale IN ('zh','en')), enabled boolean NOT NULL DEFAULT true CHECK (enabled),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (site_id, locale)
);
CREATE TABLE site_data.site_settings (
 site_id uuid PRIMARY KEY REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 default_locale text NOT NULL DEFAULT 'zh', theme_key text NOT NULL DEFAULT 'default' CHECK (theme_key = 'default'),
 theme_options jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (theme_options = '{}'::jsonb),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (site_id, default_locale) REFERENCES site_data.site_locales(site_id, locale)
);
CREATE TABLE site_data.section_state (
 site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 section_key text NOT NULL CHECK (section_key = 'introduction'), revision bigint NOT NULL DEFAULT 0 CHECK (revision = 0),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (site_id, section_key)
);
CREATE TABLE site_data.site_publications (
 site_id uuid PRIMARY KEY REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 state text NOT NULL DEFAULT 'unpublished', snapshot_id uuid,
 publication_revision bigint NOT NULL DEFAULT 0,
 changed_at timestamptz NOT NULL DEFAULT now(), changed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 CONSTRAINT publication_s33_closed CHECK (state = 'unpublished' AND snapshot_id IS NULL AND publication_revision = 0)
);
-- S3.6 must add snapshots + same-site FK + outbox + complete state machine
-- atomically BEFORE replacing publication_s33_closed or granting publishing.
CREATE TABLE site_data.intro_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 position integer NOT NULL CHECK (position >= 0), source_key text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (site_id, id), UNIQUE (site_id, position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE site_data.intro_translations (
 site_id uuid NOT NULL, parent_id uuid NOT NULL, locale text NOT NULL,
 text text NOT NULL CHECK (length(text) <= 20000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (site_id, parent_id, locale),
 FOREIGN KEY (site_id, parent_id) REFERENCES site_data.intro_entries(site_id, id) ON DELETE RESTRICT,
 FOREIGN KEY (site_id, locale) REFERENCES site_data.site_locales(site_id, locale) ON DELETE RESTRICT
);
CREATE INDEX intro_translations_locale ON site_data.intro_translations(site_id, locale);
CREATE TABLE site_private.operation_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, actor_session_id uuid NOT NULL,
 operation text NOT NULL CHECK (operation = 'create_site'), request_id uuid NOT NULL,
 payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK (state = 'succeeded'), result_schema_version integer NOT NULL CHECK (result_schema_version = 1),
 result jsonb NOT NULL, error_code text CHECK (error_code IS NULL),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
 UNIQUE (site_id, id), UNIQUE (site_id, actor_auth_user_id, operation, request_id),
 FOREIGN KEY (site_id, actor_auth_user_id) REFERENCES site_data.sites(id, owner_auth_user_id),
 CHECK (jsonb_typeof(result) = 'object' AND result ? 'site_id'
  AND jsonb_typeof(result -> 'site_id') = 'string' AND result ->> 'site_id' = site_id::text)
);
-- Site-independent lookup/uniqueness, without nullable site FK or orphan reservation.
CREATE UNIQUE INDEX create_site_request_key ON site_private.operation_requests(actor_auth_user_id, operation, request_id)
 WHERE operation = 'create_site';
CREATE TABLE site_data.draft_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 site_revision bigint NOT NULL CHECK (site_revision = 0), section_key text NOT NULL CHECK (section_key = 'introduction'),
 section_revision bigint NOT NULL CHECK (section_revision = 0), schema_version integer NOT NULL CHECK (schema_version = 1),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
 digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
 actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT, operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (site_id, id), UNIQUE (site_id, site_revision),
 FOREIGN KEY (site_id, actor_auth_user_id) REFERENCES site_data.sites(id, owner_auth_user_id),
 FOREIGN KEY (site_id, operation_id) REFERENCES site_private.operation_requests(site_id, id) ON DELETE RESTRICT
);
CREATE TABLE site_private.site_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
 actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 action text NOT NULL CHECK (action = 'create_site'), section text NOT NULL CHECK (section = 'introduction'),
 operation_id uuid NOT NULL, result text NOT NULL CHECK (result = 'succeeded'),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (metadata = '{}'::jsonb), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (site_id, id), UNIQUE (operation_id, action),
 FOREIGN KEY (site_id, actor_auth_user_id) REFERENCES site_data.sites(id, owner_auth_user_id),
 FOREIGN KEY (site_id, operation_id) REFERENCES site_private.operation_requests(site_id, id) ON DELETE RESTRICT
);
CREATE INDEX audit_site_time ON site_private.site_audit_events(site_id, created_at DESC, id DESC);

-- No client-callable commands. All functions below are trigger-only.
CREATE FUNCTION site_private.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
BEGIN
 RAISE EXCEPTION 'immutable foundation record' USING ERRCODE = '23514';
END;
$fn$;
CREATE FUNCTION site_private.guard_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE col text;
BEGIN
 FOREACH col IN ARRAY TG_ARGV LOOP
  IF pg_catalog.to_jsonb(NEW) -> col IS DISTINCT FROM pg_catalog.to_jsonb(OLD) -> col THEN
   RAISE EXCEPTION 'immutable identity' USING ERRCODE = '23514';
  END IF;
 END LOOP;
 NEW.created_at := OLD.created_at;
 NEW.updated_at := pg_catalog.clock_timestamp();
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER sites_identity BEFORE UPDATE ON site_data.sites FOR EACH ROW EXECUTE FUNCTION site_private.guard_identity('id','owner_auth_user_id');
CREATE TRIGGER members_identity BEFORE UPDATE ON site_data.site_members FOR EACH ROW EXECUTE FUNCTION site_private.guard_identity('site_id','auth_user_id');
CREATE TRIGGER domains_identity BEFORE UPDATE ON site_data.site_domains FOR EACH ROW EXECUTE FUNCTION site_private.guard_identity('id','site_id','slug','hostname_normalized');
CREATE TRIGGER locales_identity BEFORE UPDATE ON site_data.site_locales FOR EACH ROW EXECUTE FUNCTION site_private.guard_identity('site_id','locale');
CREATE TRIGGER settings_identity BEFORE UPDATE ON site_data.site_settings FOR EACH ROW EXECUTE FUNCTION site_private.guard_identity('site_id');
CREATE TRIGGER entries_identity BEFORE UPDATE ON site_data.intro_entries FOR EACH ROW EXECUTE FUNCTION site_private.guard_identity('id','site_id');
CREATE TRIGGER translations_identity BEFORE UPDATE ON site_data.intro_translations FOR EACH ROW EXECUTE FUNCTION site_private.guard_identity('site_id','parent_id','locale');
-- Prevent deletion/recreation of permanent state, even at revision zero.
CREATE TRIGGER section_frozen BEFORE UPDATE ON site_data.section_state FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();
CREATE TRIGGER publication_permanent BEFORE DELETE ON site_data.site_publications FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();
CREATE TRIGGER publication_frozen BEFORE UPDATE ON site_data.site_publications FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();
CREATE TRIGGER operation_immutable BEFORE UPDATE OR DELETE ON site_private.operation_requests FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();
CREATE TRIGGER revisions_immutable BEFORE UPDATE OR DELETE ON site_data.draft_revisions FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON site_private.site_audit_events FOR EACH ROW EXECUTE FUNCTION site_private.reject_mutation();

-- A non-owner, non-BYPASSRLS role can only SELECT the three integrity tables.
-- No JWT/actor parameters, dynamic SQL, auth access, or user-callable function.
CREATE FUNCTION site_private.assert_site_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE sid uuid; authority uuid; mirrors bigint;
BEGIN
 IF TG_TABLE_NAME = 'sites' THEN
  IF TG_OP = 'DELETE' THEN sid := OLD.id; ELSE sid := NEW.id; END IF;
 ELSE
  IF TG_OP = 'DELETE' THEN sid := OLD.site_id; ELSE sid := NEW.site_id; END IF;
 END IF;
 SELECT s.owner_auth_user_id INTO authority FROM site_data.sites s WHERE s.id = sid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT count(*) INTO mirrors FROM site_data.site_members m
 WHERE m.site_id = sid AND m.auth_user_id = authority AND m.role = 'owner' AND m.state = 'active';
 IF mirrors <> 1 OR NOT EXISTS (SELECT 1 FROM site_data.site_publications p WHERE p.site_id = sid) THEN
  RAISE EXCEPTION 'owner/publication invariant' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END;
$fn$;
CREATE CONSTRAINT TRIGGER sites_integrity AFTER INSERT OR UPDATE OR DELETE ON site_data.sites
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION site_private.assert_site_integrity();
CREATE CONSTRAINT TRIGGER members_integrity AFTER INSERT OR UPDATE OR DELETE ON site_data.site_members
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION site_private.assert_site_integrity();
CREATE CONSTRAINT TRIGGER publications_integrity AFTER INSERT OR UPDATE OR DELETE ON site_data.site_publications
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION site_private.assert_site_integrity();
ALTER TABLE site_data.sites OWNER TO ecv_s3_owner;
ALTER TABLE site_data.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.sites FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.sites FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.site_members OWNER TO ecv_s3_owner;
ALTER TABLE site_data.site_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.site_members FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.site_members FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.site_domains OWNER TO ecv_s3_owner;
ALTER TABLE site_data.site_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.site_domains FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.site_domains FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.site_locales OWNER TO ecv_s3_owner;
ALTER TABLE site_data.site_locales ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.site_locales FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.site_locales FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.site_settings OWNER TO ecv_s3_owner;
ALTER TABLE site_data.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.site_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.site_settings FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.section_state OWNER TO ecv_s3_owner;
ALTER TABLE site_data.section_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.section_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.section_state FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.site_publications OWNER TO ecv_s3_owner;
ALTER TABLE site_data.site_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.site_publications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.site_publications FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.intro_entries OWNER TO ecv_s3_owner;
ALTER TABLE site_data.intro_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.intro_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.intro_entries FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.intro_translations OWNER TO ecv_s3_owner;
ALTER TABLE site_data.intro_translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.intro_translations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.intro_translations FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_data.draft_revisions OWNER TO ecv_s3_owner;
ALTER TABLE site_data.draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_data.draft_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_data.draft_revisions FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_private.operation_requests OWNER TO ecv_s3_owner;
ALTER TABLE site_private.operation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.operation_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_private.operation_requests FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE site_private.site_audit_events OWNER TO ecv_s3_owner;
ALTER TABLE site_private.site_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.site_audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE site_private.site_audit_events FROM PUBLIC, anon, authenticated, service_role, authenticator;
GRANT USAGE ON SCHEMA site_data, site_private TO ecv_s3_integrity;
GRANT SELECT ON TABLE site_data.sites TO ecv_s3_integrity;
CREATE POLICY integrity_read ON site_data.sites FOR SELECT TO ecv_s3_integrity USING (true);
GRANT SELECT ON TABLE site_data.site_members TO ecv_s3_integrity;
CREATE POLICY integrity_read ON site_data.site_members FOR SELECT TO ecv_s3_integrity USING (true);
GRANT SELECT ON TABLE site_data.site_publications TO ecv_s3_integrity;
CREATE POLICY integrity_read ON site_data.site_publications FOR SELECT TO ecv_s3_integrity USING (true);
ALTER FUNCTION site_private.reject_mutation() OWNER TO ecv_s3_owner;
REVOKE ALL ON FUNCTION site_private.reject_mutation() FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER FUNCTION site_private.guard_identity() OWNER TO ecv_s3_owner;
REVOKE ALL ON FUNCTION site_private.guard_identity() FROM PUBLIC, anon, authenticated, service_role, authenticator;
-- ALTER FUNCTION OWNER requires CREATE at transfer; remove immediately.
GRANT CREATE ON SCHEMA site_private TO ecv_s3_integrity;
ALTER FUNCTION site_private.assert_site_integrity() OWNER TO ecv_s3_integrity;
REVOKE CREATE ON SCHEMA site_private FROM ecv_s3_integrity;
SET LOCAL ROLE ecv_s3_integrity;
REVOKE ALL ON FUNCTION site_private.assert_site_integrity() FROM PUBLIC, anon, authenticated, service_role, authenticator;
RESET ROLE;

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
