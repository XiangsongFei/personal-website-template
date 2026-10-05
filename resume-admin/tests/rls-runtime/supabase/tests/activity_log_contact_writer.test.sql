-- TEST ONLY: Contact aggregate V2, typed writer, idempotency, rollback, and mode-aware RLS.
BEGIN;
CREATE FUNCTION public.test_only_contact_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='contact' AND entity_type='contact_section' AND payload_version=2 $function$;
CREATE FUNCTION public.test_only_contact_event_valid(target_resume uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT count(*)=1 AND COALESCE(bool_and(operation='update' AND section_key='contact' AND entity_type='contact_section' AND entity_id IS NULL AND payload_version=2
    AND changes->'contact'->'before'->'focus'->0->>'position'='3'
    AND changes->'contact'->'before'->'status'->0->>'position'='2'
    AND changes->'contact'->'after'->'focus'->0->>'position'='0'
    AND changes->'contact'->'after'->'status'->0->>'position'='0'
    AND changes->'contact'->'after'=entity_snapshot->'contact'),false)
  FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='contact' AND payload_version=2
$function$;
CREATE FUNCTION public.test_only_contact_official_unchanged(target_resume uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT (SELECT write_mode='direct' FROM cms_private.resume_write_modes WHERE resume_id=target_resume AND domain_key='contact')
    AND NOT EXISTS(SELECT 1 FROM cms_private.resume_domain_requirements WHERE resume_id=target_resume AND domain_key='contact' AND requirement_key='trusted_network_context_v11')
    AND (SELECT count(*)=0 FROM public.resume_contact_focus_items WHERE resume_id=target_resume)
    AND (SELECT count(*)=0 FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='contact' AND payload_version=2)
$function$;
CREATE FUNCTION public.test_only_contact_payload(target_resume uuid, marker text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT pg_catalog.jsonb_build_object('translations',pg_catalog.jsonb_build_object(
      'zh',pg_catalog.jsonb_build_object('contact_label',CASE marker WHEN 'changed' THEN 'Contact integration changed' WHEN 'conflict' THEN 'Contact integration conflict' ELSE zh.contact_label END,'availability',zh.availability),
      'en',pg_catalog.jsonb_build_object('contact_label',en.contact_label,'availability',en.availability)),
    'focus',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',x.id::text,'position',x.position,
      'zh',pg_catalog.jsonb_build_object('title',CASE WHEN marker='changed' AND x.ordinality=1 THEN 'Contact focus changed' ELSE x.zh_title END,'detail',x.zh_detail),
      'en',pg_catalog.jsonb_build_object('title',x.en_title,'detail',x.en_detail)) ORDER BY x.position,x.id)
      FROM (SELECT p.id,(pg_catalog.row_number() OVER(ORDER BY p.position,p.id)-1)::integer AS position,p.position AS stored_position,
        zt.title AS zh_title,zt.detail AS zh_detail,et.title AS en_title,et.detail AS en_detail,
        pg_catalog.row_number() OVER(ORDER BY p.position,p.id) AS ordinality
        FROM public.resume_contact_focus_items p JOIN public.resume_contact_focus_translations zt ON zt.resume_id=p.resume_id AND zt.focus_item_id=p.id AND zt.locale='zh'
        JOIN public.resume_contact_focus_translations et ON et.resume_id=p.resume_id AND et.focus_item_id=p.id AND et.locale='en' WHERE p.resume_id=target_resume) x),'[]'::jsonb),
    'status',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',x.id::text,'position',x.position,
      'status_type',CASE WHEN marker='changed' AND x.ordinality=1 THEN 'study' ELSE x.status_type END,
      'zh',pg_catalog.jsonb_build_object('title',CASE WHEN marker='force rollback' AND x.ordinality=1 THEN 'force rollback' WHEN marker='changed' AND x.ordinality=1 THEN 'Contact status changed' ELSE x.zh_title END,'detail',x.zh_detail),
      'en',pg_catalog.jsonb_build_object('title',x.en_title,'detail',x.en_detail)) ORDER BY x.position,x.id)
      FROM (SELECT p.id,(pg_catalog.row_number() OVER(ORDER BY p.position,p.id)-1)::integer AS position,p.status_type,
        zt.title AS zh_title,zt.detail AS zh_detail,et.title AS en_title,et.detail AS en_detail,
        pg_catalog.row_number() OVER(ORDER BY p.position,p.id) AS ordinality
        FROM public.resume_contact_status_items p JOIN public.resume_contact_status_translations zt ON zt.resume_id=p.resume_id AND zt.status_item_id=p.id AND zt.locale='zh'
        JOIN public.resume_contact_status_translations et ON et.resume_id=p.resume_id AND et.status_item_id=p.id AND et.locale='en' WHERE p.resume_id=target_resume) x),'[]'::jsonb))
  FROM public.resume_locale_content zh JOIN public.resume_locale_content en ON en.resume_id=zh.resume_id AND en.locale='en'
  WHERE zh.resume_id=target_resume AND zh.locale='zh'
$function$;
CREATE FUNCTION public.test_only_contact_sign(target_resume uuid,target_contact text,target_request uuid)
RETURNS TABLE(signed_context text,signature_hex text) LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  WITH stamp AS (SELECT pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint AS issued), context AS (
    SELECT pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
      'actor_user_id','10000000-0000-4000-8000-000000000002','resume_id',target_resume::text,'domain','contact','operation','update',
      'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_contact,'UTF8'),'sha256'),'hex'),
      'issued_at',stamp.issued,'expires_at',stamp.issued+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text AS value
    FROM stamp
  ) SELECT context.value,pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(context.value,'UTF8'),
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex') FROM context
$function$;
CREATE FUNCTION public.test_only_contact_save(target_resume uuid,target_request uuid,marker text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE payload text; signed_value text; signature_value text;
BEGIN
  payload:=public.test_only_contact_payload(target_resume,marker)::text;
  SELECT signed_context,signature_hex INTO signed_value,signature_value FROM public.test_only_contact_sign(target_resume,payload,target_request);
  RETURN public.save_resume_contact_v1(target_resume,payload,signed_value,signature_value);
END
$function$;
CREATE FUNCTION public.test_only_contact_state(target_resume uuid,target_request uuid,marker text,signature_override text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE payload text; signed_value text; signature_value text; state_value text;
BEGIN
  payload:=public.test_only_contact_payload(target_resume,marker)::text;
  SELECT signed_context,signature_hex INTO signed_value,signature_value FROM public.test_only_contact_sign(target_resume,payload,target_request);
  BEGIN PERFORM public.save_resume_contact_v1(target_resume,payload,signed_value,COALESCE(signature_override,signature_value)); state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value;
END
$function$;
CREATE FUNCTION public.test_only_contact_direct_locale_blocked(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE old_value text; state_value text;
BEGIN
  SELECT contact_label INTO old_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh';
  BEGIN UPDATE public.resume_locale_content SET contact_label='forbidden direct value' WHERE resume_id=target_resume AND locale='zh'; state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value='42501' AND (SELECT contact_label FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh')=old_value;
END
$function$;
CREATE FUNCTION public.test_only_contact_locale_child_count(target_resume uuid,target_locale text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT (SELECT count(*) FROM public.resume_profile_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_navigation_item_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_intro_paragraph_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_education_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_experience_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_project_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_skill_group_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_award_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_contact_focus_translations WHERE resume_id=target_resume AND locale=target_locale)
    +(SELECT count(*) FROM public.resume_contact_status_translations WHERE resume_id=target_resume AND locale=target_locale)
$function$;
CREATE FUNCTION public.test_only_contact_direct_locale_delete_blocked(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE prior_children bigint; state_value text;
BEGIN
  prior_children:=public.test_only_contact_locale_child_count(target_resume,'zh');
  BEGIN DELETE FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh'; state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value='42501'
    AND EXISTS(SELECT 1 FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh')
    AND public.test_only_contact_locale_child_count(target_resume,'zh')=prior_children;
END
$function$;
CREATE FUNCTION public.test_only_contact_direct_locale_insert_blocked(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE state_value text;
BEGIN
  BEGIN
    INSERT INTO public.resume_locale_content(resume_id,locale,education_label,experience_label,project_heading,skills_label,
      honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href)
    VALUES(target_resume,'zh','Education','Experience','Projects','Skills','Awards','Contact','Available','Portfolio','',
      'Kaggle','Updated','LinkedIn','');
    state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value='42501' AND NOT EXISTS(SELECT 1 FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh');
END
$function$;
CREATE FUNCTION public.test_only_contact_unrelated_locale_update_allowed(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE prior_value text;
BEGIN
  SELECT education_label INTO prior_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh';
  UPDATE public.resume_locale_content SET education_label='unrelated shared field probe' WHERE resume_id=target_resume AND locale='zh';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.resume_locale_content SET education_label=prior_value WHERE resume_id=target_resume AND locale='zh';
  RETURN FOUND AND (SELECT education_label=prior_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh');
END
$function$;
CREATE FUNCTION public.test_only_contact_key_move_blocked(source_resume uuid,destination_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE state_value text;
BEGIN
  BEGIN UPDATE public.resume_locale_content SET resume_id=destination_resume WHERE resume_id=source_resume AND locale='zh'; state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value='42501' AND EXISTS(SELECT 1 FROM public.resume_locale_content WHERE resume_id=source_resume AND locale='zh');
END
$function$;
CREATE FUNCTION public.test_only_contact_direct_locale_delete_legacy(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
  DELETE FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh';
  RETURN NOT EXISTS(SELECT 1 FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh');
END
$function$;
CREATE FUNCTION public.test_only_contact_direct_locale_insert_legacy(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
  INSERT INTO public.resume_locale_content(resume_id,locale,education_label,experience_label,project_heading,skills_label,
    honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href)
  VALUES(target_resume,'zh','Education','Experience','Projects','Skills','Awards','Contact','Available','Portfolio','',
    'Kaggle','Updated','LinkedIn','');
  RETURN EXISTS(SELECT 1 FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh');
END
$function$;
CREATE FUNCTION public.test_only_contact_direct_collection_blocked(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE original_title text; row_count integer;
BEGIN
  SELECT title INTO original_title FROM public.resume_contact_focus_translations WHERE resume_id=target_resume AND locale='zh' ORDER BY focus_item_id LIMIT 1;
  UPDATE public.resume_contact_focus_translations SET title='forbidden direct value' WHERE resume_id=target_resume AND locale='zh';
  GET DIAGNOSTICS row_count=ROW_COUNT;
  RETURN row_count=0 AND (SELECT title FROM public.resume_contact_focus_translations WHERE resume_id=target_resume AND locale='zh' ORDER BY focus_item_id LIMIT 1)=original_title;
END
$function$;
CREATE FUNCTION public.test_only_contact_direct_legacy(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE original_value text;
BEGIN
  SELECT contact_label INTO original_value FROM public.resume_locale_content WHERE resume_id=target_resume AND locale='zh';
  UPDATE public.resume_locale_content SET contact_label='legacy direct test' WHERE resume_id=target_resume AND locale='zh';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.resume_locale_content SET contact_label=original_value WHERE resume_id=target_resume AND locale='zh';
  RETURN FOUND;
END
$function$;
CREATE FUNCTION public.test_only_contact_failure_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$ BEGIN IF NEW.title='force rollback' THEN RAISE EXCEPTION 'synthetic rollback probe' USING ERRCODE='22023'; END IF; RETURN NEW; END $function$;
REVOKE ALL ON FUNCTION public.test_only_contact_event_count(uuid),public.test_only_contact_event_valid(uuid),public.test_only_contact_official_unchanged(uuid),public.test_only_contact_payload(uuid,text),public.test_only_contact_sign(uuid,text,uuid),
  public.test_only_contact_save(uuid,uuid,text),public.test_only_contact_state(uuid,uuid,text,text),public.test_only_contact_direct_locale_blocked(uuid),
  public.test_only_contact_locale_child_count(uuid,text),public.test_only_contact_direct_locale_delete_blocked(uuid),public.test_only_contact_direct_locale_insert_blocked(uuid),
  public.test_only_contact_unrelated_locale_update_allowed(uuid),public.test_only_contact_key_move_blocked(uuid,uuid),
  public.test_only_contact_direct_locale_delete_legacy(uuid),public.test_only_contact_direct_locale_insert_legacy(uuid),
  public.test_only_contact_direct_collection_blocked(uuid),public.test_only_contact_direct_legacy(uuid),public.test_only_contact_failure_trigger() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_contact_event_count(uuid),public.test_only_contact_event_valid(uuid),public.test_only_contact_official_unchanged(uuid),public.test_only_contact_payload(uuid,text),public.test_only_contact_sign(uuid,text,uuid),
  public.test_only_contact_save(uuid,uuid,text),public.test_only_contact_state(uuid,uuid,text,text),public.test_only_contact_direct_locale_blocked(uuid),
  public.test_only_contact_locale_child_count(uuid,text),public.test_only_contact_direct_locale_delete_blocked(uuid),public.test_only_contact_direct_locale_insert_blocked(uuid),
  public.test_only_contact_unrelated_locale_update_allowed(uuid),public.test_only_contact_key_move_blocked(uuid,uuid),
  public.test_only_contact_direct_locale_delete_legacy(uuid),public.test_only_contact_direct_locale_insert_legacy(uuid),
  public.test_only_contact_direct_collection_blocked(uuid),public.test_only_contact_direct_legacy(uuid) TO authenticated;

SELECT extensions.plan(33);
SELECT extensions.ok((SELECT contact_label_attnotnull AND availability_attnotnull FROM (
    SELECT bool_or(attnotnull) FILTER(WHERE attname='contact_label') AS contact_label_attnotnull,
      bool_or(attnotnull) FILTER(WHERE attname='availability') AS availability_attnotnull
    FROM pg_catalog.pg_attribute WHERE attrelid='public.resume_locale_content'::regclass AND attnum>0 AND NOT attisdropped) columns)
  AND (SELECT array_agg(a.attname ORDER BY key_column.ordinality)=ARRAY['resume_id','locale']::name[]
    FROM pg_catalog.pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key_column(attnum,ordinality)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key_column.attnum
    WHERE c.conrelid='public.resume_locale_content'::regclass AND c.contype='p')
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.confrelid='public.resume_locale_content'::regclass AND c.contype='f' AND c.confdeltype='c'),
  'shared locale row INSERT/DELETE always creates/removes non-null Contact values and cascades dependent translations; no unrelated row-existence operation exists');
SELECT extensions.ok(to_regprocedure('public.load_admin_contact_write_state(uuid)') IS NOT NULL
  AND to_regprocedure('public.save_resume_contact_v1(uuid,text,text,text)') IS NOT NULL,'Contact state reader and typed writer are installed');
SELECT extensions.ok(has_function_privilege('authenticated','public.load_admin_contact_write_state(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.save_resume_contact_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.load_admin_contact_write_state(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_contact_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_contact_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('public','public.save_resume_contact_v1(uuid,text,text,text)','EXECUTE'),'typed entry points are authenticated-only');
SELECT extensions.ok((SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.save_resume_contact_v1(uuid,text,text,text)'::regprocedure)
  AND (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.load_admin_contact_write_state(uuid)'::regprocedure),
  'writer is SECURITY DEFINER and reader is STABLE with empty search_path');
SELECT extensions.ok(NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_idempotency','INSERT'),'authenticated cannot write audit or idempotency rows');
SELECT extensions.ok((SELECT write_mode='direct' FROM cms_private.resume_write_modes WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='contact')
  AND NOT EXISTS(SELECT 1 FROM cms_private.resume_domain_requirements WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='contact' AND requirement_key='trusted_network_context_v11'),
  'installation preserves QA Contact direct mode and no trusted requirement');
SELECT extensions.ok(NOT has_function_privilege('authenticated','cms_private.activity_event_payload_v2_contact_is_allowed(text,text,text,text,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','cms_private.activity_event_payload_v2_contact_is_allowed(text,text,text,text,jsonb,jsonb)','EXECUTE'),
  'private Contact payload validators are not executable by API roles');
SELECT extensions.ok(cms_private.contact_aggregate_is_allowed('{"translations":{"zh":{"contact_label":"","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[]}'::jsonb,true,true),
  'Contact aggregate accepts empty strings and empty collections');
SELECT extensions.ok(NOT cms_private.contact_aggregate_is_allowed('{"translations":{"zh":{"contact_label":"x","availability":""},"en":{"contact_label":"","availability":""}},"focus":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":1,"zh":{"title":"x","detail":""},"en":{"title":"x","detail":""}}],"status":[]}'::jsonb,true,true)
  AND NOT cms_private.contact_aggregate_is_allowed('{"translations":{"zh":{"contact_label":"x","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"status_type":"unknown","zh":{"title":"x","detail":""},"en":{"title":"x","detail":""}}]}'::jsonb,true,true),
  'malformed dense ordering and unknown status types fail closed');
SELECT extensions.ok(cms_private.activity_event_payload_v2_contact_is_allowed('contact','contact_section',NULL,'update',
  '{"contact":{"translations":{"zh":{"contact_label":"","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[]}}'::jsonb,
  '{"contact":{"before":{"translations":{"zh":{"contact_label":"","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[]},"after":{"translations":{"zh":{"contact_label":"","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[]}}}'::jsonb),
  'Contact V2 empty collection shape is accepted');
SELECT extensions.ok(NOT cms_private.activity_event_payload_v2_contact_is_allowed('contact','contact_section',NULL,'update',
  '{"contact":{"translations":{"zh":{"contact_label":"","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[]}}'::jsonb,
  '{"contact":{"before":{"translations":{"zh":{"contact_label":"","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[]},"after":{"translations":{"zh":{"contact_label":"","availability":""},"en":{"contact_label":"","availability":""}},"focus":[],"status":[]},"extra":true}}'::jsonb),
  'unknown Contact event keys are rejected');

INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode) VALUES('ea111111-1111-4111-8111-111111111111','contact','direct')
ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='direct';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok((SELECT contact_write_mode='direct' AND NOT contact_trusted_context_required FROM public.load_admin_contact_write_state('ea111111-1111-4111-8111-111111111111')),
  'write state reader reports target-scoped direct mode');
SELECT extensions.ok(public.test_only_contact_direct_legacy('ea111111-1111-4111-8111-111111111111'),
  'authorized legacy Contact locale writes remain permitted in direct mode');
RESET ROLE;

-- Create an existing sparse before-state. It is local-test-only and rolled back below.
UPDATE public.resume_contact_focus_items SET position=position+1000 WHERE resume_id='ea111111-1111-4111-8111-111111111111';
UPDATE public.resume_contact_focus_items SET position=(position-1000)*4+3 WHERE resume_id='ea111111-1111-4111-8111-111111111111';
UPDATE public.resume_contact_status_items SET position=position+1000 WHERE resume_id='ea111111-1111-4111-8111-111111111111';
UPDATE public.resume_contact_status_items SET position=(position-1000)*5+2 WHERE resume_id='ea111111-1111-4111-8111-111111111111';
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode) VALUES('ea111111-1111-4111-8111-111111111111','contact','rpc')
ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='rpc';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','contact','trusted_network_context_v11',true)
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;
CREATE TRIGGER test_only_force_contact_rollback BEFORE UPDATE ON public.resume_contact_status_translations
FOR EACH ROW EXECUTE FUNCTION public.test_only_contact_failure_trigger();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok((SELECT contact_write_mode='rpc' AND contact_trusted_context_required FROM public.load_admin_contact_write_state('ea111111-1111-4111-8111-111111111111')),
  'state reader reports activated test mode and trusted requirement');
SELECT extensions.ok(public.test_only_contact_direct_locale_blocked('ea111111-1111-4111-8111-111111111111')
  AND public.test_only_contact_direct_collection_blocked('ea111111-1111-4111-8111-111111111111'),
  'rpc mode blocks direct Contact value and collection writes');
SELECT extensions.ok(public.test_only_contact_direct_locale_delete_blocked('ea111111-1111-4111-8111-111111111111'),
  'rpc mode rejects direct locale DELETE before row removal or cascading child deletion');
SELECT extensions.ok(public.test_only_contact_unrelated_locale_update_allowed('ea111111-1111-4111-8111-111111111111'),
  'Contact rpc mode does not govern an unrelated stable-key locale field UPDATE');
SELECT extensions.ok(public.test_only_contact_key_move_blocked('ea111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000001'),
  'key-changing UPDATE out of a Contact rpc target checks OLD ownership and is denied');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"owner@example.test"}',true);
SELECT extensions.ok(public.test_only_contact_key_move_blocked('20000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111'),
  'key-changing UPDATE into a Contact rpc target checks NEW ownership and is denied');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok(public.test_only_contact_event_count('ea111111-1111-4111-8111-111111111111')=0,
  'denied direct update/insert/delete/key moves produce no Contact success event');
SELECT extensions.ok(public.test_only_contact_state('20000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000499',NULL)='42501'
  AND public.test_only_contact_event_count('20000000-0000-4000-8000-000000000001')=0,
  'unauthorized target Contact RPC fails before mutation or event creation');

SELECT extensions.ok(public.test_only_contact_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000501') IS NOT NULL
  AND (SELECT count(*)=2 AND min(position)=3 AND max(position)=7 FROM public.resume_contact_focus_items WHERE resume_id='ea111111-1111-4111-8111-111111111111')
  AND (SELECT count(*)=3 AND min(position)=2 AND max(position)=12 FROM public.resume_contact_status_items WHERE resume_id='ea111111-1111-4111-8111-111111111111')
  AND public.test_only_contact_event_count('ea111111-1111-4111-8111-111111111111')=0,
  'semantic no-op accepts canonical dense request and preserves sparse stored positions without an event');

SELECT extensions.ok((public.test_only_contact_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000502','changed')->'translations'->'zh'->>'contact_label')='Contact integration changed'
  AND public.test_only_contact_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'changed aggregate save persists locale update and exactly one V2 event');
SELECT extensions.ok((SELECT t.title='Contact focus changed' FROM public.resume_contact_focus_items p JOIN public.resume_contact_focus_translations t
    ON t.resume_id=p.resume_id AND t.focus_item_id=p.id AND t.locale='zh' WHERE p.resume_id='ea111111-1111-4111-8111-111111111111' ORDER BY p.position,p.id LIMIT 1)
  AND (SELECT bool_and(position=expected) FROM (SELECT position,(row_number() OVER(ORDER BY position,id)-1)::integer expected FROM public.resume_contact_focus_items WHERE resume_id='ea111111-1111-4111-8111-111111111111') x),
  'changed save updates Focus and normalizes changed Focus order');
SELECT extensions.ok((SELECT p.status_type='study' FROM public.resume_contact_status_items p WHERE p.resume_id='ea111111-1111-4111-8111-111111111111' ORDER BY p.position,p.id LIMIT 1)
  AND (SELECT t.title='Contact status changed' FROM public.resume_contact_status_items p JOIN public.resume_contact_status_translations t
    ON t.resume_id=p.resume_id AND t.status_item_id=p.id AND t.locale='zh' WHERE p.resume_id='ea111111-1111-4111-8111-111111111111' ORDER BY p.position,p.id LIMIT 1)
  AND (SELECT bool_and(position=expected) FROM (SELECT position,(row_number() OVER(ORDER BY position,id)-1)::integer expected FROM public.resume_contact_status_items WHERE resume_id='ea111111-1111-4111-8111-111111111111') x),
  'changed save updates Status and normalizes changed Status order');
SELECT extensions.ok(public.test_only_contact_event_valid('ea111111-1111-4111-8111-111111111111'),
  'success event stores sparse before-state and authoritative dense after snapshot');
SELECT extensions.ok(public.test_only_contact_save('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000502','changed') IS NOT NULL
  AND public.test_only_contact_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'exact replay returns success without duplicate event');
SELECT extensions.ok(public.test_only_contact_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000502','conflict')='P13B1'
  AND (SELECT contact_label='Contact integration changed' FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh')
  AND public.test_only_contact_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'changed payload with reused request ID fails before mutation');
SELECT extensions.ok(public.test_only_contact_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000503',NULL,repeat('0',64))='22023'
  AND public.test_only_contact_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'invalid signature fails before Contact mutation or event insertion');
SELECT extensions.ok(public.test_only_contact_state('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000504','force rollback')='22023'
  AND (SELECT contact_label='Contact integration changed' FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh')
  AND NOT EXISTS(SELECT 1 FROM public.resume_contact_status_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND title='force rollback')
  AND public.test_only_contact_event_count('ea111111-1111-4111-8111-111111111111')=1,
  'late Contact mutation failure rolls back locale, collection, event, and ledger changes');
SELECT extensions.ok(public.test_only_contact_official_unchanged('20000000-0000-4000-8000-000000000001'),
  'Official target and Contact rows remain untouched');
RESET ROLE;
-- Exercise row-creation/deletion guards last: each operation intentionally removes
-- or recreates Contact state and cascades every locale child. The enclosing test
-- transaction is rolled back below, restoring the complete synthetic fixture.
DELETE FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok(public.test_only_contact_direct_locale_insert_blocked('ea111111-1111-4111-8111-111111111111'),
  'rpc mode rejects valid Contact locale INSERT when the shared locale key is absent');
RESET ROLE;
UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='contact';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok(public.test_only_contact_direct_locale_insert_legacy('ea111111-1111-4111-8111-111111111111')
  AND public.test_only_contact_direct_locale_delete_legacy('ea111111-1111-4111-8111-111111111111'),
  'authorized Contact row INSERT/DELETE remain permitted in direct mode');
RESET ROLE;
ROLLBACK;
