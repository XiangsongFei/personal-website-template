-- TEST ONLY: Restore V1 authorization and transactional behavior in the isolated local lab.
BEGIN;

CREATE TEMP TABLE restore_test_requests(request_id uuid PRIMARY KEY, expected_digest text NOT NULL, source_event_id uuid NOT NULL);
CREATE TEMP TABLE restore_test_sources(domain_key text NOT NULL,event_id uuid NOT NULL,historical_state jsonb,created_seq bigserial);
CREATE TEMP TABLE restore_test_results(request_id uuid PRIMARY KEY,result_value jsonb NOT NULL);
CREATE TEMP TABLE restore_target_preview(expected_digest text NOT NULL);
CREATE TEMP TABLE restore_cross_target_sources(target_key text PRIMARY KEY,event_id uuid NOT NULL);
GRANT SELECT,INSERT ON pg_temp.restore_test_requests,pg_temp.restore_target_preview TO authenticated;
GRANT SELECT,INSERT ON pg_temp.restore_cross_target_sources TO authenticated;
GRANT SELECT ON pg_temp.restore_test_sources,pg_temp.restore_test_results TO authenticated;

CREATE FUNCTION public.test_only_restore_source(target_resume uuid,target_domain text,make_change boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE before_value jsonb; after_value jsonb; event_id uuid:=gen_random_uuid(); section_value text; entity_value text; site_value text;
BEGIN
  before_value:=cms_private.restore_current_aggregate(target_resume,target_domain);
  IF before_value IS NULL THEN RAISE EXCEPTION 'test fixture missing'; END IF;
  IF make_change THEN
    CASE target_domain
      WHEN 'awards' THEN UPDATE public.resume_award_translations SET name=name||' restore change' WHERE resume_id=target_resume AND locale='zh' AND award_entry_id=(SELECT id FROM public.resume_award_entries WHERE resume_id=target_resume ORDER BY position LIMIT 1);
      WHEN 'experience' THEN UPDATE public.resume_experience_translations SET title=title||' restore change' WHERE resume_id=target_resume AND locale='zh' AND experience_entry_id=(SELECT id FROM public.resume_experience_entries WHERE resume_id=target_resume ORDER BY position LIMIT 1);
      WHEN 'skills' THEN UPDATE public.resume_skill_group_translations SET title=title||' restore change' WHERE resume_id=target_resume AND locale='zh' AND skill_group_id=(SELECT id FROM public.resume_skill_groups WHERE resume_id=target_resume ORDER BY position LIMIT 1);
      WHEN 'education' THEN UPDATE public.resume_education_translations SET title=title||' restore change' WHERE resume_id=target_resume AND locale='zh' AND education_entry_id=(SELECT id FROM public.resume_education_entries WHERE resume_id=target_resume ORDER BY position LIMIT 1);
      WHEN 'projects' THEN UPDATE public.resume_project_translations SET title=title||' restore change' WHERE resume_id=target_resume AND locale='zh' AND project_entry_id=(SELECT id FROM public.resume_project_entries WHERE resume_id=target_resume ORDER BY position LIMIT 1);
      WHEN 'contact' THEN UPDATE public.resume_locale_content SET availability=availability||' restore change' WHERE resume_id=target_resume AND locale='zh';
      WHEN 'website_links' THEN UPDATE public.resume_public_links SET email=email||'.restore' WHERE resume_id=target_resume;
      ELSE RAISE EXCEPTION 'unsupported test domain';
    END CASE;
  END IF;
  after_value:=cms_private.restore_current_aggregate(target_resume,target_domain);
  site_value:=(SELECT site_key FROM public.resume_sites WHERE id=target_resume);
  section_value:=target_domain;
  entity_value:=CASE target_domain WHEN 'awards' THEN 'award_list' WHEN 'experience' THEN 'experience_list'
    WHEN 'skills' THEN 'skill_group_list' WHEN 'education' THEN 'education_list'
    WHEN 'projects' THEN 'project_list' WHEN 'contact' THEN 'contact_section' ELSE 'website_links_settings' END;
  IF NOT cms_private.activity_event_payload_v2_is_allowed(section_value,entity_value,NULL,'update',
    jsonb_build_object(target_domain,after_value),jsonb_build_object(target_domain,jsonb_build_object('before',before_value,'after',after_value))) THEN
    RAISE EXCEPTION 'invalid synthetic source';
  END IF;
  INSERT INTO cms_private.activity_log_events(id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
    operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
  VALUES(event_id,'10000000-0000-4000-8000-000000000002','qa@example.invalid','qa',target_resume,site_value,
    'update',section_value,entity_value,NULL,jsonb_build_object(target_domain,after_value),
    jsonb_build_object(target_domain,jsonb_build_object('before',before_value,'after',after_value)),2);
  INSERT INTO pg_temp.restore_test_sources(domain_key,event_id,historical_state) VALUES(target_domain,event_id,before_value);
  RETURN event_id;
END $f$;

CREATE FUNCTION public.test_only_restore_v1_source(target_resume uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE source_id uuid:=gen_random_uuid(); site_value text;
BEGIN
  SELECT site_key INTO site_value FROM public.resume_sites WHERE id=target_resume;
  INSERT INTO cms_private.activity_log_events(id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
    operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
  VALUES(source_id,'10000000-0000-4000-8000-000000000002','qa@example.invalid','qa',target_resume,site_value,
    'update','awards','award_entry','legacy-award',jsonb_build_object('name','old','year','2024','position',0),
    jsonb_build_object('name',jsonb_build_object('before','old','after','new')),1);
  INSERT INTO pg_temp.restore_test_sources(domain_key,event_id,historical_state) VALUES('v1',source_id,NULL);
  RETURN source_id;
END $f$;

CREATE FUNCTION public.test_only_restore_bad_identity_source(target_resume uuid,use_official_id boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE before_value jsonb; after_value jsonb; source_id uuid:=gen_random_uuid(); site_value text; replaced_id uuid;
BEGIN
  before_value:=cms_private.restore_current_aggregate(target_resume,'awards');
  after_value:=before_value;
  IF before_value IS NULL OR jsonb_array_length(before_value)=0 THEN RAISE EXCEPTION 'test fixture missing'; END IF;
  IF use_official_id THEN
    replaced_id:=gen_random_uuid();
    INSERT INTO public.resume_locale_content(resume_id,locale,education_label,experience_label,project_heading,skills_label,
      honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href)
    VALUES ('20000000-0000-4000-8000-000000000001','zh','教育','经历','项目','技能','奖项','联系','可用','作品集','','Kaggle','更新','LinkedIn',''),
      ('20000000-0000-4000-8000-000000000001','en','Education','Experience','Projects','Skills','Honors','Contact','Available','Portfolio','','Kaggle','Updated','LinkedIn','')
    ON CONFLICT(resume_id,locale) DO NOTHING;
    INSERT INTO public.resume_award_entries(id,resume_id,source_key,position)
      VALUES(replaced_id,'20000000-0000-4000-8000-000000000001',NULL,
        (SELECT COALESCE(max(position)+1,0) FROM public.resume_award_entries WHERE resume_id='20000000-0000-4000-8000-000000000001'));
    INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year)
      VALUES(replaced_id,'20000000-0000-4000-8000-000000000001','zh','Official fixture','2024'),
        (replaced_id,'20000000-0000-4000-8000-000000000001','en','Official fixture','2024');
  ELSE
    replaced_id:=gen_random_uuid();
  END IF;
  before_value:=jsonb_set(before_value,'{0,id}',to_jsonb(replaced_id::text),false);
  SELECT site_key INTO site_value FROM public.resume_sites WHERE id=target_resume;
  IF NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    jsonb_build_object('awards',after_value),jsonb_build_object('awards',jsonb_build_object('before',before_value,'after',after_value))) THEN
    RAISE EXCEPTION 'test fixture payload invalid';
  END IF;
  INSERT INTO cms_private.activity_log_events(id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
    operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
  VALUES(source_id,'10000000-0000-4000-8000-000000000002','qa@example.invalid','qa',target_resume,site_value,
    'update','awards','award_list',NULL,jsonb_build_object('awards',after_value),
    jsonb_build_object('awards',jsonb_build_object('before',before_value,'after',after_value)),2);
  INSERT INTO pg_temp.restore_test_sources(domain_key,event_id,historical_state)
    VALUES(CASE WHEN use_official_id THEN 'cross_id' ELSE 'missing_id' END,source_id,before_value);
  RETURN source_id;
END $f$;

CREATE FUNCTION public.test_only_restore_bad_project_source(target_resume uuid,bad_case text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE before_value jsonb; after_value jsonb; source_id uuid:=gen_random_uuid(); site_value text;
  first_method_id text; second_method_id text; filtered_methods jsonb;
BEGIN
  before_value:=cms_private.restore_current_aggregate(target_resume,'projects');
  IF before_value IS NULL OR jsonb_array_length(before_value)<2
    OR jsonb_array_length(before_value->0->'methods'->'zh')<1
    OR jsonb_array_length(before_value->1->'methods'->'zh')<1 THEN RAISE EXCEPTION 'test fixture missing'; END IF;
  IF bad_case='wrong_parent' THEN
    second_method_id:=before_value->1->'methods'->'zh'->0->>'id';
    before_value:=jsonb_set(before_value,'{0,methods,zh,0,id}',to_jsonb(second_method_id),false);
    SELECT COALESCE(jsonb_agg(method ORDER BY ordinal), '[]'::jsonb) INTO filtered_methods
      FROM jsonb_array_elements(before_value->1->'methods'->'zh') WITH ORDINALITY AS item(method,ordinal)
      WHERE method->>'id'<>second_method_id;
    before_value:=jsonb_set(before_value,'{1,methods,zh}',filtered_methods,false);
  ELSIF bad_case='wrong_locale' THEN
    IF jsonb_array_length(before_value->0->'methods'->'en')<1 THEN RAISE EXCEPTION 'test fixture missing'; END IF;
    first_method_id:=before_value->0->'methods'->'zh'->0->>'id';
    second_method_id:=before_value->0->'methods'->'en'->0->>'id';
    before_value:=jsonb_set(before_value,'{0,methods,zh,0,id}',to_jsonb(second_method_id),false);
    before_value:=jsonb_set(before_value,'{0,methods,en,0,id}',to_jsonb(first_method_id),false);
  ELSE RAISE EXCEPTION 'unsupported project proof case'; END IF;

  UPDATE public.resume_project_translations SET title=title||' restore proof change'
    WHERE resume_id=target_resume AND locale='zh'
      AND project_entry_id=(SELECT id FROM public.resume_project_entries WHERE resume_id=target_resume ORDER BY position LIMIT 1);
  after_value:=cms_private.restore_current_aggregate(target_resume,'projects');
  IF NOT cms_private.activity_event_payload_v2_is_allowed('projects','project_list',NULL,'update',
    jsonb_build_object('projects',after_value),jsonb_build_object('projects',jsonb_build_object('before',before_value,'after',after_value))) THEN
    RAISE EXCEPTION 'project proof source does not pass the existing V2 validator';
  END IF;
  SELECT site_key INTO site_value FROM public.resume_sites WHERE id=target_resume;
  INSERT INTO cms_private.activity_log_events(id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
    operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
  VALUES(source_id,'10000000-0000-4000-8000-000000000002','qa@example.invalid','qa',target_resume,site_value,
    'update','projects','project_list',NULL,jsonb_build_object('projects',after_value),
    jsonb_build_object('projects',jsonb_build_object('before',before_value,'after',after_value)),2);
  INSERT INTO pg_temp.restore_test_sources(domain_key,event_id,historical_state)
    VALUES('project_'||bad_case,source_id,before_value);
  RETURN source_id;
END $f$;

CREATE FUNCTION public.test_only_restore_call(target_resume uuid,source_id uuid,target_request uuid,target_digest text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE preview_value jsonb; digest_value text; domain_value text; issued bigint; context_value text; signature_value text; key_value bytea;
BEGIN
  preview_value:=public.preview_restore_v1(target_resume,source_id);
  domain_value:=preview_value->>'domain';
  SELECT r.expected_digest INTO digest_value FROM pg_temp.restore_test_requests r WHERE r.request_id=target_request;
  digest_value:=COALESCE(target_digest,digest_value,preview_value->>'expected_current_digest');
  INSERT INTO pg_temp.restore_test_requests(request_id,expected_digest,source_event_id) VALUES(target_request,digest_value,source_id)
    ON CONFLICT(request_id) DO NOTHING;
  issued:=floor(date_part('epoch',clock_timestamp()))::bigint;
  context_value:=jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1','actor_user_id',auth.uid()::text,
    'resume_id',target_resume::text,'domain',domain_value,'operation','restore','request_id',target_request::text,
    'source_event_id',source_id::text,'expected_current_digest',digest_value,'issued_at',issued,'expires_at',issued+180)::text;
  key_value:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
  signature_value:=encode(extensions.hmac(convert_to(context_value,'UTF8'),key_value,'sha256'),'hex');
  RETURN public.restore_domain_v1(target_resume,source_id,digest_value,target_request,context_value,signature_value);
END $f$;

CREATE FUNCTION public.test_only_restore_state(target_resume uuid,source_id uuid,target_request uuid,target_digest text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN PERFORM public.test_only_restore_call(target_resume,source_id,target_request,target_digest); RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $f$;
CREATE FUNCTION public.test_only_restore_domain(target_resume uuid,target_domain text,target_request uuid,make_change boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE source_id uuid; expected_value jsonb; before_event_count bigint; after_event_count bigint;
  before_link_count bigint; after_link_count bigint; before_source_keys jsonb; after_source_keys jsonb; response jsonb;
BEGIN
  source_id:=public.test_only_restore_source(target_resume,target_domain,make_change);
  SELECT historical_state INTO expected_value FROM pg_temp.restore_test_sources WHERE event_id=source_id;
  SELECT count(*) INTO before_event_count FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain;
  SELECT count(*) INTO before_link_count FROM cms_private.activity_log_restore_links WHERE resume_id=target_resume;
  IF target_domain='awards' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'source_key',source_key) ORDER BY position),'[]'::jsonb)
      INTO before_source_keys FROM public.resume_award_entries WHERE resume_id=target_resume;
  ELSIF target_domain='projects' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'source_key',source_key) ORDER BY position),'[]'::jsonb)
      INTO before_source_keys FROM public.resume_project_entries WHERE resume_id=target_resume;
  END IF;
  response:=public.test_only_restore_call(target_resume,source_id,target_request);
  SELECT count(*) INTO after_event_count FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain;
  SELECT count(*) INTO after_link_count FROM cms_private.activity_log_restore_links WHERE resume_id=target_resume;
  IF target_domain='awards' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'source_key',source_key) ORDER BY position),'[]'::jsonb)
      INTO after_source_keys FROM public.resume_award_entries WHERE resume_id=target_resume;
  ELSIF target_domain='projects' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'source_key',source_key) ORDER BY position),'[]'::jsonb)
      INTO after_source_keys FROM public.resume_project_entries WHERE resume_id=target_resume;
  END IF;
  response:=response || jsonb_build_object('test_event_delta',after_event_count-before_event_count,
    'test_link_delta',after_link_count-before_link_count,
    'test_aggregate_matches_source',public.test_only_restore_current(target_resume,target_domain)=expected_value,
    'test_source_key_preserved',CASE WHEN target_domain IN('awards','projects') THEN before_source_keys IS NOT DISTINCT FROM after_source_keys ELSE NULL END);
  INSERT INTO pg_temp.restore_test_results(request_id,result_value) VALUES(target_request,response);
  RETURN response;
END $f$;

CREATE FUNCTION public.test_only_restore_current(target_resume uuid,target_domain text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT cms_private.restore_current_aggregate(target_resume,target_domain) $f$;
CREATE FUNCTION public.test_only_restore_event_count(target_resume uuid,target_domain text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain AND payload_version=2 $f$;
CREATE FUNCTION public.test_only_restore_link_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT count(*) FROM cms_private.activity_log_restore_links WHERE resume_id=target_resume $f$;
CREATE FUNCTION public.test_only_restore_ledger_count(target_resume uuid,target_request uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT count(*) FROM cms_private.activity_log_idempotency WHERE resume_id=target_resume AND request_id=target_request AND completed_at IS NOT NULL $f$;
CREATE FUNCTION public.test_only_restore_counts(target_resume uuid,target_domain text)
RETURNS TABLE(event_count bigint,link_count bigint) LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT (SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain),
  (SELECT count(*) FROM cms_private.activity_log_restore_links WHERE resume_id=target_resume) $f$;
CREATE FUNCTION public.test_only_restore_snapshot(target_resume uuid,target_domain text,target_request uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT jsonb_build_object('current',cms_private.restore_current_aggregate(target_resume,target_domain),
  'events',(SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key=target_domain),
  'links',(SELECT count(*) FROM cms_private.activity_log_restore_links WHERE resume_id=target_resume),
  'ledger',(SELECT count(*) FROM cms_private.activity_log_idempotency WHERE resume_id=target_resume AND request_id=target_request)) $f$;

REVOKE ALL ON FUNCTION public.test_only_restore_source(uuid,text,boolean),public.test_only_restore_call(uuid,uuid,uuid,text),
  public.test_only_restore_v1_source(uuid),public.test_only_restore_bad_identity_source(uuid,boolean),
  public.test_only_restore_bad_project_source(uuid,text),
  public.test_only_restore_state(uuid,uuid,uuid,text),public.test_only_restore_domain(uuid,text,uuid,boolean),public.test_only_restore_current(uuid,text),
  public.test_only_restore_event_count(uuid,text),public.test_only_restore_link_count(uuid),
  public.test_only_restore_ledger_count(uuid,uuid),public.test_only_restore_counts(uuid,text),public.test_only_restore_snapshot(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_restore_source(uuid,text,boolean),public.test_only_restore_call(uuid,uuid,uuid,text),
  public.test_only_restore_v1_source(uuid),public.test_only_restore_bad_identity_source(uuid,boolean),
  public.test_only_restore_bad_project_source(uuid,text),
  public.test_only_restore_state(uuid,uuid,uuid,text),public.test_only_restore_domain(uuid,text,uuid,boolean),public.test_only_restore_current(uuid,text),
  public.test_only_restore_event_count(uuid,text),public.test_only_restore_link_count(uuid),
  public.test_only_restore_ledger_count(uuid,uuid),public.test_only_restore_counts(uuid,text),public.test_only_restore_snapshot(uuid,text,uuid) TO authenticated;

SELECT extensions.plan(49);
SELECT extensions.ok(to_regprocedure('public.preview_restore_v1(uuid,uuid)') IS NOT NULL
  AND to_regprocedure('public.restore_domain_v1(uuid,uuid,text,uuid,text,text)') IS NOT NULL,
  'Restore V1 preview and mutation RPCs are installed');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM cms_private.resume_capabilities WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='restore'),
  'Restore capability is absent and therefore disabled by default');
SELECT extensions.ok(NOT has_function_privilege('anon','public.preview_restore_v1(uuid,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.preview_restore_v1(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.restore_domain_v1(uuid,uuid,text,uuid,text,text)','EXECUTE'),
  'browser execution is authenticated-only and service role has no RPC grant');
SELECT extensions.ok(NOT has_table_privilege('authenticated','cms_private.activity_log_restore_links','SELECT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_restore_links','INSERT'),
  'authenticated callers have no direct access to private restore linkage');
SELECT extensions.ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.preview_restore_v1(uuid,uuid)'::regprocedure)
  AND (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc WHERE oid='public.restore_domain_v1(uuid,uuid,text,uuid,text,text)'::regprocedure),
  'both browser RPCs are SECURITY DEFINER with empty search_path');
SELECT extensions.ok(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
  '{"awards":"malformed"}'::jsonb,'{"awards":{"before":[],"after":"malformed"}}'::jsonb),
  'malformed known V2 aggregate fails the existing strict validator');
SELECT extensions.ok(NOT cms_private.activity_event_payload_version_is_allowed(99::smallint,'awards'::text,'award_list'::text,NULL::text,'update'::text,
  '{"awards":[]}'::jsonb,'{"awards":{"before":[],"after":[]}}'::jsonb),
  'unknown future payload version fails closed');
SELECT extensions.ok(cms_private.restore_domain_for_event('profile','profile_settings',NULL) IS NULL
  AND cms_private.restore_domain_for_event('files','resume_file_set',NULL) IS NULL,
  'Profile and Files events are excluded from generic Restore V1');

-- A real eligible source exists, but capability is still absent at this point.
SELECT public.test_only_restore_source('ea111111-1111-4111-8111-111111111111','awards',true);
SELECT public.test_only_restore_v1_source('ea111111-1111-4111-8111-111111111111');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT extensions.throws_ok(
  $$SELECT public.preview_restore_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='awards' ORDER BY created_seq LIMIT 1))$$,
  '42501',NULL,'anonymous callers cannot execute the preview RPC');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.throws_ok(
  $$SELECT public.preview_restore_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='awards' ORDER BY created_seq LIMIT 1))$$,
  '42501',NULL,'missing Restore capability fails closed');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT extensions.throws_ok(
  $$SELECT public.preview_restore_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='awards' ORDER BY created_seq LIMIT 1))$$,
  '42501',NULL,'authenticated user without target authorization is denied');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.throws_ok(
  $$SELECT public.preview_restore_v1('20000000-0000-4000-8000-000000000001',gen_random_uuid())$$,
  '42501',NULL,'Official Activity Log capability disabled blocks its owner');
RESET ROLE;

-- TEST ONLY: enable an isolated Official-like target so one authorized owner can
-- compare two target identities and prove a QA preview digest cannot cross targets.
INSERT INTO public.resume_award_entries(id,resume_id,source_key,position)
VALUES('ea000000-0000-4000-8000-000000000930','20000000-0000-4000-8000-000000000001','restore-target-bind','0');
INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year)
VALUES('ea000000-0000-4000-8000-000000000930','20000000-0000-4000-8000-000000000001','zh','Target binding fixture','2024'),
  ('ea000000-0000-4000-8000-000000000930','20000000-0000-4000-8000-000000000001','en','Target binding fixture','2024');
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
VALUES('20000000-0000-4000-8000-000000000001','awards','rpc')
ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='rpc';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
VALUES('20000000-0000-4000-8000-000000000001','awards','trusted_network_context_v11',true)
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES('20000000-0000-4000-8000-000000000001','activity_log',true),
  ('20000000-0000-4000-8000-000000000001','restore',true)
ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;

UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111'
 AND domain_key IN ('awards','experience','skills','education','projects','contact','website_links');
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
SELECT 'ea111111-1111-4111-8111-111111111111',d,'trusted_network_context_v11',true
FROM unnest(ARRAY['awards','experience','skills','education','projects','contact','website_links']) d
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','restore',true);

-- TEST ONLY: the existing QA fixture contains one Project. Add one more local
-- project with both locales so historical method parent/locale checks are exercised.
INSERT INTO public.resume_project_entries(id,resume_id,source_key,position)
VALUES('ea000000-0000-4000-8000-000000000921','ea111111-1111-4111-8111-111111111111','restore-project-proof','1');
INSERT INTO public.resume_project_translations(project_entry_id,resume_id,locale,title,subtitle,period,description,href)
VALUES('ea000000-0000-4000-8000-000000000921','ea111111-1111-4111-8111-111111111111','zh','Restore proof project','subtitle','period','description',''),
  ('ea000000-0000-4000-8000-000000000921','ea111111-1111-4111-8111-111111111111','en','Restore proof project','subtitle','period','description','');
INSERT INTO public.resume_project_methods(id,resume_id,project_entry_id,locale,position,value)
VALUES('ea000000-0000-4000-8000-000000000922','ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000921','zh','0','zh method'),
  ('ea000000-0000-4000-8000-000000000923','ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000921','en','0','en method');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.ok(public.can_manage_resume('ea111111-1111-4111-8111-111111111111')
  AND public.can_manage_resume('20000000-0000-4000-8000-000000000001')
  AND cms_private.restore_expected_digest('ea111111-1111-4111-8111-111111111111','awards',
    cms_private.restore_current_aggregate('ea111111-1111-4111-8111-111111111111','awards'))
    <> cms_private.restore_expected_digest('20000000-0000-4000-8000-000000000001','awards',
      cms_private.restore_current_aggregate('ea111111-1111-4111-8111-111111111111','awards')),
  'two authorized targets produce different digests for identical domain and canonical state');
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.restore_cross_target_sources(target_key,event_id)
  VALUES('qa',public.test_only_restore_source('ea111111-1111-4111-8111-111111111111','awards',false)),
    ('official',public.test_only_restore_source('20000000-0000-4000-8000-000000000001','awards',true));
INSERT INTO pg_temp.restore_target_preview(expected_digest)
SELECT preview_value->>'expected_current_digest'
FROM (SELECT public.preview_restore_v1('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_cross_target_sources WHERE target_key='qa')) AS preview_value) preview;
CREATE TEMP TABLE restore_cross_target_before AS
  SELECT public.test_only_restore_snapshot('20000000-0000-4000-8000-000000000001','awards','ea000000-0000-4000-8000-000000000912') AS snapshot;
GRANT SELECT ON pg_temp.restore_cross_target_before TO authenticated;
SELECT extensions.isnt(public.test_only_restore_state('20000000-0000-4000-8000-000000000001',
  (SELECT event_id FROM pg_temp.restore_cross_target_sources WHERE target_key='official'),
  'ea000000-0000-4000-8000-000000000912',(SELECT expected_digest FROM pg_temp.restore_target_preview)),
  '00000','a preview token from QA is rejected for the authorized Official-like target');
SELECT extensions.is(public.test_only_restore_snapshot('20000000-0000-4000-8000-000000000001','awards','ea000000-0000-4000-8000-000000000912'),
  (SELECT snapshot FROM pg_temp.restore_cross_target_before),'cross-target digest rejection has zero content, event, link, or ledger effects');
-- Restore the Official-like target's test-only configuration before later isolation assertions.
RESET ROLE;
DELETE FROM cms_private.resume_capabilities
WHERE resume_id='20000000-0000-4000-8000-000000000001' AND capability_key IN ('activity_log','restore');
DELETE FROM cms_private.resume_domain_requirements
WHERE resume_id='20000000-0000-4000-8000-000000000001' AND domain_key='awards' AND requirement_key='trusted_network_context_v11';
UPDATE cms_private.resume_write_modes SET write_mode='direct'
WHERE resume_id='20000000-0000-4000-8000-000000000001' AND domain_key='awards';
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',gen_random_uuid(),gen_random_uuid()),'00000',
  'nonexistent/cross-target source does not return a result');
SELECT extensions.isnt(public.test_only_restore_state('20000000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid()),'00000',
  'QA admin cannot preview or mutate Official target');
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='v1'),gen_random_uuid()),'00000',
  'V1 source events are not restorable');
SELECT public.test_only_restore_bad_identity_source('ea111111-1111-4111-8111-111111111111',false);
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='missing_id'),gen_random_uuid()),'00000',
  'missing historical entity identity is rejected');
SELECT public.test_only_restore_bad_identity_source('ea111111-1111-4111-8111-111111111111',true);
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='cross_id'),gen_random_uuid()),'00000',
  'cross-target historical identity collision is rejected');
SELECT public.test_only_restore_bad_project_source('ea111111-1111-4111-8111-111111111111','wrong_parent');
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='project_wrong_parent'),gen_random_uuid()),'00000',
  'Project method ID belonging to another project parent is rejected');
SELECT public.test_only_restore_bad_project_source('ea111111-1111-4111-8111-111111111111','wrong_locale');
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='project_wrong_locale'),gen_random_uuid()),'00000',
  'Project method ID belonging to another locale is rejected');
RESET ROLE;
WITH current_state AS (
  SELECT cms_private.restore_current_aggregate('ea111111-1111-4111-8111-111111111111','projects') AS value
), malformed AS (
  SELECT value,jsonb_set(value,'{0,methods,zh,1,id}',value->0->'methods'->'zh'->0->'id',false) AS duplicate_value
  FROM current_state
)
SELECT extensions.ok(NOT cms_private.activity_event_payload_v2_is_allowed('projects','project_list',NULL,'update',
  jsonb_build_object('projects',value),jsonb_build_object('projects',jsonb_build_object('before',duplicate_value,'after',value))),
  'existing Project V2 validator rejects duplicate method identity in historical structure')
FROM malformed;
SET LOCAL ROLE authenticated;

-- Every supported domain is exercised through a real authenticated SQL RPC.
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','awards','ea000000-0000-4000-8000-000000000901')->>'status','restored','Awards V2 BEFORE state restores successfully');
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','experience','ea000000-0000-4000-8000-000000000902')->>'status','restored','Experience V2 BEFORE state restores successfully');
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','skills','ea000000-0000-4000-8000-000000000903')->>'status','restored','Skills V2 BEFORE state restores successfully');
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','education','ea000000-0000-4000-8000-000000000904')->>'status','restored','Education V2 BEFORE state restores successfully');
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','projects','ea000000-0000-4000-8000-000000000905')->>'status','restored','Projects and nested method IDs restore successfully');
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','contact','ea000000-0000-4000-8000-000000000906')->>'status','restored','Contact V2 BEFORE state restores successfully');
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','website_links','ea000000-0000-4000-8000-000000000907')->>'status','restored','Website & Links fixed navigation identity/order restore successfully');
SELECT extensions.ok((SELECT bool_and(result_value->>'test_event_delta'='1' AND result_value->>'test_link_delta'='1')
  FROM pg_temp.restore_test_results WHERE request_id BETWEEN 'ea000000-0000-4000-8000-000000000901'::uuid AND 'ea000000-0000-4000-8000-000000000907'::uuid),
  'each supported restore creates exactly one V2 event and one source link');
SELECT extensions.ok((SELECT bool_and(result_value->>'test_aggregate_matches_source'='true')
  FROM pg_temp.restore_test_results WHERE request_id BETWEEN 'ea000000-0000-4000-8000-000000000901'::uuid AND 'ea000000-0000-4000-8000-000000000907'::uuid),
  'all domains preserve the exact historical aggregate, locale values, and order');
SELECT extensions.ok((SELECT bool_and(result_value->>'test_source_key_preserved'='true')
  FROM pg_temp.restore_test_results WHERE request_id IN ('ea000000-0000-4000-8000-000000000901','ea000000-0000-4000-8000-000000000905')),
  'Awards and Projects preserve existing source-key provenance');
SELECT extensions.is(public.test_only_restore_link_count('ea111111-1111-4111-8111-111111111111'),7::bigint,
  'each successful domain restore creates exactly one private source link');
SELECT extensions.is((SELECT sum(public.test_only_restore_ledger_count('ea111111-1111-4111-8111-111111111111',request_id))::bigint
  FROM unnest(ARRAY['ea000000-0000-4000-8000-000000000901','ea000000-0000-4000-8000-000000000902','ea000000-0000-4000-8000-000000000903',
    'ea000000-0000-4000-8000-000000000904','ea000000-0000-4000-8000-000000000905','ea000000-0000-4000-8000-000000000906','ea000000-0000-4000-8000-000000000907']::uuid[]) request_id),7::bigint,
  'each successful domain restore completes exactly one existing idempotency row');

-- Restore-of-Restore, exact replay, and mismatched request binding.
SELECT extensions.is(public.test_only_restore_domain('ea111111-1111-4111-8111-111111111111','awards','ea000000-0000-4000-8000-000000000908')->>'status','restored',
  'Restore-generated V2 update is eligible for Restore-of-Restore');
SELECT extensions.is(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT source_event_id FROM pg_temp.restore_test_requests WHERE request_id='ea000000-0000-4000-8000-000000000901'),
  'ea000000-0000-4000-8000-000000000901'), '00000', 'exact request retry returns the cached Restore result');
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT source_event_id FROM pg_temp.restore_test_requests WHERE request_id='ea000000-0000-4000-8000-000000000901'),
  'ea000000-0000-4000-8000-000000000901',repeat('a',64)), '00000', 'same request ID with a different expected digest is rejected');

-- No-op is terminal and creates neither a content event nor a source link.
SELECT public.test_only_restore_source('ea111111-1111-4111-8111-111111111111','contact',false);
CREATE TEMP TABLE restore_noop_counts AS
  SELECT * FROM public.test_only_restore_counts('ea111111-1111-4111-8111-111111111111','contact');
GRANT SELECT ON pg_temp.restore_noop_counts TO authenticated;
SELECT extensions.is(public.test_only_restore_call('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='contact' ORDER BY created_seq DESC LIMIT 1),
  'ea000000-0000-4000-8000-000000000909')->>'status','no_change', 'canonical equality is returned as no_change');
SELECT extensions.is((SELECT count(DISTINCT event_count) FROM pg_temp.restore_noop_counts),1::bigint,
  'no_change does not append a Files-independent contact event');
SELECT extensions.is((SELECT count(DISTINCT link_count) FROM pg_temp.restore_noop_counts),1::bigint,
  'no_change does not create a source link');
SELECT extensions.is(public.test_only_restore_ledger_count('ea111111-1111-4111-8111-111111111111','ea000000-0000-4000-8000-000000000909'),1::bigint,
  'no_change is terminally bound in the existing idempotency ledger');

-- Stale preview digest and a post-writer failure both leave all domain/audit state unchanged.
SELECT public.test_only_restore_source('ea111111-1111-4111-8111-111111111111','awards',true);
CREATE TEMP TABLE restore_stale_before AS SELECT public.test_only_restore_snapshot('ea111111-1111-4111-8111-111111111111','awards','ea000000-0000-4000-8000-000000000910') AS snapshot;
GRANT SELECT ON pg_temp.restore_stale_before TO authenticated;
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='awards' ORDER BY created_seq DESC LIMIT 1),
  'ea000000-0000-4000-8000-000000000910',repeat('a',64)),'00000','stale expected-current digest is rejected');
SELECT extensions.is(public.test_only_restore_snapshot('ea111111-1111-4111-8111-111111111111','awards','ea000000-0000-4000-8000-000000000910'),
  (SELECT snapshot FROM pg_temp.restore_stale_before),'stale digest conflict has zero content, event, link, or ledger effects');

SELECT public.test_only_restore_source('ea111111-1111-4111-8111-111111111111','awards',true);
CREATE TEMP TABLE restore_rollback_before AS SELECT public.test_only_restore_snapshot('ea111111-1111-4111-8111-111111111111','awards','ea000000-0000-4000-8000-000000000911') AS snapshot;
GRANT SELECT ON pg_temp.restore_rollback_before TO authenticated;
RESET ROLE;
CREATE FUNCTION public.test_only_reject_restore_link() RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $f$ BEGIN RAISE EXCEPTION 'forced test-only linkage failure' USING ERRCODE='55000'; END $f$;
CREATE TRIGGER test_only_reject_restore_link BEFORE INSERT ON cms_private.activity_log_restore_links
  FOR EACH ROW EXECUTE FUNCTION public.test_only_reject_restore_link();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.isnt(public.test_only_restore_state('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.restore_test_sources WHERE domain_key='awards' ORDER BY created_seq DESC LIMIT 1),
  'ea000000-0000-4000-8000-000000000911'),'00000','forced post-writer linkage failure aborts the Restore transaction');
RESET ROLE;
DROP TRIGGER test_only_reject_restore_link ON cms_private.activity_log_restore_links;
DROP FUNCTION public.test_only_reject_restore_link();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.is(public.test_only_restore_snapshot('ea111111-1111-4111-8111-111111111111','awards','ea000000-0000-4000-8000-000000000911'),
  (SELECT snapshot FROM pg_temp.restore_rollback_before),'post-writer failure rolls back content, V2 event, linkage, and idempotency');

RESET ROLE;
SELECT extensions.throws_ok(
  $$INSERT INTO cms_private.activity_log_restore_links(result_event_id,source_event_id,resume_id,domain_key)
    SELECT (result_value->>'result_event_id')::uuid,source_event_id,'20000000-0000-4000-8000-000000000001','awards'
    FROM pg_temp.restore_test_results r JOIN pg_temp.restore_test_requests q USING(request_id)
    WHERE r.request_id='ea000000-0000-4000-8000-000000000901'$$,
  '23514',NULL,'private source linkage trigger rejects a cross-target link');
SELECT extensions.ok(to_regclass('cms_private.restore_v1_idempotency') IS NULL,
  'Restore introduces no separately exposed idempotency table');
SELECT extensions.ok(NOT EXISTS(SELECT 1 FROM cms_private.resume_capabilities WHERE resume_id='20000000-0000-4000-8000-000000000001' AND capability_key='restore'),
  'Official Restore capability remains absent and disabled');
SELECT * FROM extensions.finish();
ROLLBACK;
