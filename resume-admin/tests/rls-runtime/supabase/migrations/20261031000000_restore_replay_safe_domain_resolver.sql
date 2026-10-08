-- Restore V1: resolve only the authoritative source domain for signed retries.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Restore replay-safe resolver migration must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

DO $collision_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = procedure_row.pronamespace
    WHERE namespace_row.nspname = 'public'
      AND procedure_row.proname = 'resolve_restore_domain_v1'
  ) THEN
    RAISE EXCEPTION 'Restore replay-safe domain resolver name already exists'
      USING ERRCODE = '42723';
  END IF;
END
$collision_guard$;

CREATE FUNCTION public.resolve_restore_domain_v1(target_resume_id uuid, source_event_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  authorized_site_key text;
  event_row cms_private.activity_log_events%ROWTYPE;
  domain_value text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT target_auth.resolved_site_key
    INTO authorized_site_key
    FROM cms_private.assert_activity_log_target(target_resume_id) AS target_auth;

  IF authorized_site_key IS NULL THEN
    RAISE EXCEPTION 'Restore target is not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE((
    SELECT capability.enabled
    FROM cms_private.resume_capabilities AS capability
    WHERE capability.resume_id = target_resume_id
      AND capability.capability_key = 'restore'
  ), false) THEN
    RAISE EXCEPTION 'Restore is disabled for this target' USING ERRCODE = '42501';
  END IF;

  -- Both IDs are constrained in the lookup so another target's event is indistinguishable
  -- from a nonexistent event. No current aggregate or historical state is read here.
  SELECT event.*
    INTO event_row
    FROM cms_private.activity_log_events AS event
    WHERE event.id = source_event_id
      AND event.resume_id = target_resume_id;

  IF NOT FOUND
    OR event_row.site_key_snapshot IS DISTINCT FROM authorized_site_key
    OR event_row.payload_version IS DISTINCT FROM 2
    OR event_row.operation IS DISTINCT FROM 'update' THEN
    RAISE EXCEPTION 'Restore source is not eligible' USING ERRCODE = '22023';
  END IF;

  domain_value := cms_private.restore_domain_for_event(
    event_row.section_key, event_row.entity_type, event_row.entity_id
  );

  IF domain_value IS NULL
    OR domain_value NOT IN ('awards','experience','skills','education','projects','contact','website_links')
    OR NOT cms_private.activity_event_payload_v2_is_allowed(
      event_row.section_key, event_row.entity_type, event_row.entity_id, event_row.operation,
      event_row.entity_snapshot, event_row.changes
    ) THEN
    RAISE EXCEPTION 'Restore source is not eligible' USING ERRCODE = '22023';
  END IF;

  IF cms_private.get_resume_write_mode(target_resume_id, domain_value) IS DISTINCT FROM 'rpc'
    OR NOT COALESCE((
      SELECT requirement.enabled
      FROM cms_private.resume_domain_requirements AS requirement
      WHERE requirement.resume_id = target_resume_id
        AND requirement.domain_key = domain_value
        AND requirement.requirement_key = 'trusted_network_context_v11'
    ), false) THEN
    RAISE EXCEPTION 'Restore write configuration is not enabled' USING ERRCODE = '42501';
  END IF;

  RETURN domain_value;
END
$function$;

REVOKE ALL ON FUNCTION public.resolve_restore_domain_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_restore_domain_v1(uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.resolve_restore_domain_v1(uuid,uuid) IS
  'Resolves only the authoritative supported Restore source domain for replay-safe Worker signing.';

COMMIT;
