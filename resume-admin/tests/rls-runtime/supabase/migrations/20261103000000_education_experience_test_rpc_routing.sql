-- Enable the already-installed transactional Education and Experience writers
-- for the unpublished official Test target only. Apply only after separate
-- owner approval; this migration is not executed as part of this change.
BEGIN;

DO $test_target_guard$
DECLARE
  test_resume_id uuid;
  owner_resume_id uuid;
  education_count bigint;
  education_zh_count bigint;
  education_en_count bigint;
  education_before jsonb;
  experience_count bigint;
  experience_zh_count bigint;
  experience_en_count bigint;
  experience_before jsonb;
  max_position integer;
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

  -- The aggregate writers reject incomplete legacy collections. Validate both
  -- current collections before making direct writes unavailable on Test.
  SELECT count(*), count(*) FILTER (WHERE zh.education_entry_id IS NOT NULL),
      count(*) FILTER (WHERE en.education_entry_id IS NOT NULL)
    INTO education_count, education_zh_count, education_en_count
    FROM public.resume_education_entries e
    LEFT JOIN public.resume_education_translations zh ON zh.resume_id = e.resume_id
      AND zh.education_entry_id = e.id AND zh.locale = 'zh'
    LEFT JOIN public.resume_education_translations en ON en.resume_id = e.resume_id
      AND en.education_entry_id = e.id AND en.locale = 'en'
    WHERE e.resume_id = test_resume_id;
  IF education_count > 16 OR education_zh_count <> education_count OR education_en_count <> education_count THEN
    RAISE EXCEPTION 'Test Education collection is incomplete or exceeds the RPC limit';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', e.id::text, 'position', e.position, 'entry_type', e.entry_type, 'education_category', e.education_category,
      'zh', pg_catalog.jsonb_build_object('title', zh.title, 'program', zh.program, 'period', zh.period, 'grade', zh.grade,
        'course_title', zh.course_title, 'course_description', zh.course_description, 'custom_category_label', zh.custom_category_label),
      'en', pg_catalog.jsonb_build_object('title', en.title, 'program', en.program, 'period', en.period, 'grade', en.grade,
        'course_title', en.course_title, 'course_description', en.course_description, 'custom_category_label', en.custom_category_label))
      ORDER BY e.position, e.id), '[]'::jsonb)
    INTO education_before
    FROM public.resume_education_entries e
    JOIN public.resume_education_translations zh ON zh.resume_id = e.resume_id AND zh.education_entry_id = e.id AND zh.locale = 'zh'
    JOIN public.resume_education_translations en ON en.resume_id = e.resume_id AND en.education_entry_id = e.id AND en.locale = 'en'
    WHERE e.resume_id = test_resume_id;
  SELECT COALESCE(max(position), -1) INTO max_position FROM public.resume_education_entries WHERE resume_id = test_resume_id;
  IF max_position > 1000000000 OR pg_catalog.jsonb_array_length(education_before) > 16
    OR pg_catalog.octet_length(pg_catalog.convert_to(education_before::text, 'UTF8')) > 212992
    OR NOT cms_private.activity_event_payload_v2_education_is_allowed('education', 'education_list', NULL, 'update',
      pg_catalog.jsonb_build_object('education', education_before),
      pg_catalog.jsonb_build_object('education', pg_catalog.jsonb_build_object('before', education_before, 'after', education_before))) THEN
    RAISE EXCEPTION 'Test Education collection is outside the supported RPC contract';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE zh.experience_entry_id IS NOT NULL),
      count(*) FILTER (WHERE en.experience_entry_id IS NOT NULL)
    INTO experience_count, experience_zh_count, experience_en_count
    FROM public.resume_experience_entries e
    LEFT JOIN public.resume_experience_translations zh ON zh.resume_id = e.resume_id
      AND zh.experience_entry_id = e.id AND zh.locale = 'zh'
    LEFT JOIN public.resume_experience_translations en ON en.resume_id = e.resume_id
      AND en.experience_entry_id = e.id AND en.locale = 'en'
    WHERE e.resume_id = test_resume_id;
  IF experience_count > 16 OR experience_zh_count <> experience_count OR experience_en_count <> experience_count THEN
    RAISE EXCEPTION 'Test Experience collection is incomplete or exceeds the RPC limit';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', e.id::text, 'position', e.position,
      'zh', pg_catalog.jsonb_build_object('organization', zh.organization, 'title', zh.title, 'period', zh.period, 'description', zh.description, 'location', zh.location),
      'en', pg_catalog.jsonb_build_object('organization', en.organization, 'title', en.title, 'period', en.period, 'description', en.description, 'location', en.location))
      ORDER BY e.position, e.id), '[]'::jsonb)
    INTO experience_before
    FROM public.resume_experience_entries e
    JOIN public.resume_experience_translations zh ON zh.resume_id = e.resume_id AND zh.experience_entry_id = e.id AND zh.locale = 'zh'
    JOIN public.resume_experience_translations en ON en.resume_id = e.resume_id AND en.experience_entry_id = e.id AND en.locale = 'en'
    WHERE e.resume_id = test_resume_id;
  SELECT COALESCE(max(position), -1) INTO max_position FROM public.resume_experience_entries WHERE resume_id = test_resume_id;
  IF max_position > 1000000000 OR pg_catalog.jsonb_array_length(experience_before) > 16
    OR pg_catalog.octet_length(pg_catalog.convert_to(experience_before::text, 'UTF8')) > 212992
    OR NOT cms_private.activity_event_payload_v2_experience_is_allowed('experience', 'experience_list', NULL, 'update',
      pg_catalog.jsonb_build_object('experience', experience_before),
      pg_catalog.jsonb_build_object('experience', pg_catalog.jsonb_build_object('before', experience_before, 'after', experience_before))) THEN
    RAISE EXCEPTION 'Test Experience collection is outside the supported RPC contract';
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
