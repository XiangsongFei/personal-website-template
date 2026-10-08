-- TEST ONLY: authenticated replay-safe Restore domain resolution in the isolated runtime lab.
BEGIN;

CREATE TEMP TABLE resolver_test_sources(label text PRIMARY KEY, event_id uuid NOT NULL);
CREATE TEMP TABLE resolver_test_target(official_resume_id uuid NOT NULL);
GRANT SELECT ON pg_temp.resolver_test_sources, pg_temp.resolver_test_target TO authenticated;

CREATE FUNCTION public.test_only_resolver_v2_source(target_resume uuid, target_domain text, site_override text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $test$
DECLARE current_value jsonb; source_id uuid := pg_catalog.gen_random_uuid(); site_value text;
  entity_value text;
BEGIN
  current_value := cms_private.restore_current_aggregate(target_resume, target_domain);
  IF current_value IS NULL THEN RAISE EXCEPTION 'resolver test fixture aggregate missing'; END IF;
  entity_value := CASE target_domain WHEN 'awards' THEN 'award_list' WHEN 'experience' THEN 'experience_list'
    WHEN 'skills' THEN 'skill_group_list' WHEN 'education' THEN 'education_list'
    WHEN 'projects' THEN 'project_list' WHEN 'contact' THEN 'contact_section'
    WHEN 'website_links' THEN 'website_links_settings' ELSE NULL END;
  IF entity_value IS NULL OR NOT cms_private.activity_event_payload_v2_is_allowed(
    target_domain, entity_value, NULL, 'update', pg_catalog.jsonb_build_object(target_domain,current_value),
    pg_catalog.jsonb_build_object(target_domain,pg_catalog.jsonb_build_object('before',current_value,'after',current_value))) THEN
    RAISE EXCEPTION 'resolver test fixture payload invalid';
  END IF;
  SELECT site.site_key INTO site_value FROM public.resume_sites AS site WHERE site.id=target_resume;
  INSERT INTO cms_private.activity_log_events(id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
    operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
  VALUES(source_id,'10000000-0000-4000-8000-000000000002','qa@example.invalid','qa',target_resume,
    COALESCE(site_override,site_value),'update',target_domain,entity_value,NULL,
    pg_catalog.jsonb_build_object(target_domain,current_value),
    pg_catalog.jsonb_build_object(target_domain,pg_catalog.jsonb_build_object('before',current_value,'after',current_value)),2);
  RETURN source_id;
END
$test$;

CREATE FUNCTION public.test_only_resolver_v1_source(target_resume uuid, target_section text, target_entity text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $test$
DECLARE source_id uuid := pg_catalog.gen_random_uuid(); site_value text; snapshot_value jsonb; changes_value jsonb;
  entity_id_value text := 'legacy-v1';
BEGIN
  SELECT site.site_key INTO site_value FROM public.resume_sites AS site WHERE site.id=target_resume;
  CASE target_entity
    WHEN 'award_entry' THEN snapshot_value:='{"position":0,"name":"legacy","year":"2024"}'::jsonb;
      changes_value:='{"name":{"before":"legacy","after":"new"}}'::jsonb;
    WHEN 'resume_file' THEN snapshot_value:='{"locale":"zh","object_key":"legacy/zh.pdf","file_name":"legacy.pdf","content_type":"application/pdf","size_bytes":1}'::jsonb;
      changes_value:='{"object_key":{"before":"old","after":"new"}}'::jsonb;
    WHEN 'profile_image' THEN snapshot_value:='{"object_key":"profile/old.png","file_name":"old.png","content_type":"image/png","size_bytes":1}'::jsonb;
      changes_value:='{"object_key":{"before":"old","after":"new"}}'::jsonb;
    WHEN 'profile_settings' THEN snapshot_value:='{"footer_name":"legacy"}'::jsonb;
      changes_value:='{"footer_name":{"before":"legacy","after":"new"}}'::jsonb;
    WHEN 'introduction_paragraph' THEN snapshot_value:='{"position":0,"text":"legacy"}'::jsonb;
      changes_value:='{"text":{"before":"legacy","after":"new"}}'::jsonb;
    ELSE RAISE EXCEPTION 'unsupported V1 test entity';
  END CASE;
  INSERT INTO cms_private.activity_log_events(id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
    operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
  VALUES(source_id,'10000000-0000-4000-8000-000000000002','qa@example.invalid','qa',target_resume,site_value,
    'update',target_section,target_entity,entity_id_value,snapshot_value,changes_value,1);
  RETURN source_id;
END
$test$;

REVOKE ALL ON FUNCTION public.test_only_resolver_v2_source(uuid,text,text),
  public.test_only_resolver_v1_source(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- All mutations below are confined to the isolated test transaction and roll back at the end.
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
SELECT 'ea111111-1111-4111-8111-111111111111',capability_key,true
FROM (VALUES ('activity_log'),('restore')) AS enabled(capability_key)
ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
SELECT 'ea111111-1111-4111-8111-111111111111',domain_key,'rpc'
FROM (VALUES ('awards'),('experience'),('skills'),('education'),('projects'),('contact'),('website_links')) AS domains(domain_key)
ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='rpc';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
SELECT 'ea111111-1111-4111-8111-111111111111',domain_key,'trusted_network_context_v11',true
FROM (VALUES ('awards'),('experience'),('skills'),('education'),('projects'),('contact'),('website_links')) AS domains(domain_key)
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;

INSERT INTO pg_temp.resolver_test_sources VALUES
  ('awards',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','awards')),
  ('experience',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','experience')),
  ('skills',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','skills')),
  ('education',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','education')),
  ('projects',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','projects')),
  ('contact',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','contact')),
  ('website_links',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','website_links')),
  ('wrong_site',public.test_only_resolver_v2_source('ea111111-1111-4111-8111-111111111111','awards','example-cv')),
  ('v1_awards',public.test_only_resolver_v1_source('ea111111-1111-4111-8111-111111111111','awards','award_entry')),
  ('files',public.test_only_resolver_v1_source('ea111111-1111-4111-8111-111111111111','files','resume_file')),
  ('profile',public.test_only_resolver_v1_source('ea111111-1111-4111-8111-111111111111','profile','profile_settings')),
  ('photo',public.test_only_resolver_v1_source('ea111111-1111-4111-8111-111111111111','files','profile_image')),
  ('introduction',public.test_only_resolver_v1_source('ea111111-1111-4111-8111-111111111111','introduction','introduction_paragraph'));

-- V2 table constraints normally reject these malformed rows. Relax only the local
-- transaction's checks so the resolver's own fail-closed validation is exercised.
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_payload_allowlist_check;
INSERT INTO pg_temp.resolver_test_sources VALUES
  ('malformed_v2',pg_catalog.gen_random_uuid()),
  ('unsupported_domain',pg_catalog.gen_random_uuid()),
  ('unsupported_operation',pg_catalog.gen_random_uuid());
INSERT INTO cms_private.activity_log_events(id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
  operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
SELECT event_id,'10000000-0000-4000-8000-000000000002','qa@example.invalid','qa',
  'ea111111-1111-4111-8111-111111111111','example-cv-qa',
  CASE label WHEN 'unsupported_operation' THEN 'delete' ELSE 'update' END,
  CASE label WHEN 'unsupported_domain' THEN 'introduction' ELSE 'awards' END,
  CASE label WHEN 'unsupported_domain' THEN 'introduction_paragraph' ELSE 'award_list' END,
  CASE label WHEN 'unsupported_domain' THEN 'legacy-introduction' ELSE NULL END,
  CASE label WHEN 'malformed_v2' THEN '{"awards":"bad"}'::jsonb ELSE '{"awards":[]}'::jsonb END,
  CASE label WHEN 'malformed_v2' THEN '{"awards":{"before":[],"after":"bad"}}'::jsonb
    WHEN 'unsupported_domain' THEN '{"introduction":{"before":[],"after":[]}}'::jsonb
    ELSE '{"awards":{"before":[],"after":[]}}'::jsonb END,
  2
FROM pg_temp.resolver_test_sources WHERE label IN ('malformed_v2','unsupported_domain','unsupported_operation');

INSERT INTO pg_temp.resolver_test_sources VALUES ('system_event',pg_catalog.gen_random_uuid());
INSERT INTO cms_private.activity_log_system_events(event_id,occurred_at,resume_id,site_key_snapshot,event_kind,outcome,
  section_key,operation,system_event_key)
SELECT event_id,pg_catalog.transaction_timestamp(),'ea111111-1111-4111-8111-111111111111','example-cv-qa',
  'system_change','applied',NULL,NULL,'resume_published'
FROM pg_temp.resolver_test_sources WHERE label='system_event';

SELECT extensions.plan(32);
SELECT extensions.ok(to_regprocedure('public.resolve_restore_domain_v1(uuid,uuid)') IS NOT NULL
  AND pg_catalog.pg_get_function_result('public.resolve_restore_domain_v1(uuid,uuid)'::regprocedure)='text',
  'resolver exists with the exact scalar text contract');
SELECT extensions.ok((SELECT procedure_row.prosecdef AND procedure_row.proconfig @> ARRAY['search_path=""']
    AND pg_catalog.pg_get_userbyid(procedure_row.proowner)='postgres'
  FROM pg_catalog.pg_proc AS procedure_row WHERE procedure_row.oid='public.resolve_restore_domain_v1(uuid,uuid)'::regprocedure),
  'resolver is SECURITY DEFINER, empty-search-path, and follows the migration owner convention');
SELECT extensions.ok(has_function_privilege('authenticated','public.resolve_restore_domain_v1(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.resolve_restore_domain_v1(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.resolve_restore_domain_v1(uuid,uuid)','EXECUTE'),
  'authenticated can execute while anon and service_role cannot');
SELECT extensions.ok(NOT has_table_privilege('authenticated','cms_private.activity_log_events','SELECT')
  AND NOT has_function_privilege('authenticated','cms_private.restore_domain_for_event(text,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb)','EXECUTE'),
  'resolver grants no direct private-table or helper access to browser roles');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards')),'awards','awards source resolves to its scalar domain');
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='experience')),'experience','experience source resolves to its scalar domain');
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='skills')),'skills','skills source resolves to its scalar domain');
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='education')),'education','education source resolves to its scalar domain');
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='projects')),'projects','projects source resolves to its scalar domain');
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='contact')),'contact','contact source resolves to its scalar domain');
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='website_links')),'website_links','Website & Links source resolves to its exact frozen domain key');

RESET ROLE;
DELETE FROM public.resume_award_translations AS translation
WHERE translation.resume_id='ea111111-1111-4111-8111-111111111111' AND translation.locale='en'
  AND translation.award_entry_id=(SELECT entry.id FROM public.resume_award_entries AS entry
    WHERE entry.resume_id=translation.resume_id ORDER BY entry.position LIMIT 1);
SELECT extensions.ok(NOT cms_private.restore_current_aggregate_is_complete('ea111111-1111-4111-8111-111111111111','awards',
  cms_private.restore_current_aggregate('ea111111-1111-4111-8111-111111111111','awards')),
  'the same current Awards aggregate is independently known to be incomplete');
SET LOCAL ROLE authenticated;
SELECT extensions.is(public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',
  (SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards')),'awards',
  'resolver remains available when current Awards aggregate is incomplete');
SELECT extensions.throws_ok(
  $$SELECT public.preview_restore_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '22023',NULL,'full Preview rejects the same current aggregate as ineligible');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SET LOCAL ROLE anon;
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '42501',NULL,'anonymous caller cannot execute the resolver');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '42501',NULL,'authenticated non-admin cannot resolve a target source');

RESET ROLE;
UPDATE public.cms_admins SET role='owner',resume_id=NULL WHERE user_id='10000000-0000-4000-8000-000000000002';
INSERT INTO pg_temp.resolver_test_target
SELECT site.id FROM public.resume_sites AS site WHERE site.site_key='example-cv';
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
SELECT official_resume_id,capability_key,true FROM pg_temp.resolver_test_target CROSS JOIN (VALUES ('activity_log'),('restore')) AS caps(capability_key)
ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
SELECT official_resume_id,'awards','rpc' FROM pg_temp.resolver_test_target
ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode='rpc';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
SELECT official_resume_id,'awards','trusted_network_context_v11',true FROM pg_temp.resolver_test_target
ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=true;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1((SELECT official_resume_id FROM pg_temp.resolver_test_target),(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '22023',NULL,'authorized owner cannot pair a QA source event with the Official target');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1(pg_catalog.gen_random_uuid(),(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '42501',NULL,'invalid target is rejected before source resolution');

SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='wrong_site'))$$,
  '22023',NULL,'cross-site source snapshot is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='v1_awards'))$$,
  '22023',NULL,'V1 source is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='files'))$$,
  '22023',NULL,'Files source is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='profile'))$$,
  '22023',NULL,'Profile source is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='photo'))$$,
  '22023',NULL,'Profile photo source is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='introduction'))$$,
  '22023',NULL,'Introduction source is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='unsupported_domain'))$$,
  '22023',NULL,'unknown V2 source mapping is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='unsupported_operation'))$$,
  '22023',NULL,'non-update V2 operation is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='malformed_v2'))$$,
  '22023',NULL,'malformed V2 payload is rejected');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',pg_catalog.gen_random_uuid())$$,
  '22023',NULL,'missing source is rejected without a detailed error');
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='system_event'))$$,
  '22023',NULL,'system event stored in its separate table cannot resolve as a Restore source');

RESET ROLE;
DELETE FROM cms_private.resume_capabilities WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='restore';
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '42501',NULL,'disabled Restore capability blocks source resolution');
RESET ROLE;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES('ea111111-1111-4111-8111-111111111111','restore',true)
ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;
UPDATE cms_private.resume_write_modes SET write_mode='direct'
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='awards';
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '42501',NULL,'direct write mode blocks source resolution');
RESET ROLE;
UPDATE cms_private.resume_write_modes SET write_mode='rpc'
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='awards';
UPDATE cms_private.resume_domain_requirements SET enabled=false
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='awards' AND requirement_key='trusted_network_context_v11';
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT public.resolve_restore_domain_v1('ea111111-1111-4111-8111-111111111111',(SELECT event_id FROM pg_temp.resolver_test_sources WHERE label='awards'))$$,
  '42501',NULL,'disabled trusted-context requirement blocks source resolution');

SELECT * FROM extensions.finish();
ROLLBACK;
