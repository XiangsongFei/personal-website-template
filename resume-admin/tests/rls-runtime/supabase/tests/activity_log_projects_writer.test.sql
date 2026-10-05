-- TEST ONLY: Projects aggregate V2 contract, signed writer, idempotency and RLS.
BEGIN;
CREATE FUNCTION public.test_only_projects_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='projects' AND entity_type='project_list' AND payload_version=2 $function$;
CREATE FUNCTION public.test_only_projects_sign(target_resume uuid,target_items text,target_request uuid)
RETURNS TABLE(signed_context text,signature_hex text) LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  WITH stamp AS (SELECT pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint AS issued), context AS (
    SELECT pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
      'actor_user_id','10000000-0000-4000-8000-000000000002','resume_id',target_resume::text,'domain','projects','operation','update',
      'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_items,'UTF8'),'sha256'),'hex'),
      'issued_at',stamp.issued,'expires_at',stamp.issued+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text AS value FROM stamp
  ) SELECT context.value,pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(context.value,'UTF8'),
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex') FROM context
$function$;
CREATE FUNCTION public.test_only_projects_save(target_resume uuid,target_items text,target_request uuid)
RETURNS jsonb LANGUAGE sql SET search_path=''
AS $function$ SELECT public.save_resume_projects_v1(target_resume,target_items,s.signed_context,s.signature_hex)
  FROM public.test_only_projects_sign(target_resume,target_items,target_request) s $function$;
CREATE FUNCTION public.test_only_projects_replay(target_resume uuid,target_items text,target_request uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE before_count bigint; first_result jsonb; replay_result jsonb;
BEGIN
  before_count:=public.test_only_projects_event_count(target_resume);
  first_result:=public.test_only_projects_save(target_resume,target_items,target_request);
  replay_result:=public.test_only_projects_save(target_resume,target_items,target_request);
  RETURN first_result=replay_result AND public.test_only_projects_event_count(target_resume)=before_count+1
    AND (first_result->1->>'id') ~ '^[0-9a-f-]{36}$'
    AND (first_result->1->'methods'->'zh'->0->>'id') ~ '^[0-9a-f-]{36}$';
END
$function$;
CREATE FUNCTION public.test_only_projects_conflict(target_resume uuid,target_items text,changed_items text,target_request uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE before_count bigint; first_result jsonb; state_value text;
BEGIN
  before_count:=public.test_only_projects_event_count(target_resume);
  first_result:=public.test_only_projects_save(target_resume,target_items,target_request);
  BEGIN PERFORM public.test_only_projects_save(target_resume,changed_items,target_request); state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value='P13B1' AND first_result IS NOT NULL AND public.test_only_projects_event_count(target_resume)=before_count;
END
$function$;
CREATE FUNCTION public.test_only_projects_bad_signature(target_resume uuid,target_items text,target_request uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE signed_value text; signature_value text; state_value text; before_count bigint;
BEGIN
  before_count:=public.test_only_projects_event_count(target_resume);
  SELECT signed_context,signature_hex INTO signed_value,signature_value FROM public.test_only_projects_sign(target_resume,target_items,target_request);
  signature_value:=(CASE WHEN pg_catalog.left(signature_value,1)='0' THEN '1' ELSE '0' END)||pg_catalog.substr(signature_value,2);
  BEGIN PERFORM public.save_resume_projects_v1(target_resume,target_items,signed_value,signature_value); state_value:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  RETURN state_value='22023' AND public.test_only_projects_event_count(target_resume)=before_count;
END
$function$;
CREATE FUNCTION public.test_only_projects_multi_existing_save(target_resume uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE items_value jsonb; result_value jsonb; before_count bigint; event_snapshot jsonb; event_changes jsonb;
BEGIN
  UPDATE public.resume_project_methods SET position=10
  WHERE resume_id=target_resume AND project_entry_id='ea000000-0000-4000-8000-000000000201'
    AND locale='zh' AND id='ea000000-0000-4000-8000-000000000204';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.resume_project_entries SET position=4
  WHERE resume_id=target_resume AND source_key IS NULL AND position=1;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',e.id::text,'position',e.position,
    'zh',pg_catalog.jsonb_build_object('title',zh.title,'subtitle',zh.subtitle,'period',zh.period,'description',zh.description,'href',zh.href),
    'en',pg_catalog.jsonb_build_object('title',en.title,'subtitle',en.subtitle,'period',en.period,'description',en.description,'href',en.href),
    'methods',pg_catalog.jsonb_build_object(
      'zh',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id::text,'position',m.position,'value',m.value) ORDER BY m.position),'[]'::jsonb)
        FROM (SELECT id,value,(pg_catalog.row_number() OVER(ORDER BY position,id)-1)::integer AS position
          FROM public.resume_project_methods WHERE resume_id=target_resume AND project_entry_id=e.id AND locale='zh') m),
      'en',(SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id::text,'position',m.position,'value',m.value) ORDER BY m.position),'[]'::jsonb)
        FROM (SELECT id,value,(pg_catalog.row_number() OVER(ORDER BY position,id)-1)::integer AS position
          FROM public.resume_project_methods WHERE resume_id=target_resume AND project_entry_id=e.id AND locale='en') m)
    )) ORDER BY e.position,e.id),'[]'::jsonb)
  INTO items_value
  FROM (SELECT id,resume_id,(pg_catalog.row_number() OVER(ORDER BY position,id)-1)::integer AS position
    FROM public.resume_project_entries WHERE resume_id=target_resume) e
  JOIN public.resume_project_translations zh ON zh.project_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
  JOIN public.resume_project_translations en ON en.project_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en'
  WHERE e.resume_id=target_resume;
  IF pg_catalog.jsonb_array_length(items_value)<>2 OR items_value->1->>'position'<>'1'
    OR items_value->0->'methods'->'zh'->2->>'position'<>'2' THEN RETURN false; END IF;
  items_value:=pg_catalog.jsonb_set(items_value,'{0,zh,title}',pg_catalog.to_jsonb('Projects validator multi-existing regression'::text),false);
  before_count:=public.test_only_projects_event_count(target_resume);
  result_value:=public.test_only_projects_save(target_resume,items_value::text,'ea000000-0000-4000-8000-000000000214');
  IF result_value IS NULL THEN RETURN false; END IF;
  SELECT entity_snapshot,changes INTO event_snapshot,event_changes
  FROM cms_private.activity_log_events
  WHERE resume_id=target_resume AND section_key='projects' AND entity_type='project_list'
    AND operation='update' AND entity_id IS NULL AND payload_version=2
    AND entity_snapshot->'projects'->0->'zh'->>'title'='Projects validator multi-existing regression';
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN public.test_only_projects_event_count(target_resume)=before_count+1
    AND pg_catalog.jsonb_array_length(event_snapshot->'projects')=2
    AND event_snapshot->'projects'->0->>'position'='0'
    AND event_snapshot->'projects'->1->>'position'='1'
    AND event_changes->'projects'->'before'->1->>'position'='4'
    AND event_changes->'projects'->'before'->0->'methods'->'zh'->2->>'position'='10'
    AND event_changes->'projects'->'before'->0->'zh'->>'title'='项目甲已更新'
    AND event_changes->'projects'->'after'->0->'zh'->>'title'='Projects validator multi-existing regression'
    AND event_changes->'projects'->'after'=event_snapshot->'projects'
    AND result_value=event_snapshot->'projects'
    AND event_snapshot->'projects'->0->'methods'->'zh'->2->>'position'='2'
    AND cms_private.activity_event_payload_v2_projects_is_allowed('projects','project_list',NULL,'update',event_snapshot,event_changes);
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_projects_event_count(uuid),public.test_only_projects_sign(uuid,text,uuid),
  public.test_only_projects_save(uuid,text,uuid),public.test_only_projects_replay(uuid,text,uuid),
  public.test_only_projects_conflict(uuid,text,text,uuid),public.test_only_projects_bad_signature(uuid,text,uuid),
  public.test_only_projects_multi_existing_save(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_projects_event_count(uuid),public.test_only_projects_sign(uuid,text,uuid),
  public.test_only_projects_save(uuid,text,uuid),public.test_only_projects_replay(uuid,text,uuid),
  public.test_only_projects_conflict(uuid,text,text,uuid),public.test_only_projects_bad_signature(uuid,text,uuid) TO authenticated;

SELECT extensions.plan(24);
SELECT extensions.ok(to_regprocedure('public.load_admin_projects_write_state(uuid)') IS NOT NULL
  AND to_regprocedure('public.save_resume_projects_v1(uuid,text,text,text)') IS NOT NULL,
  'Projects state reader and typed writer are installed');
SELECT extensions.ok(has_function_privilege('authenticated','public.load_admin_projects_write_state(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.save_resume_projects_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.load_admin_projects_write_state(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_projects_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_projects_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('public','public.save_resume_projects_v1(uuid,text,text,text)','EXECUTE'),
  'typed entry points remain restricted to authenticated');
SELECT extensions.ok((SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=""']
  FROM pg_catalog.pg_proc WHERE oid='public.save_resume_projects_v1(uuid,text,text,text)'::regprocedure)
  AND (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""']
  FROM pg_catalog.pg_proc WHERE oid='public.load_admin_projects_write_state(uuid)'::regprocedure),
  'writer and state reader are SECURITY DEFINER with empty search_path');
SELECT extensions.ok(NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_idempotency','INSERT'),
  'authenticated cannot write event or idempotency rows directly');
SELECT extensions.ok((SELECT write_mode='direct' FROM cms_private.resume_write_modes WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='projects')
  AND NOT EXISTS(SELECT 1 FROM cms_private.resume_domain_requirements WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='projects' AND requirement_key='trusted_network_context_v11'),
  'installation preserves QA Projects direct mode and disabled trusted context');
SELECT extensions.ok((SELECT array_agg(a.attname ORDER BY a.attname)=ARRAY['locale','project_entry_id','resume_id']::name[]
  FROM pg_catalog.pg_constraint c CROSS JOIN LATERAL pg_catalog.unnest(c.conkey) k(attnum)
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
  WHERE c.conrelid='public.resume_project_translations'::regclass AND c.contype='p')
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.resume_project_translations'::regclass
    AND contype IN ('p','u') AND pg_catalog.pg_get_constraintdef(oid) LIKE '%project_entry_id, resume_id, locale%'),
  'runtime translation conflict target matches production composite uniqueness');
SELECT extensions.ok(EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.resume_project_entries'::regclass
  AND contype='u' AND pg_catalog.pg_get_constraintdef(oid) LIKE '%resume_id, source_key%')
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname='resume_project_source_key_unique'),
  'test fixture uses production nonpartial source_key uniqueness with multiple NULLs allowed');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('projects','project_list',NULL,'update',
  '{"projects":[]}'::jsonb,'{"projects":{"before":[],"after":[]}}'::jsonb),
  'Projects V2 empty aggregate is valid');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('projects','project_list',NULL,'update',
  '{"projects":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"title":"项目","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":0,"value":"甲"},{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","position":1,"value":"乙"},{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","position":2,"value":"丙"}],"en":[]}}]}'::jsonb,
  '{"projects":{"before":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"title":"项目","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":0,"value":"甲"},{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","position":1,"value":"乙"},{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","position":3,"value":"丙"}],"en":[]}}],"after":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"title":"项目","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","position":0,"value":"甲"},{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","position":1,"value":"乙"},{"id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","position":2,"value":"丙"}],"en":[]}}]}}'::jsonb),
  'Projects V2 accepts sparse before ordering and dense after ordering');
SELECT extensions.ok(NOT cms_private.activity_event_payload_v2_is_allowed('projects','project_list',NULL,'update',
  '{"projects":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"title":"项目","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[],"en":[]},"unknown":true} ]}'::jsonb,
  '{"projects":{"before":[],"after":[]}}'::jsonb)
  AND NOT cms_private.activity_event_payload_v2_is_allowed('projects','project_list',NULL,'update','{"projects":[]}'::jsonb,
    '{"projects":{"before":[],"after":[]},"extra":true}'::jsonb)
  AND NOT cms_private.activity_event_payload_v2_is_allowed('projects','experience_list',NULL,'update','{"projects":[]}'::jsonb,'{"projects":{"before":[],"after":[]}}'::jsonb),
  'malformed, unknown, and cross-domain Projects V2 shapes fail closed');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update','{"awards":[]}'::jsonb,'{"awards":{"before":[],"after":[]}}'::jsonb)
  AND cms_private.activity_event_payload_v2_is_allowed('experience','experience_list',NULL,'update','{"experience":[]}'::jsonb,'{"experience":{"before":[],"after":[]}}'::jsonb)
  AND cms_private.activity_event_payload_v2_is_allowed('skills','skill_group_list',NULL,'update','{"skills":[]}'::jsonb,'{"skills":{"before":[],"after":[]}}'::jsonb)
  AND cms_private.activity_event_payload_v2_is_allowed('education','education_list',NULL,'update','{"education":[]}'::jsonb,'{"education":{"before":[],"after":[]}}'::jsonb),
  'existing aggregate V2 domains remain accepted');

-- This isolated QA seed has a sample Projects row. Remove it only inside this
-- rolled-back test transaction so the sparse-order fixture is deterministic.
DELETE FROM public.resume_project_entries WHERE resume_id='ea111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok((SELECT projects_write_mode='direct' FROM public.load_admin_projects_write_state('ea111111-1111-4111-8111-111111111111')),
  'QA Projects remains direct after migration installation');
INSERT INTO public.resume_project_entries(id,resume_id,source_key,position)
VALUES('ea000000-0000-4000-8000-000000000301','ea111111-1111-4111-8111-111111111111','projects-direct-compatibility',0);
INSERT INTO public.resume_project_translations(project_entry_id,resume_id,locale,title,subtitle,period,description,href)
VALUES('ea000000-0000-4000-8000-000000000301','ea111111-1111-4111-8111-111111111111','zh','Direct mode','','2025','',''),
 ('ea000000-0000-4000-8000-000000000301','ea111111-1111-4111-8111-111111111111','en','Direct mode','','2025','','');
DELETE FROM public.resume_project_entries WHERE id='ea000000-0000-4000-8000-000000000301';
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM public.resume_project_entries WHERE id='ea000000-0000-4000-8000-000000000301'),
  'authorized legacy direct-mode Projects writes remain permitted');
RESET ROLE;

-- Add a local sparse baseline and enable the writer only within this rolled-back test transaction.
INSERT INTO public.resume_project_entries(id,resume_id,source_key,position)
VALUES('ea000000-0000-4000-8000-000000000201','ea111111-1111-4111-8111-111111111111','projects-sparse-baseline',0);
INSERT INTO public.resume_project_translations(project_entry_id,resume_id,locale,title,subtitle,period,description,href)
VALUES('ea000000-0000-4000-8000-000000000201','ea111111-1111-4111-8111-111111111111','zh','项目甲','','2025','',''),
 ('ea000000-0000-4000-8000-000000000201','ea111111-1111-4111-8111-111111111111','en','Project A','','2025','','https://example.test');
INSERT INTO public.resume_project_methods(id,resume_id,project_entry_id,locale,position,value)
VALUES('ea000000-0000-4000-8000-000000000202','ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000201','zh',0,'规划'),
 ('ea000000-0000-4000-8000-000000000203','ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000201','zh',1,'设计'),
 ('ea000000-0000-4000-8000-000000000204','ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000201','zh',3,'交付');
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
VALUES('ea111111-1111-4111-8111-111111111111','projects','rpc')
ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='rpc';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','projects','trusted_network_context_v11',true)
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.ok((SELECT projects_write_mode='rpc' AND projects_trusted_context_required
  FROM public.load_admin_projects_write_state('ea111111-1111-4111-8111-111111111111')),
  'authenticated QA state reader returns rpc with trusted context required');
SELECT extensions.throws_ok($$INSERT INTO public.resume_project_entries(resume_id,position) VALUES('ea111111-1111-4111-8111-111111111111',10)$$,
  '42501','new row violates row-level security policy for table "resume_project_entries"','rpc mode denies direct authenticated Projects DML');
SELECT extensions.ok(public.test_only_projects_bad_signature('ea111111-1111-4111-8111-111111111111',
  '[{"id":"ea000000-0000-4000-8000-000000000201","position":0,"zh":{"title":"项目甲","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project A","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"ea000000-0000-4000-8000-000000000202","position":0,"value":"规划"},{"id":"ea000000-0000-4000-8000-000000000203","position":1,"value":"设计"},{"id":"ea000000-0000-4000-8000-000000000204","position":2,"value":"交付"}],"en":[]}}]',
  'ea000000-0000-4000-8000-000000000211'), 'tampered signatures fail before content/event mutation');
SELECT extensions.ok(public.test_only_projects_save('ea111111-1111-4111-8111-111111111111',
  '[{"id":"ea000000-0000-4000-8000-000000000201","position":0,"zh":{"title":"项目甲","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project A","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"ea000000-0000-4000-8000-000000000202","position":0,"value":"规划"},{"id":"ea000000-0000-4000-8000-000000000203","position":1,"value":"设计"},{"id":"ea000000-0000-4000-8000-000000000204","position":2,"value":"交付"}],"en":[]}}]',
  'ea000000-0000-4000-8000-000000000212')->0->'methods'->'zh'->2->>'position'='3'
  AND public.test_only_projects_event_count('ea111111-1111-4111-8111-111111111111')=0,
  'semantic no-op preserves sparse stored positions and creates no success event');
SELECT extensions.ok(public.test_only_projects_replay('ea111111-1111-4111-8111-111111111111',
  '[{"id":"ea000000-0000-4000-8000-000000000201","position":0,"zh":{"title":"项目甲已更新","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project A","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"ea000000-0000-4000-8000-000000000202","position":0,"value":"规划"},{"id":"ea000000-0000-4000-8000-000000000203","position":1,"value":"设计"},{"id":"ea000000-0000-4000-8000-000000000204","position":2,"value":"交付"}],"en":[]}},{"id":null,"position":1,"zh":{"title":"新项目","subtitle":"","period":"2026","description":"","href":""},"en":{"title":"New project","subtitle":"","period":"2026","description":"","href":"https://new.example.test"},"methods":{"zh":[{"id":null,"position":0,"value":"新增方法"}],"en":[]}}]',
  'ea000000-0000-4000-8000-000000000213'), 'changed save generates server parent/method UUIDs and exact replay returns the same result without duplicate event');
SELECT extensions.ok(public.test_only_projects_conflict('ea111111-1111-4111-8111-111111111111',
  '[{"id":"ea000000-0000-4000-8000-000000000201","position":0,"zh":{"title":"项目甲已更新","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project A","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"ea000000-0000-4000-8000-000000000202","position":0,"value":"规划"},{"id":"ea000000-0000-4000-8000-000000000203","position":1,"value":"设计"},{"id":"ea000000-0000-4000-8000-000000000204","position":2,"value":"交付"}],"en":[]}},{"id":null,"position":1,"zh":{"title":"新项目","subtitle":"","period":"2026","description":"","href":""},"en":{"title":"New project","subtitle":"","period":"2026","description":"","href":"https://new.example.test"},"methods":{"zh":[{"id":null,"position":0,"value":"新增方法"}],"en":[]}}]',
  '[{"id":"ea000000-0000-4000-8000-000000000201","position":0,"zh":{"title":"冲突","subtitle":"","period":"2025","description":"","href":""},"en":{"title":"Project A","subtitle":"","period":"2025","description":"","href":"https://example.test"},"methods":{"zh":[{"id":"ea000000-0000-4000-8000-000000000202","position":0,"value":"规划"},{"id":"ea000000-0000-4000-8000-000000000203","position":1,"value":"设计"},{"id":"ea000000-0000-4000-8000-000000000204","position":2,"value":"交付"}],"en":[]}},{"id":null,"position":1,"zh":{"title":"新项目","subtitle":"","period":"2026","description":"","href":""},"en":{"title":"New project","subtitle":"","period":"2026","description":"","href":"https://new.example.test"},"methods":{"zh":[{"id":null,"position":0,"value":"新增方法"}],"en":[]}}]',
  'ea000000-0000-4000-8000-000000000213'), 'same request ID with changed canonical body fails before mutation or extra event');
RESET ROLE;
SELECT extensions.ok((SELECT source_key='projects-sparse-baseline' FROM public.resume_project_entries
  WHERE id='ea000000-0000-4000-8000-000000000201' AND resume_id='ea111111-1111-4111-8111-111111111111')
  AND (SELECT array_agg(position ORDER BY position)=ARRAY[0,1,2] FROM public.resume_project_methods WHERE project_entry_id='ea000000-0000-4000-8000-000000000201' AND locale='zh')
  AND (SELECT count(*)=1 FROM cms_private.activity_log_events WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND section_key='projects' AND entity_type='project_list' AND operation='update' AND entity_id IS NULL AND payload_version=2),
  'changed save preserves server-owned source_key, densifies positions, and appends one V2 event');
SELECT extensions.ok((SELECT count(*)=2 FROM public.resume_project_entries WHERE resume_id='ea111111-1111-4111-8111-111111111111')
  AND (SELECT count(*)=4 FROM public.resume_project_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111')
  AND (SELECT count(*)=1 FROM public.resume_project_methods WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh' AND value='新增方法')
  AND (SELECT count(*)=2 FROM public.resume_project_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh' AND href='')
  AND (SELECT count(*)=1 FROM public.resume_project_translations WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en' AND href='https://new.example.test'),
  'aggregate persists bilingual rows, nested create, empty href, and distinct locale href exactly');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('projects','project_list',NULL,'update',
  (SELECT entity_snapshot FROM cms_private.activity_log_events WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND section_key='projects'),
  (SELECT changes FROM cms_private.activity_log_events WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND section_key='projects')),
  'writer event stores the canonical after snapshot and valid exact before/after aggregate');
SELECT extensions.ok(public.test_only_projects_multi_existing_save('ea111111-1111-4111-8111-111111111111'),
  'valid changed save with two existing Projects accepts sparse nested before positions and appends one valid V2 event');
SELECT extensions.ok(NOT cms_private.activity_event_payload_v2_projects_is_allowed('projects','project_list',NULL,'update',
  event_value.entity_snapshot,pg_catalog.jsonb_set(event_value.changes,'{projects,before,1,position}','0'::jsonb,false))
  AND NOT cms_private.activity_event_payload_v2_projects_is_allowed('projects','project_list',NULL,'update',
    event_value.entity_snapshot,pg_catalog.jsonb_set(event_value.changes,'{projects,before,0,methods,zh,2,position}','1'::jsonb,false)),
  'malformed Project and nested method before-ordering remain rejected')
FROM (SELECT entity_snapshot,changes FROM cms_private.activity_log_events
  WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND section_key='projects' AND entity_type='project_list'
    AND operation='update' AND entity_id IS NULL AND payload_version=2
    AND entity_snapshot->'projects'->0->'zh'->>'title'='Projects validator multi-existing regression') event_value;

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
