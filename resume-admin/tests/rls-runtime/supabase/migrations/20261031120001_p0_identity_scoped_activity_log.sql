-- Restrict Admin data and Activity Log access to the exact Owner and Test targets.
-- This is a forward-only authorization correction. It changes no rows or capabilities.
BEGIN;

DO $migration_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Identity-scoped Admin authorization must be installed as postgres'
      USING ERRCODE = '42501';
  END IF;
  IF to_regclass('public.resume_sites') IS NULL
    OR to_regclass('public.cms_admins') IS NULL
    OR to_regclass('cms_private.resume_capabilities') IS NULL
    OR to_regclass('cms_private.activity_log_events') IS NULL THEN
    RAISE EXCEPTION 'Required Admin authorization schema is incomplete';
  END IF;
END
$migration_guard$;

CREATE OR REPLACE FUNCTION public.can_manage_resume(target_resume_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT pg_catalog.count(*) = 1
       FROM public.cms_admins AS admin
      WHERE admin.user_id = (SELECT auth.uid()))
    AND (
      (public.is_resume_owner()
       AND EXISTS (
         SELECT 1
           FROM public.cms_admins AS admin
           JOIN public.resume_sites AS site ON site.site_key = 'example-cv'
          WHERE admin.user_id = (SELECT auth.uid())
            AND admin.role = 'owner'
            AND admin.resume_id IS NULL
            AND site.id = target_resume_id
       ))
      OR EXISTS (
        SELECT 1
          FROM public.cms_admins AS admin
          JOIN public.resume_sites AS site ON site.id = admin.resume_id
         WHERE admin.user_id = (SELECT auth.uid())
           AND admin.role = 'qa'
           AND admin.resume_id = target_resume_id
           AND site.site_key = 'example-cv-qa-activity-log'
           AND site.is_published IS FALSE
      )
    ), false
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_resume_target()
RETURNS TABLE (resume_id uuid, site_key text, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  membership public.cms_admins%ROWTYPE;
  matching_targets integer;
BEGIN
  IF caller_id IS NULL OR (SELECT pg_catalog.count(*) FROM public.cms_admins AS admin
                            WHERE admin.user_id = caller_id) <> 1 THEN
    RETURN;
  END IF;

  SELECT admin.* INTO membership
    FROM public.cms_admins AS admin
   WHERE admin.user_id = caller_id;

  IF membership.role = 'owner' AND membership.resume_id IS NULL
     AND public.is_resume_owner() THEN
    SELECT pg_catalog.count(*) INTO matching_targets
      FROM public.resume_sites AS site
     WHERE site.site_key = 'example-cv';
    IF matching_targets <> 1 THEN RETURN; END IF;
    RETURN QUERY
      SELECT site.id, site.site_key, 'owner'::text
        FROM public.resume_sites AS site
       WHERE site.site_key = 'example-cv';
  ELSIF membership.role = 'qa' AND membership.resume_id IS NOT NULL THEN
    RETURN QUERY
      SELECT site.id, site.site_key, 'qa'::text
        FROM public.resume_sites AS site
       WHERE site.id = membership.resume_id
         AND site.site_key = 'example-cv-qa-activity-log'
         AND site.is_published IS FALSE
         AND public.can_manage_resume(site.id);
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.activity_log_authorized_targets()
RETURNS TABLE (resume_id uuid, site_key text, role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  membership public.cms_admins%ROWTYPE;
  matching_targets integer;
BEGIN
  IF caller_id IS NULL OR (SELECT pg_catalog.count(*) FROM public.cms_admins AS admin
                            WHERE admin.user_id = caller_id) <> 1 THEN
    RETURN;
  END IF;

  SELECT admin.* INTO membership
    FROM public.cms_admins AS admin
   WHERE admin.user_id = caller_id;

  IF membership.role = 'owner' AND membership.resume_id IS NULL
     AND public.is_resume_owner() THEN
    SELECT pg_catalog.count(*) INTO matching_targets
      FROM public.resume_sites AS site
     WHERE site.site_key = 'example-cv';
    IF matching_targets <> 1 THEN RETURN; END IF;
    RETURN QUERY
      SELECT site.id, site.site_key, 'owner'::text
        FROM public.resume_sites AS site
       WHERE site.site_key = 'example-cv'
         AND public.can_manage_resume(site.id)
         AND EXISTS (
           SELECT 1 FROM cms_private.resume_capabilities AS capability
            WHERE capability.resume_id = site.id
              AND capability.capability_key = 'activity_log'
              AND capability.enabled
         );
  ELSIF membership.role = 'qa' AND membership.resume_id IS NOT NULL THEN
    RETURN QUERY
      SELECT site.id, site.site_key, 'qa'::text
        FROM public.resume_sites AS site
       WHERE site.id = membership.resume_id
         AND site.site_key = 'example-cv-qa-activity-log'
         AND site.is_published IS FALSE
         AND public.can_manage_resume(site.id)
         AND EXISTS (
           SELECT 1 FROM cms_private.resume_capabilities AS capability
            WHERE capability.resume_id = site.id
              AND capability.capability_key = 'activity_log'
              AND capability.enabled
         );
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION cms_private.assert_activity_log_target(target_resume_id uuid)
RETURNS TABLE (resolved_site_key text, resolved_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  membership public.cms_admins%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.cms_admins AS admin
       WHERE admin.user_id = caller_id) <> 1 THEN
    RAISE EXCEPTION 'Admin authorization required' USING ERRCODE = '42501';
  END IF;
  SELECT admin.* INTO membership
    FROM public.cms_admins AS admin
   WHERE admin.user_id = caller_id;

  IF membership.role = 'owner' AND membership.resume_id IS NULL
     AND public.is_resume_owner() THEN
    SELECT site.site_key INTO resolved_site_key
      FROM public.resume_sites AS site
     WHERE site.id = target_resume_id
       AND site.site_key = 'example-cv'
       AND public.can_manage_resume(site.id);
  ELSIF membership.role = 'qa' AND membership.resume_id = target_resume_id THEN
    SELECT site.site_key INTO resolved_site_key
      FROM public.resume_sites AS site
     WHERE site.id = target_resume_id
       AND site.site_key = 'example-cv-qa-activity-log'
       AND site.is_published IS FALSE
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

  resolved_role := membership.role;
  RETURN NEXT;
END
$function$;

CREATE OR REPLACE FUNCTION cms_private.assert_activity_log_read_target(target_resume_id uuid)
RETURNS TABLE (resolved_site_key text, resolved_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
    SELECT authorized.resolved_site_key, authorized.resolved_role
      FROM cms_private.assert_activity_log_target(target_resume_id) AS authorized;
END
$function$;

-- Keep the system-event writer on the same exact identity-to-target boundary.
CREATE OR REPLACE FUNCTION cms_private.assert_activity_log_system_event_target(target_resume_id uuid)
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
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  SELECT admin.role, admin.resume_id INTO caller_role, caller_resume_id
    FROM public.cms_admins AS admin WHERE admin.user_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  IF caller_role = 'owner' AND caller_resume_id IS NULL THEN
    SELECT site.site_key INTO resolved_site_key FROM public.resume_sites AS site
      WHERE site.id = target_resume_id
        AND site.site_key = 'example-cv'
        AND public.can_manage_resume(site.id);
  ELSIF caller_role = 'qa' AND caller_resume_id = target_resume_id THEN
    SELECT site.site_key INTO resolved_site_key FROM public.resume_sites AS site
      WHERE site.id = target_resume_id
        AND site.site_key = 'example-cv-qa-activity-log'
        AND site.is_published IS FALSE
        AND public.can_manage_resume(site.id);
  ELSE
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;

  IF resolved_site_key IS NULL THEN
    RAISE EXCEPTION 'Activity Log access denied' USING ERRCODE = '42501';
  END IF;
  resolved_role := caller_role;
  RETURN NEXT;
END
$function$;

DROP POLICY IF EXISTS cms_owner_manage_resume_sites ON public.resume_sites;
CREATE POLICY cms_owner_manage_resume_sites ON public.resume_sites
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_resume_owner() AND site_key = 'example-cv')
  WITH CHECK (public.is_resume_owner() AND site_key = 'example-cv');

COMMIT;
