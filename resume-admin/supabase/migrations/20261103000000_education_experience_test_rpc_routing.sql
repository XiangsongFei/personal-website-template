-- Enable the already-installed transactional Education and Experience writers
-- for the unpublished official Test target only. Apply only after separate
-- owner approval; this migration is not executed as part of this change.
BEGIN;

DO $test_target_guard$
DECLARE
  test_resume_id uuid;
  owner_resume_id uuid;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Education/Experience Test routing must be configured as postgres'
      USING ERRCODE = '42501';
  END IF;

  IF (SELECT count(*) FROM public.resume_sites WHERE site_key = 'example-cv-qa-activity-log' AND is_published IS FALSE) <> 1
    OR (SELECT count(*) FROM public.resume_sites WHERE site_key = 'example-cv') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one official Test target and one Owner target';
  END IF;

  SELECT id INTO test_resume_id FROM public.resume_sites
    WHERE site_key = 'example-cv-qa-activity-log' AND is_published IS FALSE;
  SELECT id INTO owner_resume_id FROM public.resume_sites WHERE site_key = 'example-cv';

  IF NOT COALESCE((SELECT enabled FROM cms_private.resume_capabilities
      WHERE resume_id = test_resume_id AND capability_key = 'activity_log'), false) THEN
    RAISE EXCEPTION 'Activity Log must already be enabled for the official Test target';
  END IF;

  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id = test_resume_id AND domain_key IN ('education', 'experience')) <> 2
    OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id = test_resume_id AND domain_key IN ('education', 'experience') AND write_mode <> 'direct') THEN
    RAISE EXCEPTION 'Test Education/Experience modes are not in the expected direct baseline';
  END IF;

  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id = owner_resume_id AND domain_key IN ('education', 'experience')) <> 2
    OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id = owner_resume_id AND domain_key IN ('education', 'experience') AND write_mode <> 'direct') THEN
    RAISE EXCEPTION 'Owner Education/Experience modes must remain direct';
  END IF;

  UPDATE cms_private.resume_write_modes
    SET write_mode = 'rpc', updated_at = pg_catalog.transaction_timestamp()
    WHERE resume_id = test_resume_id AND domain_key IN ('education', 'experience');

  INSERT INTO cms_private.resume_domain_requirements(resume_id, domain_key, requirement_key, enabled)
  VALUES
    (test_resume_id, 'education', 'trusted_network_context_v11', true),
    (test_resume_id, 'experience', 'trusted_network_context_v11', true)
  ON CONFLICT (resume_id, domain_key, requirement_key)
    DO UPDATE SET enabled = true, updated_at = pg_catalog.transaction_timestamp();

  IF EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id = owner_resume_id AND domain_key IN ('education', 'experience') AND write_mode <> 'direct') THEN
    RAISE EXCEPTION 'Owner Education/Experience modes changed unexpectedly';
  END IF;
END
$test_target_guard$;

COMMIT;
