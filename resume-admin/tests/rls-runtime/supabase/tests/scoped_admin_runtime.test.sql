-- TEST ONLY. Executed by `supabase test db --local` against the dedicated local project.
BEGIN;
SELECT extensions.plan(6);
-- TEST ONLY: establish the RPC Awards state and a disposable QA record. This
-- transaction rolls back, and the production migration itself activates none.
UPDATE cms_private.resume_write_modes SET write_mode='rpc'
 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='awards';
INSERT INTO public.resume_award_entries(id,resume_id,position,source_key)
 VALUES ('a3000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111',50,NULL);
INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year)
 VALUES ('a3000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111','zh','Disposable','2025');
-- Enable Activity Log only inside this test transaction so both authorized
-- target paths can be read; Restore remains absent/disabled for both.
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('20000000-0000-4000-8000-000000000001','activity_log',true),
       ('ea555555-5555-4555-8555-555555555555','activity_log',true)
ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=EXCLUDED.enabled;
-- Synthetic event and Storage rows let the identity tests exercise the actual
-- SECURITY DEFINER read boundary and Storage RLS without touching real data.
INSERT INTO cms_private.activity_log_events
  (id,actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
   operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version)
VALUES
  ('ea330000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner@example.invalid','owner',
   '20000000-0000-4000-8000-000000000001','example-cv','update','introduction','introduction_paragraph','owner-fixture',
   '{"position":0,"text":"owner after"}','{"text":{"before":"owner before","after":"owner after"}}',1),
  ('ea330000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','test@example.invalid','qa',
   'ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log','update','introduction','introduction_paragraph','test-fixture',
   '{"position":0,"text":"test after"}','{"text":{"before":"test before","after":"test after"}}',1),
  ('ea330000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','owner@example.invalid','owner',
   'ea555555-5555-4555-8555-555555555555','example-cv-qa','update','introduction','introduction_paragraph','legacy-fixture',
   '{"position":0,"text":"legacy after"}','{"text":{"before":"legacy before","after":"legacy after"}}',1);
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
  ('profile-images','20000000-0000-4000-8000-000000000001/profile/owner-test.png','{"fixture":"owner"}'),
  ('profile-images','ea111111-1111-4111-8111-111111111111/profile/test-only.png','{"fixture":"test"}'),
  ('profile-images','ea555555-5555-4555-8555-555555555555/profile/legacy-only.png','{"fixture":"legacy"}');
-- TEST ONLY. Exercise the private assertion helper with the caller's JWT claims
-- while keeping its production EXECUTE grant private.
CREATE FUNCTION public.rls_test_read_scope(target_resume_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT target.resolved_site_key
    FROM cms_private.assert_activity_log_read_target(target_resume_id) AS target
$function$;
REVOKE ALL ON FUNCTION public.rls_test_read_scope(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rls_test_read_scope(uuid) TO authenticated;
-- TEST ONLY: exercise the private system-event target gate under caller JWT claims.
CREATE FUNCTION public.rls_test_system_event_scope(target_resume_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT target.resolved_site_key
    FROM cms_private.assert_activity_log_system_event_target(target_resume_id) AS target
$function$;
REVOKE ALL ON FUNCTION public.rls_test_system_event_scope(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rls_test_system_event_scope(uuid) TO authenticated;
-- TEST ONLY: mirror the transaction-local flag set by Supabase Storage API
-- before its object DELETE statements. RLS still runs as each synthetic role.
SELECT set_config('storage.allow_delete_query','true',true);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$
BEGIN
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.resume_sites WHERE site_key='example-cv'), 'anon sees published official root');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.resume_profile WHERE resume_id='20000000-0000-4000-8000-000000000001'), 'anon sees published official content');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_sites WHERE site_key='example-cv-qa-activity-log'), 'anon cannot read unpublished QA root');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111'), 'anon cannot read unpublished QA content');
  PERFORM public.rls_test_assert(auth.uid() IS NULL, 'anon has no synthetic user identity');
END $$;
SELECT extensions.pass('anonymous published/unpublished read behavior');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE affected integer; award_position integer; event_rows integer; denied boolean;
BEGIN
  PERFORM public.rls_test_assert(auth.uid()='10000000-0000-4000-8000-000000000001'::uuid, 'auth.uid resolves synthetic owner JWT subject');
  PERFORM public.rls_test_assert(public.is_resume_admin(), 'owner remains an admin');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.get_admin_resume_target() WHERE resume_id='20000000-0000-4000-8000-000000000001' AND site_key='example-cv' AND role='owner'), 'owner target RPC resolves official site');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.activity_log_authorized_targets() WHERE resume_id='20000000-0000-4000-8000-000000000001' AND site_key='example-cv' AND role='owner'), 'Owner receives exactly the Owner Activity Log target');
  PERFORM public.rls_test_assert(public.can_manage_resume('20000000-0000-4000-8000-000000000001')
    AND NOT public.can_manage_resume('ea111111-1111-4111-8111-111111111111')
    AND NOT public.can_manage_resume('ea555555-5555-4555-8555-555555555555'), 'Owner management predicate excludes Test and legacy targets');
  PERFORM public.rls_test_assert((SELECT count(*)>0 FROM public.resume_profile WHERE resume_id='20000000-0000-4000-8000-000000000001'), 'owner reads official content');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_intro_paragraphs WHERE resume_id='ea111111-1111-4111-8111-111111111111'), 'owner cannot read Test content');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_intro_paragraphs WHERE resume_id='ea555555-5555-4555-8555-555555555555'), 'owner cannot read retained legacy content');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_sites WHERE site_key IN ('example-cv-qa','example-cv-qa-activity-log')), 'Owner metadata policy hides both non-Owner targets');
  SELECT count(*) INTO event_rows FROM public.read_activity_log_events_v12('20000000-0000-4000-8000-000000000001');
  PERFORM public.rls_test_assert(event_rows=1 AND (SELECT count(*)=1 FROM public.read_activity_log_events_v12('20000000-0000-4000-8000-000000000001') WHERE id='ea330000-0000-4000-8000-000000000001'), 'Owner Activity Log RPC returns only Owner event');
  PERFORM public.rls_test_assert(public.rls_test_read_scope('20000000-0000-4000-8000-000000000001')='example-cv', 'read assertion authorizes Owner only for the Owner target');
  PERFORM public.rls_test_assert(public.rls_test_system_event_scope('20000000-0000-4000-8000-000000000001')='example-cv', 'system-event assertion authorizes Owner only for the Owner target');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Owner cannot read Test Activity Log through its read RPC');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events_v12('ea555555-5555-4555-8555-555555555555');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Owner cannot read legacy Activity Log through its read RPC');
  denied := false;
  BEGIN
    PERFORM public.rls_test_read_scope('ea111111-1111-4111-8111-111111111111');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'read assertion denies Owner access to Test target');
  denied := false; BEGIN PERFORM public.rls_test_system_event_scope('ea111111-1111-4111-8111-111111111111'); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'system-event assertion denies Owner access to Test target');
  denied := false; BEGIN PERFORM public.rls_test_system_event_scope('ea555555-5555-4555-8555-555555555555'); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'system-event assertion denies Owner access to legacy target');
  denied := false;
  BEGIN
    PERFORM 1 FROM cms_private.activity_log_events;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Owner has no direct event-table read grant');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='profile-images' AND name='20000000-0000-4000-8000-000000000001/profile/owner-test.png')
    AND (SELECT count(*)=0 FROM storage.objects WHERE name LIKE 'ea111111-1111-4111-8111-111111111111/%')
    AND (SELECT count(*)=0 FROM storage.objects WHERE name LIKE 'ea555555-5555-4555-8555-555555555555/%'), 'Owner Storage visibility is limited to Owner UUID paths');
  denied := false;
  BEGIN
    PERFORM public.preview_restore_v1('20000000-0000-4000-8000-000000000001','ea330000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Restore preview remains disabled for Owner');
  PERFORM public.rls_test_assert(public.can_direct_write_awards('20000000-0000-4000-8000-000000000001'), 'Official Awards remain direct-mode writable');

  SELECT COALESCE(max(position),-1)+1000 INTO award_position FROM public.resume_award_entries WHERE resume_id='20000000-0000-4000-8000-000000000001';
  INSERT INTO public.resume_award_entries(id,resume_id,position,source_key)
    VALUES ('a4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',award_position,'rls-direct-awards-proof');
  INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year) VALUES
    ('a4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','zh','Direct Awards proof','2025'),
    ('a4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','en','Direct Awards proof','2025');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.resume_award_entries WHERE id='a4000000-0000-4000-8000-000000000001')
    AND (SELECT count(*)=2 FROM public.resume_award_translations WHERE award_entry_id='a4000000-0000-4000-8000-000000000001'),
    'authorized direct-mode Awards INSERT and reads succeed for parent and translations');
  UPDATE public.resume_award_entries SET position=award_position+1 WHERE id='a4000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'authorized direct-mode Awards parent UPDATE succeeds');
  UPDATE public.resume_award_translations SET name='Direct Awards proof updated'
    WHERE award_entry_id='a4000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=2, 'authorized direct-mode Awards translation UPDATE succeeds');
  DELETE FROM public.resume_award_translations WHERE award_entry_id='a4000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=2, 'authorized direct-mode Awards translation DELETE succeeds');
  DELETE FROM public.resume_award_entries WHERE id='a4000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'authorized direct-mode Awards parent DELETE succeeds');

  INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key) VALUES ('a1000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',50,'rls-owner-official');
  UPDATE public.resume_intro_paragraphs SET position=51 WHERE id='a1000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'owner updates official content');
  DELETE FROM public.resume_intro_paragraphs WHERE id='a1000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'owner deletes official content');

  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key) VALUES ('a1000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111',50,'rls-owner-qa-stale-direct');
    RAISE EXCEPTION 'owner Introduction direct insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('profile-images','example-cv/profile/owner-legacy.png','{"fixture":"owner"}');
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('resume-files','example-cv/resume_en.pdf','{"fixture":"owner"}');
  UPDATE storage.objects SET metadata='{"fixture":"owner-updated"}' WHERE bucket_id='profile-images' AND name='example-cv/profile/owner-legacy.png'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'owner can access intended official legacy Storage paths');
  DELETE FROM storage.objects WHERE bucket_id='resume-files' AND name='example-cv/resume_en.pdf'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'owner can delete intended official legacy Storage object');
END $$;
SELECT extensions.pass('Owner official and QA content CRUD, Storage legacy access, and target RPC');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE affected integer; denied boolean; event_rows integer;
BEGIN
  PERFORM public.rls_test_assert(auth.uid()='10000000-0000-4000-8000-000000000002'::uuid, 'auth.uid resolves synthetic QA JWT subject');
  PERFORM public.rls_test_assert(public.is_resume_admin(), 'QA membership passes existing Admin gate');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.get_admin_resume_target() WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND site_key='example-cv-qa-activity-log' AND role='qa'), 'Test target RPC resolves bound Test site');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.activity_log_authorized_targets() WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND site_key='example-cv-qa-activity-log' AND role='qa'), 'Test receives exactly its own Activity Log target');
  PERFORM public.rls_test_assert(public.can_manage_resume('ea111111-1111-4111-8111-111111111111')
    AND NOT public.can_manage_resume('20000000-0000-4000-8000-000000000001')
    AND NOT public.can_manage_resume('ea555555-5555-4555-8555-555555555555'), 'Test management predicate excludes Owner and legacy targets');
  PERFORM public.rls_test_assert((SELECT count(*)>0 FROM public.resume_intro_paragraphs WHERE resume_id='ea111111-1111-4111-8111-111111111111'), 'QA can read QA content');
  PERFORM public.rls_test_assert((SELECT count(*)>0 FROM public.resume_intro_paragraphs WHERE resume_id='20000000-0000-4000-8000-000000000001'), 'published Owner content remains publicly readable');
  UPDATE public.resume_intro_paragraph_translations SET text=text WHERE resume_id='20000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'Test cannot modify Owner content');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_intro_paragraphs WHERE resume_id='ea555555-5555-4555-8555-555555555555'), 'Test cannot read retained legacy content');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.resume_sites WHERE id='ea111111-1111-4111-8111-111111111111')
    AND (SELECT count(*)=1 FROM public.resume_sites WHERE site_key='example-cv')
    AND (SELECT count(*)=0 FROM public.resume_sites WHERE site_key='example-cv-qa'), 'Test sees its bound target and only publicly published Owner metadata');
  SELECT count(*) INTO event_rows FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111');
  PERFORM public.rls_test_assert(event_rows=1 AND (SELECT count(*)=1 FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111') WHERE id='ea330000-0000-4000-8000-000000000002'), 'Test Activity Log RPC returns only Test event');
  PERFORM public.rls_test_assert(public.rls_test_read_scope('ea111111-1111-4111-8111-111111111111')='example-cv-qa-activity-log', 'read assertion authorizes Test only for its own target');
  PERFORM public.rls_test_assert(public.rls_test_system_event_scope('ea111111-1111-4111-8111-111111111111')='example-cv-qa-activity-log', 'system-event assertion authorizes Test only for its own target');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events_v12('20000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Test cannot read Owner Activity Log through its read RPC');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events_v12('ea555555-5555-4555-8555-555555555555');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Test cannot read legacy Activity Log through its read RPC');
  denied := false;
  BEGIN
    PERFORM public.rls_test_read_scope('20000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'read assertion denies Test access to Owner target');
  denied := false; BEGIN PERFORM public.rls_test_system_event_scope('20000000-0000-4000-8000-000000000001'); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'system-event assertion denies Test access to Owner target');
  denied := false; BEGIN PERFORM public.rls_test_system_event_scope('ea555555-5555-4555-8555-555555555555'); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'system-event assertion denies Test access to legacy target');
  denied := false;
  BEGIN
    PERFORM 1 FROM cms_private.activity_log_events;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Test has no direct event-table read grant');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM storage.objects WHERE bucket_id='profile-images' AND name='ea111111-1111-4111-8111-111111111111/profile/test-only.png')
    AND (SELECT count(*)=0 FROM storage.objects WHERE name LIKE '20000000-0000-4000-8000-000000000001/%')
    AND (SELECT count(*)=0 FROM storage.objects WHERE name LIKE 'ea555555-5555-4555-8555-555555555555/%'), 'Test Storage visibility is limited to its own UUID paths');
  denied := false;
  BEGIN
    PERFORM public.preview_restore_v1('ea111111-1111-4111-8111-111111111111','ea330000-0000-4000-8000-000000000002');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Restore preview remains disabled for Test');
  PERFORM public.rls_test_assert(EXISTS (SELECT 1 FROM public.resume_award_entries WHERE id='a3000000-0000-4000-8000-000000000001'), 'QA can still read Awards in RPC mode');

  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key) VALUES ('a2000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111',50,'rls-qa-stale-direct');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot bypass Introduction RPC mode with direct INSERT');
  denied := false;
  BEGIN
    INSERT INTO public.resume_award_entries(id,resume_id,position,source_key) VALUES ('a2000000-0000-4000-8000-000000000004','ea111111-1111-4111-8111-111111111111',10,NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot bypass Awards RPC mode with direct INSERT');
  denied := false;
  BEGIN
    INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year)
      VALUES ('a3000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111','en','Blocked direct insert','2025');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot bypass Awards RPC mode with direct translation INSERT');
  UPDATE public.resume_award_entries SET position=position+1 WHERE id='a3000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA direct Awards parent UPDATE is blocked in RPC mode');
  UPDATE public.resume_award_translations SET name='Blocked direct update' WHERE award_entry_id='a3000000-0000-4000-8000-000000000001' AND locale='zh'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA direct Awards UPDATE is blocked in RPC mode');
  DELETE FROM public.resume_award_translations WHERE award_entry_id='a3000000-0000-4000-8000-000000000001' AND locale='zh'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA direct Awards translation DELETE is blocked in RPC mode');
  DELETE FROM public.resume_award_entries WHERE id='a3000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA direct Awards DELETE is blocked in RPC mode');
  UPDATE public.resume_intro_paragraphs SET position=51 WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND id='ea000000-0000-4000-8000-000000000006'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA stale direct UPDATE is blocked for Introduction');
  DELETE FROM public.resume_intro_paragraphs WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND id='ea000000-0000-4000-8000-000000000006'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA stale direct DELETE is blocked for Introduction');
  UPDATE public.resume_profile SET footer_name=footer_name || ' tested' WHERE resume_id='ea111111-1111-4111-8111-111111111111'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'QA retains direct writes for non-converted domains');

  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key) VALUES ('a2000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',60,'rls-qa-official-insert');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA official INSERT denied');
  UPDATE public.resume_intro_paragraphs SET position=61 WHERE resume_id='20000000-0000-4000-8000-000000000001' AND id='20000000-0000-4000-8000-000000000011'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA official UPDATE denied');
  DELETE FROM public.resume_intro_paragraphs WHERE resume_id='20000000-0000-4000-8000-000000000001' AND id='20000000-0000-4000-8000-000000000011'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA official DELETE denied');

  UPDATE public.resume_sites SET is_published=true WHERE id='ea111111-1111-4111-8111-111111111111'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0 AND (SELECT is_published=false FROM public.resume_sites WHERE id='ea111111-1111-4111-8111-111111111111'), 'QA cannot publish root');
  UPDATE public.resume_sites SET site_key='qa-renamed' WHERE id='ea111111-1111-4111-8111-111111111111'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot rename root');
  DELETE FROM public.resume_sites WHERE id='ea111111-1111-4111-8111-111111111111'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot delete root');

  denied := false;
  BEGIN
    INSERT INTO public.resume_sites(id,site_key,is_published) VALUES ('a2000000-0000-4000-8000-000000000003','arbitrary-qa-site',false);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot create arbitrary root');

  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('profile-images','ea111111-1111-4111-8111-111111111111/profile/qa-photo.png','{"fixture":"qa"}');
  UPDATE storage.objects SET metadata='{"fixture":"qa-updated"}' WHERE bucket_id='profile-images' AND name='ea111111-1111-4111-8111-111111111111/profile/qa-photo.png'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'QA Storage namespace UPDATE allowed');

  denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('profile-images','20000000-0000-4000-8000-000000000001/profile/qa-in-official.png');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot INSERT in official UUID namespace');
  denied := false;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES ('profile-images','not-a-uuid/profile/malformed.png');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'malformed Storage path denied');
  denied := false;
  BEGIN
    UPDATE storage.objects SET name='20000000-0000-4000-8000-000000000001/profile/renamed.png'
    WHERE bucket_id='profile-images' AND name='ea111111-1111-4111-8111-111111111111/profile/qa-photo.png';
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA object move into official namespace denied by WITH CHECK');
  DELETE FROM storage.objects WHERE bucket_id='profile-images' AND name='ea111111-1111-4111-8111-111111111111/profile/qa-photo.png'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'QA Storage namespace DELETE allowed');
  INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('resume-files','ea111111-1111-4111-8111-111111111111/resume_en.pdf','{"fixture":"qa-pdf"}');
  UPDATE storage.objects SET metadata='{"fixture":"qa-pdf-updated"}' WHERE bucket_id='resume-files' AND name='ea111111-1111-4111-8111-111111111111/resume_en.pdf'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'QA PDF namespace UPDATE allowed');
  DELETE FROM storage.objects WHERE bucket_id='resume-files' AND name='ea111111-1111-4111-8111-111111111111/resume_en.pdf'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=1, 'QA PDF namespace DELETE allowed');

  UPDATE storage.objects SET metadata='{"fixture":"blocked"}' WHERE bucket_id='profile-images' AND name='example-cv/profile/owner-legacy.png'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot overwrite official legacy object');
  DELETE FROM storage.objects WHERE bucket_id='profile-images' AND name='example-cv/profile/owner-legacy.png'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot delete official legacy object');
  UPDATE storage.objects SET metadata='{"fixture":"blocked"}' WHERE bucket_id='resume-files' AND name='example-cv/resume_en.pdf'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot overwrite official legacy PDF');
  DELETE FROM storage.objects WHERE bucket_id='resume-files' AND name='example-cv/resume_en.pdf'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot delete official legacy PDF');
END $$;
SELECT extensions.pass('QA scoped content/root/Storage authorization and target RPC');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$
DECLARE affected integer; denied boolean;
BEGIN
  PERFORM public.rls_test_assert(NOT public.is_resume_admin(), 'non-admin fails existing Admin gate');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.get_admin_resume_target()), 'non-admin target RPC returns no target');
  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key) VALUES ('a3000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',70,'rls-non-admin');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'non-admin content INSERT denied');
  UPDATE public.resume_intro_paragraphs SET position=71 WHERE resume_id='20000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'non-admin content UPDATE denied');
  DELETE FROM public.resume_intro_paragraphs WHERE resume_id='20000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'non-admin content DELETE denied');
  denied := false;
  BEGIN
    INSERT INTO public.cms_admins(user_id) VALUES ('10000000-0000-4000-8000-000000000003');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'non-admin cannot create membership');
END $$;
SELECT extensions.pass('authenticated non-admin fails closed');
RESET ROLE;

DO $$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraph_translations(paragraph_id,resume_id,locale,text)
    VALUES ('b4000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','en','cross-resume');
  EXCEPTION WHEN foreign_key_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'cross-resume translation FK rejected');
  denied := false;
  BEGIN
    INSERT INTO public.resume_project_methods(id,resume_id,project_entry_id,locale,position,value)
    VALUES ('a4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000012','en',30,'cross-resume method');
  EXCEPTION WHEN foreign_key_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'cross-resume project method FK rejected');
  denied := false;
  BEGIN
    INSERT INTO public.resume_locale_content(resume_id,locale,education_label,experience_label,project_heading,skills_label,
      honors_label,contact_label,availability,portfolio_label,portfolio_href,kaggle_label,updated_at_label,linkedin_label,linkedin_href)
    VALUES ('20000000-0000-4000-8000-000000000001','fr','x','x','x','x','x','x','x','x','x','x','x','x','x');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'unsupported locale constraint rejected');
  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key)
    VALUES ('a4000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001',-1,'negative-position');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'negative position constraint rejected');
  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key)
    VALUES ('a4000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001',0,'qa-intro-1');
  EXCEPTION WHEN unique_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'per-resume position/source-key uniqueness preserved');
END $$;
SELECT extensions.pass('cross-resume composite FKs and fixture constraints');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE affected integer; denied boolean;
BEGIN
  UPDATE public.cms_admins SET role='owner', resume_id=NULL WHERE user_id=auth.uid(); GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot self-promote');
  UPDATE public.cms_admins SET role='owner', resume_id=NULL WHERE user_id='10000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM public.rls_test_assert(affected=0, 'QA cannot modify another membership');
  denied := false;
  BEGIN
    INSERT INTO public.cms_admins(user_id,role,resume_id) VALUES ('10000000-0000-4000-8000-000000000004','owner',NULL);
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot create Owner membership');
END $$;
SELECT extensions.pass('membership escalation denied');

SELECT * FROM extensions.finish();
ROLLBACK;
