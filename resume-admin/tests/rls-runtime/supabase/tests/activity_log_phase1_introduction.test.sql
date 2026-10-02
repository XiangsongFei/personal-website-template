-- TEST ONLY: Phase 1 atomic Introduction RPC and QA-only cutover.
BEGIN;
SELECT extensions.plan(9);

DO $payload_compatibility$
DECLARE
  paragraph_id text := 'ea000000-0000-4000-8000-000000000006';
  legacy_snapshot jsonb := '{"position":0,"text":"before"}'::jsonb;
  legacy_changes jsonb := '{"text":{"before":"before","after":"after"}}'::jsonb;
  aggregate_snapshot jsonb;
  zh_changes jsonb;
  en_changes jsonb;
  both_changes jsonb;
  reorder_changes jsonb;
  oversized_aggregate jsonb;
  many_paragraphs jsonb;
  boundary_legacy jsonb;
  malformed_rejected boolean;
  low_length integer := 0;
  high_length integer := 12000;
  mid_length integer;
BEGIN
  aggregate_snapshot := pg_catalog.jsonb_build_object('paragraphs', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('id',paragraph_id,'position',0,'text_zh','中文','text_en','English')));
  zh_changes := '{"text_zh":{"before":[],"after":[{"id":"ea000000-0000-4000-8000-000000000006","value":"中文"}]}}'::jsonb;
  en_changes := '{"text_en":{"before":[],"after":[{"id":"ea000000-0000-4000-8000-000000000006","value":"English"}]}}'::jsonb;
  both_changes := zh_changes || en_changes;
  reorder_changes := '{"position":{"before":[{"id":"ea000000-0000-4000-8000-000000000006","value":0}],"after":[{"id":"ea000000-0000-4000-8000-000000000006","value":1}]}}'::jsonb;

  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('introduction_paragraph',legacy_snapshot,legacy_changes), 'Phase 0B legacy Introduction payload remains accepted');
  boundary_legacy := pg_catalog.jsonb_build_object('position','legacy scalar','text',pg_catalog.repeat('x',11940));
  PERFORM public.rls_test_assert(pg_catalog.octet_length(boundary_legacy::text)<=12000
    AND cms_private.activity_event_payload_is_allowed('introduction_paragraph',boundary_legacy,
      '{"text":{"before":null,"after":123}}'::jsonb), 'legacy scalar values and values within the existing serialized byte limit remain accepted');
  WHILE low_length < high_length LOOP
    mid_length := (low_length + high_length + 1) / 2;
    boundary_legacy := pg_catalog.jsonb_build_object('position',0,'text',pg_catalog.repeat('x',mid_length));
    IF pg_catalog.octet_length(boundary_legacy::text) <= 12000 THEN low_length := mid_length;
    ELSE high_length := mid_length - 1; END IF;
  END LOOP;
  boundary_legacy := pg_catalog.jsonb_build_object('position',0,'text',pg_catalog.repeat('x',low_length));
  PERFORM public.rls_test_assert(pg_catalog.octet_length(boundary_legacy::text)=12000
    AND cms_private.activity_event_payload_is_allowed('introduction_paragraph',boundary_legacy,legacy_changes), 'legacy snapshot exactly at the accepted 12000 serialized-byte boundary remains valid');
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('introduction_paragraph','{}'::jsonb,'{}'::jsonb), 'legacy contract does not require snapshot fields or a change');
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('introduction_paragraph',NULL::jsonb,NULL::jsonb), 'legacy SQL NULL behavior remains unchanged');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph','{"position":0,"text":"before","extra":true}'::jsonb,legacy_changes), 'legacy unknown snapshot key is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',legacy_snapshot,'{"text":{"before":"before","after":"after"},"extra":{"before":null,"after":null}}'::jsonb), 'legacy unknown change key is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',legacy_snapshot,zh_changes), 'legacy snapshot with aggregate changes fails closed');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,legacy_changes), 'aggregate snapshot with legacy changes fails closed');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph','null'::jsonb,'null'::jsonb), 'JSON null is rejected while SQL NULL retains the legacy behavior');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',legacy_snapshot,'{"text":{"before":"before"}}'::jsonb), 'legacy missing before/after member is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph','{"position":{},"text":"before"}'::jsonb,legacy_changes), 'legacy object position is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph','{"position":0,"text":[]}'::jsonb,legacy_changes), 'legacy array text is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',legacy_snapshot,'{"text":{"before":{},"after":"after"}}'::jsonb), 'legacy nested before value is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',pg_catalog.jsonb_build_object('position',0,'text',pg_catalog.repeat('x',12000)),legacy_changes), 'legacy snapshot beyond the 12000-byte limit is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',legacy_snapshot,pg_catalog.jsonb_build_object('text',pg_catalog.jsonb_build_object('before','before','after',pg_catalog.repeat('x',12000)))), 'legacy changes beyond the 12000-byte limit are rejected');

  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,zh_changes), 'aggregate Chinese-only change is accepted');
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,en_changes), 'aggregate English-only change is accepted');
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,both_changes), 'aggregate bilingual change is accepted');
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,reorder_changes), 'aggregate paragraph reorder representation is accepted');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot || '{"unexpected":true}'::jsonb,zh_changes), 'aggregate unknown snapshot key is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,'{"text_zh":{"before":[],"after":[]},"unexpected":{"before":[],"after":[]}}'::jsonb), 'aggregate unknown change key is rejected');
  malformed_rejected := false;
  BEGIN
    malformed_rejected := NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph','{"paragraphs":{}}'::jsonb,zh_changes);
  EXCEPTION WHEN OTHERS THEN malformed_rejected := true;
  END;
  PERFORM public.rls_test_assert(malformed_rejected, 'aggregate paragraphs value with a non-array JSON type is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph','{"paragraphs":[{}]}'::jsonb,zh_changes), 'malformed aggregate paragraph row is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',
    pg_catalog.jsonb_build_object('paragraphs',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',paragraph_id,'position',0,'text_zh',pg_catalog.repeat('x',12001),'text_en',''))),zh_changes), 'oversized aggregate paragraph text is rejected');
  SELECT pg_catalog.jsonb_build_object('paragraphs',pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',pg_catalog.gen_random_uuid()::text,'position',i,'text_zh','','text_en',''))) INTO many_paragraphs
    FROM pg_catalog.generate_series(1,201) AS series(i);
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',many_paragraphs,'{}'::jsonb), 'aggregate with more than 200 paragraphs is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,
    '{"text_zh":{"before":[{"id":"ea000000-0000-4000-8000-000000000006","value":{}}],"after":[]}}'::jsonb), 'malformed aggregate Chinese before/after value is rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',aggregate_snapshot,
    '{"text_en":{"before":[],"after":[{"id":"ea000000-0000-4000-8000-000000000006","value":[]}]}}'::jsonb), 'malformed aggregate English before/after value is rejected');
  oversized_aggregate := pg_catalog.jsonb_build_object('paragraphs',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',pg_catalog.gen_random_uuid()::text,'position',i,'text_zh',pg_catalog.repeat('x',11000),'text_en',pg_catalog.repeat('y',11000)))
    FROM pg_catalog.generate_series(1,12) AS series(i)));
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',oversized_aggregate,zh_changes), 'aggregate payload exceeding the existing 250000-byte ceiling is rejected');

  PERFORM public.rls_test_assert(cms_private.activity_event_payload_is_allowed('award_entry','{"position":0,"name":"Award"}'::jsonb,
    '{"name":{"before":"Old","after":"Award"}}'::jsonb), 'unrelated Phase 0B award payload remains accepted');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_is_allowed('award_entry','{"position":0,"name":"Award","extra":true}'::jsonb,
    '{"name":{"before":"Old","after":"Award"}}'::jsonb), 'unrelated Phase 0B invalid award payload remains rejected');
END $payload_compatibility$;
SELECT extensions.pass('Phase 0B legacy, Phase 1 aggregate, and unrelated entity payload contracts');

CREATE FUNCTION public.rls_test_require_phase1_qa_target()
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF (SELECT count(*) FROM public.resume_sites
      WHERE id='ea111111-1111-4111-8111-111111111111'
        AND site_key='example-cv-qa' AND is_published=false) <> 1
    OR EXISTS (SELECT 1 FROM public.resume_sites
      WHERE site_key='example-cv-qa' AND id <> 'ea111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'Phase 1 requires the exact unpublished example-cv-qa target';
  END IF;
END
$function$;

DO $qa_target_guard_matrix$
DECLARE rejected boolean; qa_id uuid := 'ea111111-1111-4111-8111-111111111111'; alternate_id uuid := 'ea222222-2222-4222-8222-222222222222';
BEGIN
  PERFORM public.rls_test_require_phase1_qa_target();
  rejected := false;
  BEGIN
    DELETE FROM public.resume_sites WHERE id=qa_id;
    PERFORM public.rls_test_require_phase1_qa_target();
  EXCEPTION WHEN raise_exception THEN rejected := SQLERRM='Phase 1 requires the exact unpublished example-cv-qa target';
  END;
  PERFORM public.rls_test_assert(rejected AND EXISTS(SELECT 1 FROM public.resume_sites WHERE id=qa_id AND site_key='example-cv-qa' AND NOT is_published), 'missing pinned QA UUID fails and rolls back the test subtransaction');

  rejected := false;
  BEGIN
    UPDATE public.resume_sites SET site_key='wrong-qa-key' WHERE id=qa_id;
    PERFORM public.rls_test_require_phase1_qa_target();
  EXCEPTION WHEN raise_exception THEN rejected := SQLERRM='Phase 1 requires the exact unpublished example-cv-qa target';
  END;
  PERFORM public.rls_test_assert(rejected AND EXISTS(SELECT 1 FROM public.resume_sites WHERE id=qa_id AND site_key='example-cv-qa'), 'wrong site_key fails closed');

  rejected := false;
  BEGIN
    UPDATE public.resume_sites SET is_published=true WHERE id=qa_id;
    PERFORM public.rls_test_require_phase1_qa_target();
  EXCEPTION WHEN raise_exception THEN rejected := SQLERRM='Phase 1 requires the exact unpublished example-cv-qa target';
  END;
  PERFORM public.rls_test_assert(rejected AND EXISTS(SELECT 1 FROM public.resume_sites WHERE id=qa_id AND NOT is_published), 'published pinned QA target fails closed');

  rejected := false;
  BEGIN
    UPDATE public.resume_sites SET site_key='wrong-qa-key' WHERE id=qa_id;
    INSERT INTO public.resume_sites(id,site_key,is_published) VALUES(alternate_id,'example-cv-qa',false);
    PERFORM public.rls_test_require_phase1_qa_target();
  EXCEPTION WHEN raise_exception THEN rejected := SQLERRM='Phase 1 requires the exact unpublished example-cv-qa target';
  END;
  PERFORM public.rls_test_assert(rejected AND EXISTS(SELECT 1 FROM public.resume_sites WHERE id=qa_id AND site_key='example-cv-qa')
    AND NOT EXISTS(SELECT 1 FROM public.resume_sites WHERE id=alternate_id), 'different UUID cannot substitute for the pinned QA identity');

  rejected := false;
  BEGIN
    UPDATE cms_private.resume_capabilities SET enabled=false WHERE resume_id=qa_id AND capability_key='activity_log';
    UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id=qa_id AND domain_key='introduction';
    EXECUTE 'CREATE TABLE public.rls_test_phase1_partial_ddl(id integer)';
    DELETE FROM public.resume_sites WHERE id=qa_id;
    PERFORM public.rls_test_require_phase1_qa_target();
  EXCEPTION WHEN raise_exception THEN rejected := SQLERRM='Phase 1 requires the exact unpublished example-cv-qa target';
  END;
  PERFORM public.rls_test_assert(rejected
    AND EXISTS(SELECT 1 FROM public.resume_sites WHERE id=qa_id AND site_key='example-cv-qa' AND NOT is_published)
    AND EXISTS(SELECT 1 FROM cms_private.resume_capabilities WHERE resume_id=qa_id AND capability_key='activity_log' AND enabled)
    AND cms_private.get_resume_write_mode(qa_id,'introduction')='rpc'
    AND pg_catalog.to_regclass('public.rls_test_phase1_partial_ddl') IS NULL,
    'guard failure rolls back simulated capability, mode, and DDL changes');
END $qa_target_guard_matrix$;
SELECT extensions.pass('pinned QA identity guard fails closed and rolls back partial state');

DO $phase1_state$
DECLARE qa uuid := 'ea111111-1111-4111-8111-111111111111'; official uuid := '20000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM public.rls_test_assert((SELECT enabled FROM cms_private.resume_capabilities WHERE resume_id=qa AND capability_key='activity_log'), 'QA Activity Log capability is enabled');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM cms_private.resume_capabilities WHERE resume_id=official AND enabled), 'official Activity Log remains disabled');
  PERFORM public.rls_test_assert(cms_private.get_resume_write_mode(qa,'introduction')='rpc', 'QA Introduction is RPC');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM cms_private.resume_write_modes WHERE resume_id=qa AND write_mode='rpc' AND domain_key='introduction'), 'only QA Introduction is RPC');
  PERFORM public.rls_test_assert((SELECT count(*)=9 FROM cms_private.resume_write_modes WHERE resume_id=qa AND write_mode='direct'), 'other QA domains remain direct');
  PERFORM public.rls_test_assert(cms_private.get_resume_write_mode(official,'introduction')='direct', 'official Introduction remains direct');
  PERFORM public.rls_test_assert(NOT has_function_privilege('anon','public.save_resume_introduction(uuid,jsonb)','EXECUTE'), 'anon cannot execute save RPC');
  PERFORM public.rls_test_assert(has_function_privilege('authenticated','public.save_resume_introduction(uuid,jsonb)','EXECUTE'), 'authenticated can execute intended save RPC');
END $phase1_state$;
SELECT extensions.pass('Phase 1 configuration and RPC ACL are QA-only');

INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('20000000-0000-4000-8000-000000000001','activity_log',true)
ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"owner@example.test"}',true);
DO $owner_capability_and_mode$
DECLARE state record; denied boolean;
BEGIN
  SELECT * INTO state FROM public.load_admin_feature_state('ea111111-1111-4111-8111-111111111111');
  PERFORM public.rls_test_assert(state.activity_log_enabled AND state.introduction_write_mode='rpc', 'Owner observes the QA target capability and Introduction mode');
  denied := false;
  BEGIN
    PERFORM public.save_resume_introduction('20000000-0000-4000-8000-000000000001','[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := SQLERRM='Introduction RPC mode is not enabled for this target';
  END;
  PERFORM public.rls_test_assert(denied, 'RPC refuses a target whose Introduction write mode is direct');
END $owner_capability_and_mode$;
RESET ROLE;
DELETE FROM cms_private.resume_capabilities WHERE resume_id='20000000-0000-4000-8000-000000000001' AND capability_key='activity_log';
SELECT extensions.pass('Owner sees target capability and direct-mode RPC use is rejected');

-- Failure injection is test-only and verifies that an audit insert error aborts the content mutation.
CREATE FUNCTION public.rls_test_fail_activity_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF pg_catalog.current_setting('phase1.fail_activity_insert',true)='true' THEN
    RAISE EXCEPTION 'TEST ONLY forced audit insert failure';
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER rls_test_fail_activity_insert BEFORE INSERT ON cms_private.activity_log_events
FOR EACH ROW EXECUTE FUNCTION public.rls_test_fail_activity_insert();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
DO $successful_change$
DECLARE result jsonb; event_row record; before_count integer;
BEGIN
  SELECT count(*) INTO before_count FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',100);
  result := public.save_resume_introduction('ea111111-1111-4111-8111-111111111111',
    '[{"id":"ea000000-0000-4000-8000-000000000006","zh":"QA 修改后的第一段","en":"Synthetic introduction paragraph 1 for editing and reorder checks."},{"id":"ea000000-0000-4000-8000-000000000007","zh":"这是用于测试第 2 段介绍编辑与排序的合成内容。","en":"Synthetic introduction paragraph 2 for editing and reorder checks."}]'::jsonb);
  PERFORM public.rls_test_assert(result->0->'translations'->'zh'->>'text'='QA 修改后的第一段', 'RPC returns canonical persisted AFTER state');
  SELECT * INTO event_row FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',100)
    WHERE entity_id='introduction';
  PERFORM public.rls_test_assert((SELECT count(*)=before_count+1 FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',100)), 'one changed paragraph appends exactly one event');
  PERFORM public.rls_test_assert(event_row.operation='update' AND event_row.section_key='introduction' AND event_row.entity_type='introduction_paragraph', 'event has Introduction UPDATE semantics');
  PERFORM public.rls_test_assert(event_row.actor_user_id=auth.uid() AND event_row.actor_role_snapshot='qa' AND event_row.actor_email_snapshot='qa@example.test', 'actor snapshots are derived from authenticated claims and membership');
  PERFORM public.rls_test_assert(event_row.changes='{"text_zh":{"before":[{"id":"ea000000-0000-4000-8000-000000000006","value":"这是用于测试第 1 段介绍编辑与排序的合成内容。"}],"after":[{"id":"ea000000-0000-4000-8000-000000000006","value":"QA 修改后的第一段"}]}}'::jsonb, 'semantic diff contains only the changed Chinese field');
  PERFORM public.rls_test_assert(event_row.entity_snapshot->'paragraphs'->0->>'text_zh'='QA 修改后的第一段' AND event_row.entity_snapshot->'paragraphs'->0->>'text_en'='Synthetic introduction paragraph 1 for editing and reorder checks.', 'snapshot contains canonical after values');
END $successful_change$;
SELECT extensions.pass('QA Introduction RPC writes canonical content and one server-authored event');

DO $noop_and_cursor$
DECLARE before_count integer; result jsonb; first_event record;
BEGIN
  SELECT count(*) INTO before_count FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',100);
  result := public.save_resume_introduction('ea111111-1111-4111-8111-111111111111',
    '[{"id":"ea000000-0000-4000-8000-000000000006","zh":"QA 修改后的第一段","en":"Synthetic introduction paragraph 1 for editing and reorder checks."},{"id":"ea000000-0000-4000-8000-000000000007","zh":"这是用于测试第 2 段介绍编辑与排序的合成内容。","en":"Synthetic introduction paragraph 2 for editing and reorder checks."}]'::jsonb);
  PERFORM public.rls_test_assert((SELECT count(*)=before_count FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',100)), 'semantic no-op creates no event');
  SELECT * INTO first_event FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',1);
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',1,first_event.occurred_at,first_event.id)), 'keyset cursor reads the next page without duplicates');
END $noop_and_cursor$;
SELECT extensions.pass('no-op save and keyset read behavior');

DO $fail_closed$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN
    PERFORM public.save_resume_introduction('20000000-0000-4000-8000-000000000001','[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot call RPC against official target');
  denied := false;
  BEGIN
    PERFORM public.save_resume_introduction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'caller-supplied foreign target ID does not grant access');
  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(resume_id,position) VALUES ('ea111111-1111-4111-8111-111111111111',10);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'stale QA direct DML is blocked on Introduction parent');
  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraph_translations(paragraph_id,resume_id,locale,text)
      VALUES ('ea000000-0000-4000-8000-000000000006','ea111111-1111-4111-8111-111111111111','zh','bypass');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'stale QA direct DML is blocked on Introduction translations');
  PERFORM public.rls_test_assert(has_table_privilege('authenticated','public.resume_profile','UPDATE'), 'non-converted CMS direct-write ACL remains present');
END $fail_closed$;
SELECT extensions.pass('target authorization and stale direct Introduction writes fail closed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated","email":"unlisted@example.test"}',true);
DO $unauthorized_user$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.save_resume_introduction('ea111111-1111-4111-8111-111111111111','[]'::jsonb);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'authenticated user without Admin membership cannot call the write RPC');
END $unauthorized_user$;
RESET ROLE;
SELECT extensions.pass('unlisted authenticated user is rejected');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);

DO $rollback_on_audit_failure$
DECLARE denied boolean; before_text text; after_text text;
BEGIN
  SELECT text INTO before_text FROM public.resume_intro_paragraph_translations
    WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh';
  PERFORM pg_catalog.set_config('phase1.fail_activity_insert','true',true);
  denied := false;
  BEGIN
    PERFORM public.save_resume_introduction('ea111111-1111-4111-8111-111111111111',
      '[{"id":"ea000000-0000-4000-8000-000000000006","zh":"must rollback","en":"Synthetic introduction paragraph 1 for editing and reorder checks."},{"id":"ea000000-0000-4000-8000-000000000007","zh":"这是用于测试第 2 段介绍编辑与排序的合成内容。","en":"Synthetic introduction paragraph 2 for editing and reorder checks."}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN denied := true;
  END;
  PERFORM pg_catalog.set_config('phase1.fail_activity_insert','false',true);
  SELECT text INTO after_text FROM public.resume_intro_paragraph_translations
    WHERE paragraph_id='ea000000-0000-4000-8000-000000000006' AND resume_id='ea111111-1111-4111-8111-111111111111' AND locale='zh';
  PERFORM public.rls_test_assert(denied AND before_text=after_text, 'audit insertion failure rolls back the Introduction content mutation');
END $rollback_on_audit_failure$;
SELECT extensions.pass('audit failure atomically rolls back content');

SELECT * FROM extensions.finish();
ROLLBACK;
