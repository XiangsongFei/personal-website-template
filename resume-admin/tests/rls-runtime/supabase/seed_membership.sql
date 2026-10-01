-- TEST ONLY. Synthetic QA membership; this runs only against the local lab.
DO $seed_qa_member$
DECLARE qa_id constant uuid := 'ea111111-1111-4111-8111-111111111111';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=qa_id AND site_key='example-cv-qa' AND is_published=false) THEN
    RAISE EXCEPTION 'Local QA fixture root missing or unsafe';
  END IF;
  INSERT INTO public.cms_admins(user_id, role, resume_id)
  VALUES ('10000000-0000-4000-8000-000000000002','qa',qa_id);
END
$seed_qa_member$;
