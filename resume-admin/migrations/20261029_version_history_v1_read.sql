-- Version History V1: least-data, target-authorized read of successful supported events.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Version History V1 migration must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

CREATE FUNCTION public.read_version_history_v1(
  target_resume_id uuid,
  page_limit integer DEFAULT 25,
  before_occurred_at timestamptz DEFAULT NULL,
  before_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  event_id uuid,
  occurred_at timestamptz,
  actor_account_label text,
  actor_role text,
  domain_key text,
  operation text,
  payload_version smallint,
  entity_type text,
  entity_id text,
  comparison_kind text,
  comparison jsonb,
  has_more boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  authorized_site_key text;
BEGIN
  IF target_resume_id IS NULL THEN
    RAISE EXCEPTION 'Version History target is required' USING ERRCODE = '22023';
  END IF;
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 100 THEN
    RAISE EXCEPTION 'page_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF (before_occurred_at IS NULL) <> (before_event_id IS NULL) THEN
    RAISE EXCEPTION 'Both cursor fields must be provided together' USING ERRCODE = '22023';
  END IF;

  -- This helper checks authentication, admin/QA assignment, unpublished QA target,
  -- can_manage_resume, and the target's Activity Log capability on every call.
  SELECT context.resolved_site_key
    INTO authorized_site_key
    FROM cms_private.assert_activity_log_target(target_resume_id) AS context;

  RETURN QUERY
    WITH supported AS (
      SELECT
        event.id,
        event.occurred_at,
        CASE WHEN NULLIF(pg_catalog.btrim(event.actor_email_snapshot), '') IS NOT NULL
          THEN pg_catalog.btrim(event.actor_email_snapshot)
          WHEN event.actor_role_snapshot = 'owner' THEN 'Owner account'
          ELSE 'QA account'
        END AS actor_account_label,
        event.actor_role_snapshot AS actor_role,
        CASE
          WHEN event.section_key = 'awards' AND event.entity_type IN ('award_entry','award_list') THEN 'awards'
          WHEN event.section_key = 'experience' AND event.entity_type IN ('experience_entry','experience_list') THEN 'experience'
          WHEN event.section_key = 'skills' AND event.entity_type IN ('skill_group','skill_group_list') THEN 'skills'
          WHEN event.section_key = 'education' AND event.entity_type IN ('education_entry','education_list') THEN 'education'
          WHEN event.section_key = 'projects' AND event.entity_type IN ('project_entry','project_list') THEN 'projects'
          WHEN event.section_key = 'contact' AND event.entity_type IN ('contact_focus_item','contact_status_item','contact_section') THEN 'contact'
          WHEN event.section_key = 'profile' AND event.entity_type = 'profile_settings' THEN 'profile'
          -- Legacy profile_image events use section_key=files in the frozen schema.
          WHEN event.section_key = 'files' AND event.entity_type = 'profile_image' THEN 'profile'
          WHEN event.section_key = 'website_links' AND event.entity_type IN ('public_link','website_links_settings') THEN 'website_links'
          WHEN event.section_key = 'files' AND event.entity_type IN ('resume_file','resume_file_set') THEN 'files'
          ELSE NULL
        END AS domain_key,
        event.operation,
        event.payload_version,
        event.entity_type,
        event.entity_id,
        event.section_key,
        event.entity_snapshot,
        event.changes
      FROM cms_private.activity_log_events AS event
      WHERE event.resume_id = target_resume_id
        AND event.site_key_snapshot = authorized_site_key
        AND (before_event_id IS NULL OR (event.occurred_at, event.id) < (before_occurred_at, before_event_id))
    ), adapted AS (
      SELECT
        s.*,
        CASE
          WHEN s.payload_version = 1
            AND ((s.domain_key = 'awards' AND s.section_key = 'awards' AND s.entity_type = 'award_entry')
              OR (s.domain_key = 'experience' AND s.entity_type = 'experience_entry')
              OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group')
              OR (s.domain_key = 'education' AND s.entity_type = 'education_entry')
              OR (s.domain_key = 'projects' AND s.entity_type = 'project_entry')
              OR (s.domain_key = 'contact' AND s.entity_type IN ('contact_focus_item','contact_status_item'))
              OR (s.domain_key = 'profile' AND ((s.section_key = 'profile' AND s.entity_type = 'profile_settings')
                OR (s.section_key = 'files' AND s.entity_type = 'profile_image')))
              OR (s.domain_key = 'website_links' AND s.entity_type = 'public_link')
              OR (s.domain_key = 'files' AND s.section_key = 'files' AND s.entity_type = 'resume_file'))
            AND cms_private.activity_event_payload_is_allowed(s.entity_type, s.entity_snapshot, s.changes)
            AND s.changes <> '{}'::jsonb
            -- Version History exposes file references only, not filenames or file metadata.
            AND (s.domain_key NOT IN ('files','profile') OR s.entity_type NOT IN ('resume_file','profile_image')
              OR (s.changes - ARRAY['file_name','content_type','size_bytes']) <> '{}'::jsonb)
            THEN 'entity_fields'
          WHEN s.payload_version = 2
            AND ((s.domain_key = 'awards' AND s.entity_type = 'award_list')
              OR (s.domain_key = 'experience' AND s.entity_type = 'experience_list')
              OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group_list')
              OR (s.domain_key = 'education' AND s.entity_type = 'education_list')
              OR (s.domain_key = 'projects' AND s.entity_type = 'project_list')
              OR (s.domain_key = 'contact' AND s.entity_type = 'contact_section')
              OR (s.domain_key = 'profile' AND s.section_key = 'profile' AND s.entity_type = 'profile_settings')
              OR (s.domain_key = 'website_links' AND s.entity_type = 'website_links_settings')
              OR (s.domain_key = 'files' AND s.entity_type = 'resume_file_set'))
            AND cms_private.activity_event_payload_v2_is_allowed(
              s.section_key, s.entity_type, s.entity_id, s.operation, s.entity_snapshot, s.changes)
            THEN 'aggregate'
          ELSE 'unavailable'
        END AS comparison_kind
      FROM supported AS s
      WHERE s.domain_key IS NOT NULL
        AND (
          (s.payload_version = 1 AND (
            (s.domain_key = 'awards' AND s.entity_type = 'award_entry')
            OR (s.domain_key = 'experience' AND s.entity_type = 'experience_entry')
            OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group')
            OR (s.domain_key = 'education' AND s.entity_type = 'education_entry')
            OR (s.domain_key = 'projects' AND s.entity_type = 'project_entry')
            OR (s.domain_key = 'contact' AND s.entity_type IN ('contact_focus_item','contact_status_item'))
            OR (s.domain_key = 'profile' AND s.entity_type IN ('profile_settings','profile_image'))
            OR (s.domain_key = 'website_links' AND s.entity_type = 'public_link')
            OR (s.domain_key = 'files' AND s.entity_type = 'resume_file')
          ))
          OR (s.payload_version = 2 AND (
            (s.domain_key = 'awards' AND s.entity_type = 'award_list')
            OR (s.domain_key = 'experience' AND s.entity_type = 'experience_list')
            OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group_list')
            OR (s.domain_key = 'education' AND s.entity_type = 'education_list')
            OR (s.domain_key = 'projects' AND s.entity_type = 'project_list')
            OR (s.domain_key = 'contact' AND s.entity_type = 'contact_section')
            OR (s.domain_key = 'profile' AND s.entity_type = 'profile_settings' AND s.section_key = 'profile')
            OR (s.domain_key = 'website_links' AND s.entity_type = 'website_links_settings')
            OR (s.domain_key = 'files' AND s.entity_type = 'resume_file_set')
          ))
          OR s.payload_version NOT IN (1,2)
        )
    ), limited AS (
      SELECT
        a.*,
        CASE
          WHEN a.comparison_kind = 'entity_fields' AND a.domain_key IN ('files','profile') AND a.entity_type IN ('resume_file','profile_image')
            THEN pg_catalog.jsonb_build_object('changes', a.changes - ARRAY['file_name','content_type','size_bytes'])
          WHEN a.comparison_kind = 'entity_fields' THEN pg_catalog.jsonb_build_object('changes', a.changes)
          WHEN a.comparison_kind = 'aggregate' THEN pg_catalog.jsonb_build_object(
            'before', a.changes->a.domain_key->'before',
            'after', a.changes->a.domain_key->'after'
          )
          ELSE NULL::jsonb
        END AS comparison
      FROM adapted AS a
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT page_limit + 1
    ), ranked AS (
      SELECT l.*, pg_catalog.row_number() OVER (ORDER BY l.occurred_at DESC, l.id DESC) AS row_number,
        pg_catalog.count(*) OVER () AS candidate_count
      FROM limited AS l
    )
    SELECT ranked.id,
      ranked.occurred_at,
      ranked.actor_account_label,
      ranked.actor_role,
      ranked.domain_key,
      ranked.operation,
      ranked.payload_version,
      ranked.entity_type,
      CASE WHEN ranked.entity_type IN ('resume_file','profile_image') THEN NULL ELSE ranked.entity_id END,
      ranked.comparison_kind,
      ranked.comparison,
      ranked.candidate_count > page_limit
    FROM ranked
    WHERE ranked.row_number <= page_limit
    ORDER BY ranked.occurred_at DESC, ranked.id DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.read_version_history_v1(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_version_history_v1(uuid, integer, timestamptz, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.read_version_history_v1(uuid, integer, timestamptz, uuid) IS
  'Least-data, target-authorized Version History V1 read of successful supported Activity Log events. Unknown or malformed payloads return safe generic entries.';

COMMIT;
