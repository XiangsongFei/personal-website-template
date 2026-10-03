-- Activity Log V1.2: additive, target-scoped filtered read path.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Activity Log V1.2 migration must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

CREATE FUNCTION public.read_activity_log_events_v12(
  target_resume_id uuid,
  page_limit integer DEFAULT 50,
  before_occurred_at timestamptz DEFAULT NULL,
  before_id uuid DEFAULT NULL,
  section_filter text DEFAULT NULL,
  operation_filter text DEFAULT NULL,
  actor_email_filter text DEFAULT NULL,
  date_from timestamptz DEFAULT NULL,
  date_to_exclusive timestamptz DEFAULT NULL,
  search_query text DEFAULT NULL
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
  payload_version smallint,
  ip_network cidr,
  country_code text,
  region text,
  city text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  escaped_search text;
  authorization_context record;
BEGIN
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 100 THEN
    RAISE EXCEPTION 'page_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF (before_occurred_at IS NULL) <> (before_id IS NULL) THEN
    RAISE EXCEPTION 'Both cursor fields must be provided together' USING ERRCODE = '22023';
  END IF;

  section_filter := NULLIF(pg_catalog.btrim(section_filter), '');
  operation_filter := NULLIF(pg_catalog.lower(pg_catalog.btrim(operation_filter)), '');
  actor_email_filter := NULLIF(pg_catalog.lower(pg_catalog.btrim(actor_email_filter)), '');
  search_query := NULLIF(pg_catalog.btrim(search_query), '');

  IF section_filter IS NOT NULL AND section_filter NOT IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  ) THEN
    RAISE EXCEPTION 'Invalid Activity Log section filter' USING ERRCODE = '22023';
  END IF;
  IF operation_filter IS NOT NULL AND operation_filter NOT IN (
    'create', 'update', 'delete', 'reorder', 'upload', 'remove'
  ) THEN
    RAISE EXCEPTION 'Invalid Activity Log operation filter' USING ERRCODE = '22023';
  END IF;
  IF date_from IS NOT NULL AND date_to_exclusive IS NOT NULL AND date_to_exclusive <= date_from THEN
    RAISE EXCEPTION 'Invalid Activity Log date range' USING ERRCODE = '22023';
  END IF;
  IF search_query IS NOT NULL AND pg_catalog.char_length(search_query) > 128 THEN
    RAISE EXCEPTION 'Activity Log search query is too long' USING ERRCODE = '22023';
  END IF;

  SELECT context.resolved_site_key, context.resolved_role
  INTO authorization_context
  FROM cms_private.assert_activity_log_target(target_resume_id) AS context;

  IF search_query IS NOT NULL THEN
    escaped_search := '%' || pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(search_query, E'\\', E'\\\\'),
        '%', E'\\%'
      ),
      '_', E'\\_'
    ) || '%';
  END IF;

  RETURN QUERY
    SELECT event.id, event.occurred_at, event.actor_user_id, event.actor_email_snapshot,
           event.actor_role_snapshot, event.resume_id, event.site_key_snapshot,
           event.operation, event.section_key, event.entity_type, event.entity_id,
           event.entity_snapshot, event.changes, event.payload_version,
           event.ip_network, event.country_code, event.region, event.city
    FROM cms_private.activity_log_events AS event
    WHERE event.resume_id = target_resume_id
      AND (before_id IS NULL OR (event.occurred_at, event.id) < (before_occurred_at, before_id))
      AND (section_filter IS NULL OR event.section_key = section_filter)
      AND (operation_filter IS NULL OR event.operation = operation_filter)
      AND (actor_email_filter IS NULL OR pg_catalog.lower(event.actor_email_snapshot) = actor_email_filter)
      AND (date_from IS NULL OR event.occurred_at >= date_from)
      AND (date_to_exclusive IS NULL OR event.occurred_at < date_to_exclusive)
      AND (search_query IS NULL OR pg_catalog.concat_ws(' ', event.section_key, event.entity_type, event.entity_id, event.changes::text)
        ILIKE escaped_search ESCAPE E'\\')
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT page_limit;
END
$function$;

REVOKE ALL ON FUNCTION public.read_activity_log_events_v12(uuid, integer, timestamptz, uuid, text, text, text, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_activity_log_events_v12(uuid, integer, timestamptz, uuid, text, text, text, timestamptz, timestamptz, text)
  TO authenticated;

COMMIT;
