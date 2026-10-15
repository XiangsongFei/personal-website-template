-- TEST ONLY: authenticated Profile image writes retain every historical object.
BEGIN;
SELECT extensions.plan(14);

CREATE FUNCTION public.test_only_profile_image_insert(target_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
BEGIN
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('profile-images',target_name,'{"test":"profile-retention"}');
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END
$f$;
CREATE FUNCTION public.test_only_profile_image_update(target_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE affected integer;
BEGIN
  UPDATE storage.objects SET metadata='{"test":"updated"}' WHERE bucket_id='profile-images' AND name=target_name;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END
$f$;
CREATE FUNCTION public.test_only_profile_image_delete(target_name text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE affected integer;
BEGIN
  DELETE FROM storage.objects WHERE bucket_id='profile-images' AND name=target_name;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END
$f$;

INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('profile-images','20000000-0000-4000-8000-000000000001/profile/owner-history.png','{"test":"owner"}'),
 ('profile-images','ea111111-1111-4111-8111-111111111111/profile/test-history.png','{"test":"test"}');

SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND policyname='cms_admin_scoped_profile_images_select' AND cmd='SELECT' AND permissive='PERMISSIVE'),
  'scoped authenticated SELECT policy remains');
SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND policyname='cms_admin_scoped_profile_images_insert' AND cmd='INSERT' AND permissive='PERMISSIVE'),
  'scoped authenticated INSERT policy remains');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND permissive='PERMISSIVE' AND cmd IN ('ALL','UPDATE','DELETE')
  AND (roles @> ARRAY['authenticated']::name[] OR roles @> ARRAY['public']::name[])
  AND ((COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) LIKE '%profile-images%'
    OR (COALESCE(qual,'') || ' ' || COALESCE(with_check,'')) NOT LIKE '%bucket_id%')),
  'no permissive authenticated policy can UPDATE or DELETE Profile images');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"owner@example.test"}',true);
SELECT extensions.is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='profile-images'),1,
  'Owner SELECT sees only its scoped Profile image');
SELECT extensions.ok(public.test_only_profile_image_insert('20000000-0000-4000-8000-000000000001/profile/owner-new.png'),
  'Owner can INSERT a unique object under the Owner target');
SELECT extensions.ok(NOT public.test_only_profile_image_insert('ea111111-1111-4111-8111-111111111111/profile/owner-cross-target.png'),
  'Owner cannot INSERT under the Test target');
SELECT extensions.ok(NOT public.test_only_profile_image_update('20000000-0000-4000-8000-000000000001/profile/owner-history.png'),
  'Owner cannot overwrite a retained Profile image');
SELECT extensions.ok(NOT public.test_only_profile_image_delete('20000000-0000-4000-8000-000000000001/profile/owner-history.png'),
  'Owner cannot delete a retained Profile image');

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.is((SELECT count(*)::integer FROM storage.objects WHERE bucket_id='profile-images'),1,
  'Test SELECT sees only its scoped Profile image');
SELECT extensions.ok(public.test_only_profile_image_insert('ea111111-1111-4111-8111-111111111111/profile/test-new.png'),
  'Test can INSERT a unique object under its own target');
SELECT extensions.ok(NOT public.test_only_profile_image_insert('20000000-0000-4000-8000-000000000001/profile/test-cross-target.png'),
  'Test cannot INSERT under the Owner target');
SELECT extensions.ok(NOT public.test_only_profile_image_update('ea111111-1111-4111-8111-111111111111/profile/test-history.png'),
  'Test cannot overwrite a retained Profile image');
SELECT extensions.ok(NOT public.test_only_profile_image_delete('ea111111-1111-4111-8111-111111111111/profile/test-history.png'),
  'Test cannot delete a retained Profile image');
SELECT extensions.ok(NOT public.test_only_profile_image_update('20000000-0000-4000-8000-000000000001/profile/owner-history.png')
  AND NOT public.test_only_profile_image_delete('20000000-0000-4000-8000-000000000001/profile/owner-history.png'),
  'Test cannot mutate Owner image objects');
RESET ROLE;

SELECT * FROM extensions.finish();
ROLLBACK;
