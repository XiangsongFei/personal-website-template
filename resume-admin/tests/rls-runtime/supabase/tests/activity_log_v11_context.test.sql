-- TEST ONLY: Activity Log V1.1 contract in the isolated local RLS lab.
BEGIN;
SELECT extensions.plan(11);

-- TEST ONLY: narrowly bounded observation helpers for this rolled-back test.
CREATE FUNCTION public.test_only_v11_event_count(target_resume uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF target_resume <> 'ea111111-1111-4111-8111-111111111111'::uuid THEN RAISE EXCEPTION 'TEST ONLY target rejected'; END IF;
  RETURN (SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume);
END
$function$;
CREATE FUNCTION public.test_only_v11_latest_event_context(target_resume uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF target_resume <> 'ea111111-1111-4111-8111-111111111111'::uuid THEN RAISE EXCEPTION 'TEST ONLY target rejected'; END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object('ip_network',ip_network::text,'country_code',country_code,'region',region,'city',city)
    FROM cms_private.activity_log_events WHERE resume_id=target_resume AND ip_network IS NOT NULL
    ORDER BY occurred_at DESC,id DESC LIMIT 1);
END
$function$;
CREATE FUNCTION public.test_only_v11_idempotency_exists(target_resume uuid, target_request uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF target_resume <> 'ea111111-1111-4111-8111-111111111111'::uuid THEN RAISE EXCEPTION 'TEST ONLY target rejected'; END IF;
  RETURN EXISTS (SELECT 1 FROM cms_private.activity_log_idempotency
    WHERE actor_user_id=(SELECT auth.uid()) AND resume_id=target_resume AND domain_key='introduction'
      AND request_id=target_request AND completed_at IS NOT NULL AND result_payload IS NOT NULL
      AND expires_at=created_at+interval '7 days');
END
$function$;
CREATE FUNCTION public.test_only_v11_idempotency_payload(target_resume uuid, target_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF target_resume <> 'ea111111-1111-4111-8111-111111111111'::uuid THEN RAISE EXCEPTION 'TEST ONLY target rejected'; END IF;
  RETURN (SELECT result_payload FROM cms_private.activity_log_idempotency
    WHERE actor_user_id=(SELECT auth.uid()) AND resume_id=target_resume AND domain_key='introduction'
      AND request_id=target_request);
END
$function$;
CREATE FUNCTION public.test_only_v11_mark_idempotency_incomplete(target_resume uuid, target_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF target_resume <> 'ea111111-1111-4111-8111-111111111111'::uuid THEN RAISE EXCEPTION 'TEST ONLY target rejected'; END IF;
  UPDATE cms_private.activity_log_idempotency
  SET completed_at=NULL,result_payload=NULL
  WHERE actor_user_id=(SELECT auth.uid()) AND resume_id=target_resume AND domain_key='introduction'
    AND request_id=target_request;
END
$function$;
CREATE FUNCTION public.test_only_v11_expire_idempotency(target_resume uuid, target_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE expired_created_at timestamptz := pg_catalog.clock_timestamp() - interval '8 days';
BEGIN
  IF target_resume <> 'ea111111-1111-4111-8111-111111111111'::uuid THEN RAISE EXCEPTION 'TEST ONLY target rejected'; END IF;
  UPDATE cms_private.activity_log_idempotency
  SET created_at=expired_created_at, completed_at=expired_created_at,
      expires_at=expired_created_at + interval '7 days'
  WHERE actor_user_id=(SELECT auth.uid()) AND resume_id=target_resume AND domain_key='introduction'
    AND request_id=target_request;
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_v11_event_count(uuid),
  public.test_only_v11_latest_event_context(uuid),
  public.test_only_v11_idempotency_exists(uuid,uuid),
  public.test_only_v11_idempotency_payload(uuid,uuid),
  public.test_only_v11_mark_idempotency_incomplete(uuid,uuid),
  public.test_only_v11_expire_idempotency(uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.test_only_v11_event_count(uuid),
  public.test_only_v11_latest_event_context(uuid),
  public.test_only_v11_idempotency_exists(uuid,uuid),
  public.test_only_v11_idempotency_payload(uuid,uuid),
  public.test_only_v11_mark_idempotency_incomplete(uuid,uuid),
  public.test_only_v11_expire_idempotency(uuid,uuid) TO authenticated;

DO $foundation$
DECLARE old_event uuid; denied boolean;
BEGIN
  INSERT INTO cms_private.activity_log_events(
    actor_user_id, actor_role_snapshot, resume_id, site_key_snapshot,
    operation, section_key, entity_type
  ) VALUES (
    '10000000-0000-4000-8000-000000000001', 'owner',
    '20000000-0000-4000-8000-000000000001', 'example-cv',
    'update', 'introduction', 'introduction_paragraph'
  ) RETURNING id INTO old_event;
  PERFORM public.rls_test_assert(
    (SELECT ip_network IS NULL AND country_code IS NULL AND region IS NULL AND city IS NULL
     FROM cms_private.activity_log_events WHERE id = old_event),
    'historical-style events remain valid with all V1.1 context columns NULL'
  );
  PERFORM public.rls_test_assert(
    NOT EXISTS (SELECT 1 FROM cms_private.resume_domain_requirements),
    'V1.1 requirements are absent and therefore off for QA and Official'
  );
  PERFORM public.rls_test_assert(
    NOT has_schema_privilege('authenticated', 'cms_private', 'USAGE')
      AND NOT has_table_privilege('authenticated', 'cms_private.resume_domain_requirements', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'cms_private.resume_domain_requirements', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'cms_private.activity_log_idempotency', 'SELECT'),
    'requirement and idempotency state remain private from authenticated callers'
  );
  PERFORM public.rls_test_assert(
    NOT has_function_privilege('anon', 'public.save_resume_introduction_v11(uuid,text,text,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.save_resume_introduction_v11(uuid,text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'cms_private.verify_resume_introduction_v11_context(uuid,text,text,text)', 'EXECUTE'),
    'only authenticated callers receive the intended public V1.1 RPC boundary'
  );
  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,ip_network)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001',
      'example-cv','update','introduction','introduction_paragraph','203.0.113.1/32');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'IPv4 event context must be truncated to /24');
  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,country_code)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001',
      'example-cv','update','introduction','introduction_paragraph','us');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'country code must be uppercase two-letter ASCII');
  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,region)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001',
      'example-cv','update','introduction','introduction_paragraph','bad' || pg_catalog.chr(1));
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'region rejects C0 control characters');
  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,city)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001',
      'example-cv','update','introduction','introduction_paragraph',pg_catalog.repeat('x',129));
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'city is bounded to 128 UTF-8 bytes');
END
$foundation$;
SELECT extensions.pass('V1.1 columns preserve legacy rows, requirements default off, and private ACLs hold');

CREATE FUNCTION public.test_only_v11_fail_activity_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('phase1.fail_activity_insert', true) = 'true' THEN
    RAISE EXCEPTION 'TEST ONLY forced audit insert failure';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER test_only_v11_fail_activity_insert
BEFORE INSERT ON cms_private.activity_log_events
FOR EACH ROW EXECUTE FUNCTION public.test_only_v11_fail_activity_insert();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}', true);

DO $legacy_off$
DECLARE items jsonb; changed jsonb; event_count bigint; state record;
BEGIN
  SELECT * INTO state FROM public.load_admin_feature_state_v11('ea111111-1111-4111-8111-111111111111');
  PERFORM public.rls_test_assert(NOT state.introduction_trusted_context_required,
    'authorized QA feature state defaults the absent V1.1 requirement to false');
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', p.id::text, 'zh', COALESCE(zh.text, ''), 'en', COALESCE(en.text, '')
  ) ORDER BY p.position, p.id)
  INTO items
  FROM public.resume_intro_paragraphs p
  LEFT JOIN public.resume_intro_paragraph_translations zh ON zh.paragraph_id=p.id AND zh.locale='zh'
  LEFT JOIN public.resume_intro_paragraph_translations en ON en.paragraph_id=p.id AND en.locale='en'
  WHERE p.resume_id='ea111111-1111-4111-8111-111111111111';
  changed := pg_catalog.jsonb_set(items, '{0,zh}', to_jsonb((items->0->>'zh') || ' V1.1 legacy parity'), false);
  SELECT public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111') INTO event_count;
  PERFORM public.save_resume_introduction('ea111111-1111-4111-8111-111111111111', changed);
  PERFORM public.rls_test_assert(
    (SELECT text = changed->0->>'zh' FROM public.resume_intro_paragraph_translations
     WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND locale='zh')
      AND public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count+1,
    'legacy Phase 1 RPC still saves once and writes one semantic event while V1.1 gate is absent'
  );
  PERFORM public.save_resume_introduction('ea111111-1111-4111-8111-111111111111', changed);
  PERFORM public.rls_test_assert(
    public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count+1,
    'legacy semantic no-op still creates no additional Activity Log event'
  );
END
$legacy_off$;
SELECT extensions.pass('legacy Phase 1 behavior remains intact with V1.1 gate absent');

DO $legacy_generated_ids$
DECLARE
  target_resume constant uuid := 'ea111111-1111-4111-8111-111111111111';
  saved_result jsonb; repeated_result jsonb; incoming_items jsonb; canonical_items jsonb;
  event_count_before bigint; generated_ids text[]; result_ids text[]; persisted_count bigint;
BEGIN
  SELECT pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',p.id::text,'zh',zh.text,'en',en.text))
  INTO incoming_items
  FROM public.resume_intro_paragraphs p
  JOIN public.resume_intro_paragraph_translations zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
  JOIN public.resume_intro_paragraph_translations en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
  WHERE p.resume_id=target_resume AND p.id='ea000000-0000-4000-8000-000000000006';
  incoming_items := incoming_items || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('id','local-101-1001','zh','Legacy local paragraph','en','Legacy local paragraph'),
    pg_catalog.jsonb_build_object('id',NULL,'zh','Legacy null paragraph','en','Legacy null paragraph'),
    pg_catalog.jsonb_build_object('id','local-102-1002','zh','Legacy second local paragraph','en','Legacy second local paragraph'));
  PERFORM public.rls_test_assert(incoming_items IS NOT NULL AND pg_catalog.jsonb_array_length(incoming_items)=4,
    'legacy generated-ID fixture retains one row, omits one seeded row, and submits three new items');
  SELECT public.test_only_v11_event_count(target_resume) INTO event_count_before;
  saved_result := public.save_resume_introduction(target_resume,incoming_items);
  SELECT pg_catalog.array_agg(value->>'id' ORDER BY ordinality) INTO result_ids
  FROM pg_catalog.jsonb_array_elements(saved_result) WITH ORDINALITY AS result(value,ordinality);
  generated_ids := ARRAY[
    saved_result->1->>'id', saved_result->2->>'id', saved_result->3->>'id'
  ];
  SELECT count(*) INTO persisted_count FROM public.resume_intro_paragraphs WHERE resume_id=target_resume;
  PERFORM public.rls_test_assert(
    pg_catalog.array_length(generated_ids,1)=3
      AND generated_ids[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND generated_ids[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND generated_ids[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND (SELECT count(DISTINCT id) FROM pg_catalog.unnest(generated_ids) AS ids(id))=3,
    'legacy local and NULL IDs each receive a distinct persisted UUID');
  PERFORM public.rls_test_assert(
    persisted_count=4
      AND EXISTS (SELECT 1 FROM public.resume_intro_paragraphs WHERE resume_id=target_resume AND id='ea000000-0000-4000-8000-000000000006')
      AND NOT EXISTS (SELECT 1 FROM public.resume_intro_paragraphs WHERE resume_id=target_resume AND id='ea000000-0000-4000-8000-000000000007')
      AND result_ids=(ARRAY['ea000000-0000-4000-8000-000000000006'] || generated_ids)
      AND (SELECT pg_catalog.array_agg(id::text ORDER BY position,id) FROM public.resume_intro_paragraphs WHERE resume_id=target_resume)=result_ids,
    'legacy mixed save retains the selected row, deletes the omitted row, and preserves submitted order');
  PERFORM public.rls_test_assert(
    (SELECT count(*)=8 FROM public.resume_intro_paragraph_translations WHERE resume_id=target_resume)
      AND EXISTS (SELECT 1 FROM public.resume_intro_paragraph_translations WHERE paragraph_id=generated_ids[1]::uuid AND locale='zh' AND text='Legacy local paragraph')
      AND EXISTS (SELECT 1 FROM public.resume_intro_paragraph_translations WHERE paragraph_id=generated_ids[1]::uuid AND locale='en' AND text='Legacy local paragraph')
      AND EXISTS (SELECT 1 FROM public.resume_intro_paragraph_translations WHERE paragraph_id=generated_ids[2]::uuid AND locale='zh' AND text='Legacy null paragraph')
      AND EXISTS (SELECT 1 FROM public.resume_intro_paragraph_translations WHERE paragraph_id=generated_ids[2]::uuid AND locale='en' AND text='Legacy null paragraph')
      AND EXISTS (SELECT 1 FROM public.resume_intro_paragraph_translations WHERE paragraph_id=generated_ids[3]::uuid AND locale='zh' AND text='Legacy second local paragraph')
      AND EXISTS (SELECT 1 FROM public.resume_intro_paragraph_translations WHERE paragraph_id=generated_ids[3]::uuid AND locale='en' AND text='Legacy second local paragraph'),
    'legacy generated rows retain both submitted locale translations');
  PERFORM public.rls_test_assert(public.test_only_v11_event_count(target_resume)=event_count_before+1,
    'one changed legacy save creates exactly one semantic Activity Log event');

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',value->>'id','zh',value->'translations'->'zh'->>'text','en',value->'translations'->'en'->>'text') ORDER BY ordinality),'[]'::jsonb)
  INTO canonical_items
  FROM pg_catalog.jsonb_array_elements(saved_result) WITH ORDINALITY AS result(value,ordinality);
  repeated_result := public.save_resume_introduction(target_resume,canonical_items);
  PERFORM public.rls_test_assert(repeated_result=saved_result
      AND public.test_only_v11_event_count(target_resume)=event_count_before+1,
    'subsequent identical persisted-ID legacy save is a no-op with no extra event');
END
$legacy_generated_ids$;
SELECT extensions.pass('legacy Phase 1 local, NULL, multiple, mixed, ordered, translated, and no-op saves preserve generated IDs');
RESET ROLE;

-- The setting is synthetic, transaction-local test state. No fixture outside
-- this rolled-back test transaction is activated.
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES ('ea111111-1111-4111-8111-111111111111','introduction','trusted_network_context_v11',true);
DO $gate_isolation$
BEGIN
  PERFORM public.rls_test_assert(NOT EXISTS (SELECT 1 FROM cms_private.resume_domain_requirements
    WHERE resume_id='20000000-0000-4000-8000-000000000001'), 'QA gate activation leaves Official requirements absent');
  PERFORM public.rls_test_assert(cms_private.get_resume_write_mode('ea111111-1111-4111-8111-111111111111','education')='direct'
    AND cms_private.get_resume_write_mode('ea111111-1111-4111-8111-111111111111','profile')='direct',
    'QA Introduction gate does not change other QA domains');
END
$gate_isolation$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}', true);

DO $feature_state$
DECLARE state record; denied boolean;
BEGIN
  SELECT * INTO state FROM public.load_admin_feature_state_v11('ea111111-1111-4111-8111-111111111111');
  PERFORM public.rls_test_assert(state.activity_log_enabled AND state.introduction_write_mode='rpc'
    AND state.introduction_trusted_context_required, 'authorized QA target sees its isolated V1.1 requirement');
  denied := false;
  BEGIN
    PERFORM * FROM public.load_admin_feature_state_v11('20000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot inspect the Official target through V1.1 feature state');
END
$feature_state$;
SELECT extensions.pass('V1.1 feature-state read respects existing target authorization');

DO $legacy_gate$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN
    PERFORM public.save_resume_introduction('ea111111-1111-4111-8111-111111111111', '[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := SQLERRM='Signed Introduction context is required';
  END;
  PERFORM public.rls_test_assert(denied, 'enabled V1.1 gate rejects unsigned legacy Introduction RPC before mutation');
  denied := false;
  BEGIN
    UPDATE cms_private.resume_domain_requirements SET enabled=false
    WHERE resume_id='ea111111-1111-4111-8111-111111111111';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'authenticated caller cannot disable the V1.1 gate directly');
  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key)
    VALUES ('b9999999-9999-4999-8999-999999999999','ea111111-1111-4111-8111-111111111111',99,'v11-direct-bypass');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'enabled V1.1 requirement does not permit direct Introduction table mutation');
END
$legacy_gate$;
SELECT extensions.pass('legacy public RPC cannot bypass an enabled V1.1 requirement');

DO $valid_idempotent$
DECLARE
  items_a jsonb; items_b jsonb; canonical_a text; canonical_b text; context_a text; signature_a text;
  context_b text; signature_b text; result_a jsonb; result_b jsonb; retry_a jsonb;
  generated_id text; event_count bigint; expired_denied boolean;
  request_a uuid := 'b1111111-1111-4111-8111-111111111111';
  request_b uuid := 'b3333333-3333-4333-8333-333333333333';
BEGIN
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id::text,'zh',COALESCE(zh.text,''),'en',COALESCE(en.text,'')) ORDER BY p.position,p.id),'[]'::jsonb)
  INTO items_a
  FROM public.resume_intro_paragraphs p
  LEFT JOIN public.resume_intro_paragraph_translations zh ON zh.paragraph_id=p.id AND zh.locale='zh'
  LEFT JOIN public.resume_intro_paragraph_translations en ON en.paragraph_id=p.id AND en.locale='en'
  WHERE p.resume_id='ea111111-1111-4111-8111-111111111111';
  items_a := items_a || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id',NULL,'zh','Generated paragraph from request A','en','Generated paragraph from request A'));
  canonical_a := items_a::text;
  SELECT public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111') INTO event_count;
  SELECT signed_context, signature_hex INTO context_a, signature_a
  FROM public.test_only_sign_activity_log_v11_context(
    'ea111111-1111-4111-8111-111111111111', canonical_a,
    '10000000-0000-4000-8000-000000000002', request_a,
    target_ip=>'203.0.113.0/24', target_country=>'US', target_region=>'Test Region', target_city=>'Test City'
  );
  result_a := public.save_resume_introduction_v11('ea111111-1111-4111-8111-111111111111',canonical_a,context_a,signature_a);
  generated_id := result_a->(pg_catalog.jsonb_array_length(result_a)-1)->>'id';
  PERFORM public.rls_test_assert(generated_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND result_a->(pg_catalog.jsonb_array_length(result_a)-1)->'translations'->'zh'->>'text'='Generated paragraph from request A',
    'request A creates a persisted paragraph and returns its canonical generated UUID');
  PERFORM public.rls_test_assert(public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count+1,
    'first logical request A emits exactly one event');
  PERFORM public.rls_test_assert(public.test_only_v11_latest_event_context('ea111111-1111-4111-8111-111111111111') =
      '{"ip_network":"203.0.113.0/24","country_code":"US","region":"Test Region","city":"Test City"}'::jsonb,
    'validated signed network and geo context is stored only on the V1.1 event');
  PERFORM public.rls_test_assert(public.test_only_v11_idempotency_payload(
      'ea111111-1111-4111-8111-111111111111',request_a)=result_a,
    'original canonical result is retained in the private idempotency row');

  items_b := pg_catalog.jsonb_set(items_a,
    ARRAY[(pg_catalog.jsonb_array_length(items_a)-1)::text,'id'],pg_catalog.to_jsonb(generated_id),false);
  items_b := pg_catalog.jsonb_set(items_b,'{0,zh}',
    pg_catalog.to_jsonb((items_b->0->>'zh') || ' later request B'),false);
  canonical_b := items_b::text;
  SELECT signed_context,signature_hex INTO context_b,signature_b
  FROM public.test_only_sign_activity_log_v11_context(
    'ea111111-1111-4111-8111-111111111111',canonical_b,auth.uid(),request_b);
  result_b := public.save_resume_introduction_v11(
    'ea111111-1111-4111-8111-111111111111',canonical_b,context_b,signature_b);
  PERFORM public.rls_test_assert(result_b->0->'translations'->'zh'->>'text'=(items_a->0->>'zh') || ' later request B'
      AND (SELECT text=(items_a->0->>'zh') || ' later request B'
        FROM public.resume_intro_paragraph_translations
        WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND locale='zh'),
    'later request B changes current state after request A');
  PERFORM public.rls_test_assert(public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count+2,
    'request B emits one additional event');

  retry_a := public.save_resume_introduction_v11(
    'ea111111-1111-4111-8111-111111111111',canonical_a,context_a,signature_a);
  PERFORM public.rls_test_assert(retry_a=result_a
      AND retry_a->(pg_catalog.jsonb_array_length(retry_a)-1)->>'id'=generated_id,
    'retry A returns its exact original canonical result and generated UUID after B');
  PERFORM public.rls_test_assert((SELECT text=(items_a->0->>'zh') || ' later request B'
      FROM public.resume_intro_paragraph_translations
      WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND locale='zh')
      AND public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count+2,
    'retry A leaves B current and creates no third event');
  PERFORM public.test_only_v11_expire_idempotency(
    'ea111111-1111-4111-8111-111111111111',request_a);
  expired_denied := false;
  BEGIN
    PERFORM public.save_resume_introduction_v11(
      'ea111111-1111-4111-8111-111111111111',canonical_a,context_a,signature_a);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    expired_denied := SQLERRM='Idempotency request has expired; use a new request ID';
  END;
  PERFORM public.rls_test_assert(expired_denied
      AND (SELECT text=(items_a->0->>'zh') || ' later request B'
        FROM public.resume_intro_paragraph_translations
        WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND locale='zh')
      AND public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count+2,
    'expired A is rejected and cannot reapply over later B or create an event');
  PERFORM public.rls_test_assert(public.test_only_v11_idempotency_exists(
      'ea111111-1111-4111-8111-111111111111',request_a),
    'completed idempotency record stores its bounded result for seven days');
END
$valid_idempotent$;
SELECT extensions.pass('A-to-B-to-retry-A preserves original result and generated ID without repeating mutation/event');

DO $invalid_signature_matrix$
DECLARE
  canonical text := '[]'; context_value text; signature_value text; denied boolean;
  issued bigint := pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('missing-signature', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::text),
    ('malformed-signature', 'bad', NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::text),
    ('invalid-signature', pg_catalog.repeat('0',64), NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::text),
    ('expired', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, issued-400, issued-100, NULL::text, NULL::text, NULL::text),
    ('future', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, issued+61, issued+200, NULL::text, NULL::text, NULL::text),
    ('too-long-lifetime', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, issued, issued+301, NULL::text, NULL::text, NULL::text),
    ('wrong-actor', NULL::text, '10000000-0000-4000-8000-000000000001'::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::text),
    ('wrong-resume', NULL::text, NULL::uuid, '20000000-0000-4000-8000-000000000001'::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::text),
    ('wrong-domain', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::text),
    ('wrong-operation', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, NULL::text),
    ('bad-ip-prefix', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, '203.0.113.1/32', NULL::text, NULL::text),
    ('bad-country', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, 'us', NULL::text),
    ('bad-region-size', NULL::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::bigint, NULL::bigint, NULL::text, NULL::text, pg_catalog.repeat('x',129))
  ) AS cases(name, sig_override, actor, resume, request_id, issued_at, expires_at, ip, country, region)
  LOOP
    IF item.name IN ('missing-signature','malformed-signature','invalid-signature') THEN
      SELECT signed_context, signature_hex INTO context_value, signature_value
      FROM public.test_only_sign_activity_log_v11_context(
        'ea111111-1111-4111-8111-111111111111',canonical,auth.uid(),'c1111111-1111-4111-8111-111111111111'
      );
      signature_value := item.sig_override;
    ELSE
      SELECT signed_context, signature_hex INTO context_value, signature_value
      FROM public.test_only_sign_activity_log_v11_context(
        'ea111111-1111-4111-8111-111111111111',canonical,
        COALESCE(item.actor,auth.uid()),COALESCE(item.request_id,'c1111111-1111-4111-8111-111111111111'),
        item.issued_at,item.expires_at,item.ip,item.country,item.region,
        CASE WHEN item.name='wrong-resume' THEN 'Test City' ELSE NULL END,
        CASE WHEN item.name='wrong-domain' THEN 'profile' ELSE 'introduction' END,
        CASE WHEN item.name='wrong-operation' THEN 'delete' ELSE 'update' END
      );
      IF item.name='wrong-resume' THEN
        SELECT signed_context, signature_hex INTO context_value, signature_value
        FROM public.test_only_sign_activity_log_v11_context(
          item.resume,'[]',auth.uid(),'c1111111-1111-4111-8111-111111111111'
        );
      END IF;
    END IF;
    denied := false;
    BEGIN
      PERFORM public.save_resume_introduction_v11(
        'ea111111-1111-4111-8111-111111111111',canonical,context_value,signature_value
      );
    EXCEPTION WHEN OTHERS THEN denied := SQLERRM='Invalid signed Introduction request';
    END;
    PERFORM public.rls_test_assert(denied, item.name || ' signed context is rejected generically');
  END LOOP;
END
$invalid_signature_matrix$;
SELECT extensions.pass('malformed, invalid, expired, future, long-lived, misbound, geo, and IP contexts fail closed');

DO $shape_digest_and_size$
DECLARE
  canonical text; context_value text; signature_value text; denied boolean;
  invalid_items text[] := ARRAY[
    '[{"id":"ea000000-0000-4000-8000-000000000006","zh":"a","en":"b","extra":1}]',
    '[{"id":"ea000000-0000-4000-8000-000000000006","zh":"a"}]',
    '[{"id":"bad-id","zh":"a","en":"b"}]',
    '[{"id":"ea000000-0000-4000-8000-000000000006","zh":"a","en":"b"},{"id":"ea000000-0000-4000-8000-000000000006","zh":"c","en":"d"}]',
    'not-json'
  ]; item text;
BEGIN
  FOREACH item IN ARRAY invalid_items LOOP
    SELECT signed_context,signature_hex INTO context_value,signature_value
    FROM public.test_only_sign_activity_log_v11_context(
      'ea111111-1111-4111-8111-111111111111',item,auth.uid(),pg_catalog.gen_random_uuid()
    );
    denied := false;
    BEGIN PERFORM public.save_resume_introduction_v11('ea111111-1111-4111-8111-111111111111',item,context_value,signature_value);
    EXCEPTION WHEN SQLSTATE '22023' THEN denied := true; END;
    PERFORM public.rls_test_assert(denied, 'invalid canonical item shape is rejected');
  END LOOP;

  canonical := '[]';
  SELECT signed_context,signature_hex INTO context_value,signature_value
  FROM public.test_only_sign_activity_log_v11_context('ea111111-1111-4111-8111-111111111111',canonical,auth.uid(),
    'c2222222-2222-4222-8222-222222222222',target_digest=>pg_catalog.repeat('0',64));
  denied := false;
  BEGIN PERFORM public.save_resume_introduction_v11('ea111111-1111-4111-8111-111111111111',canonical,context_value,signature_value);
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'canonical mutation digest mismatch is rejected');

  canonical := pg_catalog.repeat(' ',262145);
  SELECT signed_context,signature_hex INTO context_value,signature_value
  FROM public.test_only_sign_activity_log_v11_context('ea111111-1111-4111-8111-111111111111',canonical,auth.uid(),
    'c3333333-3333-4333-8333-333333333333');
  denied := false;
  BEGIN PERFORM public.save_resume_introduction_v11('ea111111-1111-4111-8111-111111111111',canonical,context_value,signature_value);
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'canonical mutation above 256 KiB is rejected');
END
$shape_digest_and_size$;
SELECT extensions.pass('strict canonical shape, digest, duplicate identity, and 256 KiB limits hold');

DO $idempotency_conflict_and_noop$
DECLARE
  canonical text; other_canonical text; context_value text; signature_value text; denied boolean;
  event_count bigint; first_noop_result jsonb; replay_noop_result jsonb; current_items jsonb;
  same_request uuid := 'b3333333-3333-4333-8333-333333333333';
  no_op_request uuid := 'b2222222-2222-4222-8222-222222222222';
BEGIN
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id::text,'zh',COALESCE(zh.text,''),'en',COALESCE(en.text,'')) ORDER BY p.position,p.id),'[]'::jsonb)
  INTO current_items
  FROM public.resume_intro_paragraphs p
  LEFT JOIN public.resume_intro_paragraph_translations zh ON zh.paragraph_id=p.id AND zh.locale='zh'
  LEFT JOIN public.resume_intro_paragraph_translations en ON en.paragraph_id=p.id AND en.locale='en'
  WHERE p.resume_id='ea111111-1111-4111-8111-111111111111';
  canonical := current_items::text;
  other_canonical := canonical || ' ';
  SELECT signed_context,signature_hex INTO context_value,signature_value
  FROM public.test_only_sign_activity_log_v11_context('ea111111-1111-4111-8111-111111111111',other_canonical,auth.uid(),same_request);
  denied := false;
  BEGIN PERFORM public.save_resume_introduction_v11('ea111111-1111-4111-8111-111111111111',other_canonical,context_value,signature_value);
  EXCEPTION WHEN SQLSTATE 'P13B1' THEN denied := SQLERRM='Idempotency key conflicts with a different request'; END;
  PERFORM public.rls_test_assert(denied, 'same idempotency key with a different digest is rejected');

  SELECT public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111') INTO event_count;
  SELECT signed_context,signature_hex INTO context_value,signature_value
  FROM public.test_only_sign_activity_log_v11_context('ea111111-1111-4111-8111-111111111111',canonical,auth.uid(),no_op_request);
  first_noop_result := public.save_resume_introduction_v11(
    'ea111111-1111-4111-8111-111111111111',canonical,context_value,signature_value);
  replay_noop_result := public.save_resume_introduction_v11(
    'ea111111-1111-4111-8111-111111111111',canonical,context_value,signature_value);
  PERFORM public.rls_test_assert(first_noop_result=replay_noop_result
      AND public.test_only_v11_idempotency_payload('ea111111-1111-4111-8111-111111111111',no_op_request)=first_noop_result
      AND public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count,
    'semantic no-op stores and replays its original result without creating an event');

  PERFORM public.test_only_v11_mark_idempotency_incomplete(
    'ea111111-1111-4111-8111-111111111111',no_op_request);
  denied := false;
  BEGIN
    PERFORM public.save_resume_introduction_v11(
      'ea111111-1111-4111-8111-111111111111',canonical,context_value,signature_value);
  EXCEPTION WHEN SQLSTATE '23505' THEN
    denied := SQLERRM='Idempotency key conflicts with a different request';
  END;
  PERFORM public.rls_test_assert(denied,
    'an incomplete reservation retains generic conflict SQLSTATE instead of the V1.3B proof code');

END
$idempotency_conflict_and_noop$;
SELECT extensions.pass('incomplete idempotency reservations keep the generic conflict SQLSTATE');
SELECT extensions.pass('idempotency conflicts, no-op result replay, and expiry semantics hold');

DO $failure_rollback_and_isolation$
DECLARE canonical text := '[]'; context_value text; signature_value text; denied boolean;
  event_count bigint; intro_text text;
BEGIN
  SELECT signed_context,signature_hex INTO context_value,signature_value
  FROM public.test_only_sign_activity_log_v11_context('ea111111-1111-4111-8111-111111111111',canonical,auth.uid(),
    'c4444444-4444-4444-8444-444444444444');
  SELECT public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111') INTO event_count;
  SELECT text INTO intro_text FROM public.resume_intro_paragraph_translations
  WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND locale='zh';
  PERFORM set_config('phase1.fail_activity_insert','true',true);
  denied := false;
  BEGIN PERFORM public.save_resume_introduction_v11('ea111111-1111-4111-8111-111111111111',canonical,context_value,signature_value);
  EXCEPTION WHEN raise_exception THEN denied := SQLERRM='TEST ONLY forced audit insert failure'; END;
  PERFORM set_config('phase1.fail_activity_insert','false',true);
  PERFORM public.rls_test_assert(denied AND NOT public.test_only_v11_idempotency_exists(
    'ea111111-1111-4111-8111-111111111111','c4444444-4444-4444-8444-444444444444')
      AND public.test_only_v11_event_count('ea111111-1111-4111-8111-111111111111')=event_count
      AND (SELECT text=intro_text FROM public.resume_intro_paragraph_translations
           WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND locale='zh'),
    'failed atomic save rolls back content, event, and idempotency reservation');
END
$failure_rollback_and_isolation$;
SELECT extensions.pass('target/domain isolation and transaction rollback of failed request reservation');

RESET ROLE;
ROLLBACK;
