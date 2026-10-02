-- Phase 0B: inactive, target-scoped Activity Log foundation.
-- Apply only as postgres after review. This migration intentionally does not
-- alter CMS content DML, Storage, existing authorization helpers, or UI.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Phase 0B must be installed as postgres (current_user=%)', current_user
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

CREATE SCHEMA IF NOT EXISTS cms_private AUTHORIZATION postgres;
DO $schema_owner_guard$
BEGIN
  IF (SELECT n.nspowner <> 'postgres'::regrole
      FROM pg_catalog.pg_namespace AS n
      WHERE n.nspname = 'cms_private') THEN
    RAISE EXCEPTION 'cms_private must be owned by postgres'
      USING ERRCODE = '42501';
  END IF;
END
$schema_owner_guard$;
REVOKE ALL ON SCHEMA cms_private FROM PUBLIC, anon, authenticated, service_role, pg_write_all_data;

DO $target_guard$
BEGIN
  IF (SELECT count(*) FROM public.resume_sites WHERE site_key = 'example-cv') <> 1 THEN
    RAISE EXCEPTION 'Phase 0B requires exactly one example-cv target';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resume_sites WHERE site_key = 'example-cv-qa' AND is_published IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'example-cv-qa must remain unpublished';
  END IF;
END
$target_guard$;

CREATE TABLE cms_private.resume_capabilities (
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  capability_key text NOT NULL CHECK (capability_key IN ('activity_log')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (resume_id, capability_key)
);

CREATE TABLE cms_private.resume_write_modes (
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  domain_key text NOT NULL CHECK (domain_key IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  )),
  write_mode text NOT NULL CHECK (write_mode IN ('direct', 'rpc')),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  PRIMARY KEY (resume_id, domain_key)
);

-- The migration period is backward compatible: missing rows resolve to direct.
-- Every current target/domain is also explicitly seeded as direct.
INSERT INTO cms_private.resume_write_modes (resume_id, domain_key, write_mode)
SELECT site.id, domain.domain_key, 'direct'
FROM public.resume_sites AS site
CROSS JOIN (VALUES
  ('introduction'), ('education'), ('experience'), ('awards'), ('skills'),
  ('contact'), ('projects'), ('website_links'), ('profile'), ('files')
) AS domain(domain_key)
WHERE site.site_key IN ('example-cv', 'example-cv-qa');

CREATE FUNCTION cms_private.get_resume_write_mode(target_resume_id uuid, target_domain text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE resolved_mode text;
BEGIN
  IF target_domain IS NULL OR target_domain NOT IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  ) THEN
    RAISE EXCEPTION 'Unknown CMS write domain' USING ERRCODE = '22023';
  END IF;

  SELECT mode.write_mode
  INTO resolved_mode
  FROM cms_private.resume_write_modes AS mode
  WHERE mode.resume_id = target_resume_id AND mode.domain_key = target_domain;

  RETURN COALESCE(resolved_mode, 'direct');
END
$function$;

CREATE FUNCTION cms_private.activity_event_payload_is_allowed(
  target_entity_type text,
  target_snapshot jsonb,
  target_changes jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $function$
DECLARE
  allowed_fields text[];
  change_entry record;
BEGIN
  allowed_fields := CASE target_entity_type
    WHEN 'introduction_paragraph' THEN ARRAY['position','text']
    WHEN 'education_entry' THEN ARRAY['position','institution','title','program','date','grade','course_name','course_description']
    WHEN 'experience_entry' THEN ARRAY['position','organization','role','period','location','description']
    WHEN 'project_entry' THEN ARRAY['position','title','course_title','description','url','methods']
    WHEN 'award_entry' THEN ARRAY['position','name','year']
    WHEN 'skill_group' THEN ARRAY['position','title','items']
    WHEN 'contact_focus_item' THEN ARRAY['position','title','detail']
    WHEN 'contact_status_item' THEN ARRAY['position','title','detail','status_type','date']
    WHEN 'public_link' THEN ARRAY['email_address','email_label','github_url','github_label','linkedin_url','linkedin_label','linkedin_display_name','linkedin_homepage_label']
    WHEN 'profile_settings' THEN ARRAY['graduation_value','avatar_initials','footer_name','copyright']
    WHEN 'resume_file' THEN ARRAY['locale','object_key','file_name','content_type','size_bytes']
    WHEN 'profile_image' THEN ARRAY['object_key','file_name','content_type','size_bytes']
    ELSE NULL
  END;

  IF allowed_fields IS NULL
     OR pg_catalog.jsonb_typeof(target_snapshot) <> 'object'
     OR pg_catalog.jsonb_typeof(target_changes) <> 'object'
     OR pg_catalog.octet_length(target_snapshot::text) > 12000
     OR pg_catalog.octet_length(target_changes::text) > 12000 THEN
    RETURN false;
  END IF;

  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) > 24
     OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) > 24
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_object_keys(target_snapshot) AS keys(key_name)
       WHERE keys.key_name <> ALL (allowed_fields)
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_each(target_snapshot) AS fields(field_name, field_value)
       WHERE pg_catalog.jsonb_typeof(fields.field_value) IN ('object', 'array')
     ) THEN
    RETURN false;
  END IF;

  FOR change_entry IN SELECT key, value FROM pg_catalog.jsonb_each(target_changes)
  LOOP
    IF change_entry.key <> ALL (allowed_fields)
       OR pg_catalog.jsonb_typeof(change_entry.value) <> 'object'
       OR NOT (change_entry.value ? 'before')
       OR NOT (change_entry.value ? 'after')
       OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(change_entry.value)) <> 2
       OR pg_catalog.jsonb_typeof(change_entry.value -> 'before') IN ('object', 'array')
       OR pg_catalog.jsonb_typeof(change_entry.value -> 'after') IN ('object', 'array') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END
$function$;

CREATE TABLE cms_private.activity_log_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  actor_user_id uuid NOT NULL,
  actor_email_snapshot text CHECK (actor_email_snapshot IS NULL OR pg_catalog.length(actor_email_snapshot) <= 320),
  actor_role_snapshot text NOT NULL CHECK (actor_role_snapshot IN ('owner', 'qa')),
  resume_id uuid NOT NULL,
  site_key_snapshot text NOT NULL CHECK (site_key_snapshot IN ('example-cv', 'example-cv-qa')),
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'reorder', 'upload', 'remove')),
  section_key text NOT NULL CHECK (section_key IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  )),
  entity_type text NOT NULL CHECK (entity_type IN (
    'introduction_paragraph', 'education_entry', 'experience_entry', 'project_entry',
    'award_entry', 'skill_group', 'contact_focus_item', 'contact_status_item',
    'public_link', 'profile_settings', 'resume_file', 'profile_image'
  )),
  entity_id text CHECK (entity_id IS NULL OR (pg_catalog.length(entity_id) BETWEEN 1 AND 256)),
  entity_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_version smallint NOT NULL DEFAULT 1 CHECK (payload_version = 1),
  CONSTRAINT activity_log_entity_section_check CHECK (
    (section_key = 'introduction' AND entity_type = 'introduction_paragraph') OR
    (section_key = 'education' AND entity_type = 'education_entry') OR
    (section_key = 'experience' AND entity_type = 'experience_entry') OR
    (section_key = 'projects' AND entity_type = 'project_entry') OR
    (section_key = 'awards' AND entity_type = 'award_entry') OR
    (section_key = 'skills' AND entity_type = 'skill_group') OR
    (section_key = 'contact' AND entity_type IN ('contact_focus_item','contact_status_item')) OR
    (section_key = 'website_links' AND entity_type = 'public_link') OR
    (section_key = 'profile' AND entity_type = 'profile_settings') OR
    (section_key = 'files' AND entity_type IN ('resume_file','profile_image'))
  ),
  CONSTRAINT activity_log_payload_allowlist_check CHECK (
    cms_private.activity_event_payload_is_allowed(entity_type, entity_snapshot, changes)
  )
);

CREATE INDEX activity_log_events_target_cursor_idx
  ON cms_private.activity_log_events (resume_id, occurred_at DESC, id DESC);

ALTER TABLE cms_private.resume_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_private.resume_write_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_private.activity_log_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE cms_private.resume_capabilities, cms_private.resume_write_modes,
  cms_private.activity_log_events
  FROM PUBLIC, anon, authenticated, service_role, pg_write_all_data;
REVOKE ALL ON FUNCTION cms_private.get_resume_write_mode(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_is_allowed(text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION cms_private.assert_activity_log_target(target_resume_id uuid)
RETURNS TABLE (resolved_site_key text, resolved_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_role text;
  caller_resume_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT admin.role, admin.resume_id
  INTO caller_role, caller_resume_id
  FROM public.cms_admins AS admin
  WHERE admin.user_id = (SELECT auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin authorization required' USING ERRCODE = '42501';
  END IF;

  IF caller_role = 'owner' AND caller_resume_id IS NULL THEN
    SELECT site.site_key INTO resolved_site_key
    FROM public.resume_sites AS site
    WHERE site.id = target_resume_id
      AND site.site_key IN ('example-cv', 'example-cv-qa')
      AND (site.site_key <> 'example-cv-qa' OR site.is_published = false)
      AND public.can_manage_resume(site.id);
  ELSIF caller_role = 'qa' AND caller_resume_id = target_resume_id THEN
    SELECT site.site_key INTO resolved_site_key
    FROM public.resume_sites AS site
    WHERE site.id = target_resume_id
      AND site.site_key = 'example-cv-qa'
      AND site.is_published = false
      AND public.can_manage_resume(site.id);
  ELSE
    RAISE EXCEPTION 'Activity Log target is outside the caller scope' USING ERRCODE = '42501';
  END IF;

  IF resolved_site_key IS NULL THEN
    RAISE EXCEPTION 'Activity Log target is not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE((
    SELECT capability.enabled
    FROM cms_private.resume_capabilities AS capability
    WHERE capability.resume_id = target_resume_id
      AND capability.capability_key = 'activity_log'
  ), false) THEN
    RAISE EXCEPTION 'Activity Log is disabled for this target' USING ERRCODE = '42501';
  END IF;

  resolved_role := caller_role;
  RETURN NEXT;
END
$function$;

CREATE FUNCTION public.activity_log_authorized_targets()
RETURNS TABLE (resume_id uuid, site_key text, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_role text;
  caller_resume_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT admin.role, admin.resume_id
  INTO caller_role, caller_resume_id
  FROM public.cms_admins AS admin
  WHERE admin.user_id = (SELECT auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin authorization required' USING ERRCODE = '42501';
  END IF;

  IF caller_role = 'owner' AND caller_resume_id IS NULL THEN
    RETURN QUERY
      SELECT site.id, site.site_key, caller_role
      FROM public.resume_sites AS site
      WHERE site.site_key IN ('example-cv', 'example-cv-qa')
        AND (site.site_key <> 'example-cv-qa' OR site.is_published = false)
        AND public.can_manage_resume(site.id)
        AND EXISTS (
          SELECT 1 FROM cms_private.resume_capabilities AS capability
          WHERE capability.resume_id = site.id
            AND capability.capability_key = 'activity_log'
            AND capability.enabled
        )
      ORDER BY site.site_key;
  ELSIF caller_role = 'qa' AND caller_resume_id IS NOT NULL THEN
    RETURN QUERY
      SELECT site.id, site.site_key, caller_role
      FROM public.resume_sites AS site
      WHERE site.id = caller_resume_id
        AND site.site_key = 'example-cv-qa'
        AND site.is_published = false
        AND public.can_manage_resume(site.id)
        AND EXISTS (
          SELECT 1 FROM cms_private.resume_capabilities AS capability
          WHERE capability.resume_id = site.id
            AND capability.capability_key = 'activity_log'
            AND capability.enabled
        );
  ELSE
    RAISE EXCEPTION 'Admin authorization required' USING ERRCODE = '42501';
  END IF;
END
$function$;

CREATE FUNCTION public.read_activity_log_events(
  target_resume_id uuid,
  page_limit integer DEFAULT 50,
  before_occurred_at timestamptz DEFAULT NULL,
  before_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  occurred_at timestamptz,
  actor_user_id uuid,
  actor_email_snapshot text,
  actor_role_snapshot text,
  resume_id uuid,
  site_key_snapshot text,
  operation text,
  section_key text,
  entity_type text,
  entity_id text,
  entity_snapshot jsonb,
  changes jsonb,
  payload_version smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  authorization_context record;
BEGIN
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 100 THEN
    RAISE EXCEPTION 'page_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF (before_occurred_at IS NULL) <> (before_id IS NULL) THEN
    RAISE EXCEPTION 'Both cursor fields must be provided together' USING ERRCODE = '22023';
  END IF;

  SELECT context.resolved_site_key, context.resolved_role
  INTO authorization_context
  FROM cms_private.assert_activity_log_target(target_resume_id) AS context;

  RETURN QUERY
    SELECT event.id, event.occurred_at, event.actor_user_id, event.actor_email_snapshot,
           event.actor_role_snapshot, event.resume_id, event.site_key_snapshot,
           event.operation, event.section_key, event.entity_type, event.entity_id,
           event.entity_snapshot, event.changes, event.payload_version
    FROM cms_private.activity_log_events AS event
    WHERE event.resume_id = target_resume_id
      AND (before_id IS NULL OR (event.occurred_at, event.id) < (before_occurred_at, before_id))
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT page_limit;
END
$function$;

CREATE FUNCTION cms_private.reject_activity_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'Activity Log events are immutable' USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER activity_log_events_no_row_mutation
  BEFORE UPDATE OR DELETE ON cms_private.activity_log_events
  FOR EACH ROW EXECUTE FUNCTION cms_private.reject_activity_log_mutation();
CREATE TRIGGER activity_log_events_no_truncate
  BEFORE TRUNCATE ON cms_private.activity_log_events
  FOR EACH STATEMENT EXECUTE FUNCTION cms_private.reject_activity_log_mutation();

REVOKE ALL ON FUNCTION cms_private.assert_activity_log_target(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION cms_private.reject_activity_log_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.activity_log_authorized_targets()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_activity_log_events(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activity_log_authorized_targets() TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_activity_log_events(uuid, integer, timestamptz, uuid) TO authenticated;

COMMENT ON TABLE cms_private.resume_capabilities IS
  'Server-owned per-resume feature capabilities; absent rows mean disabled.';
COMMENT ON TABLE cms_private.resume_write_modes IS
  'Server-owned per-resume/per-domain write mode; absent rows resolve to direct during migration.';
COMMENT ON TABLE cms_private.activity_log_events IS
  'Immutable append-only Activity Log events; read only through scoped RPCs.';
COMMENT ON COLUMN cms_private.resume_write_modes.domain_key IS
  'Stable keys: introduction, education, experience, awards, skills, contact, projects, website_links, profile, files.';

COMMIT;
