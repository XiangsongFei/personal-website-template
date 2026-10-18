-- TEST ONLY: Section Titles typed writer, CAS, idempotency, atomic audit and reader contract.
-- All routing changes and writes target the isolated local QA fixture inside this rolled-back transaction.
BEGIN;
SELECT extensions.plan(6);

CREATE FUNCTION public.test_only_section_titles_save(target_resume uuid,target_request uuid,target_titles jsonb,
  expected_digest text DEFAULT NULL,expected_proof text DEFAULT NULL,replay boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE snapshot_value jsonb; digest_value text; proof_value text; canonical text; ctx jsonb; context_value text; signature_value text; result_value jsonb; stamp bigint;
BEGIN
  IF expected_digest IS NULL OR expected_proof IS NULL THEN
    SELECT section_titles_snapshot,section_titles_baseline_digest,section_titles_baseline_proof
      INTO snapshot_value,digest_value,proof_value FROM public.load_admin_section_titles_write_state(target_resume);
  ELSE digest_value:=expected_digest; proof_value:=expected_proof; END IF;
  canonical:=target_titles::text;
  stamp:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
  ctx:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
    'actor_user_id',(SELECT auth.uid())::text,'resume_id',target_resume::text,'domain','section_titles','operation','update',
    'request_id',target_request::text,'mutation_digest',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical,'UTF8'),'sha256'),'hex'),
    'expected_baseline_digest',digest_value,'baseline_proof',proof_value,'issued_at',stamp,'expires_at',stamp+300,
    'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL);
  context_value:=ctx::text;
  signature_value:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(context_value,'UTF8'),
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff','hex'),'sha256'),'hex');
  result_value:=public.save_resume_section_titles_v1(target_resume,canonical,context_value,signature_value);
  IF replay THEN
    PERFORM public.rls_test_assert(public.save_resume_section_titles_v1(target_resume,canonical,context_value,signature_value)=result_value,
      'same request replays without another event');
  END IF;
  RETURN result_value;
END
$function$;
CREATE FUNCTION public.test_only_section_titles_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $function$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='section_titles' AND entity_type='section_titles_settings' $function$;
CREATE FUNCTION public.test_only_section_titles_fail_audit()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$ BEGIN IF pg_catalog.current_setting('section_titles.fail_audit',true)='true' THEN RAISE EXCEPTION 'TEST ONLY forced audit failure'; END IF; RETURN NEW; END $function$;
CREATE TRIGGER test_only_section_titles_fail_audit BEFORE INSERT ON cms_private.activity_log_events
FOR EACH ROW EXECUTE FUNCTION public.test_only_section_titles_fail_audit();

SELECT extensions.ok(to_regprocedure('public.load_admin_section_titles_write_state(uuid)') IS NOT NULL
  AND to_regprocedure('public.save_resume_section_titles_v1(uuid,text,text,text)') IS NOT NULL
  AND to_regprocedure('public.read_version_history_v1(uuid,integer,timestamptz,uuid)') IS NOT NULL,
  'Section Titles writer and history readers are installed');
SELECT extensions.ok(has_function_privilege('authenticated','public.save_resume_section_titles_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_section_titles_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_section_titles_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_idempotency','INSERT'),
  'only authenticated callers can use the typed writer and cannot write audit tables directly');
SELECT extensions.ok((SELECT write_mode='direct' FROM cms_private.resume_write_modes
  WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='section_titles')
  OR NOT EXISTS(SELECT 1 FROM cms_private.resume_write_modes WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='section_titles'),
  'migration does not activate the local Test target');
SELECT extensions.ok(cms_private.section_titles_aggregate_is_allowed('{"translations":{"zh":{"education_label":"教育","experience_label":"经历","skills_label":"技能","honors_label":"荣誉","project_heading":"项目","kaggle_label":"项目链接"},"en":{"education_label":"Education","experience_label":"Experience","skills_label":"Skills","honors_label":"Awards","project_heading":"Projects","kaggle_label":"Project link"}}}'::jsonb)
  AND NOT cms_private.section_titles_aggregate_is_allowed('{"translations":{"zh":{"education_label":"教育","experience_label":"经历","skills_label":"技能","honors_label":"荣誉","project_heading":"项目","kaggle_label":"项目链接","extra":"x"},"en":{"education_label":"Education","experience_label":"Experience","skills_label":"Skills","honors_label":"Awards","project_heading":"Projects","kaggle_label":"Project link"}}}'::jsonb),
  'aggregate accepts exactly the six bilingual title fields');
SELECT extensions.ok(pg_catalog.strpos(pg_catalog.pg_get_functiondef('cms_private.restore_domain_for_event(text,text,text)'::regprocedure),'section_titles')=0,
  'the existing Restore domain allowlist still excludes Section Titles');

UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='section_titles';
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
SELECT 'ea111111-1111-4111-8111-111111111111','section_titles','rpc'
WHERE NOT EXISTS(SELECT 1 FROM cms_private.resume_write_modes WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='section_titles');
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','section_titles','trusted_network_context_v11',true)
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);

DO $writer$
DECLARE target_id constant uuid := 'ea111111-1111-4111-8111-111111111111';
  fields text[] := ARRAY['education_label','experience_label','skills_label','honors_label','project_heading','kaggle_label']; idx integer;
  titles jsonb; original jsonb; updated jsonb; result_value jsonb; old_digest text; old_proof text; req uuid; events_before bigint; state text; denied boolean;
BEGIN
  SELECT section_titles_snapshot INTO titles FROM public.load_admin_section_titles_write_state(target_id);
  events_before:=public.test_only_section_titles_event_count(target_id);
  FOR idx IN 1..6 LOOP
    req:=('dc111111-1111-4111-8111-'||lpad(idx::text,12,'0'))::uuid;
    original:=titles;
    titles:=pg_catalog.jsonb_set(titles,ARRAY['translations','zh',fields[idx]],
      pg_catalog.to_jsonb('测试标题-'||idx::text),false);
    result_value:=public.test_only_section_titles_save(target_id,req,titles,NULL,NULL,true);
    PERFORM public.rls_test_assert(public.test_only_section_titles_event_count(target_id)=events_before+1,
      'each changed title field produces exactly one event');
    SELECT section_titles_snapshot INTO original FROM public.load_admin_section_titles_write_state(target_id);
    PERFORM public.rls_test_assert(result_value=original, 'Section Titles writer returns authoritative aggregate state');
    events_before:=events_before+1;
  END LOOP;
  PERFORM public.rls_test_assert(public.test_only_section_titles_event_count(target_id)=events_before,
    'six individual field saves each produce one aggregate event');
  -- A request ID reused with another payload conflicts before stale baseline validation.
  updated:=pg_catalog.jsonb_set(titles,'{translations,en,kaggle_label}','"different"'::jsonb);
  denied:=false;
  BEGIN PERFORM public.test_only_section_titles_save(target_id,'dc111111-1111-4111-8111-111111111116',updated);
  EXCEPTION WHEN SQLSTATE 'P13B1' THEN denied:=true; END;
  PERFORM public.rls_test_assert(denied AND public.test_only_section_titles_event_count(target_id)=events_before,
    'same request ID with different content is rejected without an event');
  SELECT section_titles_baseline_digest,section_titles_baseline_proof INTO old_digest,old_proof
    FROM public.load_admin_section_titles_write_state(target_id);
  updated:=pg_catalog.jsonb_set(titles,'{translations,en,education_label}','"Concurrent stale"'::jsonb);
  result_value:=public.test_only_section_titles_save(target_id,'dc111111-1111-4111-8111-111111111117',updated);
  denied:=false;
  BEGIN PERFORM public.test_only_section_titles_save(target_id,'dc111111-1111-4111-8111-111111111118',titles,old_digest,old_proof);
  EXCEPTION WHEN SQLSTATE 'P13B2' THEN denied:=true; END;
  PERFORM public.rls_test_assert(denied AND public.test_only_section_titles_event_count(target_id)=events_before+1,
    'a distinct request based on a stale baseline is rejected without overwriting');
  SELECT section_titles_snapshot INTO original FROM public.load_admin_section_titles_write_state(target_id);
  updated:=pg_catalog.jsonb_set(original,'{translations,zh,skills_label}','"rollback-test"'::jsonb);
  SELECT section_titles_baseline_digest,section_titles_baseline_proof INTO old_digest,old_proof FROM public.load_admin_section_titles_write_state(target_id);
  PERFORM pg_catalog.set_config('section_titles.fail_audit','true',true); denied:=false;
  BEGIN PERFORM public.test_only_section_titles_save(target_id,'dc111111-1111-4111-8111-111111111119',updated);
  EXCEPTION WHEN raise_exception THEN denied:=true; END;
  PERFORM pg_catalog.set_config('section_titles.fail_audit','false',true);
  PERFORM public.rls_test_assert(denied AND (SELECT section_titles_snapshot FROM public.load_admin_section_titles_write_state(target_id))=original
    AND public.test_only_section_titles_event_count(target_id)=events_before+1
    AND NOT EXISTS(SELECT 1 FROM cms_private.activity_log_idempotency WHERE resume_id=target_id AND domain_key='section_titles' AND request_id='dc111111-1111-4111-8111-111111111119'),
    'forced audit failure rolls back title values and idempotency');
  denied:=false;
  BEGIN UPDATE public.resume_locale_content SET education_label='direct forbidden' WHERE resume_id=target_id AND locale='zh';
  EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
  PERFORM public.rls_test_assert(denied,'RPC-routed title columns reject direct locale updates');
  PERFORM public.rls_test_assert(EXISTS(SELECT 1 FROM public.read_activity_log_events_v13c(target_id,100,NULL,NULL,NULL,'successful','section_titles')
    WHERE event_source='activity' AND entity_type='section_titles_settings' AND payload_version=2),
    'Activity Log reader returns Section Titles V2 events');
  PERFORM public.rls_test_assert(EXISTS(SELECT 1 FROM public.read_version_history_v1(target_id,100)
    WHERE domain_key='section_titles' AND entity_type='section_titles_settings' AND comparison_kind='aggregate'
      AND comparison->'after'->'translations'->'zh'->>'education_label'='测试标题-1'),
    'Version History reader returns aggregate before and after values');
END
$writer$;

SELECT extensions.ok(public.test_only_section_titles_event_count('ea111111-1111-4111-8111-111111111111') >= 7,
  'six field writes and one subsequent stale-conflict scenario persisted only expected events');
SELECT * FROM extensions.finish();
ROLLBACK;
