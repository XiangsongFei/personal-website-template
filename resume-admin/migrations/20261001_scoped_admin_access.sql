-- Scope Admin CMS and Storage writes by resume while preserving the existing
-- Owner membership and published public-read policies.
-- This migration is intentionally not applied from the application.

BEGIN;

ALTER TABLE public.cms_admins
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS resume_id uuid REFERENCES public.resume_sites(id) ON DELETE CASCADE;

-- Existing membership is the existing Owner. Never infer Owner for future rows.
UPDATE public.cms_admins
SET role = 'owner', resume_id = NULL
WHERE role IS NULL;

ALTER TABLE public.cms_admins
  ALTER COLUMN role SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cms_admins'::regclass
      AND conname = 'cms_admins_role_scope_check'
  ) THEN
    ALTER TABLE public.cms_admins
      ADD CONSTRAINT cms_admins_role_scope_check
      CHECK ((role = 'owner' AND resume_id IS NULL) OR (role = 'qa' AND resume_id IS NOT NULL));
  END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS cms_admins_one_qa_per_resume
  ON public.cms_admins (resume_id) WHERE role = 'qa';

CREATE OR REPLACE FUNCTION public.is_resume_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.cms_admins AS admin
    WHERE admin.user_id = (SELECT auth.uid())
      AND admin.role = 'owner'
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_resume(target_resume_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (public.is_resume_owner() AND EXISTS (
      SELECT 1 FROM public.resume_sites AS site
      WHERE site.id = target_resume_id AND site.site_key IN ('example-cv', 'example-cv-qa')
        AND (site.site_key <> 'example-cv-qa' OR site.is_published = false)
    ))
    OR EXISTS (
      SELECT 1
      FROM public.cms_admins AS admin
      JOIN public.resume_sites AS site ON site.id = admin.resume_id
      WHERE admin.user_id = (SELECT auth.uid())
        AND admin.role = 'qa'
        AND admin.resume_id = target_resume_id
        AND site.site_key = 'example-cv-qa'
        AND site.is_published = false
    ),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_admin_resume_target()
RETURNS TABLE (resume_id uuid, site_key text, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT site.id, site.site_key, admin.role
  FROM public.cms_admins AS admin
  JOIN public.resume_sites AS site
    ON (admin.role = 'owner' AND site.site_key = 'example-cv')
    OR (admin.role = 'qa' AND site.id = admin.resume_id
        AND site.site_key = 'example-cv-qa' AND site.is_published = false)
  WHERE admin.user_id = (SELECT auth.uid())
    AND (SELECT pg_catalog.count(*) FROM public.cms_admins AS membership
         WHERE membership.user_id = (SELECT auth.uid())) = 1
  ORDER BY site.id
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.is_resume_owner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_resume(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_resume_target() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_resume_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_resume(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_resume_target() TO authenticated;

-- Membership is managed out of band; authenticated users must not grant,
-- remove, or re-scope memberships through the Data API.
DO $lock_memberships$
DECLARE
  policy_row record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'cms_admins' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on public.cms_admins';
  END IF;
  FOR policy_row IN
    SELECT policyname FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'cms_admins'
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY %I ON public.cms_admins', policy_row.policyname);
  END LOOP;
END
$lock_memberships$;

-- Dynamic policy removal is restricted to the CMS table allowlist. Preserve
-- pure SELECT policies (including published reads), but replace every policy
-- that can grant writes so no parallel permissive policy bypasses resume scope.
DO $replace_cms_policies$
DECLARE
  table_name text;
  policy_row record;
  content_tables constant text[] := ARRAY[
    'resume_profile', 'resume_profile_translations', 'resume_public_links',
    'resume_locale_content', 'resume_intro_paragraphs',
    'resume_intro_paragraph_translations', 'resume_navigation_items',
    'resume_navigation_item_translations', 'resume_education_entries',
    'resume_education_translations', 'resume_experience_entries',
    'resume_experience_translations', 'resume_project_entries',
    'resume_project_translations', 'resume_project_methods',
    'resume_skill_groups', 'resume_skill_group_translations',
    'resume_award_entries', 'resume_award_translations',
    'resume_contact_focus_items', 'resume_contact_focus_translations',
    'resume_contact_status_items', 'resume_contact_status_translations'
  ];
BEGIN
  FOREACH table_name IN ARRAY content_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS must be enabled on public.% before scoped policies are installed', table_name;
    END IF;

    FOR policy_row IN
      SELECT policyname FROM pg_catalog.pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
        AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I', policy_row.policyname, table_name);
    END LOOP;

    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS cms_admin_scoped_all ON public.%I', table_name);
    EXECUTE pg_catalog.format(
      'CREATE POLICY cms_admin_scoped_all ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (public.can_manage_resume(resume_id)) WITH CHECK (public.can_manage_resume(resume_id))',
      table_name
    );
  END LOOP;
END
$replace_cms_policies$;

-- The resume_sites root is Owner-managed only. QA can read its bound root
-- through this policy, but cannot create, publish, rename, or delete roots.
DO $replace_site_policies$
DECLARE
  policy_row record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'resume_sites' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS must be enabled on public.resume_sites';
  END IF;
  FOR policy_row IN
    SELECT policyname FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_sites'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE pg_catalog.format('DROP POLICY %I ON public.resume_sites', policy_row.policyname);
  END LOOP;
  DROP POLICY IF EXISTS cms_owner_manage_resume_sites ON public.resume_sites;
  DROP POLICY IF EXISTS cms_qa_read_bound_resume_site ON public.resume_sites;
  CREATE POLICY cms_owner_manage_resume_sites ON public.resume_sites
    AS PERMISSIVE FOR ALL TO authenticated
    USING (public.is_resume_owner()) WITH CHECK (public.is_resume_owner());
  CREATE POLICY cms_qa_read_bound_resume_site ON public.resume_sites
    AS PERMISSIVE FOR SELECT TO authenticated
    USING (public.can_manage_resume(id));
END
$replace_site_policies$;

-- Legacy official objects remain at their existing paths. Only Owners may
-- manage those paths. New UUID-rooted paths are scoped through CMS membership.
CREATE OR REPLACE FUNCTION public.can_manage_resume_storage_object(target_bucket text, object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  path_resume_id uuid;
BEGIN
  IF target_bucket IS NULL OR target_bucket NOT IN ('profile-images', 'resume-files') OR object_name IS NULL THEN
    RETURN false;
  END IF;

  IF target_bucket = 'profile-images' AND object_name ~ '^example-cv/profile/[^/]+\.(jpg|jpeg|png|webp)$' THEN
    RETURN public.is_resume_owner() AND public.can_manage_resume(
      (SELECT site.id FROM public.resume_sites AS site WHERE site.site_key = 'example-cv')
    );
  END IF;
  IF target_bucket = 'resume-files' AND object_name IN ('example-cv/resume_zh.pdf', 'example-cv/resume_en.pdf') THEN
    RETURN public.is_resume_owner();
  END IF;

  IF pg_catalog.split_part(object_name, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  path_resume_id := pg_catalog.split_part(object_name, '/', 1)::uuid;
  IF target_bucket = 'profile-images'
    AND object_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/profile/[^/]+\.(jpg|jpeg|png|webp)$' THEN
    RETURN false;
  END IF;
  IF target_bucket = 'resume-files'
    AND object_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/resume_(zh|en)\.pdf$' THEN
    RETURN false;
  END IF;
  RETURN public.can_manage_resume(path_resume_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.can_manage_resume_storage_object(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_resume_storage_object(text, text) TO authenticated;

DO $replace_storage_policies$
DECLARE
  bucket_name text;
  bucket_slug text;
  policy_row record;
BEGIN
  FOREACH bucket_name IN ARRAY ARRAY['profile-images', 'resume-files'] LOOP
    bucket_slug := replace(bucket_name, '-', '_');
    FOR policy_row IN
      SELECT policyname FROM pg_catalog.pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND pg_catalog.strpos(COALESCE(qual, '') || ' ' || COALESCE(with_check, ''), bucket_name) > 0
        AND (
          (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) ~* 'is_resume_admin'
          OR cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
        )
    LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON storage.objects', policy_row.policyname);
    END LOOP;

    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON storage.objects', 'cms_admin_scoped_' || bucket_slug || '_select');
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON storage.objects', 'cms_admin_scoped_' || bucket_slug || '_insert');
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON storage.objects', 'cms_admin_scoped_' || bucket_slug || '_update');
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS %I ON storage.objects', 'cms_admin_scoped_' || bucket_slug || '_delete');

    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (bucket_id = %L AND public.can_manage_resume_storage_object(bucket_id, name))',
      'cms_admin_scoped_' || bucket_slug || '_select', bucket_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND public.can_manage_resume_storage_object(bucket_id, name))',
      'cms_admin_scoped_' || bucket_slug || '_insert', bucket_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (bucket_id = %L AND public.can_manage_resume_storage_object(bucket_id, name)) WITH CHECK (bucket_id = %L AND public.can_manage_resume_storage_object(bucket_id, name))',
      'cms_admin_scoped_' || bucket_slug || '_update', bucket_name, bucket_name
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (bucket_id = %L AND public.can_manage_resume_storage_object(bucket_id, name))',
      'cms_admin_scoped_' || bucket_slug || '_delete', bucket_name
    );
  END LOOP;
END
$replace_storage_policies$;

COMMIT;
