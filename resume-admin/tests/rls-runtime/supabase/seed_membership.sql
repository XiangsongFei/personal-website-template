-- TEST ONLY. Synthetic QA membership; this runs only against the local lab.
DO $seed_qa_member$
DECLARE qa_id constant uuid := 'ea111111-1111-4111-8111-111111111111';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=qa_id AND site_key='example-cv-qa' AND is_published=false) THEN
    RAISE EXCEPTION 'Local QA fixture root missing or unsafe';
  END IF;
  INSERT INTO cms_private.resume_write_modes (resume_id,domain_key,write_mode)
  SELECT qa_id, domain.domain_key, 'direct'
  FROM (VALUES
    ('introduction'), ('education'), ('experience'), ('awards'), ('skills'),
    ('contact'), ('projects'), ('website_links'), ('profile'), ('files')
  ) AS domain(domain_key)
  ON CONFLICT (resume_id,domain_key) DO NOTHING;
  INSERT INTO public.cms_admins(user_id, role, resume_id)
  VALUES ('10000000-0000-4000-8000-000000000002','qa',qa_id);
  INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
  VALUES (qa_id,'activity_log',true)
  ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true;
  UPDATE cms_private.resume_write_modes SET write_mode='rpc'
  WHERE resume_id=qa_id AND domain_key='introduction';
END
$seed_qa_member$;
