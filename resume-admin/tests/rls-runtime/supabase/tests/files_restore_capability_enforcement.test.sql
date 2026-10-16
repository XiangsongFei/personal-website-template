-- TEST ONLY: disabled legacy Files Restore is denied before source, idempotency, lock, or mutation work.
BEGIN;

CREATE FUNCTION public.test_only_restore_source_state(target_resume uuid,target_event uuid,target_request uuid,target_locale text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  PERFORM * FROM public.load_admin_files_restore_source_v1(target_resume,target_event,target_locale,target_request,
    '{"action":"restore_before","locale":"'||target_locale||'","source_event_id":"'||target_event::text||'","target_resume_id":"'||target_resume::text||'","version":1}');
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM;
END
$function$;
CREATE FUNCTION public.test_only_restore_mutation_state(target_resume uuid,target_event uuid,target_locale text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  PERFORM public.restore_resume_files_from_event_v1(target_resume,target_event,target_locale,
    '{"action":"restore_before","locale":"'||target_locale||'","source_event_id":"'||target_event::text||'","target_resume_id":"'||target_resume::text||'","version":1}',
    '{}','not-a-signature');
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM;
END
$function$;
CREATE FUNCTION public.test_only_restore_capability_state(target_resume uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  PERFORM * FROM public.load_admin_files_restore_capability_v1(target_resume);
  RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE||':'||SQLERRM;
END
$function$;
REVOKE ALL ON FUNCTION public.test_only_restore_source_state(uuid,uuid,uuid,text),
  public.test_only_restore_mutation_state(uuid,uuid,text),public.test_only_restore_capability_state(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_restore_source_state(uuid,uuid,uuid,text),
  public.test_only_restore_mutation_state(uuid,uuid,text),public.test_only_restore_capability_state(uuid) TO authenticated;

-- These capabilities are disposable test setup and roll back with this file. No target is Restore-enabled.
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('20000000-0000-4000-8000-000000000001','activity_log',true)
ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=true;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('ea111111-1111-4111-8111-111111111111','restore',false)
ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=false;

-- One idempotency record is a completed retry and one a conflicting/incomplete request.
INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at,result_payload)
VALUES
 ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','files','e1000000-0000-4000-8000-000000000001',decode(repeat('11',32),'hex'),transaction_timestamp(),transaction_timestamp(),transaction_timestamp()+interval '7 days','[{}]'::jsonb),
 ('10000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111','files','e1000000-0000-4000-8000-000000000002',decode(repeat('22',32),'hex'),transaction_timestamp(),NULL,transaction_timestamp()+interval '7 days',NULL);

CREATE TEMP TABLE restore_state_before AS
SELECT site.id AS resume_id, md5(cms_private.files_aggregate(site.id)::text) AS files_digest,
  (SELECT count(*) FROM cms_private.activity_log_events event WHERE event.resume_id=site.id AND event.section_key='files') AS activity_count,
  (SELECT count(*) FROM cms_private.activity_log_idempotency idem WHERE idem.resume_id=site.id AND idem.domain_key='files') AS idempotency_count,
  (SELECT count(*) FROM storage.objects object WHERE object.bucket_id='resume-files' AND object.name LIKE site.id::text||'/%') AS storage_count
FROM public.resume_sites site WHERE site.id IN ('20000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111');

SELECT extensions.plan(13);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"owner@example.test"}',true);
SELECT extensions.ok((SELECT restore_enabled IS FALSE FROM public.load_admin_files_restore_capability_v1('20000000-0000-4000-8000-000000000001')),
  'Owner Restore capability is absent or explicitly disabled');
SELECT extensions.is(public.test_only_restore_source_state('20000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','en'),'42501:Files Restore is disabled',
  'Owner direct source RPC denies disabled Restore before source lookup');
SELECT extensions.is(public.test_only_restore_mutation_state('20000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','en'),'42501:Files Restore is disabled',
  'Owner direct mutation RPC denies disabled Restore before signature and mutation work');
SELECT extensions.is(public.test_only_restore_source_state('20000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','en'),'42501:Files Restore is disabled',
  'Owner completed idempotency replay is denied before replay lookup');

SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok((SELECT restore_enabled IS FALSE FROM public.load_admin_files_restore_capability_v1('ea111111-1111-4111-8111-111111111111')),
  'Test Restore capability is absent or explicitly disabled');
SELECT extensions.is(public.test_only_restore_source_state('ea111111-1111-4111-8111-111111111111','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000002','en'),'42501:Files Restore is disabled',
  'Test direct source RPC denies disabled Restore before source lookup');
SELECT extensions.is(public.test_only_restore_mutation_state('ea111111-1111-4111-8111-111111111111','e2000000-0000-4000-8000-000000000002','en'),'42501:Files Restore is disabled',
  'Test direct mutation RPC denies disabled Restore before signature and mutation work');
SELECT extensions.is(public.test_only_restore_source_state('ea111111-1111-4111-8111-111111111111','e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000002','en'),'42501:Files Restore is disabled',
  'Test conflicting/incomplete idempotency request is denied before lookup');
SELECT extensions.is(public.test_only_restore_capability_state('20000000-0000-4000-8000-000000000001'),'42501:Activity Log target is outside the caller scope',
  'Test cannot read the Owner Restore capability');
SELECT extensions.is(public.test_only_restore_source_state('20000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003','e3000000-0000-4000-8000-000000000003','en'),'42501:Activity Log target is outside the caller scope',
  'Test cannot invoke the source RPC across targets');
SELECT extensions.is(public.test_only_restore_mutation_state('20000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000003','en'),'42501:Activity Log target is outside the caller scope',
  'Test cannot invoke the mutation RPC across targets');
RESET ROLE;
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM cms_private.resume_capabilities capability
  WHERE capability.resume_id IN ('20000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111')
    AND capability.capability_key='restore' AND capability.enabled IS TRUE),
  'Owner and Test Restore capabilities remain disabled');
SELECT extensions.ok(NOT EXISTS (
  SELECT 1 FROM restore_state_before before_state JOIN public.resume_sites site ON site.id=before_state.resume_id
  WHERE before_state.files_digest IS DISTINCT FROM md5(cms_private.files_aggregate(site.id)::text)
    OR before_state.activity_count IS DISTINCT FROM (SELECT count(*) FROM cms_private.activity_log_events event WHERE event.resume_id=site.id AND event.section_key='files')
    OR before_state.idempotency_count IS DISTINCT FROM (SELECT count(*) FROM cms_private.activity_log_idempotency idem WHERE idem.resume_id=site.id AND idem.domain_key='files')
    OR before_state.storage_count IS DISTINCT FROM (SELECT count(*) FROM storage.objects object WHERE object.bucket_id='resume-files' AND object.name LIKE site.id::text||'/%')
), 'Denied requests leave Files, Activity Log, idempotency, and Storage state unchanged');
SELECT extensions.finish();
ROLLBACK;
