-- TEST ONLY: Website & Links and Files transactional writers, shared-column ownership, and Storage path policy.
BEGIN;
CREATE FUNCTION public.test_only_d7_payload(target_resume uuid,target_domain text,marker text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE result jsonb;
BEGIN
 IF target_domain='website_links' THEN
  result:=cms_private.website_links_aggregate(target_resume);
  IF marker IS NOT NULL THEN result:=jsonb_set(result,'{shared,email}',to_jsonb(marker)); END IF;
  RETURN result;
 ELSIF target_domain='files' THEN
  result:=cms_private.files_aggregate(target_resume);
  IF marker IS NOT NULL THEN result:=jsonb_set(result,'{translations,en,portfolio_href}',to_jsonb(marker)); END IF;
  RETURN result;
 END IF;
 RAISE EXCEPTION 'TEST ONLY unknown D-7 domain';
END
$function$;
CREATE FUNCTION public.test_only_d7_save(target_resume uuid,target_domain text,target_request uuid,marker text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE body text; context_value text; signature_value text; issued bigint; key_bytes bytea;
BEGIN
 body:=public.test_only_d7_payload(target_resume,target_domain,marker)::text;
 issued:=floor(date_part('epoch',clock_timestamp()))::bigint;
 context_value:=jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
  'actor_user_id','10000000-0000-4000-8000-000000000002','resume_id',target_resume::text,'domain',target_domain,'operation','update',
  'request_id',target_request::text,'mutation_digest',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),
  'issued_at',issued,'expires_at',issued+180,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text;
 key_bytes:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
 signature_value:=encode(extensions.hmac(convert_to(context_value,'UTF8'),key_bytes,'sha256'),'hex');
 IF target_domain='website_links' THEN RETURN public.save_resume_website_links_v1(target_resume,body,context_value,signature_value); END IF;
 RETURN public.save_resume_files_v1(target_resume,body,context_value,signature_value);
END
$function$;
CREATE FUNCTION public.test_only_d7_state(target_resume uuid,target_domain text,target_request uuid,marker text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 PERFORM public.test_only_d7_save(target_resume,target_domain,target_request,marker); RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$function$;
CREATE FUNCTION public.test_only_files_restore(target_resume uuid,source_event_id uuid,target_locale text,target_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE body text; context_value text; signature_value text; issued bigint; key_bytes bytea;
BEGIN
 body:='{"action":"restore_before","locale":"'||target_locale||'","source_event_id":"'||source_event_id::text||'","target_resume_id":"'||target_resume::text||'","version":1}';
 issued:=floor(date_part('epoch',clock_timestamp()))::bigint;
 context_value:=jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
  'actor_user_id','10000000-0000-4000-8000-000000000002','resume_id',target_resume::text,'domain','files','operation','update',
  'request_id',target_request::text,'mutation_digest',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),
  'issued_at',issued,'expires_at',issued+180,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text;
 key_bytes:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
 signature_value:=encode(extensions.hmac(convert_to(context_value,'UTF8'),key_bytes,'sha256'),'hex');
 RETURN public.restore_resume_files_from_event_v1(target_resume,source_event_id,target_locale,body,context_value,signature_value);
END
$function$;
CREATE FUNCTION public.test_only_files_restore_state(target_resume uuid,source_event_id uuid,target_locale text,target_request uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN PERFORM public.test_only_files_restore(target_resume,source_event_id,target_locale,target_request); RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$function$;
CREATE FUNCTION public.test_only_files_restore_source_state(target_resume uuid,source_event_id uuid,target_locale text,target_actor uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN PERFORM 1 FROM cms_private.files_restore_source(target_resume,source_event_id,target_locale,target_actor); RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END
$function$;
CREATE FUNCTION public.test_only_files_reference_valid(target_origin text,target_resume uuid,target_site text,target_locale text,target_reference text,target_historical boolean)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
 SELECT CASE WHEN target_historical THEN cms_private.files_historical_reference_is_allowed(target_origin,target_resume,target_site,target_locale,target_reference)
   ELSE cms_private.files_reference_is_allowed(target_origin,target_resume,target_locale,target_reference) END
$function$;
CREATE FUNCTION public.test_only_d7_event_count(target_resume uuid,target_domain text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain AND payload_version=2 $function$;
CREATE FUNCTION public.test_only_d7_event_valid(target_resume uuid,target_domain text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
 SELECT count(*)=1 AND bool_and(entity_id IS NULL AND operation='update' AND payload_version=2
   AND ((target_domain='website_links' AND entity_type='website_links_settings' AND entity_snapshot->'website_links'=changes->'website_links'->'after')
     OR (target_domain='files' AND entity_type='resume_file_set' AND entity_snapshot->'files'=changes->'files'->'after')))
FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain AND payload_version=2
$function$;
CREATE FUNCTION public.test_only_d7_latest_event(target_resume uuid,target_domain text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT id FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain AND payload_version=2 ORDER BY occurred_at DESC,id DESC LIMIT 1 $function$;
CREATE FUNCTION public.test_only_d7_event_for_after(target_resume uuid,target_domain text,target_reference text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT id FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain AND payload_version=2 AND changes->'files'->'after'->'translations'->'en'->>'portfolio_href'=target_reference ORDER BY occurred_at DESC,id DESC LIMIT 1 $function$;
CREATE FUNCTION public.test_only_d7_event_is_valid(target_event_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT cms_private.activity_event_payload_v2_files_is_allowed(section_key,entity_type,entity_id,operation,entity_snapshot,changes) FROM cms_private.activity_log_events WHERE id=target_event_id $function$;
CREATE FUNCTION public.test_only_add_storage_object(target_bucket text,target_name text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ INSERT INTO storage.objects(bucket_id,name,metadata) SELECT target_bucket,target_name,'{"fixture":"legacy-pdf"}' WHERE NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id=target_bucket AND name=target_name) $function$;
CREATE FUNCTION public.test_only_d7_direct_locale_denied(target_resume uuid,target_field text)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE affected bigint; before_value text;
BEGIN
 IF target_field='website_links' THEN
  SELECT linkedin_label INTO before_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='en';
  BEGIN
   UPDATE public.resume_locale_content SET linkedin_label='forbidden Website direct DML' WHERE resume_id=target_resume AND locale='en';
   GET DIAGNOSTICS affected=ROW_COUNT;
  EXCEPTION WHEN SQLSTATE '42501' THEN
   affected:=-1;
  END;
  RETURN affected=-1 AND (SELECT linkedin_label IS NOT DISTINCT FROM before_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='en');
 ELSIF target_field='files' THEN
  SELECT portfolio_href INTO before_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='en';
  BEGIN
   UPDATE public.resume_locale_content SET portfolio_href='forbidden Files direct DML' WHERE resume_id=target_resume AND locale='en';
   GET DIAGNOSTICS affected=ROW_COUNT;
  EXCEPTION WHEN SQLSTATE '42501' THEN
   affected:=-1;
  END;
  RETURN affected=-1 AND (SELECT portfolio_href IS NOT DISTINCT FROM before_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='en');
 END IF;
 RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_d7_payload(uuid,text,text),public.test_only_d7_save(uuid,text,uuid,text),public.test_only_d7_state(uuid,text,uuid,text),
 public.test_only_d7_event_count(uuid,text),public.test_only_d7_event_valid(uuid,text),public.test_only_d7_direct_locale_denied(uuid,text),
 public.test_only_d7_latest_event(uuid,text),public.test_only_d7_event_for_after(uuid,text,text),public.test_only_d7_event_is_valid(uuid),
 public.test_only_add_storage_object(text,text),
 public.test_only_files_restore(uuid,uuid,text,uuid),public.test_only_files_restore_state(uuid,uuid,text,uuid),
 public.test_only_files_restore_source_state(uuid,uuid,text,uuid),
 public.test_only_files_reference_valid(text,uuid,text,text,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_d7_payload(uuid,text,text),public.test_only_d7_save(uuid,text,uuid,text),public.test_only_d7_state(uuid,text,uuid,text),
 public.test_only_d7_event_count(uuid,text),public.test_only_d7_event_valid(uuid,text),public.test_only_d7_direct_locale_denied(uuid,text),
 public.test_only_d7_latest_event(uuid,text),public.test_only_d7_event_for_after(uuid,text,text),public.test_only_d7_event_is_valid(uuid),
 public.test_only_add_storage_object(text,text),
 public.test_only_files_restore(uuid,uuid,text,uuid),public.test_only_files_restore_state(uuid,uuid,text,uuid),
 public.test_only_files_restore_source_state(uuid,uuid,text,uuid),
 public.test_only_files_reference_valid(text,uuid,text,text,text,boolean) TO authenticated;

SELECT extensions.plan(39);
SELECT extensions.ok(to_regprocedure('public.load_admin_website_links_write_state(uuid)') IS NOT NULL
 AND to_regprocedure('public.save_resume_website_links_v1(uuid,text,text,text)') IS NOT NULL,
 'typed Website & Links state reader and writer exist');
SELECT extensions.ok(to_regprocedure('public.load_admin_files_write_state(uuid)') IS NOT NULL
 AND to_regprocedure('public.save_resume_files_v1(uuid,text,text,text)') IS NOT NULL,
 'typed Files state reader and writer exist');
SELECT extensions.ok(cms_private.website_links_aggregate_is_allowed(public.test_only_d7_payload('ea111111-1111-4111-8111-111111111111','website_links')),
 'QA Navigation source accepts the exact five-item aggregate');
SELECT extensions.ok(NOT cms_private.website_links_aggregate_is_allowed(jsonb_set(public.test_only_d7_payload('ea111111-1111-4111-8111-111111111111','website_links'),'{navigation,0,position}','1'::jsonb)),
 'Website validator rejects submitted Navigation positions outside canonical array order');
SELECT extensions.ok((SELECT count(*)=5 AND min(position)=0 AND max(position)=4 FROM public.resume_navigation_items WHERE resume_id='ea111111-1111-4111-8111-111111111111'),
 'QA Navigation contract is five existing ordered parent rows');
SELECT extensions.ok((SELECT count(*)=2 FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale IN('zh','en')),
 'Files aggregate starts with both authoritative locale rows');
SELECT extensions.ok(cms_private.files_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')
 AND NOT cms_private.files_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','en','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')
 AND NOT cms_private.files_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/10000000-0000-4000-8000-000000000001/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')
 AND NOT cms_private.files_reference_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/zh/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf?download=1'),
 'Files reference validation rejects wrong bucket, cross-target and locale/query abuse');

-- Direct-mode D-7 updates work before activation.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
UPDATE public.resume_locale_content SET linkedin_label='direct-test' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
UPDATE public.resume_locale_content SET linkedin_label='LinkedIn EN' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
UPDATE public.resume_locale_content SET portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
RESET ROLE;
SELECT extensions.ok(public.can_direct_write_website_links('ea111111-1111-4111-8111-111111111111')
 AND public.can_direct_write_files('ea111111-1111-4111-8111-111111111111'), 'both D-7 direct writers remain available before activation');

-- Enable only the synthetic QA domains inside this rollback-only local test.
UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key IN('website_links','files');
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
 VALUES('ea111111-1111-4111-8111-111111111111','website_links','trusted_network_context_v11',true),
       ('ea111111-1111-4111-8111-111111111111','files','trusted_network_context_v11',true)
 ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=excluded.enabled;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
 VALUES('ea111111-1111-4111-8111-111111111111','activity_log',true)
 ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=excluded.enabled;
INSERT INTO cms_private.profile_photo_origin_config(singleton,origin) VALUES(true,'https://local.supabase.invalid');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok(public.test_only_d7_direct_locale_denied('ea111111-1111-4111-8111-111111111111','website_links')
 AND public.test_only_d7_direct_locale_denied('ea111111-1111-4111-8111-111111111111','files'),
 'rpc mode denies direct D-7-owned columns');
SELECT extensions.is(public.test_only_d7_state('ea111111-1111-4111-8111-111111111111','files','ea000000-0000-4000-8000-000000000705'),'00000',
 'Files no-op completes without rejecting a preserved historical reference');
SELECT extensions.ok((SELECT portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en')
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files')=0,
 'Files no-op preserves an unchanged legacy reference and creates no event');
UPDATE public.resume_locale_content SET availability='cross-domain Contact remains direct' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
SELECT extensions.ok((SELECT availability='cross-domain Contact remains direct' FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en'),
 'direct Contact locale update composes while Website & Links and Files are rpc');
SELECT extensions.ok(public.test_only_d7_save('ea111111-1111-4111-8111-111111111111','website_links','ea000000-0000-4000-8000-000000000701','d7@example.invalid')->'shared'->>'email'='d7@example.invalid',
 'changed Website & Links save persists only the canonical Website aggregate');
SELECT extensions.ok(public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','website_links')=1
 AND public.test_only_d7_event_valid('ea111111-1111-4111-8111-111111111111','website_links'),
 'changed save creates one valid Website & Links V2 event');
SELECT extensions.ok(public.test_only_d7_save('ea111111-1111-4111-8111-111111111111','website_links','ea000000-0000-4000-8000-000000000701','d7@example.invalid') IS NOT NULL
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','website_links')=1,
 'exact Website request replay creates no duplicate event');
SELECT extensions.ok(public.test_only_d7_state('ea111111-1111-4111-8111-111111111111','website_links','ea000000-0000-4000-8000-000000000701','different@example.invalid')='P13B1'
 AND (SELECT email='d7@example.invalid' FROM public.resume_public_links WHERE resume_id='ea111111-1111-4111-8111-111111111111'),
 'changed Website payload with reused request ID fails before mutation');
SELECT extensions.ok(public.test_only_d7_state('ea111111-1111-4111-8111-111111111111','website_links','ea000000-0000-4000-8000-000000000702')='00000'
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','website_links')=1,
 'Website semantic no-op completes idempotency without a success event');
SELECT extensions.ok(public.test_only_d7_save('ea111111-1111-4111-8111-111111111111','files','ea000000-0000-4000-8000-000000000703',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')->'translations'->'en'->>'portfolio_href'
 LIKE '%/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
 'Files writer accepts a target- and locale-scoped immutable PDF candidate');
SELECT extensions.ok(public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files')=1
 AND public.test_only_d7_event_valid('ea111111-1111-4111-8111-111111111111','files'),
 'changed Files save creates one valid reference-only V2 event');
SELECT extensions.ok(public.test_only_d7_state('ea111111-1111-4111-8111-111111111111','files','ea000000-0000-4000-8000-000000000704',
 'https://wrong.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf')='22023'
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files')=1,
 'wrong Files origin is rejected before mutation');
SELECT extensions.ok(public.test_only_d7_save('ea111111-1111-4111-8111-111111111111','files','ea000000-0000-4000-8000-000000000703',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf') IS NOT NULL
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files')=1,
 'exact Files request replay creates no duplicate event');
SELECT extensions.ok(public.test_only_d7_state('ea111111-1111-4111-8111-111111111111','files','ea000000-0000-4000-8000-000000000703',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf')='P13B1'
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files')=1,
 'Files changed payload with reused request ID fails before mutation');
SELECT extensions.ok(public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','en',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true)
 AND public.test_only_files_reference_valid('https://local.supabase.invalid','10000000-0000-4000-8000-000000000001','example-cv','zh',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/example-cv/resume_zh.pdf',true)
 AND NOT public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','en',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false),
 'historical validator permits known legacy forms without weakening the normal writer');
SELECT extensions.ok(NOT public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','en','https://attacker.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf',true)
 AND NOT public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','en','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/resume_en.pdf',true)
 AND NOT public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','zh','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=bad',true),
 'historical validator rejects external origin, wrong bucket, locale mismatch and invalid nonce');
SELECT extensions.ok(NOT public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&x=1',true)
 AND NOT public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf#frag',true)
 AND NOT public.test_only_files_reference_valid('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','example-cv-qa','en','https://local.supabase.invalid/storage/v1/object/public/resume-files/10000000-0000-4000-8000-000000000001/resume_en.pdf',true),
 'historical validator rejects arbitrary query, fragments and a different target prefix');
SELECT extensions.ok(public.test_only_files_restore_state('ea111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000001','en','ea000000-0000-4000-8000-000000000710')<>'00000',
 'restore rejects an event belonging to another resume');
SELECT extensions.ok(public.test_only_files_restore_state('ea111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000001','en','ea000000-0000-4000-8000-000000000711')<>'00000',
 'restore rejects a missing/non-Files source event');
SELECT extensions.ok((SELECT count(*)=0 FROM storage.objects WHERE bucket_id='resume-files' AND name='ea111111-1111-4111-8111-111111111111/resume_en.pdf'),
 'legacy source object is initially absent from the exact expected bucket and name');
SELECT extensions.is(public.test_only_files_restore_state('ea111111-1111-4111-8111-111111111111',
 public.test_only_d7_latest_event('ea111111-1111-4111-8111-111111111111','files'),'en','ea000000-0000-4000-8000-000000000712'),'22023',
 'restore refuses mutation when the exact legacy Storage object is missing');
SELECT public.test_only_add_storage_object('resume-files','ea111111-1111-4111-8111-111111111111/resume_en.pdf');
SELECT extensions.ok((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='resume-files' AND name='ea111111-1111-4111-8111-111111111111/resume_en.pdf'),
 'legacy object metadata is installed for the positive restore path');
SELECT extensions.is(public.test_only_files_restore_source_state('ea111111-1111-4111-8111-111111111111',
 public.test_only_d7_latest_event('ea111111-1111-4111-8111-111111111111','website_links'),'en','10000000-0000-4000-8000-000000000002'),'22023',
 'a non-Files event cannot serve as a restore source');
SELECT extensions.is(public.test_only_files_restore_source_state('20000000-0000-4000-8000-000000000001',
 public.test_only_d7_latest_event('ea111111-1111-4111-8111-111111111111','files'),'en','10000000-0000-4000-8000-000000000002'),'22023',
 'a Files event from another resume cannot be restored into this target');
SELECT extensions.is(public.test_only_files_restore_source_state('ea111111-1111-4111-8111-111111111111',
 public.test_only_d7_latest_event('ea111111-1111-4111-8111-111111111111','files'),'en','10000000-0000-4000-8000-000000000001'),'22023',
 'a Files event authored by another actor is rejected');
DO $restore_test$
DECLARE source_id uuid; restored jsonb; legacy_reference text; other_locale_reference text; event_count bigint;
BEGIN
 source_id:=public.test_only_d7_latest_event('ea111111-1111-4111-8111-111111111111','files');
 legacy_reference:='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 SELECT portfolio_href INTO other_locale_reference FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh';
 restored:=public.test_only_files_restore('ea111111-1111-4111-8111-111111111111',source_id,'en','ea000000-0000-4000-8000-000000000712');
 IF restored->'files'->'translations'->'en'->>'portfolio_href' IS DISTINCT FROM legacy_reference
   OR restored->'files'->'translations'->'zh'->>'portfolio_href' IS DISTINCT FROM other_locale_reference THEN
   RAISE EXCEPTION 'restored aggregate mismatch: en=%, zh=%', restored->'files'->'translations'->'en'->>'portfolio_href', restored->'files'->'translations'->'zh'->>'portfolio_href';
 END IF;
 event_count:=public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files');
 IF event_count<>2 OR NOT public.test_only_d7_event_is_valid(public.test_only_d7_latest_event('ea111111-1111-4111-8111-111111111111','files'))
   OR NOT public.test_only_d7_direct_locale_denied('ea111111-1111-4111-8111-111111111111','files') THEN RAISE EXCEPTION 'restore event/security mismatch'; END IF;
 PERFORM public.test_only_files_restore('ea111111-1111-4111-8111-111111111111',source_id,'en','ea000000-0000-4000-8000-000000000712');
 event_count:=public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files');
 IF event_count<>2 THEN RAISE EXCEPTION 'restore replay created duplicate event'; END IF;
END
$restore_test$;
SELECT extensions.ok((SELECT portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en')
 AND (SELECT portfolio_href='https://example.invalid/qa-resume-zh.pdf' FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh')
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files')=2,
 'bootstrap save created the restore anchor, restore returned the legacy state, and exactly two V2 events exist');
SELECT extensions.ok(public.test_only_files_restore_state('ea111111-1111-4111-8111-111111111111',
 public.test_only_d7_event_for_after('ea111111-1111-4111-8111-111111111111','files','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'zh','ea000000-0000-4000-8000-000000000712')='P13B1',
 'same request ID with a changed locale intent fails before a second event');
SELECT extensions.ok(public.test_only_files_restore_state('ea111111-1111-4111-8111-111111111111',
 public.test_only_d7_event_for_after('ea111111-1111-4111-8111-111111111111','files','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'en','ea000000-0000-4000-8000-000000000713')='00000'
 AND public.test_only_d7_event_count('ea111111-1111-4111-8111-111111111111','files')=2,
 'a new request against the already-restored reference completes as a no-op without another event');
RESET ROLE;
UPDATE public.resume_locale_content SET portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/cccccccc-cccc-4ccc-8ccc-cccccccccccc.pdf'
 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
SET LOCAL ROLE authenticated;
SELECT extensions.is(public.test_only_files_restore_state('ea111111-1111-4111-8111-111111111111',
 public.test_only_d7_event_for_after('ea111111-1111-4111-8111-111111111111','files','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'en','ea000000-0000-4000-8000-000000000714'),'P0001',
 'restore rejects a current reference that matches neither the source before nor after state');
RESET ROLE;
UPDATE public.resume_locale_content SET portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
SET LOCAL ROLE authenticated;
SELECT extensions.ok(public.can_manage_resume_storage_object('resume-files','ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')
 AND NOT public.can_manage_resume_storage_object('resume-files','10000000-0000-4000-8000-000000000001/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'Storage policy allows only authorized target-scoped candidate object names');
RESET ROLE;
SELECT extensions.ok((SELECT availability='cross-domain Contact remains direct' FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en')
 AND (SELECT email='d7@example.invalid' FROM public.resume_public_links WHERE resume_id='ea111111-1111-4111-8111-111111111111')
 AND (SELECT portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en'),
 'Website & Links, Files, and Contact changes remain independently scoped');
SELECT extensions.finish();
ROLLBACK;
