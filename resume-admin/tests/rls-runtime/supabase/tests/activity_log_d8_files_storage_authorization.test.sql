-- TEST ONLY: D-8 authenticated Storage identity and purpose-specific intent policies.
BEGIN;

CREATE FUNCTION public.test_only_d8_storage_insert(target_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
BEGIN
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('resume-files',target_name,'{"test":"d8"}');
  RETURN true;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END
$f$;
CREATE FUNCTION public.test_only_d8_storage_update(target_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE affected integer;
BEGIN
  UPDATE storage.objects SET metadata='{"test":"updated"}' WHERE bucket_id='resume-files' AND name=target_name;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END
$f$;
CREATE FUNCTION public.test_only_d8_storage_delete(target_name text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE affected integer;
BEGIN
  DELETE FROM storage.objects WHERE bucket_id='resume-files' AND name=target_name;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END
$f$;
CREATE FUNCTION public.test_only_d8_prepare(target_resume uuid,target_locale text,target_request uuid,target_object text,target_size integer,target_digest text,target_actor uuid DEFAULT '10000000-0000-4000-8000-000000000002')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE body text; context_value text; signature_value text; issued bigint; key_bytes bytea; status_value text;
BEGIN
 body:='{"byte_size":'||target_size::text||',"content_sha256":"'||target_digest||'","locale":"'||target_locale
   ||'","request_id":"'||target_request::text||'","resume_id":"'||target_resume::text||'","version":1}';
 issued:=floor(date_part('epoch',clock_timestamp()))::bigint;
 context_value:=jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1','actor_user_id',target_actor::text,
  'resume_id',target_resume::text,'domain','files','operation','update','request_id',target_request::text,
  'mutation_digest',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),'issued_at',issued,'expires_at',issued+180,
  'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text;
 key_bytes:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
 signature_value:=encode(extensions.hmac(convert_to(context_value,'UTF8'),key_bytes,'sha256'),'hex');
 SELECT p.upload_status INTO status_value FROM public.prepare_resume_file_upload_v1(target_resume,target_locale,target_request,target_object,
  target_size,target_digest,body,context_value,signature_value) p;
 RETURN status_value;
END
$f$;
CREATE FUNCTION public.test_only_d8_prepare_state(target_resume uuid,target_locale text,target_request uuid,target_object text,target_size integer,target_digest text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN RETURN public.test_only_d8_prepare(target_resume,target_locale,target_request,target_object,target_size,target_digest);
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END
$f$;
CREATE FUNCTION public.test_only_d8_complete_state(target_resume uuid,target_request uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN PERFORM public.complete_resume_file_upload_v1(target_resume,target_request); RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END
$f$;
CREATE FUNCTION public.test_only_d8_files_save(target_resume uuid,target_request uuid,target_reference text,target_actor uuid DEFAULT '10000000-0000-4000-8000-000000000002')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE body text; payload jsonb; context_value text; signature_value text; issued bigint; key_bytes bytea;
BEGIN
 payload:=cms_private.files_aggregate(target_resume);
 payload:=jsonb_set(payload,'{translations,en,portfolio_href}',to_jsonb(target_reference)); body:=payload::text;
 issued:=floor(date_part('epoch',clock_timestamp()))::bigint;
 context_value:=jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1','actor_user_id',target_actor::text,
  'resume_id',target_resume::text,'domain','files','operation','update','request_id',target_request::text,
  'mutation_digest',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),'issued_at',issued,'expires_at',issued+180,
  'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text;
 key_bytes:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
 signature_value:=encode(extensions.hmac(convert_to(context_value,'UTF8'),key_bytes,'sha256'),'hex');
 RETURN public.save_resume_files_v1(target_resume,body,context_value,signature_value);
END
$f$;
CREATE FUNCTION public.test_only_d8_files_save_state(target_resume uuid,target_request uuid,target_reference text,target_actor uuid DEFAULT '10000000-0000-4000-8000-000000000002')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN PERFORM public.test_only_d8_files_save(target_resume,target_request,target_reference,target_actor); RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END
$f$;
CREATE FUNCTION public.test_only_d8_restore(target_resume uuid,source_event uuid,target_locale text,target_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE body text; context_value text; signature_value text; issued bigint; key_bytes bytea;
BEGIN
 body:='{"action":"restore_before","locale":"'||target_locale||'","source_event_id":"'||source_event::text
   ||'","target_resume_id":"'||target_resume::text||'","version":1}';
 issued:=floor(date_part('epoch',clock_timestamp()))::bigint;
 context_value:=jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1','actor_user_id','10000000-0000-4000-8000-000000000002',
  'resume_id',target_resume::text,'domain','files','operation','update','request_id',target_request::text,
  'mutation_digest',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),'issued_at',issued,'expires_at',issued+180,
  'ip_network',NULL,'country_code',NULL,'region',NULL,'city',NULL)::text;
 key_bytes:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
 signature_value:=encode(extensions.hmac(convert_to(context_value,'UTF8'),key_bytes,'sha256'),'hex');
 RETURN public.restore_resume_files_from_event_v1(target_resume,source_event,target_locale,body,context_value,signature_value);
END
$f$;
CREATE FUNCTION public.test_only_d8_restore_state(target_resume uuid,source_event uuid,target_locale text,target_request uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN PERFORM public.test_only_d8_restore(target_resume,source_event,target_locale,target_request); RETURN '00000';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END
$f$;
CREATE FUNCTION public.test_only_d8_event_count(target_resume uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT count(*) FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='files' AND payload_version=2 $f$;
CREATE FUNCTION public.test_only_d8_files_request_count(target_resume uuid,target_request uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT count(*) FROM cms_private.activity_log_idempotency WHERE resume_id=target_resume AND domain_key='files' AND request_id=target_request AND completed_at IS NOT NULL $f$;
CREATE FUNCTION public.test_only_d8_cleanup_count(target_resume uuid,target_object text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT count(*) FROM cms_private.resume_file_cleanup_intents WHERE resume_id=target_resume AND object_name=target_object $f$;
CREATE FUNCTION public.test_only_d8_latest_event(target_resume uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT id FROM cms_private.activity_log_events WHERE resume_id=target_resume AND section_key='files' AND payload_version=2 ORDER BY occurred_at DESC,id DESC LIMIT 1 $f$;
CREATE FUNCTION public.test_only_d8_intent_matches(target_resume uuid,target_request uuid,target_status text,target_object text,target_expired boolean DEFAULT false)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT EXISTS(SELECT 1 FROM cms_private.resume_file_upload_intents
 WHERE resume_id=target_resume AND request_id=target_request AND status=target_status AND object_name=target_object
 AND (NOT target_expired OR expires_at<clock_timestamp())) $f$;
CREATE FUNCTION public.test_only_d8_upload_intent_count(target_resume uuid,target_object text)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT count(*) FROM cms_private.resume_file_upload_intents WHERE resume_id=target_resume AND object_name=target_object $f$;
CREATE FUNCTION public.test_only_d8_event_valid(target_resume uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT EXISTS(SELECT 1 FROM cms_private.activity_log_events
 WHERE id=public.test_only_d8_latest_event(target_resume) AND entity_id IS NULL AND section_key='files'
 AND entity_type='resume_file_set' AND operation='update' AND payload_version=2
 AND cms_private.activity_event_payload_v2_files_is_allowed(section_key,entity_type,entity_id::text,operation,entity_snapshot,changes)) $f$;
CREATE FUNCTION public.test_only_d8_cleanup_completed(target_resume uuid,target_object text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT EXISTS(SELECT 1 FROM cms_private.resume_file_cleanup_intents
 WHERE resume_id=target_resume AND object_name=target_object AND status='completed') $f$;
CREATE FUNCTION public.test_only_d8_claim_cleanup(target_resume uuid,target_claim uuid,target_object text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE item record; found_id uuid;
BEGIN
 FOR item IN SELECT c.cleanup_id,c.object_name FROM public.claim_resume_file_cleanup_v1(target_resume,target_claim) c LOOP
  IF item.object_name=target_object THEN
   found_id:=item.cleanup_id;
  END IF;
 END LOOP;
 RETURN found_id;
END
$f$;
CREATE FUNCTION public.test_only_d8_claimed_cleanup_id(target_resume uuid,target_claim uuid,target_object text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $f$ SELECT id FROM cms_private.resume_file_cleanup_intents
 WHERE resume_id=target_resume AND object_name=target_object AND claim_id=target_claim AND status='claimed' $f$;
REVOKE ALL ON FUNCTION public.test_only_d8_storage_insert(text),public.test_only_d8_storage_update(text),public.test_only_d8_storage_delete(text),
 public.test_only_d8_prepare(uuid,text,uuid,text,integer,text,uuid),public.test_only_d8_prepare_state(uuid,text,uuid,text,integer,text),
 public.test_only_d8_complete_state(uuid,uuid),public.test_only_d8_files_save(uuid,uuid,text,uuid),public.test_only_d8_files_save_state(uuid,uuid,text,uuid),
 public.test_only_d8_restore(uuid,uuid,text,uuid),public.test_only_d8_restore_state(uuid,uuid,text,uuid),
 public.test_only_d8_event_count(uuid),public.test_only_d8_files_request_count(uuid,uuid),public.test_only_d8_cleanup_count(uuid,text),public.test_only_d8_latest_event(uuid),
 public.test_only_d8_intent_matches(uuid,uuid,text,text,boolean),public.test_only_d8_upload_intent_count(uuid,text),public.test_only_d8_event_valid(uuid),public.test_only_d8_cleanup_completed(uuid,text),
 public.test_only_d8_claim_cleanup(uuid,uuid,text),public.test_only_d8_claimed_cleanup_id(uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.test_only_d8_storage_insert(text),public.test_only_d8_storage_update(text),public.test_only_d8_storage_delete(text),
 public.test_only_d8_prepare(uuid,text,uuid,text,integer,text,uuid),public.test_only_d8_prepare_state(uuid,text,uuid,text,integer,text),
 public.test_only_d8_complete_state(uuid,uuid),public.test_only_d8_files_save(uuid,uuid,text,uuid),public.test_only_d8_files_save_state(uuid,uuid,text,uuid),
 public.test_only_d8_restore(uuid,uuid,text,uuid),public.test_only_d8_restore_state(uuid,uuid,text,uuid),
 public.test_only_d8_event_count(uuid),public.test_only_d8_files_request_count(uuid,uuid),public.test_only_d8_cleanup_count(uuid,text),public.test_only_d8_latest_event(uuid),
 public.test_only_d8_intent_matches(uuid,uuid,text,text,boolean),public.test_only_d8_upload_intent_count(uuid,text),public.test_only_d8_event_valid(uuid),public.test_only_d8_cleanup_completed(uuid,text),
 public.test_only_d8_claim_cleanup(uuid,uuid,text),public.test_only_d8_claimed_cleanup_id(uuid,uuid,text) TO authenticated;

SELECT extensions.plan(39);
-- Supabase Storage sets this transaction-local flag while applying object DELETE.
SELECT set_config('storage.allow_delete_query','true',true);
SELECT extensions.ok(NOT cms_private.files_storage_intent_mode('ea111111-1111-4111-8111-111111111111'),
  'D-8 migration installation leaves the QA intent protocol inactive');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok(public.can_insert_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/resume_en.pdf'),
  'legacy nonactivated QA Storage path retains its prior authenticated policy');
SELECT extensions.ok(public.test_only_d8_storage_insert('ea111111-1111-4111-8111-111111111111/resume_en.pdf'),
  'authenticated Storage insert succeeds for legacy nonactivated QA path');
RESET ROLE;


-- Prepare one referenced managed object before the test-only activation.
INSERT INTO cms_private.profile_photo_origin_config(singleton,origin) VALUES(true,'https://local.supabase.invalid');
UPDATE public.resume_locale_content SET portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf'
 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';

-- Synthetic activation is transaction-local to this rollback-only test.
INSERT INTO cms_private.resume_files_storage_protocol(resume_id,protocol_key)
VALUES('ea111111-1111-4111-8111-111111111111','intent_v1');
INSERT INTO cms_private.resume_file_upload_intents(actor_user_id,resume_id,locale,request_id,mutation_digest,byte_size,object_name,status,expires_at)
VALUES('10000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111','en',
 'd8111111-1111-4111-8111-111111111111',extensions.digest(convert_to('test-pdf','UTF8'),'sha256'),8,
 'ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf','prepared',clock_timestamp()+interval '5 minutes');
INSERT INTO cms_private.resume_file_cleanup_intents(actor_user_id,resume_id,object_name,purpose)
VALUES('10000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111',
 'ea111111-1111-4111-8111-111111111111/en/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf','rejected_upload');
INSERT INTO cms_private.resume_file_cleanup_intents(actor_user_id,resume_id,object_name,purpose)
VALUES('10000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111',
 'ea111111-1111-4111-8111-111111111111/en/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf','rejected_upload');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('resume-files','ea111111-1111-4111-8111-111111111111/en/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf','{"test":"cleanup"}'),
 ('resume-files','ea111111-1111-4111-8111-111111111111/en/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf','{"test":"referenced"}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok(public.can_insert_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')
 AND public.test_only_d8_storage_insert('ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'exact prepared upload intent permits Storage INSERT under the authenticated user identity');
SELECT extensions.ok(NOT public.test_only_d8_storage_insert('ea111111-1111-4111-8111-111111111111/en/cccccccc-cccc-4ccc-8ccc-cccccccccccc.pdf'),
 'direct browser-style Storage INSERT without an exact intent is denied');
SELECT extensions.ok(NOT public.test_only_d8_storage_insert('10000000-0000-4000-8000-000000000001/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'QA cannot insert an object under the Official resume path');
SELECT extensions.ok(NOT public.test_only_d8_storage_insert('ea111111-1111-4111-8111-111111111111/en/not-a-uuid.pdf'),
 'malformed managed path is denied after intent-mode activation');
SELECT extensions.ok(NOT public.can_update_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')
 AND NOT public.test_only_d8_storage_update('ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'intent mode denies Storage UPDATE and upsert-style mutation');
SELECT extensions.ok(NOT public.can_delete_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')
 AND NOT public.test_only_d8_storage_delete('ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),
 'upload authorization alone does not grant Storage DELETE');
SELECT extensions.ok(public.can_delete_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/en/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf')
 AND public.test_only_d8_storage_delete('ea111111-1111-4111-8111-111111111111/en/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf'),
 'exact cleanup authorization permits Storage DELETE under the authenticated user identity');
SELECT extensions.ok(NOT public.can_delete_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/resume_en.pdf')
 AND NOT public.can_delete_resume_file_object('resume-files','example-cv/resume_en.pdf'),
 'intent mode rejects legacy and Official objects for cleanup');
SELECT extensions.ok(NOT public.can_delete_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/en/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf')
 AND NOT public.test_only_d8_storage_delete('ea111111-1111-4111-8111-111111111111/en/dddddddd-dddd-4ddd-8ddd-dddddddddddd.pdf'),
 'cleanup authorization cannot delete an object that is currently referenced by the Files aggregate');
RESET ROLE;

-- Trusted-time expiry is enforced by the database policy and completion RPC.
UPDATE cms_private.resume_write_modes SET write_mode='rpc' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='files';
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
 VALUES('ea111111-1111-4111-8111-111111111111','files','trusted_network_context_v11',true)
 ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=excluded.enabled;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
 VALUES('ea111111-1111-4111-8111-111111111111','activity_log',true)
 ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=excluded.enabled;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT public.test_only_d8_prepare('ea111111-1111-4111-8111-111111111111','en','d8222222-2222-4222-8222-222222222222',
 'ea111111-1111-4111-8111-111111111111/en/22222222-2222-4222-8222-222222222222.pdf',1,encode(extensions.digest(convert_to('x','UTF8'),'sha256'),'hex'));
RESET ROLE;
UPDATE cms_private.resume_file_upload_intents SET expires_at=clock_timestamp()-interval '1 second'
 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND request_id='d8222222-2222-4222-8222-222222222222';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok(NOT public.can_insert_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/en/22222222-2222-4222-8222-222222222222.pdf')
 AND NOT public.test_only_d8_storage_insert('ea111111-1111-4111-8111-111111111111/en/22222222-2222-4222-8222-222222222222.pdf'),
 'prepared authorization is denied for Storage INSERT after trusted database expiry');
SELECT extensions.is(public.test_only_d8_complete_state('ea111111-1111-4111-8111-111111111111','d8222222-2222-4222-8222-222222222222'),'22023',
 'completion rejects an expired prepared intent without an authorized Storage object');
SELECT extensions.ok(public.test_only_d8_prepare_state('ea111111-1111-4111-8111-111111111111','en','d8222222-2222-4222-8222-222222222222',
 'ea111111-1111-4111-8111-111111111111/en/ffffffff-ffff-4fff-8fff-ffffffffffff.pdf',1,encode(extensions.digest(convert_to('x','UTF8'),'sha256'),'hex'))='expired'
 AND public.test_only_d8_intent_matches('ea111111-1111-4111-8111-111111111111','d8222222-2222-4222-8222-222222222222','prepared',
   'ea111111-1111-4111-8111-111111111111/en/22222222-2222-4222-8222-222222222222.pdf',true),
 'retry returns the expired original candidate and never renews its authorization window');
SELECT extensions.is(public.test_only_d8_prepare_state('ea111111-1111-4111-8111-111111111111','en','d8222222-2222-4222-8222-222222222222',
 'ea111111-1111-4111-8111-111111111111/en/ffffffff-ffff-4fff-8fff-ffffffffffff.pdf',1,encode(extensions.digest(convert_to('y','UTF8'),'sha256'),'hex')),'P13B1',
 'changed digest with an expired request ID still conflicts');
SELECT public.test_only_d8_prepare('ea111111-1111-4111-8111-111111111111','en','d8233333-3333-4333-8333-333333333333',
 'ea111111-1111-4111-8111-111111111111/en/33333333-3333-4333-8333-333333333333.pdf',1,encode(extensions.digest(convert_to('z','UTF8'),'sha256'),'hex'));
SELECT extensions.ok(public.test_only_d8_storage_insert('ea111111-1111-4111-8111-111111111111/en/33333333-3333-4333-8333-333333333333.pdf')
 AND public.test_only_d8_complete_state('ea111111-1111-4111-8111-111111111111','d8233333-3333-4333-8333-333333333333')='00000',
 'valid prepared intent accepts its exact Storage INSERT and can complete');
RESET ROLE;
UPDATE cms_private.resume_file_upload_intents SET expires_at=clock_timestamp()-interval '1 second'
 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND request_id='d8233333-3333-4333-8333-333333333333';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok(public.test_only_d8_complete_state('ea111111-1111-4111-8111-111111111111','d8233333-3333-4333-8333-333333333333')='00000'
 AND public.test_only_d8_intent_matches('ea111111-1111-4111-8111-111111111111','d8233333-3333-4333-8333-333333333333','uploaded',
   'ea111111-1111-4111-8111-111111111111/en/33333333-3333-4333-8333-333333333333.pdf'),
 'completed upload authorization remains reconcilable after its original prepare window expires');
RESET ROLE;

-- Exercise the real Files writer, D-8 trigger and accepted restore RPC together.
DELETE FROM cms_private.resume_files_storage_protocol WHERE resume_id='ea111111-1111-4111-8111-111111111111';
UPDATE cms_private.resume_write_modes SET write_mode='direct' WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='files';
UPDATE public.resume_locale_content SET portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en';
INSERT INTO storage.objects(bucket_id,name,metadata)
 SELECT 'resume-files','ea111111-1111-4111-8111-111111111111/resume_en.pdf','{"test":"legacy restore"}'
 WHERE NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='resume-files' AND name='ea111111-1111-4111-8111-111111111111/resume_en.pdf');
INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
 VALUES('ea111111-1111-4111-8111-111111111111','files','rpc')
 ON CONFLICT(resume_id,domain_key) DO UPDATE SET write_mode=excluded.write_mode;
INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
 VALUES('ea111111-1111-4111-8111-111111111111','files','trusted_network_context_v11',true)
 ON CONFLICT(resume_id,domain_key,requirement_key) DO UPDATE SET enabled=excluded.enabled;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
 VALUES('ea111111-1111-4111-8111-111111111111','activity_log',true)
 ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=excluded.enabled;
INSERT INTO cms_private.resume_files_storage_protocol(resume_id,protocol_key)
 VALUES('ea111111-1111-4111-8111-111111111111','intent_v1');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.is(public.test_only_d8_prepare('ea111111-1111-4111-8111-111111111111','en','d8244444-4444-4444-8444-444444444444',
 'ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf',17,encode(extensions.digest(convert_to('integration-pdf','UTF8'),'sha256'),'hex')),'prepared',
 'authenticated QA actor obtains a server-timed D-8 upload intent');
SELECT extensions.ok(public.test_only_d8_storage_insert('ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')
 AND public.test_only_d8_complete_state('ea111111-1111-4111-8111-111111111111','d8244444-4444-4444-8444-444444444444')='00000',
 'authorized Storage object insertion completes the exact upload intent');
SELECT extensions.ok(public.test_only_d8_files_save('ea111111-1111-4111-8111-111111111111','d8255555-5555-4555-8555-555555555555',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')->'translations'->'en'->>'portfolio_href'
 LIKE '%/en/44444444-4444-4444-8444-444444444444.pdf'
 AND public.test_only_d8_intent_matches('ea111111-1111-4111-8111-111111111111','d8244444-4444-4444-8444-444444444444','consumed',
   'ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')
 AND public.test_only_d8_event_count('ea111111-1111-4111-8111-111111111111')=1
 AND public.test_only_d8_files_request_count('ea111111-1111-4111-8111-111111111111','d8255555-5555-4555-8555-555555555555')=1,
 'real Files RPC changes the aggregate once, consumes upload authority, and completes one V2 event/idempotency record');
SELECT extensions.ok(public.test_only_d8_files_save('ea111111-1111-4111-8111-111111111111','d8255555-5555-4555-8555-555555555555',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf') IS NOT NULL
 AND public.test_only_d8_event_count('ea111111-1111-4111-8111-111111111111')=1
 AND public.test_only_d8_cleanup_count('ea111111-1111-4111-8111-111111111111','ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')=0,
 'exact Files request replay adds no success event or duplicate cleanup authorization');
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d8255555-5555-4555-8555-555555555555',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/55555555-5555-4555-8555-555555555555.pdf'),'P13B1',
 'same Files request ID with changed payload fails before a second mutation');
SELECT extensions.is(public.test_only_d8_files_save_state('10000000-0000-4000-8000-000000000001','d8266666-6666-4666-8666-666666666666',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/10000000-0000-4000-8000-000000000001/en/66666666-6666-4666-8666-666666666666.pdf'),'42501',
 'QA authenticated actor cannot invoke the Files writer for Official resume');
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d8277777-7777-4777-8777-777777777777',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/zh/77777777-7777-4777-8777-777777777777.pdf'),'22023',
 'Files RPC rejects a candidate whose path locale differs from the changed locale');
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d8288888-8888-4888-8888-888888888888',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/88888888-8888-4888-8888-888888888888.pdf',
 '10000000-0000-4000-8000-000000000099'),'22023',
 'Files RPC rejects a signed context for an actor other than the authenticated QA user');
SELECT public.test_only_d8_prepare('ea111111-1111-4111-8111-111111111111','en','d8299999-9999-4999-8999-999999999999',
 'ea111111-1111-4111-8111-111111111111/en/99999999-9999-4999-8999-999999999999.pdf',1,encode(extensions.digest(convert_to('u','UTF8'),'sha256'),'hex'));
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d82aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/99999999-9999-4999-8999-999999999999.pdf'),'42501',
 'Files RPC rejects a prepared but uncompleted upload intent');
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d82bbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/22222222-2222-4222-8222-222222222222.pdf'),'42501',
 'Files RPC rejects an expired prepared upload authorization');
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d82ccccc-cccc-4ccc-8ccc-cccccccccccc',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'),'42501',
 'Files RPC rejects a valid managed path with no matching upload authorization');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d82ddddd-dddd-4ddd-8ddd-dddddddddddd',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf'),'42501',
 'Files writer rejects the save when authenticated actor identity is absent');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.invalid"}',true);
SELECT extensions.ok((SELECT count(*)=0 FROM public.claim_resume_file_cleanup_v1('ea111111-1111-4111-8111-111111111111','d82eeeee-eeee-4eee-8eee-eeeeeeeeeeee') c
 WHERE c.object_name='ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')
 AND NOT public.can_delete_resume_file_object('resume-files','ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')
 AND NOT public.test_only_d8_storage_delete('ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf'),
 'a referenced managed object cannot be claimed or deleted');
SELECT extensions.ok(public.test_only_d8_restore('ea111111-1111-4111-8111-111111111111',public.test_only_d8_latest_event('ea111111-1111-4111-8111-111111111111'),'en','d82fffff-ffff-4fff-8fff-ffffffffffff')
 ->'files'->'translations'->'en'->>'portfolio_href'='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 AND public.test_only_d8_event_count('ea111111-1111-4111-8111-111111111111')=2
 AND public.test_only_d8_cleanup_count('ea111111-1111-4111-8111-111111111111','ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')=1,
 'actual restore RPC accepts the historical legacy reference and queues its superseded managed object once');
SELECT extensions.is(public.test_only_d8_upload_intent_count('ea111111-1111-4111-8111-111111111111',
 'ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),0::bigint,
 'legacy reference restoration does not fabricate upload authority');
SELECT extensions.ok(public.test_only_d8_event_valid('ea111111-1111-4111-8111-111111111111')
 AND (SELECT portfolio_href='https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/resume_en.pdf?cacheNonce=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  FROM public.resume_locale_content WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND locale='en'),
 'restore event has the valid Files V2 contract and authoritative legacy reference is restored');
SELECT extensions.ok(public.test_only_d8_restore('ea111111-1111-4111-8111-111111111111',public.test_only_d8_latest_event('ea111111-1111-4111-8111-111111111111'),'en','d82fffff-ffff-4fff-8fff-ffffffffffff') IS NOT NULL
 AND public.test_only_d8_event_count('ea111111-1111-4111-8111-111111111111')=2
 AND public.test_only_d8_cleanup_count('ea111111-1111-4111-8111-111111111111','ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')=1,
 'exact restore replay remains idempotent without another event or cleanup authorization');
SELECT extensions.is(public.test_only_d8_files_save_state('ea111111-1111-4111-8111-111111111111','d8300000-0000-4000-8000-000000000001',
 'https://local.supabase.invalid/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf'),'42501',
 'an object reserved for cleanup cannot be reintroduced by a later Files save');
SELECT extensions.ok(public.test_only_d8_claim_cleanup('ea111111-1111-4111-8111-111111111111','d8311111-1111-4111-8111-111111111111',
 'ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf') IS NOT NULL,
 'unreferenced superseded managed object can be claimed for cleanup');
SELECT extensions.ok(public.test_only_d8_storage_delete('ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf'),
 'claimed object can be deleted through its exact authenticated Storage authorization');
SELECT extensions.ok(public.complete_resume_file_cleanup_v1('ea111111-1111-4111-8111-111111111111',
 public.test_only_d8_claimed_cleanup_id('ea111111-1111-4111-8111-111111111111','d8311111-1111-4111-8111-111111111111',
 'ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf'),'d8311111-1111-4111-8111-111111111111')
 AND public.test_only_d8_cleanup_completed('ea111111-1111-4111-8111-111111111111',
   'ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf')
 AND NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='resume-files' AND name='ea111111-1111-4111-8111-111111111111/en/44444444-4444-4444-8444-444444444444.pdf'),
 'exact cleanup completion closes the intent after the authorized Storage object is absent');
RESET ROLE;

ROLLBACK;
