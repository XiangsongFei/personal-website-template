-- Installed only after the original project migrations in the disposable cluster.
DO $fixture$
BEGIN
  IF session_user<>'supabase_admin' OR current_user<>session_user OR current_database()<>'postgres'
    OR current_setting('server_version_num')<>'170012' OR inet_server_addr() IS NOT NULL
    OR current_setting('listen_addresses')<>''
    OR coalesce(current_setting('s35.png_authority',true),'') !~ '^[a-f0-9-]{36}$'
    OR to_regclass('fixture_png.scope') IS NULL THEN RAISE insufficient_privilege; END IF;
END $fixture$;
CREATE ROLE fixture_png_source NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA fixture_png, site_private, site_data, auth TO fixture_png_source;
GRANT SELECT ON fixture_png.scope, fixture_png.pin TO fixture_png_source;

GRANT SELECT (id,email_confirmed_at,banned_until,is_anonymous) ON auth.users TO fixture_png_source;
GRANT SELECT (id,user_id,not_after) ON auth.sessions TO fixture_png_source;
CREATE POLICY fixture_png_user ON auth.users FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE id::text IN (s.asset->>'owner_uid',s.asset->>'worker_uid')));
CREATE POLICY fixture_png_session ON auth.sessions FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE id::text IN (s.asset->>'owner_sid',s.asset->>'worker_sid')));

GRANT SELECT ON site_private.business_runtime, site_private.user_security_state, site_private.business_session_grants,
  site_private.proof_generations, site_private.grant_proofs, site_data.sites, site_data.site_members TO fixture_png_source;
CREATE POLICY fixture_png_runtime ON site_private.business_runtime FOR SELECT TO fixture_png_source USING (singleton);
CREATE POLICY fixture_png_state ON site_private.user_security_state FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE auth_user_id::text=s.asset->>'owner_uid'));
CREATE POLICY fixture_png_grant ON site_private.business_session_grants FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE id=s.grant_id));
CREATE POLICY fixture_png_generation ON site_private.proof_generations FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE key_id=s.generation));
CREATE POLICY fixture_png_proof ON site_private.grant_proofs FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE grant_result->>'grant_id'=s.grant_id::text));
CREATE POLICY fixture_png_site ON site_data.sites FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE id::text=s.asset->>'site_id'));
CREATE POLICY fixture_png_member ON site_data.site_members FOR SELECT TO fixture_png_source
  USING (EXISTS (SELECT FROM fixture_png.scope s WHERE site_id::text=s.asset->>'site_id'
     AND auth_user_id::text=s.asset->>'owner_uid'));

-- The fixture's destructive source transitions participate in the existing M5
-- configuration fence. Initial proof issuance also takes this fence normally.
CREATE FUNCTION fixture_png.project_source_change() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(3303,5);
  RETURN NULL;
END $$;
CREATE TRIGGER fixture_png_state_fence BEFORE UPDATE OR DELETE ON site_private.user_security_state
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_png.project_source_change();
CREATE TRIGGER fixture_png_grant_fence BEFORE UPDATE OR DELETE ON site_private.business_session_grants
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_png.project_source_change();
CREATE TRIGGER fixture_png_site_fence BEFORE UPDATE OR DELETE ON site_data.sites
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_png.project_source_change();
CREATE TRIGGER fixture_png_member_fence BEFORE UPDATE OR DELETE ON site_data.site_members
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_png.project_source_change();
CREATE TRIGGER fixture_png_users_fence BEFORE UPDATE OR DELETE ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_png.project_source_change();
CREATE TRIGGER fixture_png_sessions_fence BEFORE UPDATE OR DELETE ON auth.sessions
  FOR EACH STATEMENT EXECUTE FUNCTION fixture_png.project_source_change();
REVOKE EXECUTE ON FUNCTION fixture_png.project_source_change() FROM PUBLIC;

-- Only this dependency changes between the scope-only and project-backed
-- lifecycle rehearsals. The existing prepare/claim/Seal SQL still owns its XID.
CREATE OR REPLACE FUNCTION fixture_png.live(p_run uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE t timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' OR inet_server_addr() IS NOT NULL
    OR current_setting('listen_addresses')<>'' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock_shared(3303,5);
  t := clock_timestamp();
  RETURN EXISTS (
    SELECT FROM fixture_png.scope s JOIN fixture_png.pin f USING (run_id)
    JOIN site_private.business_runtime br ON br.singleton
    JOIN site_private.user_security_state u ON u.auth_user_id IS NOT NULL AND u.auth_user_id::text=s.asset->>'owner_uid'
    JOIN site_private.business_session_grants g ON g.id=s.grant_id AND g.auth_user_id=u.auth_user_id
    JOIN site_private.proof_generations k ON k.key_id=s.generation
    JOIN site_private.grant_proofs p ON p.grant_result->>'grant_id'=g.id::text AND p.action='issue'
    JOIN site_data.sites d ON d.id::text=s.asset->>'site_id' AND d.owner_auth_user_id=u.auth_user_id
    JOIN site_data.site_members m ON m.site_id=d.id AND m.auth_user_id=u.auth_user_id
    JOIN auth.users a ON a.id=u.auth_user_id
    JOIN auth.sessions b ON b.id::text=s.asset->>'owner_sid' AND b.user_id=a.id
    JOIN auth.users w ON w.id::text=s.asset->>'worker_uid'
    JOIN auth.sessions ws ON ws.id::text=s.asset->>'worker_sid' AND ws.user_id=w.id
    WHERE s.run_id=p_run AND f.lifecycle_open AND br.enabled AND br.proof_verifier_ready
      AND br.project_ref=f.project AND br.auth_issuer=s.issuer
      AND u.business_enabled AND NOT u.security_hold AND u.hold_reason='none' AND u.security_epoch=s.owner_epoch
      AND g.auth_session_id=b.id AND g.security_epoch=u.security_epoch AND g.purpose='business'
      AND g.revoked_at IS NULL AND g.issuer_version='r3-ticket-v1:'||k.key_id
      AND greatest(g.issued_at,g.last_renewed_at,k.not_before)<=t
      AND least(g.expires_at,g.absolute_expires_at,k.verify_until)>t AND k.revoked_at IS NULL
      AND p.auth_user_id=a.id AND p.auth_session_id=b.id AND p.key_id=k.key_id
      AND p.security_epoch=s.owner_epoch AND p.project_ref=f.project AND p.consumed_at IS NOT NULL
      AND d.deleted_at IS NULL AND d.status='active' AND m.role='owner' AND m.state='active'
      AND a.email_confirmed_at IS NOT NULL AND NOT a.is_anonymous AND (a.banned_until IS NULL OR a.banned_until<=t)
      AND (b.not_after IS NULL OR b.not_after>t)
      AND w.email_confirmed_at IS NOT NULL AND NOT w.is_anonymous AND (w.banned_until IS NULL OR w.banned_until<=t)
      AND (ws.not_after IS NULL OR ws.not_after>t) AND (w.id,ws.id)<>(a.id,b.id)
  );
END $$;
ALTER FUNCTION fixture_png.live(uuid) OWNER TO fixture_png_source;
REVOKE ALL ON FUNCTION fixture_png.live(uuid) FROM PUBLIC,anon,authenticated,service_role;
