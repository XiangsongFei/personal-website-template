-- TEST ONLY: Experience and Skills typed writer installation, mode gates,
-- authenticated execution, idempotency, aggregate events, and PostgreSQL bounds.
BEGIN;
-- Local test-only helpers are transaction-scoped and use only the established
-- synthetic V1.1 key from the isolated runtime fixture.
CREATE FUNCTION public.test_only_d2_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume $function$;
CREATE FUNCTION public.test_only_d2_event_shape(target_resume uuid,target_section text,target_entity text,target_after jsonb)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT EXISTS(SELECT 1 FROM cms_private.activity_log_events e WHERE e.resume_id=target_resume
  AND e.section_key=target_section AND e.entity_type=target_entity AND e.entity_id IS NULL AND e.operation='update'
  AND e.payload_version=2 AND e.entity_snapshot->target_section=target_after
  AND e.changes->target_section->'after'=target_after) $function$;
CREATE FUNCTION public.test_only_d2_idempotency_exists(target_resume uuid,target_domain text,target_request uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT EXISTS(SELECT 1 FROM cms_private.activity_log_idempotency i WHERE i.resume_id=target_resume
  AND i.domain_key=target_domain AND i.request_id=target_request) $function$;
CREATE FUNCTION public.test_only_d2_set_experience_source(target_resume uuid,target_item uuid,target_source text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ UPDATE public.resume_experience_entries SET source_key=target_source WHERE resume_id=target_resume AND id=target_item $function$;
CREATE FUNCTION public.test_only_d2_experience_source(target_resume uuid,target_item uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT source_key FROM public.resume_experience_entries WHERE resume_id=target_resume AND id=target_item $function$;
CREATE FUNCTION public.test_only_d2_set_skills_source(target_resume uuid,target_item uuid,target_source text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ UPDATE public.resume_skill_groups SET source_key=target_source WHERE resume_id=target_resume AND id=target_item $function$;
CREATE FUNCTION public.test_only_d2_skills_source(target_resume uuid,target_item uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT source_key FROM public.resume_skill_groups WHERE resume_id=target_resume AND id=target_item $function$;
CREATE FUNCTION public.test_only_d2_fail_activity_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$ BEGIN IF pg_catalog.current_setting('d2.fail_activity_insert',true)='true'
  THEN RAISE EXCEPTION 'TEST ONLY forced aggregate event failure'; END IF; RETURN NEW; END $function$;
CREATE TRIGGER test_only_d2_fail_activity_insert BEFORE INSERT ON cms_private.activity_log_events
FOR EACH ROW EXECUTE FUNCTION public.test_only_d2_fail_activity_insert();
CREATE FUNCTION public.test_only_d2_sign_context(target_resume uuid,target_items text,target_actor uuid,target_request uuid,target_domain text)
RETURNS TABLE(signed_context text,signature_hex text) LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  WITH stamp AS (SELECT pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint AS issued), context AS (
    SELECT pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
      'actor_user_id',target_actor::text,'resume_id',target_resume::text,'domain',target_domain,'operation','update',
      'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_items,'UTF8'),'sha256'),'hex'),
      'issued_at',stamp.issued,'expires_at',stamp.issued+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text AS value FROM stamp
  ) SELECT context.value,pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(context.value,'UTF8'),
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex') FROM context
$function$;
CREATE FUNCTION public.test_only_d2_sign_context_variant(target_resume uuid,target_items text,target_actor uuid,target_request uuid,
  target_domain text,context_patch jsonb DEFAULT '{}'::jsonb,remove_key text DEFAULT NULL)
RETURNS TABLE(signed_context text,signature_hex text) LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE ctx jsonb; stamp bigint;
BEGIN
  stamp:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  ctx:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
    'actor_user_id',target_actor::text,'resume_id',target_resume::text,'domain',target_domain,'operation','update',
    'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_items,'UTF8'),'sha256'),'hex'),
    'issued_at',stamp,'expires_at',stamp+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)
    ||COALESCE(context_patch,'{}'::jsonb);
  IF remove_key IS NOT NULL THEN ctx:=ctx-remove_key; END IF;
  signed_context:=ctx::text;
  signature_hex:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex');
  RETURN NEXT;
END
$function$;
CREATE FUNCTION public.test_only_d2_content_snapshot(target_resume uuid,target_domain text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT CASE target_domain
    WHEN 'experience' THEN COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',g.id::text,'position',g.position,
      'zh',pg_catalog.jsonb_build_object('organization',zh.organization,'title',zh.title,'period',zh.period,'description',zh.description,'location',zh.location),
      'en',pg_catalog.jsonb_build_object('organization',en.organization,'title',en.title,'period',en.period,'description',en.description,'location',en.location)) ORDER BY g.position,g.id)
      FROM public.resume_experience_entries g JOIN public.resume_experience_translations zh ON zh.experience_entry_id=g.id AND zh.resume_id=g.resume_id AND zh.locale='zh'
      JOIN public.resume_experience_translations en ON en.experience_entry_id=g.id AND en.resume_id=g.resume_id AND en.locale='en' WHERE g.resume_id=target_resume),'[]'::jsonb)
    WHEN 'skills' THEN COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',g.id::text,'position',g.position,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'items',zh.items),'en',pg_catalog.jsonb_build_object('title',en.title,'items',en.items)) ORDER BY g.position,g.id)
      FROM public.resume_skill_groups g JOIN public.resume_skill_group_translations zh ON zh.skill_group_id=g.id AND zh.resume_id=g.resume_id AND zh.locale='zh'
      JOIN public.resume_skill_group_translations en ON en.skill_group_id=g.id AND en.resume_id=g.resume_id AND en.locale='en' WHERE g.resume_id=target_resume),'[]'::jsonb)
    ELSE NULL END
$function$;
CREATE FUNCTION public.test_only_d2_system_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_system_events WHERE resume_id=target_resume $function$;
CREATE FUNCTION public.test_only_d2_rejects_invalid_context(target_resume uuid,target_domain text,target_items text,
  target_actor uuid,target_request uuid,context_patch jsonb DEFAULT '{}'::jsonb,remove_key text DEFAULT NULL,
  tamper_signature boolean DEFAULT false,tamper_context_request boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE context_value text; signature_value text; supplied_signature text; actual_state text;
  content_before jsonb; events_before bigint; system_before bigint; effective_request uuid := target_request;
BEGIN
  content_before:=public.test_only_d2_content_snapshot(target_resume,target_domain);
  events_before:=public.test_only_d2_event_count(target_resume);
  system_before:=public.test_only_d2_system_event_count(target_resume);
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context_variant(
    target_resume,target_items,target_actor,target_request,target_domain,context_patch,remove_key);
  IF tamper_context_request THEN
    effective_request:=pg_catalog.gen_random_uuid();
    context_value:=(context_value::jsonb||pg_catalog.jsonb_build_object('request_id',effective_request::text))::text;
  END IF;
  supplied_signature:=CASE WHEN tamper_signature THEN (CASE WHEN left(signature_value,1)='0' THEN '1' ELSE '0' END)||substr(signature_value,2) ELSE signature_value END;
  BEGIN
    IF target_domain='experience' THEN
      PERFORM public.save_resume_experience_v1(target_resume,target_items,context_value,supplied_signature);
    ELSIF target_domain='skills' THEN
      PERFORM public.save_resume_skills_v1(target_resume,target_items,context_value,supplied_signature);
    ELSE RETURN false;
    END IF;
    actual_state:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE;
  END;
  RETURN actual_state='22023'
    AND public.test_only_d2_content_snapshot(target_resume,target_domain)=content_before
    AND public.test_only_d2_event_count(target_resume)=events_before
    AND public.test_only_d2_system_event_count(target_resume)=system_before
    AND NOT public.test_only_d2_idempotency_exists(target_resume,target_domain,target_request)
    AND NOT public.test_only_d2_idempotency_exists(target_resume,target_domain,effective_request);
END
$function$;
CREATE FUNCTION public.test_only_d2_skills_rejects_wrong_target(target_resume uuid,alternate_resume uuid,target_actor uuid,target_request uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE context_value text; signature_value text; actual_state text; content_before jsonb;
  alternate_before jsonb; target_events bigint; alternate_events bigint; system_before bigint;
  canonical text := '[{"id":null,"position":0,"zh":{"title":"测试","items":"目标隔离"},"en":{"title":"Test","items":"Target isolation"}}]';
BEGIN
  content_before:=public.test_only_d2_content_snapshot(target_resume,'skills');
  alternate_before:=public.test_only_d2_content_snapshot(alternate_resume,'skills');
  target_events:=public.test_only_d2_event_count(target_resume); alternate_events:=public.test_only_d2_event_count(alternate_resume);
  system_before:=public.test_only_d2_system_event_count(target_resume)+public.test_only_d2_system_event_count(alternate_resume);
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context_variant(
    target_resume,canonical,target_actor,target_request,'skills');
  BEGIN PERFORM public.save_resume_skills_v1(alternate_resume,canonical,context_value,signature_value); actual_state:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE; END;
  RETURN actual_state='42501'
    AND public.test_only_d2_content_snapshot(target_resume,'skills')=content_before
    AND public.test_only_d2_content_snapshot(alternate_resume,'skills')=alternate_before
    AND public.test_only_d2_event_count(target_resume)=target_events
    AND public.test_only_d2_event_count(alternate_resume)=alternate_events
    AND public.test_only_d2_system_event_count(target_resume)+public.test_only_d2_system_event_count(alternate_resume)=system_before
    AND NOT public.test_only_d2_idempotency_exists(target_resume,'skills',target_request)
    AND NOT public.test_only_d2_idempotency_exists(alternate_resume,'skills',target_request);
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_d2_event_count(uuid),public.test_only_d2_event_shape(uuid,text,text,jsonb),
  public.test_only_d2_idempotency_exists(uuid,text,uuid),public.test_only_d2_set_experience_source(uuid,uuid,text),
  public.test_only_d2_experience_source(uuid,uuid),public.test_only_d2_set_skills_source(uuid,uuid,text),public.test_only_d2_skills_source(uuid,uuid),
  public.test_only_d2_sign_context(uuid,text,uuid,uuid,text),public.test_only_d2_sign_context_variant(uuid,text,uuid,uuid,text,jsonb,text),
  public.test_only_d2_content_snapshot(uuid,text),public.test_only_d2_system_event_count(uuid),
  public.test_only_d2_rejects_invalid_context(uuid,text,text,uuid,uuid,jsonb,text,boolean,boolean),
  public.test_only_d2_skills_rejects_wrong_target(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_d2_event_count(uuid),public.test_only_d2_event_shape(uuid,text,text,jsonb),
  public.test_only_d2_idempotency_exists(uuid,text,uuid),public.test_only_d2_set_experience_source(uuid,uuid,text),
  public.test_only_d2_experience_source(uuid,uuid),public.test_only_d2_set_skills_source(uuid,uuid,text),public.test_only_d2_skills_source(uuid,uuid),
  public.test_only_d2_sign_context(uuid,text,uuid,uuid,text),public.test_only_d2_sign_context_variant(uuid,text,uuid,uuid,text,jsonb,text),
  public.test_only_d2_content_snapshot(uuid,text),public.test_only_d2_system_event_count(uuid),
  public.test_only_d2_rejects_invalid_context(uuid,text,text,uuid,uuid,jsonb,text,boolean,boolean),
  public.test_only_d2_skills_rejects_wrong_target(uuid,uuid,uuid,uuid) TO authenticated;
SELECT extensions.plan(22);

SELECT extensions.ok(to_regprocedure('public.load_admin_experience_write_state(uuid)') IS NOT NULL
  AND to_regprocedure('public.save_resume_experience_v1(uuid,text,text,text)') IS NOT NULL
  AND to_regprocedure('public.load_admin_skills_write_state(uuid)') IS NOT NULL
  AND to_regprocedure('public.save_resume_skills_v1(uuid,text,text,text)') IS NOT NULL,
  'both domain-specific write-state readers and writers are installed');
SELECT extensions.ok(has_function_privilege('authenticated','public.save_resume_experience_v1(uuid,text,text,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.save_resume_skills_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_experience_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_skills_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_experience_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_skills_v1(uuid,text,text,text)','EXECUTE'),
  'typed writer execution remains authenticated-only');
SELECT extensions.ok((SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc WHERE oid='public.save_resume_experience_v1(uuid,text,text,text)'::regprocedure)
  AND (SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc WHERE oid='public.save_resume_skills_v1(uuid,text,text,text)'::regprocedure)
  AND (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc WHERE oid='public.load_admin_experience_write_state(uuid)'::regprocedure)
  AND (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""']
    FROM pg_catalog.pg_proc WHERE oid='public.load_admin_skills_write_state(uuid)'::regprocedure),
  'writers and state readers retain the SECURITY DEFINER empty-search-path boundary');
SELECT extensions.ok(NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_idempotency','INSERT'),
  'event/idempotency writes remain behind the typed RPC');
SELECT extensions.ok((SELECT array_agg(a.attname ORDER BY a.attname)=ARRAY['experience_entry_id','locale']::name[]
    FROM pg_catalog.pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) k(attnum)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.conrelid='public.resume_experience_translations'::regclass AND c.contype='p')
  AND (SELECT array_agg(a.attname ORDER BY a.attname)=ARRAY['locale','skill_group_id']::name[]
    FROM pg_catalog.pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) k(attnum)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.conrelid='public.resume_skill_group_translations'::regclass AND c.contype='p'),
  'runtime fixture translation primary keys match the production conflict targets');
SELECT extensions.ok((SELECT write_mode='direct' FROM cms_private.resume_write_modes
    WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='experience')
  AND (SELECT write_mode='direct' FROM cms_private.resume_write_modes
    WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='skills')
  AND NOT EXISTS(SELECT 1 FROM cms_private.resume_domain_requirements WHERE resume_id='ea111111-1111-4111-8111-111111111111'
    AND domain_key IN ('experience','skills') AND requirement_key='trusted_network_context_v11'),
  'writer installation leaves both QA domains in direct mode without trusted-context activation');

SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    '{"awards":[]}'::jsonb,'{"awards":{"before":[],"after":[]}}'::jsonb),
  'existing Awards V2 aggregate validation remains supported');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('experience','experience_list',NULL,'update',
    '{"experience":[]}'::jsonb,'{"experience":{"before":[],"after":[]}}'::jsonb),
  'empty Experience aggregate has the exact V2 contract');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('experience','experience_list',NULL,'update',
    '{"experience":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"organization":"机构","title":"职位","period":"2025","description":"描述","location":null},"en":{"organization":"Org","title":"Role","period":"2025","description":"Work","location":""}}]}'::jsonb,
    '{"experience":{"before":[],"after":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"organization":"机构","title":"职位","period":"2025","description":"描述","location":null},"en":{"organization":"Org","title":"Role","period":"2025","description":"Work","location":""}}]}}'::jsonb)
  AND NOT cms_private.activity_event_payload_v2_is_allowed('experience','experience_list',NULL,'update',
    '{"experience":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"organization":"机构","title":"职位","period":"2025","description":"描述","location":null,"extra":1},"en":{"organization":"Org","title":"Role","period":"2025","description":"Work","location":""}}]}'::jsonb,
    '{"experience":{"before":[],"after":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"organization":"机构","title":"职位","period":"2025","description":"描述","location":null,"extra":1},"en":{"organization":"Org","title":"Role","period":"2025","description":"Work","location":""}}]}}'::jsonb),
  'Experience V2 exact locale keys, null location, and malformed rejection are enforced');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('skills','skill_group_list',NULL,'update',
    '{"skills":[]}'::jsonb,'{"skills":{"before":[],"after":[]}}'::jsonb),
  'empty Skills aggregate has the exact V2 contract');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('skills','skill_group_list',NULL,'update',
    '{"skills":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":0,"zh":{"title":"技术","items":"技能"},"en":{"title":"Skills","items":"Work"}}]}'::jsonb,
    '{"skills":{"before":[],"after":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":0,"zh":{"title":"技术","items":"技能"},"en":{"title":"Skills","items":"Work"}}]}}'::jsonb)
  AND NOT cms_private.activity_event_payload_v2_is_allowed('skills','skill_group_list',NULL,'update',
    '{"skills":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":0,"zh":{"title":"技术","items":"技能","extra":1},"en":{"title":"Skills","items":"Work"}}]}'::jsonb,
    '{"skills":{"before":[],"after":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":0,"zh":{"title":"技术","items":"技能","extra":1},"en":{"title":"Skills","items":"Work"}}]}}'::jsonb),
  'Skills V2 exact locale keys and malformed rejection are enforced');
SELECT extensions.ok(NOT cms_private.activity_event_payload_v2_is_allowed('experience','skill_group_list',NULL,'update',
    '{"skills":[]}'::jsonb,'{"skills":{"before":[],"after":[]}}'::jsonb)
  AND NOT cms_private.activity_event_payload_v2_is_allowed('skills','experience_list',NULL,'update',
    '{"experience":[]}'::jsonb,'{"experience":{"before":[],"after":[]}}'::jsonb),
  'cross-domain V2 entity/section combinations fail closed');

-- Direct-mode compatibility: authenticated QA can still create, update, and delete
-- rows through the legacy collection tables before either domain is activated.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok((SELECT experience_write_mode='direct' FROM public.load_admin_experience_write_state('ea111111-1111-4111-8111-111111111111'))
  AND (SELECT skills_write_mode='direct' FROM public.load_admin_skills_write_state('ea111111-1111-4111-8111-111111111111')),
  'QA scoped state readers report direct mode before activation');
INSERT INTO public.resume_experience_entries(id,resume_id,source_key,position)
VALUES('ea000000-0000-4000-8000-000000000101','ea111111-1111-4111-8111-111111111111','d2-direct-experience',1000);
INSERT INTO public.resume_experience_translations(experience_entry_id,resume_id,locale,organization,title,period,description,location)
VALUES('ea000000-0000-4000-8000-000000000101','ea111111-1111-4111-8111-111111111111','zh','组织','职位','2025','说明',NULL),
 ('ea000000-0000-4000-8000-000000000101','ea111111-1111-4111-8111-111111111111','en','Org','Role','2025','Description','');
UPDATE public.resume_experience_entries SET position=1001 WHERE id='ea000000-0000-4000-8000-000000000101';
UPDATE public.resume_experience_translations SET title='职位更新' WHERE experience_entry_id='ea000000-0000-4000-8000-000000000101' AND locale='zh';
DELETE FROM public.resume_experience_entries WHERE id='ea000000-0000-4000-8000-000000000101';
INSERT INTO public.resume_skill_groups(id,resume_id,source_key,position)
VALUES('ea000000-0000-4000-8000-000000000102','ea111111-1111-4111-8111-111111111111','d2-direct-skills',1000);
INSERT INTO public.resume_skill_group_translations(skill_group_id,resume_id,locale,title,items)
VALUES('ea000000-0000-4000-8000-000000000102','ea111111-1111-4111-8111-111111111111','zh','语言','中文'),
 ('ea000000-0000-4000-8000-000000000102','ea111111-1111-4111-8111-111111111111','en','Languages','English');
UPDATE public.resume_skill_groups SET position=1001 WHERE id='ea000000-0000-4000-8000-000000000102';
UPDATE public.resume_skill_group_translations SET title='语言能力' WHERE skill_group_id='ea000000-0000-4000-8000-000000000102' AND locale='zh';
DELETE FROM public.resume_skill_groups WHERE id='ea000000-0000-4000-8000-000000000102';
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.resume_experience_entries WHERE id='ea000000-0000-4000-8000-000000000101')
  AND NOT EXISTS(SELECT 1 FROM public.resume_skill_groups WHERE id='ea000000-0000-4000-8000-000000000102'),
  'legacy direct-mode create/update/delete remains authorized for both collections');

RESET ROLE;
UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key IN ('experience','skills');
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','experience','trusted_network_context_v11',true),
 ('ea111111-1111-4111-8111-111111111111','skills','trusted_network_context_v11',true);
SET LOCAL ROLE authenticated;
SELECT extensions.ok((SELECT experience_write_mode='rpc' AND experience_trusted_context_required
    FROM public.load_admin_experience_write_state('ea111111-1111-4111-8111-111111111111'))
  AND (SELECT skills_write_mode='rpc' AND skills_trusted_context_required
    FROM public.load_admin_skills_write_state('ea111111-1111-4111-8111-111111111111')),
  'each typed state reader reports only its own RPC/trusted-context state');

DO $experience_writer$
DECLARE target_id constant uuid := 'ea111111-1111-4111-8111-111111111111'; actor_id constant uuid := '10000000-0000-4000-8000-000000000002';
  canonical text; context_value text; signature_value text; first_result jsonb; replay_result jsonb; changed_result jsonb; denied boolean;
  event_start bigint; request_create constant uuid := 'd2222222-2222-4222-8222-222222222221';
  request_update constant uuid := 'd2222222-2222-4222-8222-222222222222'; request_noop constant uuid := 'd2222222-2222-4222-8222-222222222223';
  request_delete constant uuid := 'd2222222-2222-4222-8222-222222222224'; request_failure constant uuid := 'd2222222-2222-4222-8222-222222222225';
  request_translation constant uuid := 'd2222222-2222-4222-8222-222222222226'; translation_result jsonb;
BEGIN
  event_start:=public.test_only_d2_event_count(target_id);
  canonical:='[{"id":null,"position":0,"zh":{"organization":"组织","title":"职位","period":"2025","description":"说明","location":null},"en":{"organization":"Org","title":"Role","period":"2025","description":"Work","location":""}},'
    ||'{"id":null,"position":1,"zh":{"organization":"组织二","title":"职位二","period":"2024","description":"旧说明","location":"上海"},"en":{"organization":"Org Two","title":"Role Two","period":"2024","description":"Old work","location":null}}]';
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_create,'experience');
  first_result:=public.save_resume_experience_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(jsonb_array_length(first_result)=2 AND (first_result->0->>'id') ~ '^[0-9a-f-]{36}$'
    AND (first_result->1->>'id') ~ '^[0-9a-f-]{36}$' AND (first_result->0->>'id')<>(first_result->1->>'id'),
    'Experience create generates distinct server UUIDs');
  PERFORM public.rls_test_assert(first_result->0->>'position'='0' AND first_result->1->>'position'='1',
    'Experience result positions are dense and ordered');
  PERFORM public.rls_test_assert(first_result->0->'zh'->'location'='null'::jsonb
    AND first_result->0->'en'->'location'='""'::jsonb AND first_result->1->'en'->'location'='null'::jsonb,
    'Experience preserves NULL location separately from empty text');
  PERFORM public.rls_test_assert(public.test_only_d2_event_count(target_id)=event_start+1
    AND public.test_only_d2_event_shape(target_id,'experience','experience_list',first_result),
    'Experience changed save creates one correctly shaped aggregate V2 event');
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_create,'experience');
  replay_result:=public.save_resume_experience_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(replay_result=first_result AND public.test_only_d2_event_count(target_id)=event_start+1,
    'Experience exact replay returns its authoritative IDs without a duplicate event');
  PERFORM public.test_only_d2_set_experience_source(target_id,(first_result->0->>'id')::uuid,'keep-source-experience');
  denied:=false;
  BEGIN
    SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(
      target_id,canonical || ' ',actor_id,request_create,'experience');
    PERFORM public.save_resume_experience_v1(target_id,canonical || ' ',context_value,signature_value);
  EXCEPTION WHEN SQLSTATE 'P13B1' THEN denied:=true; END;
  PERFORM public.rls_test_assert(denied AND public.test_only_d2_event_count(target_id)=event_start+1,
    'Experience changed payload with a reused request ID conflicts before a second event');

  -- Update one locale field and reorder both existing UUIDs in the same aggregate request.
  canonical:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('id',first_result->1->>'id','position',0,'zh',first_result->1->'zh','en',first_result->1->'en'),
    pg_catalog.jsonb_build_object('id',first_result->0->>'id','position',1,
      'zh',pg_catalog.jsonb_set(first_result->0->'zh','{description}','"说明更新"'::jsonb), 'en',first_result->0->'en'))::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_update,'experience');
  changed_result:=public.save_resume_experience_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(changed_result->0->>'id'=first_result->1->>'id' AND changed_result->1->>'id'=first_result->0->>'id'
    AND changed_result->1->'zh'->>'description'='说明更新'
    AND public.test_only_d2_experience_source(target_id,(first_result->0->>'id')::uuid)='keep-source-experience'
    AND public.test_only_d2_event_count(target_id)=event_start+2,
    'Experience reorder plus translation update preserves source_key and persists as one aggregate event');

  canonical:=pg_catalog.jsonb_set(changed_result,'{0,en,title}',pg_catalog.to_jsonb((changed_result->0->'en'->>'title')||' updated'))::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_translation,'experience');
  translation_result:=public.save_resume_experience_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(translation_result->0->>'id'=changed_result->0->>'id'
    AND translation_result->0->>'position'=changed_result->0->>'position'
    AND translation_result->0->'en'->>'title'='Role Two updated'
    AND public.test_only_d2_event_count(target_id)=event_start+3,
    'Experience translation-only edit records one aggregate event without reordering');

  -- A semantic no-op under a fresh request stores an idempotent result but emits no event.
  canonical:=translation_result::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_noop,'experience');
  first_result:=public.save_resume_experience_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(first_result=translation_result AND public.test_only_d2_event_count(target_id)=event_start+3,
    'Experience semantic no-op produces no success event');
  canonical:=pg_catalog.jsonb_set(changed_result,'{1,zh,description}',pg_catalog.to_jsonb((changed_result->1->'zh'->>'description')||'!'))::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_failure,'experience');
  PERFORM pg_catalog.set_config('d2.fail_activity_insert','true',true); denied:=false;
  BEGIN PERFORM public.save_resume_experience_v1(target_id,canonical,context_value,signature_value);
  EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='TEST ONLY forced aggregate event failure'; END;
  PERFORM pg_catalog.set_config('d2.fail_activity_insert','false',true);
  PERFORM public.rls_test_assert(denied AND public.test_only_d2_event_count(target_id)=event_start+3
    AND NOT public.test_only_d2_idempotency_exists(target_id,'experience',request_failure)
    AND (SELECT count(*)=2 FROM public.resume_experience_entries WHERE resume_id=target_id),
    'Experience audit failure rolls back content and idempotency reservation');
  canonical:='[]';
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_delete,'experience');
  PERFORM public.save_resume_experience_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(NOT EXISTS(SELECT 1 FROM public.resume_experience_entries WHERE resume_id=target_id)
    AND public.test_only_d2_event_count(target_id)=event_start+4,
    'Experience delete removes the target collection and records exactly one aggregate event');
  denied:=false;
  BEGIN
    PERFORM public.save_resume_experience_v1('20000000-0000-4000-8000-000000000001',canonical,context_value,signature_value);
  EXCEPTION WHEN OTHERS THEN denied:=SQLSTATE='42501'; END;
  PERFORM public.rls_test_assert(denied,'Experience typed writer rejects a different target before mutation');
END
$experience_writer$;

DO $skills_writer$
DECLARE target_id constant uuid := 'ea111111-1111-4111-8111-111111111111'; actor_id constant uuid := '10000000-0000-4000-8000-000000000002';
  canonical text; context_value text; signature_value text; first_result jsonb; replay_result jsonb; changed_result jsonb;
  event_start bigint; request_create constant uuid := 'd3333333-3333-4333-8333-333333333331';
  request_update constant uuid := 'd3333333-3333-4333-8333-333333333332'; request_noop constant uuid := 'd3333333-3333-4333-8333-333333333333';
  request_delete constant uuid := 'd3333333-3333-4333-8333-333333333334'; request_failure constant uuid := 'd3333333-3333-4333-8333-333333333335';
  request_translation constant uuid := 'd3333333-3333-4333-8333-333333333336'; denied boolean; translation_result jsonb;
BEGIN
  event_start:=public.test_only_d2_event_count(target_id);
  canonical:='[{"id":null,"position":0,"zh":{"title":"语言","items":"中文"},"en":{"title":"Languages","items":"English"}},'
    ||'{"id":null,"position":1,"zh":{"title":"工具","items":"工具甲"},"en":{"title":"Tools","items":"Tool A"}}]';
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_create,'skills');
  first_result:=public.save_resume_skills_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(jsonb_array_length(first_result)=2 AND (first_result->0->>'id') ~ '^[0-9a-f-]{36}$'
    AND first_result->0->>'position'='0','Skills create generates server IDs and dense positions');
  PERFORM public.rls_test_assert(public.test_only_d2_event_count(target_id)=event_start+1
    AND public.test_only_d2_event_shape(target_id,'skills','skill_group_list',first_result),
    'Skills changed save creates one correctly shaped aggregate V2 event');
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_create,'skills');
  replay_result:=public.save_resume_skills_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(replay_result=first_result AND public.test_only_d2_event_count(target_id)=event_start+1,
    'Skills exact replay returns authoritative IDs without a duplicate event');
  PERFORM public.test_only_d2_set_skills_source(target_id,(first_result->0->>'id')::uuid,'keep-source-skills');
  denied:=false;
  BEGIN
    SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(
      target_id,canonical || ' ',actor_id,request_create,'skills');
    PERFORM public.save_resume_skills_v1(target_id,canonical || ' ',context_value,signature_value);
  EXCEPTION WHEN SQLSTATE 'P13B1' THEN denied:=true; END;
  PERFORM public.rls_test_assert(denied AND public.test_only_d2_event_count(target_id)=event_start+1,
    'Skills changed payload with a reused request ID conflicts before a second event');
  canonical:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('id',first_result->1->>'id','position',0,'zh',first_result->1->'zh','en',first_result->1->'en'),
    pg_catalog.jsonb_build_object('id',first_result->0->>'id','position',1,
      'zh',pg_catalog.jsonb_set(first_result->0->'zh','{items}','"中文、粤语"'::jsonb),'en',first_result->0->'en'))::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_update,'skills');
  changed_result:=public.save_resume_skills_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(changed_result->0->>'id'=first_result->1->>'id' AND changed_result->1->>'id'=first_result->0->>'id'
    AND changed_result->1->'zh'->>'items'='中文、粤语' AND public.test_only_d2_event_count(target_id)=event_start+2,
    'Skills reorder plus translation update persists atomically as one aggregate event');
  PERFORM public.rls_test_assert(public.test_only_d2_skills_source(target_id,(first_result->0->>'id')::uuid)='keep-source-skills',
    'Skills update preserves the existing source_key');
  canonical:=pg_catalog.jsonb_set(changed_result,'{0,zh,items}','""'::jsonb)::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_translation,'skills');
  translation_result:=public.save_resume_skills_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(translation_result->0->>'id'=changed_result->0->>'id'
    AND translation_result->0->>'position'=changed_result->0->>'position'
    AND translation_result->0->'zh'->>'items'=''
    AND public.test_only_d2_event_count(target_id)=event_start+3,
    'Skills translation-only edit records one aggregate event without reordering');
  canonical:=translation_result::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_noop,'skills');
  first_result:=public.save_resume_skills_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(first_result=translation_result AND public.test_only_d2_event_count(target_id)=event_start+3,
    'Skills semantic no-op produces no success event');
  canonical:=pg_catalog.jsonb_set(changed_result,'{1,zh,items}',pg_catalog.to_jsonb((changed_result->1->'zh'->>'items')||'!'))::text;
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_failure,'skills');
  PERFORM pg_catalog.set_config('d2.fail_activity_insert','true',true); denied:=false;
  BEGIN PERFORM public.save_resume_skills_v1(target_id,canonical,context_value,signature_value);
  EXCEPTION WHEN raise_exception THEN denied:=SQLERRM='TEST ONLY forced aggregate event failure'; END;
  PERFORM pg_catalog.set_config('d2.fail_activity_insert','false',true);
  PERFORM public.rls_test_assert(denied AND public.test_only_d2_event_count(target_id)=event_start+3
    AND NOT public.test_only_d2_idempotency_exists(target_id,'skills',request_failure)
    AND (SELECT count(*)=2 FROM public.resume_skill_groups WHERE resume_id=target_id),
    'Skills audit failure rolls back content and idempotency reservation');
  canonical:='[]';
  SELECT signed_context,signature_hex INTO context_value,signature_value FROM public.test_only_d2_sign_context(target_id,canonical,actor_id,request_delete,'skills');
  PERFORM public.save_resume_skills_v1(target_id,canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(NOT EXISTS(SELECT 1 FROM public.resume_skill_groups WHERE resume_id=target_id)
    AND public.test_only_d2_event_count(target_id)=event_start+4,
    'Skills delete removes the target collection and records exactly one aggregate event');
END
$skills_writer$;

-- Each changed claim is freshly HMAC-signed so the typed verifier must reject
-- the claim itself, rather than merely detecting a stale signature. Separate
-- cases also prove raw signature integrity and canonical-payload digest binding.
SELECT extensions.ok((
  SELECT pg_catalog.bool_and(public.test_only_d2_rejects_invalid_context(
    'ea111111-1111-4111-8111-111111111111','experience',
    '[{"id":null,"position":0,"zh":{"organization":"机构","title":"职位","period":"2025","description":"说明","location":null},"en":{"organization":"Org","title":"Role","period":"2025","description":"Work","location":""}}]',
    '10000000-0000-4000-8000-000000000002',pg_catalog.gen_random_uuid(),patch,remove_key,tamper_signature))
  FROM (VALUES
    ('actor',pg_catalog.jsonb_build_object('actor_user_id','10000000-0000-4000-8000-000000000099'),NULL::text,false),
    ('target',pg_catalog.jsonb_build_object('resume_id','20000000-0000-4000-8000-000000000001'),NULL::text,false),
    ('wrong_domain',pg_catalog.jsonb_build_object('domain','skills'),NULL::text,false),
    ('operation',pg_catalog.jsonb_build_object('operation','create'),NULL::text,false),
    ('request_id',pg_catalog.jsonb_build_object('request_id','not-a-uuid'),NULL::text,false),
    ('digest',pg_catalog.jsonb_build_object('mutation_digest',pg_catalog.repeat('f',64)),NULL::text,false),
    ('future_issued',pg_catalog.jsonb_build_object('issued_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint+120),NULL::text,false),
    ('expired',pg_catalog.jsonb_build_object('expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint-1),NULL::text,false),
    ('excessive_lifetime',pg_catalog.jsonb_build_object('expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint+301),NULL::text,false),
    ('signature','{}'::jsonb,NULL::text,true),
    ('key_id',pg_catalog.jsonb_build_object('key_id','unknown-test-key'),NULL::text,false),
    ('missing_network_context_field','{}'::jsonb,'city'::text,false),
    ('malformed_network_context',pg_catalog.jsonb_build_object('ip_network','not-a-cidr'),NULL::text,false)
  ) AS cases(case_name,patch,remove_key,tamper_signature)
), 'Experience writer rejects all independently signed invalid bindings/context and leaves content, success events, idempotency, and system events unchanged');
SELECT extensions.ok(public.test_only_d2_rejects_invalid_context(
  'ea111111-1111-4111-8111-111111111111','experience',
  '[{"id":null,"position":0,"zh":{"organization":"机构","title":"职位","period":"2025","description":"说明","location":null},"en":{"organization":"Org","title":"Role","period":"2025","description":"Work","location":""}}]',
  '10000000-0000-4000-8000-000000000002',pg_catalog.gen_random_uuid(),'{}'::jsonb,NULL,false,true),
  'Experience verifier rejects a valid-format request ID changed after signing and leaves no state side effect');

SELECT extensions.ok((
  SELECT pg_catalog.bool_and(public.test_only_d2_rejects_invalid_context(
    'ea111111-1111-4111-8111-111111111111','skills',
    '[{"id":null,"position":0,"zh":{"title":"测试","items":"技能"},"en":{"title":"Test","items":"Skills"}}]',
    '10000000-0000-4000-8000-000000000002',pg_catalog.gen_random_uuid(),patch,remove_key,tamper_signature))
  FROM (VALUES
    ('actor',pg_catalog.jsonb_build_object('actor_user_id','10000000-0000-4000-8000-000000000099'),NULL::text,false),
    ('target',pg_catalog.jsonb_build_object('resume_id','20000000-0000-4000-8000-000000000001'),NULL::text,false),
    ('wrong_domain',pg_catalog.jsonb_build_object('domain','experience'),NULL::text,false),
    ('operation',pg_catalog.jsonb_build_object('operation','create'),NULL::text,false),
    ('request_id',pg_catalog.jsonb_build_object('request_id','not-a-uuid'),NULL::text,false),
    ('digest',pg_catalog.jsonb_build_object('mutation_digest',pg_catalog.repeat('f',64)),NULL::text,false),
    ('future_issued',pg_catalog.jsonb_build_object('issued_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint+120),NULL::text,false),
    ('expired',pg_catalog.jsonb_build_object('expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint-1),NULL::text,false),
    ('excessive_lifetime',pg_catalog.jsonb_build_object('expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint+301),NULL::text,false),
    ('signature','{}'::jsonb,NULL::text,true),
    ('key_id',pg_catalog.jsonb_build_object('key_id','unknown-test-key'),NULL::text,false),
    ('missing_network_context_field','{}'::jsonb,'city'::text,false),
    ('malformed_network_context',pg_catalog.jsonb_build_object('ip_network','not-a-cidr'),NULL::text,false)
  ) AS cases(case_name,patch,remove_key,tamper_signature)
), 'Skills writer independently rejects all invalid bindings/context and leaves content, success events, idempotency, and system events unchanged');
SELECT extensions.ok(public.test_only_d2_rejects_invalid_context(
  'ea111111-1111-4111-8111-111111111111','skills',
  '[{"id":null,"position":0,"zh":{"title":"测试","items":"技能"},"en":{"title":"Test","items":"Skills"}}]',
  '10000000-0000-4000-8000-000000000002',pg_catalog.gen_random_uuid(),'{}'::jsonb,NULL,false,true),
  'Skills verifier rejects a valid-format request ID changed after signing and leaves no state side effect');

SELECT extensions.ok(public.test_only_d2_skills_rejects_wrong_target(
  'ea111111-1111-4111-8111-111111111111','20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','d4444444-4444-4444-8444-444444444441'),
  'Skills typed writer rejects an alternate target without changing either collection or creating event/idempotency state');

DO $rpc_mode_direct_denial$
DECLARE denied boolean; affected bigint;
BEGIN
  denied:=false;
  BEGIN INSERT INTO public.resume_experience_entries(resume_id,position)
    VALUES('ea111111-1111-4111-8111-111111111111',1000);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  PERFORM public.rls_test_assert(denied,'authenticated direct Experience INSERT is denied in rpc mode');
  denied:=false;
  UPDATE public.resume_experience_entries SET position=position+1000 WHERE resume_id='ea111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected=ROW_COUNT; denied:=affected=0;
  PERFORM public.rls_test_assert(denied,'authenticated direct Experience UPDATE is denied in rpc mode');
  denied:=false;
  DELETE FROM public.resume_experience_entries WHERE resume_id='ea111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected=ROW_COUNT; denied:=affected=0;
  PERFORM public.rls_test_assert(denied,'authenticated direct Experience DELETE is denied in rpc mode');
  denied:=false;
  BEGIN INSERT INTO public.resume_skill_groups(resume_id,position)
    VALUES('ea111111-1111-4111-8111-111111111111',1000);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  PERFORM public.rls_test_assert(denied,'authenticated direct Skills INSERT is denied in rpc mode');
  denied:=false;
  UPDATE public.resume_skill_groups SET position=position+1000 WHERE resume_id='ea111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected=ROW_COUNT; denied:=affected=0;
  PERFORM public.rls_test_assert(denied,'authenticated direct Skills UPDATE is denied in rpc mode');
  denied:=false;
  DELETE FROM public.resume_skill_groups WHERE resume_id='ea111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS affected=ROW_COUNT; denied:=affected=0;
  PERFORM public.rls_test_assert(denied,'authenticated direct Skills DELETE is denied in rpc mode');
END
$rpc_mode_direct_denial$;

SELECT extensions.ok(NOT public.can_direct_write_experience('ea111111-1111-4111-8111-111111111111')
  AND NOT public.can_direct_write_skills('ea111111-1111-4111-8111-111111111111')
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='resume_experience_entries' AND policyname='cms_admin_scoped_select')
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='resume_skill_groups' AND policyname='cms_admin_scoped_select'),
  'RPC mode closes direct collection writes while preserving scoped reads');

RESET ROLE;
DO $serialized_bounds$
DECLARE experience_value jsonb; skills_value jsonb; experience_payload jsonb; skills_payload jsonb;
  experience_canonical text; skills_canonical text;
BEGIN
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid()::text,'position',n,
    'zh',pg_catalog.jsonb_build_object('organization',pg_catalog.repeat('组',21),'title',pg_catalog.repeat('职',21),
      'period',pg_catalog.repeat('期',10),'description',pg_catalog.repeat('描',256),'location',pg_catalog.repeat('地',21)),
    'en',pg_catalog.jsonb_build_object('organization',pg_catalog.repeat('O',64),'title',pg_catalog.repeat('T',64),
      'period',pg_catalog.repeat('P',32),'description',pg_catalog.repeat('D',768),'location',pg_catalog.repeat('L',64))) ORDER BY n)
    INTO experience_value FROM pg_catalog.generate_series(0,15) n;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid()::text,'position',n,
    'zh',pg_catalog.jsonb_build_object('title',pg_catalog.repeat('技',21),'items',pg_catalog.repeat('项',298)),
    'en',pg_catalog.jsonb_build_object('title',pg_catalog.repeat('T',64),'items',pg_catalog.repeat('I',896))) ORDER BY n)
    INTO skills_value FROM pg_catalog.generate_series(0,15) n;
  experience_canonical:=experience_value::text; skills_canonical:=skills_value::text;
  experience_payload:=pg_catalog.jsonb_build_object('experience',pg_catalog.jsonb_build_object('before',experience_value,'after',experience_value));
  skills_payload:=pg_catalog.jsonb_build_object('skills',pg_catalog.jsonb_build_object('before',skills_value,'after',skills_value));
  PERFORM public.rls_test_assert(pg_catalog.octet_length(pg_catalog.convert_to(experience_canonical,'UTF8'))<=196608
    AND pg_catalog.octet_length(pg_catalog.convert_to(experience_value::text,'UTF8'))<=212992
    AND pg_catalog.octet_length(pg_catalog.convert_to(experience_payload::text,'UTF8'))<=655360
    AND cms_private.activity_event_payload_v2_experience_is_allowed('experience','experience_list',NULL,'update',
      pg_catalog.jsonb_build_object('experience',experience_value),experience_payload),
    'actual PostgreSQL JSONB serialization of max-field 16-entry Experience meets frozen request and event bounds');
  PERFORM public.rls_test_assert(pg_catalog.octet_length(pg_catalog.convert_to(skills_canonical,'UTF8'))<=196608
    AND pg_catalog.octet_length(pg_catalog.convert_to(skills_value::text,'UTF8'))<=212992
    AND pg_catalog.octet_length(pg_catalog.convert_to(skills_payload::text,'UTF8'))<=655360
    AND cms_private.activity_event_payload_v2_skills_is_allowed('skills','skill_group_list',NULL,'update',
      pg_catalog.jsonb_build_object('skills',skills_value),skills_payload),
    'actual PostgreSQL JSONB serialization of max-field 16-group Skills meets frozen request and event bounds');
END
$serialized_bounds$;

SELECT extensions.pass('Experience and Skills writers satisfy their independent transaction, policy, and payload contracts');
SELECT * FROM extensions.finish();
RESET ROLE;
ROLLBACK;
