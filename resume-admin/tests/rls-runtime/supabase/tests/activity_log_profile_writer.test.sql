-- TEST ONLY: transactional Profile aggregate, photo-origin contract, Activity Log V2, and mode-aware RLS.
BEGIN;
CREATE FUNCTION public.test_only_profile_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='profile' AND entity_type='profile_settings' AND payload_version=2 $function$;
CREATE FUNCTION public.test_only_profile_payload(target_resume uuid,marker text DEFAULT NULL,photo_override text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'shared',pg_catalog.jsonb_build_object('graduation_value',CASE WHEN marker IS NOT NULL THEN marker ELSE p.graduation_value END,
      'avatar_initials',p.avatar_initials,'footer_name',p.footer_name,'copyright',CASE WHEN marker IS NOT NULL THEN 'Profile ' || marker || ' copyright' ELSE p.copyright END,
      'photo_url',COALESCE(photo_override,p.photo_url)),
    'translations',pg_catalog.jsonb_build_object(
      'zh',pg_catalog.jsonb_build_object('name',CASE WHEN marker IS NOT NULL THEN 'Profile ' || marker || ' zh' ELSE zh.name END,
        'nav_about_label',zh.nav_about_label,'email_action_label',zh.email_action_label,'graduation_label',zh.graduation_label,
        'avatar_label',zh.avatar_label,'contact_focus_heading',zh.contact_focus_heading,'contact_status_heading',zh.contact_status_heading),
      'en',pg_catalog.jsonb_build_object('name',CASE WHEN marker IS NOT NULL THEN 'Profile ' || marker || ' en' ELSE en.name END,
        'nav_about_label',en.nav_about_label,'email_action_label',en.email_action_label,'graduation_label',en.graduation_label,
        'avatar_label',en.avatar_label,'contact_focus_heading',en.contact_focus_heading,'contact_status_heading',en.contact_status_heading)))
  FROM public.resume_profile p
  JOIN public.resume_profile_translations zh ON zh.resume_id=p.resume_id AND zh.locale='zh'
  JOIN public.resume_profile_translations en ON en.resume_id=p.resume_id AND en.locale='en'
  WHERE p.resume_id=target_resume
$function$;
CREATE FUNCTION public.test_only_profile_sign(target_resume uuid,target_profile text,target_request uuid)
RETURNS TABLE(signed_context text,signature_hex text) LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  WITH stamp AS (SELECT pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint AS issued), context AS (
    SELECT pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
      'actor_user_id','10000000-0000-4000-8000-000000000002','resume_id',target_resume::text,'domain','profile','operation','update',
      'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_profile,'UTF8'),'sha256'),'hex'),
      'issued_at',stamp.issued,'expires_at',stamp.issued+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text AS value
    FROM stamp
  ) SELECT context.value,pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(context.value,'UTF8'),
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex') FROM context
$function$;
CREATE FUNCTION public.test_only_profile_save(target_resume uuid,target_request uuid,marker text DEFAULT NULL,photo_override text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE payload text; signed_value text; signature_value text;
BEGIN
  payload:=public.test_only_profile_payload(target_resume,marker,photo_override)::text;
  SELECT signed_context,signature_hex INTO signed_value,signature_value FROM public.test_only_profile_sign(target_resume,payload,target_request);
  RETURN public.save_resume_profile_v1(target_resume,payload,signed_value,signature_value);
END
$function$;
CREATE FUNCTION public.test_only_profile_state(target_resume uuid,target_request uuid,marker text DEFAULT NULL,photo_override text DEFAULT NULL,signature_override text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE payload text; signed_value text; signature_value text; state_value text;
BEGIN
  payload:=public.test_only_profile_payload(target_resume,marker,photo_override)::text;
  SELECT signed_context,signature_hex INTO signed_value,signature_value FROM public.test_only_profile_sign(target_resume,payload,target_request);
  BEGIN PERFORM public.save_resume_profile_v1(target_resume,payload,signed_value,COALESCE(signature_override,signature_value)); state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value;
END
$function$;
CREATE FUNCTION public.test_only_profile_event_valid(target_resume uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT count(*)=1 AND COALESCE(bool_and(operation='update' AND section_key='profile' AND entity_type='profile_settings'
    AND entity_id IS NULL AND payload_version=2 AND entity_snapshot->'profile'=changes->'profile'->'after'
    AND changes->'profile'->'before'->'shared'->>'graduation_value' IS DISTINCT FROM changes->'profile'->'after'->'shared'->>'graduation_value'
    AND changes->'profile'->'before'->'translations'->'zh'->>'name' IS DISTINCT FROM changes->'profile'->'after'->'translations'->'zh'->>'name'
    AND changes->'profile'->'before'->'translations'->'en'->>'name' IS DISTINCT FROM changes->'profile'->'after'->'translations'->'en'->>'name'
    AND changes->'profile'->'before'->'translations'->'zh'->>'avatar_label'=changes->'profile'->'after'->'translations'->'zh'->>'avatar_label'
    AND changes->'profile'->'before'->'translations'->'en'->>'avatar_label'=changes->'profile'->'after'->'translations'->'en'->>'avatar_label'),false)
  FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='profile' AND payload_version=2
$function$;
CREATE FUNCTION public.test_only_profile_fail_activity_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
  IF NEW.section_key='profile' AND pg_catalog.current_setting('profile.fail_activity_insert',true)='on' THEN
    RAISE EXCEPTION 'TEST ONLY forced Profile event failure' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER test_only_profile_fail_activity_insert
BEFORE INSERT ON cms_private.activity_log_events
FOR EACH ROW EXECUTE FUNCTION public.test_only_profile_fail_activity_insert();
CREATE FUNCTION public.test_only_profile_direct_denied(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE changed_rows integer; state_value text;
BEGIN
  UPDATE public.resume_profile SET footer_name='forbidden direct update' WHERE resume_id=target_resume;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  BEGIN INSERT INTO public.resume_profile(resume_id,graduation_value,avatar_initials,footer_name,copyright)
    VALUES(target_resume,'x','x','x','x'); state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN changed_rows=0 AND state_value='42501'
    AND (SELECT footer_name<>'forbidden direct update' FROM public.resume_profile WHERE resume_id=target_resume);
END
$function$;
CREATE FUNCTION public.test_only_profile_direct_delete_denied(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE changed_rows integer;
BEGIN DELETE FROM public.resume_profile_translations WHERE resume_id=target_resume AND locale='zh';
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  RETURN changed_rows=0 AND EXISTS(SELECT 1 FROM public.resume_profile_translations WHERE resume_id=target_resume AND locale='zh');
END
$function$;
CREATE FUNCTION public.test_only_profile_key_move_denied(target_resume uuid,other_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE changed_rows integer;
BEGIN
  UPDATE public.resume_profile_translations SET resume_id=other_resume WHERE resume_id=target_resume AND locale='zh';
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  RETURN changed_rows=0 AND EXISTS(SELECT 1 FROM public.resume_profile_translations WHERE resume_id=target_resume AND locale='zh');
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_profile_event_count(uuid),public.test_only_profile_payload(uuid,text,text),
  public.test_only_profile_sign(uuid,text,uuid),public.test_only_profile_save(uuid,uuid,text,text),
  public.test_only_profile_state(uuid,uuid,text,text,text),public.test_only_profile_event_valid(uuid),
  public.test_only_profile_fail_activity_insert(),
  public.test_only_profile_direct_denied(uuid),public.test_only_profile_direct_delete_denied(uuid),public.test_only_profile_key_move_denied(uuid,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_profile_event_count(uuid),public.test_only_profile_payload(uuid,text,text),
  public.test_only_profile_sign(uuid,text,uuid),public.test_only_profile_save(uuid,uuid,text,text),
  public.test_only_profile_state(uuid,uuid,text,text,text),public.test_only_profile_event_valid(uuid),
  public.test_only_profile_direct_denied(uuid),public.test_only_profile_direct_delete_denied(uuid),public.test_only_profile_key_move_denied(uuid,uuid)
  TO authenticated;

SELECT extensions.plan(29);
SELECT extensions.ok(to_regprocedure('public.load_admin_profile_write_state(uuid)') IS NOT NULL
  AND to_regprocedure('public.save_resume_profile_v1(uuid,text,text,text)') IS NOT NULL,'typed Profile state reader and writer exist');
SELECT extensions.ok(has_function_privilege('authenticated','public.load_admin_profile_write_state(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.save_resume_profile_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.load_admin_profile_write_state(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_profile_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_profile_v1(uuid,text,text,text)','EXECUTE'),
  'Profile RPC execution is restricted to authenticated callers');
SELECT extensions.ok((SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc WHERE oid='public.save_resume_profile_v1(uuid,text,text,text)'::regprocedure)
  AND (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc WHERE oid='public.load_admin_profile_write_state(uuid)'::regprocedure),
  'Profile RPCs retain SECURITY DEFINER, fixed empty search_path, and stable state reader');
SELECT extensions.ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='cms_private.profile_photo_origin_config'::regclass)
  AND NOT has_table_privilege('authenticated','cms_private.profile_photo_origin_config','INSERT')
  AND NOT has_table_privilege('service_role','cms_private.profile_photo_origin_config','UPDATE'),
  'origin configuration is RLS protected and not writable by application roles');
SELECT extensions.ok((SELECT c.contype='f' AND c.confrelid='public.resume_profile'::regclass AND c.confdeltype='c'
  FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.resume_profile_translations'::regclass AND c.contype='f'
    AND c.confrelid='public.resume_profile'::regclass),
  'test bootstrap Profile translations cascade from the Profile parent, not shared locale rows');
SELECT extensions.ok(cms_private.profile_aggregate_is_allowed(public.test_only_profile_payload('ea111111-1111-4111-8111-111111111111'))
  AND NOT cms_private.profile_aggregate_is_allowed(public.test_only_profile_payload('ea111111-1111-4111-8111-111111111111') || '{"extra":true}'::jsonb),
  'strict exact Profile shape accepts the canonical aggregate and rejects extra keys');
SELECT extensions.ok(cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111',
  'https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'),
  'configured exact managed Profile image URL is accepted');
SELECT extensions.ok(NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://elsewhere.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/20000000-0000-4000-8000-000000000001/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/other/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'),
  'photo validator rejects wrong origin, bucket, resume UUID, and subdirectory');
SELECT extensions.ok(NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://user@local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp?x=1')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp#x')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/%61aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp/extra')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.JPG')
  AND NOT cms_private.profile_photo_url_is_allowed('https://local.supabase.invalid','ea111111-1111-4111-8111-111111111111','https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp\\x'),
  'photo validator rejects userinfo, query, fragment, encoding, extra path, uppercase extension, and backslash');

INSERT INTO cms_private.profile_photo_origin_config(singleton,origin) VALUES(true,'https://local.supabase.invalid');
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled) VALUES('ea111111-1111-4111-8111-111111111111','activity_log',true)
ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode) VALUES('ea111111-1111-4111-8111-111111111111','profile','direct')
ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='direct';
DELETE FROM cms_private.resume_domain_requirements WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='profile' AND requirement_key='trusted_network_context_v11';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok((SELECT profile_write_mode='direct' AND NOT profile_trusted_context_required AND activity_log_enabled
  FROM public.load_admin_profile_write_state('ea111111-1111-4111-8111-111111111111')),'Profile state reader is target scoped and starts in direct mode');
RESET ROLE;
UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='profile';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok(public.test_only_profile_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000600')='42501'
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=0,
  'Profile RPC fails closed while trusted context is disabled');
RESET ROLE;
UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='profile';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
UPDATE public.resume_profile SET footer_name='direct legacy allowed' WHERE resume_id='ea111111-1111-4111-8111-111111111111';
SELECT extensions.ok((SELECT footer_name='direct legacy allowed' FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111'),
  'authorized legacy Profile UPDATE continues to work in direct mode');
RESET ROLE;
UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='profile';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','profile','trusted_network_context_v11',true)
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok((SELECT profile_write_mode='rpc' AND profile_trusted_context_required AND activity_log_enabled
  FROM public.load_admin_profile_write_state('ea111111-1111-4111-8111-111111111111')),'Profile write state reports rpc and required trusted context');
SELECT extensions.ok(public.test_only_profile_direct_denied('ea111111-1111-4111-8111-111111111111')
  AND public.test_only_profile_direct_delete_denied('ea111111-1111-4111-8111-111111111111')
  AND public.test_only_profile_key_move_denied('ea111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000001'),
  'rpc mode denies direct Profile INSERT/UPDATE/DELETE and key-changing writes');
SELECT extensions.ok(public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=0,
  'direct-write denials create no Profile success event');
SELECT extensions.ok(public.test_only_profile_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000601') IS NOT NULL
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=0,
  'semantic no-op completes idempotency without mutation or event');
RESET ROLE;

DO $profile_changed_tests$
DECLARE prior_site timestamptz; prior_profile timestamptz; prior_zh timestamptz; prior_en timestamptz;
BEGIN
  SELECT updated_at INTO prior_site FROM public.resume_sites WHERE id='ea111111-1111-4111-8111-111111111111';
  SELECT updated_at INTO prior_profile FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111';
  SELECT updated_at INTO prior_zh FROM public.resume_profile_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh';
  SELECT updated_at INTO prior_en FROM public.resume_profile_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
  PERFORM public.test_only_profile_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000602',NULL);
  IF (SELECT updated_at FROM public.resume_sites WHERE id='ea111111-1111-4111-8111-111111111111') IS DISTINCT FROM prior_site
    OR (SELECT updated_at FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111') IS DISTINCT FROM prior_profile
    OR (SELECT updated_at FROM public.resume_profile_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh') IS DISTINCT FROM prior_zh
    OR (SELECT updated_at FROM public.resume_profile_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en') IS DISTINCT FROM prior_en THEN
    RAISE EXCEPTION 'semantic Profile no-op changed updated_at';
  END IF;
END
$profile_changed_tests$;
SELECT extensions.ok(public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=0,
  'semantic no-op preserves parent and Profile row timestamps and creates no event');
SELECT extensions.ok(public.test_only_profile_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000603','changed')->'shared'->>'graduation_value'='changed',
  'changed save returns the updated aggregate');
SELECT extensions.ok((SELECT name='Profile changed en' FROM public.resume_profile_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en'),
  'changed save persists the English translation');
SELECT extensions.ok((SELECT graduation_value='changed' AND copyright='Profile changed copyright' FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111'),
  'changed save persists shared Profile fields');
SELECT extensions.ok(public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'changed save creates exactly one Profile V2 event');
SELECT extensions.ok(public.test_only_profile_event_valid('ea111111-1111-4111-8111-111111111111'),
  'Profile V2 event snapshot and before/after validate');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT set_config('profile.fail_activity_insert','on',true);
SELECT extensions.ok(public.test_only_profile_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000608','rollback')='55000',
  'forced Activity Log insert failure aborts Profile RPC');
RESET ROLE;
SELECT set_config('profile.fail_activity_insert','off',true);
SELECT extensions.ok((SELECT graduation_value='changed' FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111')
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=1
  AND NOT EXISTS (SELECT 1 FROM cms_private.activity_log_idempotency WHERE resume_id='ea111111-1111-4111-8111-111111111111'
    AND domain_key='profile' AND request_id='ea000000-0000-4000-8000-000000000608'),
  'failed event insertion rolls back Profile data and the idempotency row');
SELECT extensions.ok(public.test_only_profile_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000603','changed') IS NOT NULL
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=1
  AND public.test_only_profile_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000603','conflict')='P13B1'
  AND (SELECT graduation_value='changed' FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111')
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'exact replay creates no duplicate event and conflicting payload fails before mutation');
SELECT extensions.ok(public.test_only_profile_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000604','signature',NULL,repeat('0',64))='22023'
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'invalid signature fails before Profile mutation or event insertion');
SELECT extensions.ok(public.test_only_profile_state('20000000-0000-4000-8000-000000000099','ea000000-0000-4000-8000-000000000605')='42501',
  'unauthorized target fails closed before Profile mutation');

DELETE FROM cms_private.profile_photo_origin_config WHERE singleton;
SELECT extensions.ok(public.test_only_profile_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000606','photo',
  'https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp')='22023'
  AND (SELECT photo_url IS NULL FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111')
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'changed non-null photo fails closed when the origin is unconfigured');
INSERT INTO cms_private.profile_photo_origin_config(singleton,origin) VALUES(true,'https://local.supabase.invalid');
SELECT extensions.ok(public.test_only_profile_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000607','photo',
  'https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp')->'shared'->>'photo_url'
    LIKE 'https://local.supabase.invalid/storage/v1/object/public/profile-images/ea111111-1111-4111-8111-111111111111/profile/%'
  AND public.test_only_profile_event_count('ea111111-1111-4111-8111-111111111111')=2,
  'valid configured managed photo URL is saved as the exact authoritative value');

RESET ROLE;
SELECT extensions.finish();
ROLLBACK;
