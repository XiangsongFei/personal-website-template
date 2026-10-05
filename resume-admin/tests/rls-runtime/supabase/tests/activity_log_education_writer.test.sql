-- TEST ONLY: Education V2 transaction, legacy NULL preservation, and mode-aware RLS.
BEGIN;
CREATE FUNCTION public.test_only_d3_education_snapshot(target_resume uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,'entry_type',e.entry_type,'education_category',e.education_category,
    'zh',pg_catalog.jsonb_build_object('title',zh.title,'program',zh.program,'period',zh.period,'grade',zh.grade,'course_title',zh.course_title,'course_description',zh.course_description,'custom_category_label',zh.custom_category_label),
    'en',pg_catalog.jsonb_build_object('title',en.title,'program',en.program,'period',en.period,'grade',en.grade,'course_title',en.course_title,'course_description',en.course_description,'custom_category_label',en.custom_category_label)) ORDER BY e.position,e.id),'[]'::jsonb)
  FROM public.resume_education_entries e
  JOIN public.resume_education_translations zh ON zh.education_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
  JOIN public.resume_education_translations en ON en.education_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en'
  WHERE e.resume_id=target_resume
$function$;
CREATE FUNCTION public.test_only_d3_education_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='education' AND payload_version=2 $function$;
CREATE FUNCTION public.test_only_d3_education_event_matches(target_resume uuid,before_value jsonb,after_value jsonb)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT EXISTS(SELECT 1 FROM cms_private.activity_log_events e WHERE e.resume_id=target_resume AND e.section_key='education'
  AND e.entity_type='education_list' AND e.entity_id IS NULL AND e.operation='update' AND e.payload_version=2
  AND e.entity_snapshot->'education'=after_value AND e.changes->'education'->'before'=before_value
  AND e.changes->'education'->'after'=after_value) $function$;
CREATE FUNCTION public.test_only_d3_education_sign_and_save(target_resume uuid,target_canonical text,target_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE stamp bigint; signed_value text; context_value jsonb;
BEGIN
  stamp:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  context_value:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
    'actor_user_id',(SELECT auth.uid())::text,'resume_id',target_resume::text,'domain','education','operation','update',
    'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_canonical,'UTF8'),'sha256'),'hex'),
    'issued_at',stamp,'expires_at',stamp+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL);
  signed_value:=context_value::text;
  RETURN public.save_resume_education_v1(target_resume,target_canonical,signed_value,
    pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(signed_value,'UTF8'),
      pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex'));
END
$function$;
CREATE FUNCTION public.test_only_d3_education_signed_request(target_resume uuid,target_canonical text,target_request uuid,overrides jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE stamp bigint; signed_value text; context_value jsonb; signature_value text;
BEGIN
  stamp:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  context_value:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
    'actor_user_id',(SELECT auth.uid())::text,'resume_id',target_resume::text,'domain','education','operation','update',
    'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_canonical,'UTF8'),'sha256'),'hex'),
    'issued_at',stamp,'expires_at',stamp+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)||COALESCE(overrides,'{}'::jsonb);
  signed_value:=context_value::text;
  signature_value:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(signed_value,'UTF8'),
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex');
  RETURN pg_catalog.jsonb_build_object('signed_context',signed_value,'signature_hex',signature_value);
END
$function$;
CREATE FUNCTION public.test_only_d3_education_idempotency(target_resume uuid,target_request uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT pg_catalog.jsonb_build_object('count',count(*),'completed_count',count(*) FILTER(WHERE completed_at IS NOT NULL),
    'result',max(result_payload::text)::jsonb)
  FROM cms_private.activity_log_idempotency
  WHERE actor_user_id=(SELECT auth.uid()) AND resume_id=target_resume AND domain_key='education' AND request_id=target_request
$function$;
CREATE FUNCTION public.test_only_d3_education_idempotency_for_actor(target_resume uuid,target_actor uuid,target_request uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT pg_catalog.jsonb_build_object('count',count(*),'completed_count',count(*) FILTER(WHERE completed_at IS NOT NULL))
  FROM cms_private.activity_log_idempotency
  WHERE actor_user_id=target_actor AND resume_id=target_resume AND domain_key='education' AND request_id=target_request
$function$;
CREATE FUNCTION public.test_only_d3_education_target_counts(target_resume uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$
  SELECT pg_catalog.jsonb_build_object('parents',(SELECT count(*) FROM public.resume_education_entries WHERE resume_id=target_resume),
    'translations',(SELECT count(*) FROM public.resume_education_translations WHERE resume_id=target_resume),
    'events',(SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='education' AND payload_version=2))
$function$;
CREATE FUNCTION public.test_only_d3_education_rejects_bad_signature(target_resume uuid,target_canonical text,target_request uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE stamp bigint; signed_value text; context_value jsonb; sig text; actual_state text;
BEGIN
  stamp:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  context_value:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
    'actor_user_id',(SELECT auth.uid())::text,'resume_id',target_resume::text,'domain','education','operation','update',
    'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_canonical,'UTF8'),'sha256'),'hex'),
    'issued_at',stamp,'expires_at',stamp+300,'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL);
  signed_value:=context_value::text;
  sig:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(signed_value,'UTF8'),pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex');
  BEGIN PERFORM public.save_resume_education_v1(target_resume,target_canonical,signed_value,
    CASE WHEN left(sig,1)='0' THEN '1' ELSE '0' END||substr(sig,2)); actual_state:='00000';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE; END;
  RETURN actual_state='22023';
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_d3_education_snapshot(uuid),public.test_only_d3_education_event_count(uuid),
  public.test_only_d3_education_event_matches(uuid,jsonb,jsonb),
  public.test_only_d3_education_sign_and_save(uuid,text,uuid),public.test_only_d3_education_signed_request(uuid,text,uuid,jsonb),
  public.test_only_d3_education_idempotency(uuid,uuid),public.test_only_d3_education_idempotency_for_actor(uuid,uuid,uuid),
  public.test_only_d3_education_target_counts(uuid),
  public.test_only_d3_education_rejects_bad_signature(uuid,text,uuid)
  FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_d3_education_snapshot(uuid),public.test_only_d3_education_event_count(uuid),
  public.test_only_d3_education_event_matches(uuid,jsonb,jsonb),
  public.test_only_d3_education_sign_and_save(uuid,text,uuid),public.test_only_d3_education_signed_request(uuid,text,uuid,jsonb),
  public.test_only_d3_education_idempotency(uuid,uuid),public.test_only_d3_education_idempotency_for_actor(uuid,uuid,uuid),
  public.test_only_d3_education_target_counts(uuid),
  public.test_only_d3_education_rejects_bad_signature(uuid,text,uuid)
  TO authenticated;

SELECT extensions.plan(17);
SELECT extensions.ok(to_regprocedure('public.load_admin_education_write_state(uuid)') IS NOT NULL
  AND to_regprocedure('public.save_resume_education_v1(uuid,text,text,text)') IS NOT NULL,
  'typed Education state reader and save RPC are installed');
SELECT extensions.ok(has_function_privilege('authenticated','public.save_resume_education_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_education_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_education_v1(uuid,text,text,text)','EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
    WHERE p.oid='public.save_resume_education_v1(uuid,text,text,text)'::regprocedure
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE'),
  'Education writer execute privilege is authenticated-only');
SELECT extensions.ok((SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=""']
  FROM pg_catalog.pg_proc WHERE oid='public.save_resume_education_v1(uuid,text,text,text)'::regprocedure)
  AND (SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""']
  FROM pg_catalog.pg_proc WHERE oid='public.load_admin_education_write_state(uuid)'::regprocedure),
  'Education RPC and state reader preserve SECURITY DEFINER and empty search_path');
SELECT extensions.ok((SELECT array_agg(a.attname ORDER BY a.attname)=ARRAY['education_entry_id','locale']::name[]
  FROM pg_catalog.pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) k(attnum)
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
  WHERE c.conrelid='public.resume_education_translations'::regclass AND c.contype='p'),
  'runtime Education translation primary key matches the production ON CONFLICT target');
SELECT extensions.ok((SELECT write_mode='direct' FROM cms_private.resume_write_modes
  WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='education')
  AND NOT EXISTS(SELECT 1 FROM cms_private.resume_domain_requirements WHERE resume_id='ea111111-1111-4111-8111-111111111111'
    AND domain_key='education' AND requirement_key='trusted_network_context_v11'),
  'migration installation leaves Education in direct mode without gate activation');
SELECT extensions.ok(cms_private.activity_event_payload_v2_is_allowed('education','education_list',NULL,'update',
  '{"education":[]}'::jsonb,'{"education":{"before":[],"after":[]}}'::jsonb)
  AND NOT cms_private.activity_event_payload_v2_is_allowed('education','education_list',NULL,'create',
  '{"education":[]}'::jsonb,'{"education":{"before":[],"after":[]}}'::jsonb),
  'Education V2 validator accepts only its frozen collection contract');
SELECT extensions.ok(NOT has_table_privilege('authenticated','cms_private.activity_log_events','SELECT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT')
  AND NOT has_table_privilege('anon','cms_private.activity_log_events','SELECT'),
  'Education writer does not grant direct access to private Activity Log rows');

-- Exercise the actual authenticated parent/translation policies while the target is in direct mode.
-- Seed one synthetic Official row so wrong-target UPDATE/DELETE assertions exercise RLS against existing rows.
INSERT INTO public.resume_education_entries(id,resume_id,source_key,position,entry_type,education_category)
  VALUES('d3000000-0000-4000-8000-000000000090','20000000-0000-4000-8000-000000000001',NULL,0,'standard',NULL);
INSERT INTO public.resume_education_translations(education_entry_id,resume_id,locale,title,program,period,grade)
  VALUES('d3000000-0000-4000-8000-000000000090','20000000-0000-4000-8000-000000000001','zh','Synthetic','Synthetic','Synthetic','Synthetic');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SET LOCAL ROLE authenticated;
DO $direct_rls$
DECLARE qa constant uuid:='ea111111-1111-4111-8111-111111111111'; official constant uuid:='20000000-0000-4000-8000-000000000001';
  created constant uuid:='d3000000-0000-4000-8000-000000000099'; affected bigint; rejected boolean:=false;
BEGIN
  INSERT INTO public.resume_education_entries(id,resume_id,source_key,position,entry_type,education_category)
    VALUES(created,qa,NULL,90,'standard',NULL);
  INSERT INTO public.resume_education_translations(education_entry_id,resume_id,locale,title,program,period,grade)
    VALUES(created,qa,'zh','测试','项目','时间','成绩'),(created,qa,'en','Test','Program','Period','Grade');
  UPDATE public.resume_education_entries SET position=91 WHERE id=created AND resume_id=qa;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'authorized direct parent UPDATE was denied'; END IF;
  UPDATE public.resume_education_translations SET title='更新' WHERE education_entry_id=created AND resume_id=qa AND locale='zh';
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'authorized direct translation UPDATE was denied'; END IF;
  DELETE FROM public.resume_education_translations WHERE education_entry_id=created AND resume_id=qa;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>2 THEN RAISE EXCEPTION 'authorized direct translation DELETE was denied'; END IF;
  DELETE FROM public.resume_education_entries WHERE id=created AND resume_id=qa;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>1 THEN RAISE EXCEPTION 'authorized direct parent DELETE was denied'; END IF;
  BEGIN INSERT INTO public.resume_education_entries(resume_id,position,entry_type) VALUES(official,900,'standard');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'wrong-target direct parent INSERT was not denied'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.resume_education_translations(education_entry_id,resume_id,locale,title,program,period,grade)
    VALUES('d3000000-0000-4000-8000-000000000090',official,'zh','x','x','x','x');
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'wrong-target direct translation INSERT was not denied'; END IF;
  UPDATE public.resume_education_entries SET updated_at=updated_at+interval '1 second' WHERE resume_id=official;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'wrong-target direct parent UPDATE affected rows'; END IF;
  DELETE FROM public.resume_education_entries WHERE resume_id=official;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'wrong-target direct parent DELETE affected rows'; END IF;
  UPDATE public.resume_education_translations SET title=title WHERE resume_id=official;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'wrong-target direct translation UPDATE affected rows'; END IF;
  DELETE FROM public.resume_education_translations WHERE resume_id=official;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'wrong-target direct translation DELETE affected rows'; END IF;
END
$direct_rls$;
RESET ROLE;
SELECT extensions.ok(true,'authenticated Education direct mode permits QA CRUD and denies wrong-target writes on both tables');

-- Test-only activation is transaction-local and is rolled back at the end.
UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='education';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','education','trusted_network_context_v11',true)
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;
UPDATE public.resume_education_entries SET education_category=NULL
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND id='ea000000-0000-4000-8000-000000000009';
SET LOCAL ROLE authenticated;
SELECT extensions.ok((SELECT education_write_mode='rpc' AND education_trusted_context_required
  FROM public.load_admin_education_write_state('ea111111-1111-4111-8111-111111111111')),
  'authenticated QA state reader reports Education RPC and trusted context');
SELECT extensions.ok((public.test_only_d3_education_snapshot('ea111111-1111-4111-8111-111111111111')->1->>'education_category') IS NULL,
  'test baseline includes the legacy summer-school raw NULL category');
SELECT extensions.ok(public.test_only_d3_education_rejects_bad_signature('ea111111-1111-4111-8111-111111111111',
  public.test_only_d3_education_snapshot('ea111111-1111-4111-8111-111111111111')::text,'d3000000-0000-4000-8000-000000000001'),
  'typed Education RPC rejects a tampered HMAC before content/event changes');

DO $rpc_direct_denials$
DECLARE qa constant uuid:='ea111111-1111-4111-8111-111111111111'; affected bigint; rejected boolean:=false;
BEGIN
  BEGIN INSERT INTO public.resume_education_entries(resume_id,position,entry_type) VALUES(qa,900,'standard');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'rpc-mode direct Education parent INSERT was not denied'; END IF;
  rejected:=false;
  BEGIN INSERT INTO public.resume_education_translations(education_entry_id,resume_id,locale,title,program,period,grade)
    VALUES('ea000000-0000-4000-8000-000000000008',qa,'zh','x','x','x','x');
  EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'rpc-mode direct Education translation INSERT was not denied'; END IF;
  UPDATE public.resume_education_entries SET updated_at=updated_at+interval '1 second' WHERE resume_id=qa;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'rpc-mode direct parent UPDATE affected rows'; END IF;
  DELETE FROM public.resume_education_entries WHERE resume_id=qa;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'rpc-mode direct parent DELETE affected rows'; END IF;
  UPDATE public.resume_education_translations SET title=title WHERE resume_id=qa;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'rpc-mode direct translation UPDATE affected rows'; END IF;
  DELETE FROM public.resume_education_translations WHERE resume_id=qa;
  GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>0 THEN RAISE EXCEPTION 'rpc-mode direct translation DELETE affected rows'; END IF;
END
$rpc_direct_denials$;
SELECT extensions.ok(true,'authenticated rpc mode denies direct INSERT/UPDATE/DELETE on Education parents and translations');

DO $rpc_roundtrip$
DECLARE qa constant uuid:='ea111111-1111-4111-8111-111111111111'; before_value jsonb; changed jsonb; conflict_value jsonb; created jsonb; deleted jsonb;
  initial_events bigint; response_value jsonb; after_value jsonb; signed_request jsonb; replay_result jsonb; reordered jsonb; idem jsonb;
  request_noop constant uuid:='d3000000-0000-4000-8000-000000000002';
  request_update constant uuid:='d3000000-0000-4000-8000-000000000005';
BEGIN
  before_value:=public.test_only_d3_education_snapshot(qa); initial_events:=public.test_only_d3_education_event_count(qa);
  response_value:=public.test_only_d3_education_sign_and_save(qa,before_value::text,request_noop);
  IF response_value<>before_value OR public.test_only_d3_education_event_count(qa)<>initial_events THEN RAISE EXCEPTION 'Education semantic no-op wrote an event or changed content'; END IF;
  changed:=pg_catalog.jsonb_set(before_value,'{1,zh,title}','"QA edited"'::jsonb);
  response_value:=public.test_only_d3_education_sign_and_save(qa,changed::text,request_update);
  after_value:=public.test_only_d3_education_snapshot(qa);
  IF response_value<>after_value OR after_value->1->>'education_category' IS NOT NULL OR after_value->1->'zh'->>'title'<>'QA edited'
    OR public.test_only_d3_education_event_count(qa)<>initial_events+1 THEN RAISE EXCEPTION 'Education update or legacy NULL preservation failed'; END IF;
  IF NOT public.test_only_d3_education_event_matches(qa,before_value,after_value) THEN RAISE EXCEPTION 'Education aggregate event is malformed'; END IF;
  -- Replay the exact same signed request bytes after a real semantic mutation.
  changed:=pg_catalog.jsonb_set(after_value,'{1,en,title}','"Exact replay mutation"'::jsonb);
  signed_request:=public.test_only_d3_education_signed_request(qa,changed::text,'d3000000-0000-4000-8000-000000000006','{}'::jsonb);
  response_value:=public.save_resume_education_v1(qa,changed::text,signed_request->>'signed_context',signed_request->>'signature_hex');
  after_value:=public.test_only_d3_education_snapshot(qa);
  replay_result:=public.save_resume_education_v1(qa,changed::text,signed_request->>'signed_context',signed_request->>'signature_hex');
  idem:=public.test_only_d3_education_idempotency(qa,'d3000000-0000-4000-8000-000000000006');
  IF response_value<>replay_result OR replay_result<>after_value OR public.test_only_d3_education_event_count(qa)<>initial_events+2
    OR idem->>'count'<>'1' OR idem->>'completed_count'<>'1' OR idem->'result'<>replay_result THEN
    RAISE EXCEPTION 'Exact Education replay changed state or duplicated the event/idempotency operation'; END IF;
  -- Aggregate reorder the legacy summer-school row while round-tripping NULL and empty strings distinctly.
  reordered:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(after_value->1,'{position}','0'::jsonb),'{zh,course_title}','""'::jsonb),'{en,course_description}','""'::jsonb),
    pg_catalog.jsonb_set(after_value->0,'{position}','1'::jsonb));
  response_value:=public.test_only_d3_education_sign_and_save(qa,reordered::text,'d3000000-0000-4000-8000-000000000007');
  after_value:=public.test_only_d3_education_snapshot(qa);
  IF after_value->0->>'entry_type'<>'summerSchool' OR after_value->0->'education_category'<>'null'::jsonb
    OR after_value->0->'zh'->'course_title'<>'""'::jsonb OR after_value->0->'zh'->'course_description'<>'null'::jsonb
    OR after_value->0->'en'->'course_title'<>'null'::jsonb OR after_value->0->'en'->'course_description'<>'""'::jsonb
    OR after_value->0->>'position'<>'0' OR after_value->1->>'position'<>'1'
    OR (SELECT count(*)<>count(DISTINCT position) OR min(position)<>0 OR max(position)<>1 FROM public.resume_education_entries WHERE resume_id=qa)
    OR public.test_only_d3_education_event_count(qa)<>initial_events+3 THEN
    RAISE EXCEPTION 'Education reorder did not preserve raw NULL, NULL/empty values, dense unique positions, or one event'; END IF;
  -- Reusing the completed request with a different digest must reject before DML.
  conflict_value:=pg_catalog.jsonb_set(after_value,'{1,en,title}','"Conflicting replay"'::jsonb);
  BEGIN PERFORM public.test_only_d3_education_sign_and_save(qa,conflict_value::text,request_update);
    RAISE EXCEPTION 'Education idempotency conflict unexpectedly passed';
  EXCEPTION WHEN SQLSTATE 'P13B1' THEN NULL; END;
  IF public.test_only_d3_education_snapshot(qa)<>after_value OR public.test_only_d3_education_event_count(qa)<>initial_events+3
    THEN RAISE EXCEPTION 'Education conflict changed content or event history'; END IF;
  created:=after_value||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',NULL,'position',2,'entry_type','standard','education_category',NULL,
    'zh',pg_catalog.jsonb_build_object('title','新增','program','','period','','grade','','course_title',NULL,'course_description',NULL,'custom_category_label',NULL),
    'en',pg_catalog.jsonb_build_object('title','New','program','','period','','grade','','course_title',NULL,'course_description',NULL,'custom_category_label',NULL)));
  response_value:=public.test_only_d3_education_sign_and_save(qa,created::text,'d3000000-0000-4000-8000-000000000003');
  after_value:=public.test_only_d3_education_snapshot(qa);
  IF pg_catalog.jsonb_array_length(after_value)<>3 OR after_value->2->>'id' IS NULL OR after_value->2->>'id'='null'
    OR (SELECT source_key IS NOT NULL FROM public.resume_education_entries WHERE id=(after_value->2->>'id')::uuid)
    OR public.test_only_d3_education_event_count(qa)<>initial_events+4 THEN RAISE EXCEPTION 'Education create did not generate a server ID / one event'; END IF;
  deleted:=after_value-2;
  response_value:=public.test_only_d3_education_sign_and_save(qa,deleted::text,'d3000000-0000-4000-8000-000000000004');
  IF pg_catalog.jsonb_array_length(public.test_only_d3_education_snapshot(qa))<>2
    OR public.test_only_d3_education_event_count(qa)<>initial_events+5 THEN RAISE EXCEPTION 'Education delete was not atomic or did not produce exactly one event'; END IF;
END
$rpc_roundtrip$;

SELECT extensions.ok(true,'exact signed Education replay is idempotent; aggregate reorder preserves raw NULL and NULL-versus-empty values');

DO $verifier_rejection_matrix$
DECLARE qa constant uuid:='ea111111-1111-4111-8111-111111111111'; official constant uuid:='20000000-0000-4000-8000-000000000001';
  canonical_value text; before_value jsonb; event_count bigint; official_before jsonb; official_events bigint;
  test_case record; request_value uuid; signed_value jsonb; state_value text; overrides jsonb; stamp bigint; after_counts jsonb; claimed_actor uuid;
BEGIN
  canonical_value:=public.test_only_d3_education_snapshot(qa)::text;
  before_value:=public.test_only_d3_education_snapshot(qa); event_count:=public.test_only_d3_education_event_count(qa);
  official_before:=public.test_only_d3_education_snapshot(official); official_events:=public.test_only_d3_education_event_count(official);
  stamp:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  FOR test_case IN SELECT label,context_overrides,row_number() OVER() AS n FROM (VALUES
    ('wrong actor',pg_catalog.jsonb_build_object('actor_user_id','10000000-0000-4000-8000-000000000003')),
    ('wrong target',pg_catalog.jsonb_build_object('resume_id',official::text)),
    ('wrong domain',pg_catalog.jsonb_build_object('domain','awards')),
    ('wrong operation',pg_catalog.jsonb_build_object('operation','create')),
    ('malformed request id',pg_catalog.jsonb_build_object('request_id','not-a-uuid')),
    ('digest mismatch',pg_catalog.jsonb_build_object('mutation_digest',pg_catalog.repeat('0',64))),
    ('future timestamp',pg_catalog.jsonb_build_object('issued_at',stamp+61,'expires_at',stamp+200)),
    ('expired timestamp',pg_catalog.jsonb_build_object('issued_at',stamp-400,'expires_at',stamp-100)),
    ('excessive lifetime',pg_catalog.jsonb_build_object('issued_at',stamp,'expires_at',stamp+301)),
    ('invalid issued-expiry relationship',pg_catalog.jsonb_build_object('issued_at',stamp,'expires_at',stamp)),
    ('wrong key id',pg_catalog.jsonb_build_object('key_id','not-the-v1-key')),
    ('invalid network prefix',pg_catalog.jsonb_build_object('ip_network','192.0.2.1/32')),
    ('invalid country metadata',pg_catalog.jsonb_build_object('country_code','USA')),
    ('invalid region metadata',pg_catalog.jsonb_build_object('region',''))
  ) AS cases(label,context_overrides) LOOP
    request_value:=('d3000000-0000-4000-8000-'||pg_catalog.lpad((500000000000+test_case.n)::text,12,'0'))::uuid;
    overrides:=test_case.context_overrides;
    signed_value:=public.test_only_d3_education_signed_request(qa,canonical_value,request_value,overrides);
    state_value:='00000';
    BEGIN
      PERFORM public.save_resume_education_v1(qa,canonical_value,signed_value->>'signed_context',signed_value->>'signature_hex');
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
    IF state_value<>'22023' THEN RAISE EXCEPTION 'Education verifier case % returned SQLSTATE %',test_case.label,state_value; END IF;
    claimed_actor:=COALESCE((overrides->>'actor_user_id')::uuid,(SELECT auth.uid()));
    after_counts:=public.test_only_d3_education_idempotency_for_actor(qa,claimed_actor,request_value);
    IF public.test_only_d3_education_snapshot(qa)<>before_value OR public.test_only_d3_education_event_count(qa)<>event_count
      OR public.test_only_d3_education_snapshot(official)<>official_before OR public.test_only_d3_education_event_count(official)<>official_events
      OR after_counts->>'count'<>'0' OR after_counts->>'completed_count'<>'0'
      OR (public.test_only_d3_education_idempotency_for_actor(official,claimed_actor,request_value)->>'count')<>'0' THEN
      RAISE EXCEPTION 'Rejected Education verifier case % changed state: snapshot_same=%, events_before=%, events_after=%, idem_count=%, idem_completed=%',
        test_case.label,public.test_only_d3_education_snapshot(qa)=before_value,event_count,public.test_only_d3_education_event_count(qa),after_counts->>'count',after_counts->>'completed_count'; END IF;
  END LOOP;
  -- The database function accepts request_id only inside signed_context, so a second independent ID to compare is not part of this RPC contract.
  -- A signed-context network edit after signing demonstrates that network metadata is integrity-bound to the HMAC.
  request_value:='d3000000-0000-4000-8000-000000000098';
  signed_value:=public.test_only_d3_education_signed_request(qa,canonical_value,request_value,'{}'::jsonb);
  signed_value:=pg_catalog.jsonb_set(signed_value,'{signed_context}',
    pg_catalog.to_jsonb(pg_catalog.jsonb_set((signed_value->>'signed_context')::jsonb,'{ip_network}','"192.0.2.0/24"'::jsonb)::text));
  state_value:='00000';
  BEGIN PERFORM public.save_resume_education_v1(qa,canonical_value,signed_value->>'signed_context',signed_value->>'signature_hex');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  IF state_value<>'22023' OR public.test_only_d3_education_snapshot(qa)<>before_value
    OR public.test_only_d3_education_event_count(qa)<>event_count
    OR public.test_only_d3_education_snapshot(official)<>official_before OR public.test_only_d3_education_event_count(official)<>official_events
    OR (public.test_only_d3_education_idempotency(qa,request_value)->>'count')<>'0'
    OR (public.test_only_d3_education_idempotency_for_actor(official,(SELECT auth.uid()),request_value)->>'count')<>'0' THEN
    RAISE EXCEPTION 'Signed network-context binding mismatch was not rejected before writes'; END IF;
  -- Change the request ID after signing: the altered signed field cannot be rebound to the old HMAC.
  request_value:='d3000000-0000-4000-8000-000000000097';
  signed_value:=public.test_only_d3_education_signed_request(qa,canonical_value,request_value,'{}'::jsonb);
  signed_value:=pg_catalog.jsonb_set(signed_value,'{signed_context}',pg_catalog.to_jsonb(pg_catalog.jsonb_set(
    (signed_value->>'signed_context')::jsonb,'{request_id}',pg_catalog.to_jsonb('d3000000-0000-4000-8000-000000000096'::text))::text));
  state_value:='00000';
  BEGIN PERFORM public.save_resume_education_v1(qa,canonical_value,signed_value->>'signed_context',signed_value->>'signature_hex');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  IF state_value<>'22023' OR public.test_only_d3_education_snapshot(qa)<>before_value
    OR public.test_only_d3_education_event_count(qa)<>event_count
    OR public.test_only_d3_education_snapshot(official)<>official_before OR public.test_only_d3_education_event_count(official)<>official_events
    OR (public.test_only_d3_education_idempotency(qa,request_value)->>'count')<>'0'
    OR (public.test_only_d3_education_idempotency_for_actor(official,(SELECT auth.uid()),request_value)->>'count')<>'0' THEN
    RAISE EXCEPTION 'Request-ID field changed after signing was not rejected before writes'; END IF;
  -- A correctly shaped, correctly signed context with one signature bit changed is also rejected before writes.
  request_value:='d3000000-0000-4000-8000-000000000095';
  signed_value:=public.test_only_d3_education_signed_request(qa,canonical_value,request_value,'{}'::jsonb);
  signed_value:=pg_catalog.jsonb_set(signed_value,'{signature_hex}',pg_catalog.to_jsonb(
    CASE WHEN left(signed_value->>'signature_hex',1)='0' THEN '1' ELSE '0' END||substr(signed_value->>'signature_hex',2)));
  state_value:='00000';
  BEGIN PERFORM public.save_resume_education_v1(qa,canonical_value,signed_value->>'signed_context',signed_value->>'signature_hex');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  IF state_value<>'22023' OR public.test_only_d3_education_snapshot(qa)<>before_value
    OR public.test_only_d3_education_event_count(qa)<>event_count
    OR public.test_only_d3_education_snapshot(official)<>official_before OR public.test_only_d3_education_event_count(official)<>official_events
    OR (public.test_only_d3_education_idempotency(qa,request_value)->>'count')<>'0'
    OR (public.test_only_d3_education_idempotency_for_actor(official,(SELECT auth.uid()),request_value)->>'count')<>'0' THEN
    RAISE EXCEPTION 'Invalid Education signature was not rejected before writes'; END IF;
END
$verifier_rejection_matrix$;
SELECT extensions.ok(true,'actual Education verifier rejects adversarial actor/target/domain/operation/request/digest/time/key/network cases before any writes');

DO $education_bounds$
DECLARE qa constant uuid:='ea111111-1111-4111-8111-111111111111'; payload jsonb; signed_value jsonb; result_value jsonb;
  before_value jsonb; event_count bigint; state_value text; request_value uuid;
BEGIN
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',NULL,'position',i,'entry_type','standard','education_category',NULL,
    'zh',pg_catalog.jsonb_build_object('title',CASE WHEN i=0 THEN pg_catalog.repeat('界',85)||'x' ELSE '标题' END,
      'program','','period','','grade','','course_title',NULL,'course_description',CASE WHEN i=0 THEN pg_catalog.repeat('x',2048) ELSE NULL END,'custom_category_label',NULL),
    'en',pg_catalog.jsonb_build_object('title','Boundary','program','','period','','grade','','course_title',NULL,'course_description',NULL,'custom_category_label',NULL)) ORDER BY i)
  INTO payload FROM pg_catalog.generate_series(0,15) i;
  request_value:='d3000000-0000-4000-8000-000000000080';
  signed_value:=public.test_only_d3_education_signed_request(qa,payload::text,request_value,'{}'::jsonb);
  result_value:=public.save_resume_education_v1(qa,payload::text,signed_value->>'signed_context',signed_value->>'signature_hex');
  before_value:=public.test_only_d3_education_snapshot(qa); event_count:=public.test_only_d3_education_event_count(qa);
  IF pg_catalog.jsonb_array_length(before_value)<>16 OR pg_catalog.octet_length(pg_catalog.convert_to(before_value->0->'zh'->>'title','UTF8'))<>256
    OR pg_catalog.octet_length(pg_catalog.convert_to(before_value->0->'zh'->>'course_description','UTF8'))<>2048
    OR result_value<>before_value THEN RAISE EXCEPTION '16-entry Education / UTF-8 field boundary was not accepted exactly'; END IF;
  payload:=before_value||pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(before_value->0,'{position}','16'::jsonb));
  request_value:='d3000000-0000-4000-8000-000000000081';
  signed_value:=public.test_only_d3_education_signed_request(qa,payload::text,request_value,'{}'::jsonb); state_value:='00000';
  BEGIN PERFORM public.save_resume_education_v1(qa,payload::text,signed_value->>'signed_context',signed_value->>'signature_hex');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  IF state_value<>'22023' OR public.test_only_d3_education_snapshot(qa)<>before_value OR public.test_only_d3_education_event_count(qa)<>event_count
    OR (public.test_only_d3_education_idempotency(qa,request_value)->>'count')<>'0' THEN RAISE EXCEPTION '17-entry Education payload was not rejected before writes'; END IF;
  payload:=pg_catalog.jsonb_set(before_value,'{0,zh,title}',pg_catalog.to_jsonb(pg_catalog.repeat('界',86)));
  request_value:='d3000000-0000-4000-8000-000000000082';
  signed_value:=public.test_only_d3_education_signed_request(qa,payload::text,request_value,'{}'::jsonb); state_value:='00000';
  BEGIN PERFORM public.save_resume_education_v1(qa,payload::text,signed_value->>'signed_context',signed_value->>'signature_hex');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  IF state_value<>'22023' OR public.test_only_d3_education_snapshot(qa)<>before_value OR public.test_only_d3_education_event_count(qa)<>event_count
    OR (public.test_only_d3_education_idempotency(qa,request_value)->>'count')<>'0' THEN RAISE EXCEPTION 'database-side multibyte field over-limit was not rejected before writes'; END IF;
  payload:=pg_catalog.jsonb_set(before_value,'{0,zh,course_description}',pg_catalog.to_jsonb(pg_catalog.repeat('x',2049)));
  request_value:='d3000000-0000-4000-8000-000000000083';
  signed_value:=public.test_only_d3_education_signed_request(qa,payload::text,request_value,'{}'::jsonb); state_value:='00000';
  BEGIN PERFORM public.save_resume_education_v1(qa,payload::text,signed_value->>'signed_context',signed_value->>'signature_hex');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state_value=RETURNED_SQLSTATE; END;
  IF state_value<>'22023' OR public.test_only_d3_education_snapshot(qa)<>before_value OR public.test_only_d3_education_event_count(qa)<>event_count
    OR (public.test_only_d3_education_idempotency(qa,request_value)->>'count')<>'0' THEN RAISE EXCEPTION 'database-side course-description over-limit was not rejected before writes'; END IF;
END
$education_bounds$;
SELECT extensions.ok(true,'actual Education RPC accepts 16 entries and exact UTF-8 byte boundaries, and rejects 17/over-limit fields without writes');

-- Force a natural late event-table constraint failure only inside this test transaction.
RESET ROLE;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT test_only_d3_education_late_failure
  CHECK (section_key <> 'education') NOT VALID;
SET LOCAL ROLE authenticated;
DO $education_late_rollback$
DECLARE qa constant uuid:='ea111111-1111-4111-8111-111111111111'; before_value jsonb; candidate jsonb; signed_value jsonb;
  events bigint; request_value uuid:='d3000000-0000-4000-8000-000000000084'; state_value text:='00000'; idem jsonb;
BEGIN
  before_value:=public.test_only_d3_education_snapshot(qa); events:=public.test_only_d3_education_event_count(qa);
  candidate:=pg_catalog.jsonb_set(before_value,'{0,en,title}','"Late failure rollback probe"'::jsonb);
  signed_value:=public.test_only_d3_education_signed_request(qa,candidate::text,request_value,'{}'::jsonb);
  BEGIN PERFORM public.save_resume_education_v1(qa,candidate::text,signed_value->>'signed_context',signed_value->>'signature_hex');
  EXCEPTION WHEN check_violation THEN state_value:='23514'; END;
  idem:=public.test_only_d3_education_idempotency(qa,request_value);
  IF state_value<>'23514' OR public.test_only_d3_education_snapshot(qa)<>before_value
    OR public.test_only_d3_education_event_count(qa)<>events OR idem->>'count'<>'0' OR idem->>'completed_count'<>'0' THEN
    RAISE EXCEPTION 'late Education event constraint failure did not roll back rows/event/idempotency'; END IF;
END
$education_late_rollback$;
RESET ROLE;
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT test_only_d3_education_late_failure;
SELECT extensions.ok(true,'late failure at aggregate event insertion rolls back parent/translation rows, success event, and idempotency completion');

SELECT extensions.pass('Education writer transaction, event, idempotency, and raw-category checks completed');
SELECT * FROM extensions.finish();
RESET ROLE;
ROLLBACK;
