-- TEST ONLY. Reconstructs two already-installed Production baseline details
-- absent from the older local runtime schema: the Test snapshot key and the
-- pre-correction read assertion helper. This is never staged for deployment.
ALTER TABLE cms_private.activity_log_events
  DROP CONSTRAINT IF EXISTS activity_log_events_site_key_snapshot_check;
ALTER TABLE cms_private.activity_log_events
  ADD CONSTRAINT activity_log_events_site_key_snapshot_check
  CHECK (site_key_snapshot IN (
    'example-cv',
    'example-cv-qa',
    'example-cv-qa-activity-log'
  ));

ALTER TABLE cms_private.activity_log_system_events
  DROP CONSTRAINT IF EXISTS activity_log_system_events_site_key_snapshot_check;
ALTER TABLE cms_private.activity_log_system_events
  ADD CONSTRAINT activity_log_system_events_site_key_snapshot_check
  CHECK (site_key_snapshot IN (
    'example-cv',
    'example-cv-qa',
    'example-cv-qa-activity-log'
  ));

CREATE FUNCTION cms_private.assert_activity_log_read_target(target_resume_id uuid)
RETURNS TABLE (resolved_site_key text, resolved_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE caller_role text; caller_resume_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT admin.role, admin.resume_id INTO caller_role, caller_resume_id
    FROM public.cms_admins AS admin WHERE admin.user_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin authorization required' USING ERRCODE = '42501';
  END IF;
  IF caller_role = 'owner' AND caller_resume_id IS NULL THEN
    SELECT site.site_key INTO resolved_site_key FROM public.resume_sites AS site
      WHERE site.id = target_resume_id
        AND site.site_key IN ('example-cv', 'example-cv-qa', 'example-cv-qa-activity-log')
        AND (site.site_key = 'example-cv' OR site.is_published IS FALSE);
  ELSIF caller_role = 'qa' AND caller_resume_id = target_resume_id THEN
    SELECT site.site_key INTO resolved_site_key FROM public.resume_sites AS site
      WHERE site.id = target_resume_id
        AND site.site_key IN ('example-cv-qa', 'example-cv-qa-activity-log')
        AND site.is_published IS FALSE;
  ELSE
    RAISE EXCEPTION 'Activity Log target is outside the caller scope' USING ERRCODE = '42501';
  END IF;
  IF resolved_site_key IS NULL THEN
    RAISE EXCEPTION 'Activity Log target is not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE((SELECT capability.enabled FROM cms_private.resume_capabilities AS capability
    WHERE capability.resume_id = target_resume_id AND capability.capability_key = 'activity_log'), false) THEN
    RAISE EXCEPTION 'Activity Log is disabled for this target' USING ERRCODE = '42501';
  END IF;
  resolved_role := caller_role;
  RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.assert_activity_log_read_target(uuid) FROM PUBLIC, anon, authenticated, service_role;
