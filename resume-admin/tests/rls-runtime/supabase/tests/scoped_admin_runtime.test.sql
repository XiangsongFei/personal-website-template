-- TEST ONLY. Executed by `supabase test db --local` against the dedicated local project.
BEGIN;
SELECT extensions.plan(6);
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
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_sites WHERE site_key='example-cv-qa'), 'anon cannot read unpublished QA root');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.resume_profile WHERE resume_id='ea111111-1111-4111-8111-111111111111'), 'anon cannot read unpublished QA content');
  PERFORM public.rls_test_assert(auth.uid() IS NULL, 'anon has no synthetic user identity');
END $$;
SELECT extensions.pass('anonymous published/unpublished read behavior');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE affected integer;
BEGIN
  PERFORM public.rls_test_assert(auth.uid()='10000000-0000-4000-8000-000000000001'::uuid, 'auth.uid resolves synthetic owner JWT subject');
  PERFORM public.rls_test_assert(public.is_resume_admin(), 'owner remains an admin');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.get_admin_resume_target() WHERE resume_id='20000000-0000-4000-8000-000000000001' AND site_key='example-cv' AND role='owner'), 'owner target RPC resolves official site');
  PERFORM public.rls_test_assert((SELECT count(*)>0 FROM public.resume_profile WHERE resume_id='20000000-0000-4000-8000-000000000001'), 'owner reads official content');
  PERFORM public.rls_test_assert((SELECT count(*)>0 FROM public.resume_intro_paragraphs WHERE resume_id='ea111111-1111-4111-8111-111111111111'), 'owner reads QA content');

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
DECLARE affected integer; denied boolean;
BEGIN
  PERFORM public.rls_test_assert(auth.uid()='10000000-0000-4000-8000-000000000002'::uuid, 'auth.uid resolves synthetic QA JWT subject');
  PERFORM public.rls_test_assert(public.is_resume_admin(), 'QA membership passes existing Admin gate');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.get_admin_resume_target() WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND site_key='example-cv-qa' AND role='qa'), 'QA target RPC resolves bound QA site');
  PERFORM public.rls_test_assert((SELECT count(*)>0 FROM public.resume_intro_paragraphs WHERE resume_id='ea111111-1111-4111-8111-111111111111'), 'QA can read QA content');

  denied := false;
  BEGIN
    INSERT INTO public.resume_intro_paragraphs(id,resume_id,position,source_key) VALUES ('a2000000-0000-4000-8000-000000000001','ea111111-1111-4111-8111-111111111111',50,'rls-qa-stale-direct');
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot bypass Introduction RPC mode with direct INSERT');
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
    VALUES ('ea000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','en','cross-resume');
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
