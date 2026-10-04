-- Activity Log V1.3C-1: additive unified read path for successful activity
-- and rejected operations. Existing V1/V1.2 read RPCs remain unchanged.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Activity Log V1.3C migration must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

-- source_rank is a stable pagination protocol value: activity=1, system=2.
-- With descending ordering, a same-time/same-UUID system row precedes activity.
CREATE FUNCTION public.read_activity_log_events_v13c(
  target_resume_id uuid,
  page_limit integer DEFAULT 50,
  before_occurred_at timestamptz DEFAULT NULL,
  before_id uuid DEFAULT NULL,
  before_source_rank integer DEFAULT NULL,
  event_filter text DEFAULT 'all',
  section_filter text DEFAULT NULL,
  operation_filter text DEFAULT NULL,
  actor_email_filter text DEFAULT NULL,
  date_from timestamptz DEFAULT NULL,
  date_to_exclusive timestamptz DEFAULT NULL,
  search_query text DEFAULT NULL
)
RETURNS TABLE (
  event_source text,
  source_rank integer,
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
  event_kind text,
  outcome text,
  failure_stage text,
  failure_code text,
  request_id uuid,
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
  normalized_event_filter text;
  normalized_section_filter text;
  normalized_operation_filter text;
  normalized_actor_filter text;
  normalized_search text;
  escaped_search text;
  authorization_context record;
BEGIN
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 100 THEN
    RAISE EXCEPTION 'page_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    (before_occurred_at IS NULL AND before_id IS NULL AND before_source_rank IS NULL)
    OR
    (before_occurred_at IS NOT NULL AND before_id IS NOT NULL AND before_source_rank IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'All cursor fields must be provided together' USING ERRCODE = '22023';
  END IF;
  IF before_source_rank IS NOT NULL AND before_source_rank NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Invalid Activity Log cursor source rank' USING ERRCODE = '22023';
  END IF;

  normalized_event_filter := COALESCE(pg_catalog.lower(pg_catalog.btrim(event_filter)), 'all');
  normalized_section_filter := NULLIF(pg_catalog.btrim(section_filter), '');
  normalized_operation_filter := NULLIF(pg_catalog.lower(pg_catalog.btrim(operation_filter)), '');
  normalized_actor_filter := NULLIF(pg_catalog.lower(pg_catalog.btrim(actor_email_filter)), '');
  normalized_search := NULLIF(pg_catalog.btrim(search_query), '');

  IF normalized_event_filter NOT IN ('all', 'successful', 'rejected') THEN
    RAISE EXCEPTION 'Invalid Activity Log event filter' USING ERRCODE = '22023';
  END IF;
  IF normalized_section_filter IS NOT NULL AND normalized_section_filter NOT IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files'
  ) THEN
    RAISE EXCEPTION 'Invalid Activity Log section filter' USING ERRCODE = '22023';
  END IF;
  IF normalized_operation_filter IS NOT NULL AND normalized_operation_filter NOT IN (
    'create', 'update', 'delete', 'reorder', 'upload', 'remove'
  ) THEN
    RAISE EXCEPTION 'Invalid Activity Log operation filter' USING ERRCODE = '22023';
  END IF;
  IF date_from IS NOT NULL AND date_to_exclusive IS NOT NULL AND date_to_exclusive <= date_from THEN
    RAISE EXCEPTION 'Invalid Activity Log date range' USING ERRCODE = '22023';
  END IF;
  IF normalized_search IS NOT NULL AND pg_catalog.char_length(normalized_search) > 128 THEN
    RAISE EXCEPTION 'Activity Log search query is too long' USING ERRCODE = '22023';
  END IF;

  SELECT context.resolved_site_key, context.resolved_role
    INTO authorization_context
    FROM cms_private.assert_activity_log_target(target_resume_id) AS context;

  IF normalized_search IS NOT NULL THEN
    escaped_search := '%' || pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(normalized_search, E'\\', E'\\\\'),
        '%', E'\\%'
      ),
      '_', E'\\_'
    ) || '%';
  END IF;

  RETURN QUERY
    WITH unified_events AS (
      SELECT
        'activity'::text AS event_source,
        1::integer AS source_rank,
        event.id AS id,
        event.occurred_at AS occurred_at,
        event.actor_user_id AS actor_user_id,
        event.actor_email_snapshot AS actor_email_snapshot,
        event.actor_role_snapshot AS actor_role_snapshot,
        event.resume_id AS resume_id,
        event.site_key_snapshot AS site_key_snapshot,
        event.operation AS operation,
        event.section_key AS section_key,
        event.entity_type AS entity_type,
        event.entity_id AS entity_id,
        event.entity_snapshot AS entity_snapshot,
        event.changes AS changes,
        event.payload_version AS payload_version,
        NULL::text AS event_kind,
        NULL::text AS outcome,
        NULL::text AS failure_stage,
        NULL::text AS failure_code,
        NULL::uuid AS request_id,
        event.ip_network AS ip_network,
        event.country_code AS country_code,
        event.region AS region,
        event.city AS city
      FROM cms_private.activity_log_events AS event
      WHERE event.resume_id = target_resume_id
        AND normalized_event_filter IN ('all', 'successful')
        AND (normalized_section_filter IS NULL OR event.section_key = normalized_section_filter)
        AND (normalized_operation_filter IS NULL OR event.operation = normalized_operation_filter)
        AND (normalized_actor_filter IS NULL OR pg_catalog.lower(event.actor_email_snapshot) = normalized_actor_filter)
        AND (date_from IS NULL OR event.occurred_at >= date_from)
        AND (date_to_exclusive IS NULL OR event.occurred_at < date_to_exclusive)
        AND (normalized_search IS NULL OR pg_catalog.concat_ws(
          ' ', event.section_key, event.entity_type, event.entity_id, event.changes::text
        ) ILIKE escaped_search ESCAPE E'\\')

      UNION ALL

      SELECT
        'system'::text AS event_source,
        2::integer AS source_rank,
        event.event_id AS id,
        event.occurred_at AS occurred_at,
        event.actor_user_id AS actor_user_id,
        event.actor_email_snapshot AS actor_email_snapshot,
        event.actor_role_snapshot AS actor_role_snapshot,
        event.resume_id AS resume_id,
        event.site_key_snapshot AS site_key_snapshot,
        event.operation AS operation,
        event.section_key AS section_key,
        NULL::text AS entity_type,
        NULL::text AS entity_id,
        NULL::jsonb AS entity_snapshot,
        NULL::jsonb AS changes,
        NULL::smallint AS payload_version,
        event.event_kind AS event_kind,
        event.outcome AS outcome,
        event.failure_stage AS failure_stage,
        event.failure_code AS failure_code,
        event.request_id AS request_id,
        event.ip_network AS ip_network,
        event.country_code AS country_code,
        event.region AS region,
        event.city AS city
      FROM cms_private.activity_log_system_events AS event
      WHERE event.resume_id = target_resume_id
        AND event.event_kind = 'operation_failure'
        AND event.outcome = 'rejected'
        AND normalized_event_filter IN ('all', 'rejected')
        AND (normalized_section_filter IS NULL OR event.section_key = normalized_section_filter)
        AND (normalized_operation_filter IS NULL OR event.operation = normalized_operation_filter)
        AND (normalized_actor_filter IS NULL OR pg_catalog.lower(event.actor_email_snapshot) = normalized_actor_filter)
        AND (date_from IS NULL OR event.occurred_at >= date_from)
        AND (date_to_exclusive IS NULL OR event.occurred_at < date_to_exclusive)
        AND (normalized_search IS NULL OR pg_catalog.concat_ws(
          ' ', event.section_key, event.operation, event.failure_stage,
          event.failure_code, event.request_id::text
        ) ILIKE escaped_search ESCAPE E'\\')
    )
    SELECT unified_events.event_source,
           unified_events.source_rank,
           unified_events.id,
           unified_events.occurred_at,
           unified_events.actor_user_id,
           unified_events.actor_email_snapshot,
           unified_events.actor_role_snapshot,
           unified_events.resume_id,
           unified_events.site_key_snapshot,
           unified_events.operation,
           unified_events.section_key,
           unified_events.entity_type,
           unified_events.entity_id,
           unified_events.entity_snapshot,
           unified_events.changes,
           unified_events.payload_version,
           unified_events.event_kind,
           unified_events.outcome,
           unified_events.failure_stage,
           unified_events.failure_code,
           unified_events.request_id,
           unified_events.ip_network,
           unified_events.country_code,
           unified_events.region,
           unified_events.city
    FROM unified_events
    WHERE before_id IS NULL
       OR unified_events.occurred_at < before_occurred_at
       OR (unified_events.occurred_at = before_occurred_at AND unified_events.id < before_id)
       OR (unified_events.occurred_at = before_occurred_at
           AND unified_events.id = before_id
           AND unified_events.source_rank < before_source_rank)
    ORDER BY unified_events.occurred_at DESC,
             unified_events.id DESC,
             unified_events.source_rank DESC
    LIMIT page_limit;
END
$function$;

REVOKE ALL ON FUNCTION public.read_activity_log_events_v13c(
  uuid, integer, timestamptz, uuid, integer, text, text, text, text,
  timestamptz, timestamptz, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_activity_log_events_v13c(
  uuid, integer, timestamptz, uuid, integer, text, text, text, text,
  timestamptz, timestamptz, text
) TO authenticated;

COMMENT ON FUNCTION public.read_activity_log_events_v13c(
  uuid, integer, timestamptz, uuid, integer, text, text, text, text,
  timestamptz, timestamptz, text
) IS 'V1.3C unified target-scoped read of successful activity and rejected operation failures. source_rank is activity=1, system=2.';

COMMIT;
