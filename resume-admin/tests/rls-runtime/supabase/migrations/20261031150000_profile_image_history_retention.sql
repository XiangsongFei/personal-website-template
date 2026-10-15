-- Retain every profile image while Profile snapshots or retained history may reference it.
-- This migration deliberately disables authenticated object replacement/deletion only
-- for profile-images. New uploads remain INSERT-only and use unique paths.
BEGIN;

DO $profile_image_policy_preflight$
DECLARE
  target_policy record;
  unexpected_count integer;
BEGIN
  FOR target_policy IN
    SELECT policyname, cmd, roles, permissive, qual, with_check
    FROM pg_catalog.pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN (
        'cms_admin_scoped_profile_images_select',
        'cms_admin_scoped_profile_images_insert',
        'cms_admin_scoped_profile_images_update',
        'cms_admin_scoped_profile_images_delete'
      )
  LOOP
    IF target_policy.roles <> ARRAY['authenticated']::name[] OR target_policy.permissive <> 'PERMISSIVE' THEN
      RAISE EXCEPTION 'Unexpected profile-images policy role or permissive mode: %', target_policy.policyname;
    END IF;
    IF target_policy.policyname='cms_admin_scoped_profile_images_select'
      AND (target_policy.cmd <> 'SELECT' OR COALESCE(target_policy.qual,'') NOT LIKE '%profile-images%'
        OR COALESCE(target_policy.qual,'') NOT LIKE '%can_manage_resume_storage_object%') THEN
      RAISE EXCEPTION 'Unexpected SELECT policy definition';
    ELSIF target_policy.policyname='cms_admin_scoped_profile_images_insert'
      AND (target_policy.cmd <> 'INSERT' OR COALESCE(target_policy.with_check,'') NOT LIKE '%profile-images%'
        OR COALESCE(target_policy.with_check,'') NOT LIKE '%can_manage_resume_storage_object%') THEN
      RAISE EXCEPTION 'Unexpected INSERT policy definition';
    ELSIF target_policy.policyname='cms_admin_scoped_profile_images_update'
      AND (target_policy.cmd <> 'UPDATE' OR COALESCE(target_policy.qual,'') NOT LIKE '%profile-images%'
        OR COALESCE(target_policy.qual,'') NOT LIKE '%can_manage_resume_storage_object%'
        OR COALESCE(target_policy.with_check,'') NOT LIKE '%profile-images%'
        OR COALESCE(target_policy.with_check,'') NOT LIKE '%can_manage_resume_storage_object%') THEN
      RAISE EXCEPTION 'Unexpected UPDATE policy definition';
    ELSIF target_policy.policyname='cms_admin_scoped_profile_images_delete'
      AND (target_policy.cmd <> 'DELETE' OR COALESCE(target_policy.qual,'') NOT LIKE '%profile-images%'
        OR COALESCE(target_policy.qual,'') NOT LIKE '%can_manage_resume_storage_object%') THEN
      RAISE EXCEPTION 'Unexpected DELETE policy definition';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname IN ('cms_admin_scoped_profile_images_select','cms_admin_scoped_profile_images_insert',
        'cms_admin_scoped_profile_images_update','cms_admin_scoped_profile_images_delete')) <> 4 THEN
    RAISE EXCEPTION 'Expected all four reviewed profile-images policies';
  END IF;

  SELECT count(*) INTO unexpected_count
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname='storage' AND p.tablename='objects'
    AND p.permissive='PERMISSIVE' AND p.cmd IN ('ALL','UPDATE','DELETE')
    AND (p.roles @> ARRAY['authenticated']::name[] OR p.roles @> ARRAY['public']::name[])
    AND p.policyname NOT IN (
      'cms_admin_scoped_profile_images_update','cms_admin_scoped_profile_images_delete',
      'cms_admin_scoped_resume_files_update','cms_admin_scoped_resume_files_delete'
    );
  IF unexpected_count <> 0 THEN
    RAISE EXCEPTION 'Unexpected authenticated/public permissive Storage UPDATE/DELETE policy exists';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_policies p WHERE p.schemaname='storage' AND p.tablename='objects'
      AND p.permissive='PERMISSIVE' AND p.cmd IN ('UPDATE','DELETE')
      AND p.roles = ARRAY['authenticated']::name[]
      AND p.policyname IN ('cms_admin_scoped_resume_files_update','cms_admin_scoped_resume_files_delete')
      AND (COALESCE(p.qual,'') || ' ' || COALESCE(p.with_check,'')) LIKE '%resume-files%'
      AND ((p.policyname='cms_admin_scoped_resume_files_update' AND p.cmd='UPDATE'
        AND (COALESCE(p.qual,'') || ' ' || COALESCE(p.with_check,'')) LIKE '%can_update_resume_file_object%')
      OR (p.policyname='cms_admin_scoped_resume_files_delete' AND p.cmd='DELETE'
        AND COALESCE(p.qual,'') LIKE '%can_delete_resume_file_object%')) ) <> 2 THEN
    RAISE EXCEPTION 'Unexpected resume-files UPDATE/DELETE policy baseline';
  END IF;
END
$profile_image_policy_preflight$;

DROP POLICY cms_admin_scoped_profile_images_update ON storage.objects;
DROP POLICY cms_admin_scoped_profile_images_delete ON storage.objects;

DO $profile_image_policy_postflight$
DECLARE
  remaining_count integer;
BEGIN
  SELECT count(*) INTO remaining_count
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname='storage' AND p.tablename='objects'
    AND p.permissive='PERMISSIVE' AND p.cmd IN ('ALL','UPDATE','DELETE')
    AND (p.roles @> ARRAY['authenticated']::name[] OR p.roles @> ARRAY['public']::name[])
    AND ((COALESCE(p.qual,'') || ' ' || COALESCE(p.with_check,'')) LIKE '%profile-images%'
      OR (COALESCE(p.qual,'') || ' ' || COALESCE(p.with_check,'')) NOT LIKE '%bucket_id%');
  IF remaining_count <> 0 THEN
    RAISE EXCEPTION 'Another permissive policy still allows profile-images UPDATE or DELETE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname='cms_admin_scoped_profile_images_select' AND cmd='SELECT' AND permissive='PERMISSIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
      AND policyname='cms_admin_scoped_profile_images_insert' AND cmd='INSERT' AND permissive='PERMISSIVE') THEN
    RAISE EXCEPTION 'Reviewed profile-images SELECT or INSERT policy was not preserved';
  END IF;
END
$profile_image_policy_postflight$;

COMMIT;
