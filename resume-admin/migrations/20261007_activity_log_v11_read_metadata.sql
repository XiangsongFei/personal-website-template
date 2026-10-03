-- Activity Log V1.1 read-only location metadata projection.
-- Preserve the existing scoped RPC and add only the event-time metadata fields.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Activity Log metadata migration must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

-- PostgreSQL cannot change a RETURNS TABLE row type with CREATE OR REPLACE.
-- Drop/recreate atomically without CASCADE; an unexpected dependent object aborts safely.
DROP FUNCTION public.read_activity_log_events(uuid, integer, timestamptz, uuid);

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
           event.entity_snapshot, event.changes, event.payload_version,
           event.ip_network, event.country_code, event.region, event.city
    FROM cms_private.activity_log_events AS event
    WHERE event.resume_id = target_resume_id
      AND (before_id IS NULL OR (event.occurred_at, event.id) < (before_occurred_at, before_id))
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT page_limit;
END
$function$;

REVOKE ALL ON FUNCTION public.read_activity_log_events(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_activity_log_events(uuid, integer, timestamptz, uuid)
  TO authenticated;

COMMIT;
