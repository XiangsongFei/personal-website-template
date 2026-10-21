-- TEST ONLY: reference format compatibility never grants target access.
BEGIN;
SELECT extensions.plan(15);
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/example-cv/resume_en.pdf'),true,'Owner fixed prefix');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf'),true,'Legacy QA format compatibility');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf'),true,'Current QA UUID prefix');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','zh','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_zh.pdf?cacheNonce=12345678-1234-4234-8234-123456789012'),true,'Current QA historical nonce');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'unknown','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf'),false,'Unknown site rejected');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/example-cv/resume_en.pdf'),false,'QA cannot use Owner prefix');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf'),false,'Owner cannot use UUID prefix');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea222222-2222-4222-8222-222222222222/resume_en.pdf'),false,'Wrong target UUID rejected');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_zh.pdf'),false,'Wrong locale reference rejected');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','fr','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_fr.pdf'),false,'Unsupported locale rejected');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','en','https://other.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf'),false,'Wrong origin rejected');
SELECT extensions.is(cms_private.files_historical_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111'::uuid,'example-cv-qa-activity-log','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=forged'),false,'Forged nonce rejected');
SELECT extensions.ok((SELECT count(*)=2 AND bool_and(p.prosecdef AND r.rolname='postgres' AND p.proconfig @> ARRAY['search_path=""'])
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
  WHERE p.oid IN ('cms_private.files_historical_reference_is_allowed(text,uuid,text,text,text)'::regprocedure,
    'cms_private.files_restore_source(uuid,uuid,text,uuid)'::regprocedure)), 'Private signatures retain owner, SECURITY DEFINER and empty search_path');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p,
  LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.oid IN ('cms_private.files_historical_reference_is_allowed(text,uuid,text,text,text)'::regprocedure,
    'cms_private.files_restore_source(uuid,uuid,text,uuid)'::regprocedure)
    AND a.grantee=0 AND a.privilege_type='EXECUTE'), 'No PUBLIC execution permission');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM cms_private.resume_capabilities WHERE capability_key='restore' AND enabled
  AND resume_id IN ('ea111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000001')), 'Compatibility migration does not activate Restore');
SELECT extensions.finish();
ROLLBACK;
