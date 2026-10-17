-- DRAFT FOR REVIEW ONLY. DO NOT APPLY WITHOUT SEPARATE PRODUCTION APPROVAL.
-- Enable existing signed-context RPC writers for the published Owner target only.
-- No resume content is changed. The official Test target must remain unchanged.
BEGIN;

DO $owner_three_domain_guard$
DECLARE
  owner_id uuid;
  test_id uuid;
  domain_name text;
  record_count bigint;
  zh_count bigint;
  en_count bigint;
  max_pos integer;
  before_value jsonb;
  test_before jsonb;
  test_after jsonb;
  test_requirements_before jsonb;
  test_requirements_after jsonb;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Owner RPC routing requires postgres' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv' AND is_published IS TRUE) <> 1
    OR (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv-qa-activity-log' AND is_published IS FALSE) <> 1 THEN
    RAISE EXCEPTION 'Expected one published Owner and one unpublished official Test target';
  END IF;
  SELECT id INTO owner_id FROM public.resume_sites WHERE site_key='example-cv' AND is_published IS TRUE;
  SELECT id INTO test_id FROM public.resume_sites WHERE site_key='example-cv-qa-activity-log' AND is_published IS FALSE;
  IF owner_id <> '10000000-0000-4000-8000-000000000001'::uuid
    OR test_id <> 'f6000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'Unexpected Owner/Test resume identity';
  END IF;

  -- Drain direct and RPC content writes before validation. Taking these first
  -- avoids a cycle with direct INSERTs, which take a content-table write lock
  -- before their foreign-key check locks resume_sites.
  LOCK TABLE public.resume_education_entries, public.resume_education_translations,
    public.resume_experience_entries, public.resume_experience_translations,
    public.resume_intro_paragraphs, public.resume_intro_paragraph_translations
    IN SHARE MODE;

  -- The writers lock resume_sites before their content tables. NOWAIT makes
  -- the reverse-order probe fail and roll back if an RPC currently holds either
  -- target row while waiting to write through the table locks above.
  PERFORM 1 FROM public.resume_sites
    WHERE id IN (owner_id,test_id)
    ORDER BY id FOR UPDATE NOWAIT;
  IF (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv' AND is_published IS TRUE) <> 1
    OR (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv-qa-activity-log' AND is_published IS FALSE) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=owner_id AND site_key='example-cv' AND is_published IS TRUE)
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=test_id AND site_key='example-cv-qa-activity-log' AND is_published IS FALSE) THEN
    RAISE EXCEPTION 'Owner/Test identity changed while acquiring activation locks';
  END IF;

  IF NOT COALESCE((SELECT enabled FROM cms_private.resume_capabilities
      WHERE resume_id=owner_id AND capability_key='activity_log'),false)
    OR NOT COALESCE((SELECT enabled FROM cms_private.resume_capabilities
      WHERE resume_id=test_id AND capability_key='activity_log'),false) THEN
    RAISE EXCEPTION 'Activity Log must be enabled for both targets';
  END IF;
  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id=owner_id AND domain_key IN ('introduction','education','experience')) <> 3
    OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id=owner_id AND domain_key IN ('introduction','education','experience') AND write_mode <> 'direct') THEN
    RAISE EXCEPTION 'Owner modes are not at the expected direct baseline';
  END IF;
  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id=test_id AND domain_key IN ('introduction','education','experience')) <> 3
    OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id=test_id AND domain_key IN ('introduction','education','experience') AND write_mode <> 'rpc') THEN
    RAISE EXCEPTION 'Official Test RPC baseline has changed';
  END IF;
  IF EXISTS (SELECT 1 FROM cms_private.resume_domain_requirements
      WHERE resume_id=owner_id AND domain_key IN ('introduction','education','experience')
        AND requirement_key='trusted_network_context_v11' AND enabled) THEN
    RAISE EXCEPTION 'Owner trusted-context baseline has changed';
  END IF;
  IF (SELECT count(*) FROM cms_private.resume_domain_requirements
      WHERE resume_id=test_id AND domain_key IN ('introduction','education','experience')
        AND requirement_key='trusted_network_context_v11' AND enabled) <> 3 THEN
    RAISE EXCEPTION 'Official Test trusted-context baseline has changed';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('domain',domain_key,'enabled',enabled) ORDER BY domain_key)
    INTO test_requirements_before FROM cms_private.resume_domain_requirements
    WHERE resume_id=test_id AND domain_key IN ('introduction','education','experience')
      AND requirement_key='trusted_network_context_v11';
  SELECT jsonb_agg(jsonb_build_object('domain',domain_key,'mode',write_mode) ORDER BY domain_key)
    INTO test_before FROM cms_private.resume_write_modes
    WHERE resume_id=test_id AND domain_key IN ('introduction','education','experience');

  -- Introduction: 200 paragraphs max, two complete translations per paragraph,
  -- 12,000 characters per locale and safe position arithmetic for the writer.
  SELECT count(*),count(*) FILTER (WHERE zh.paragraph_id IS NOT NULL),
    count(*) FILTER (WHERE en.paragraph_id IS NOT NULL),max(p.position)
    INTO record_count,zh_count,en_count,max_pos
    FROM public.resume_intro_paragraphs p
    LEFT JOIN public.resume_intro_paragraph_translations zh ON zh.resume_id=p.resume_id AND zh.paragraph_id=p.id AND zh.locale='zh'
    LEFT JOIN public.resume_intro_paragraph_translations en ON en.resume_id=p.resume_id AND en.paragraph_id=p.id AND en.locale='en'
    WHERE p.resume_id=owner_id;
  IF record_count>200 OR zh_count<>record_count OR en_count<>record_count
    OR COALESCE(max_pos,-1) > ((2147483647 - 200 - 1001)/2) THEN
    RAISE EXCEPTION 'Owner Introduction collection is incompatible with RPC';
  END IF;
  IF EXISTS (SELECT 1 FROM public.resume_intro_paragraphs p
    JOIN public.resume_intro_paragraph_translations tr ON tr.resume_id=p.resume_id AND tr.paragraph_id=p.id
    WHERE p.resume_id=owner_id AND tr.locale IN ('zh','en') AND (tr.text IS NULL OR length(tr.text)>12000)) THEN
    RAISE EXCEPTION 'Owner Introduction translation exceeds RPC limits';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',p.id::text,'position',p.position,'text_zh',COALESCE(zh.text,''),'text_en',COALESCE(en.text,''))
      ORDER BY p.position,p.id),'[]'::jsonb)
    INTO before_value
    FROM public.resume_intro_paragraphs p
    JOIN public.resume_intro_paragraph_translations zh ON zh.resume_id=p.resume_id AND zh.paragraph_id=p.id AND zh.locale='zh'
    JOIN public.resume_intro_paragraph_translations en ON en.resume_id=p.resume_id AND en.paragraph_id=p.id AND en.locale='en'
    WHERE p.resume_id=owner_id;
  IF NOT cms_private.activity_event_payload_is_allowed('introduction_paragraph',
      jsonb_build_object('paragraphs',before_value),'{}'::jsonb) THEN
    RAISE EXCEPTION 'Owner Introduction snapshot is outside the Activity Log contract';
  END IF;

  -- Education: same snapshot and activity payload validation as the Test migration.
  SELECT count(*),count(*) FILTER (WHERE zh.education_entry_id IS NOT NULL),
    count(*) FILTER (WHERE en.education_entry_id IS NOT NULL)
    INTO record_count,zh_count,en_count
    FROM public.resume_education_entries e
    LEFT JOIN public.resume_education_translations zh ON zh.resume_id=e.resume_id AND zh.education_entry_id=e.id AND zh.locale='zh'
    LEFT JOIN public.resume_education_translations en ON en.resume_id=e.resume_id AND en.education_entry_id=e.id AND en.locale='en'
    WHERE e.resume_id=owner_id;
  IF record_count>16 OR zh_count<>record_count OR en_count<>record_count THEN
    RAISE EXCEPTION 'Owner Education collection is incomplete or too large';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id::text,'position',e.position,'entry_type',e.entry_type,'education_category',e.education_category,
      'zh',jsonb_build_object('title',zh.title,'program',zh.program,'period',zh.period,'grade',zh.grade,
        'course_title',zh.course_title,'course_description',zh.course_description,'custom_category_label',zh.custom_category_label),
      'en',jsonb_build_object('title',en.title,'program',en.program,'period',en.period,'grade',en.grade,
        'course_title',en.course_title,'course_description',en.course_description,'custom_category_label',en.custom_category_label))
      ORDER BY e.position,e.id),'[]'::jsonb)
    INTO before_value
    FROM public.resume_education_entries e
    JOIN public.resume_education_translations zh ON zh.resume_id=e.resume_id AND zh.education_entry_id=e.id AND zh.locale='zh'
    JOIN public.resume_education_translations en ON en.resume_id=e.resume_id AND en.education_entry_id=e.id AND en.locale='en'
    WHERE e.resume_id=owner_id;
  SELECT COALESCE(max(position),-1) INTO max_pos FROM public.resume_education_entries WHERE resume_id=owner_id;
  IF max_pos>1000000000 OR octet_length(convert_to(before_value::text,'UTF8'))>212992
    OR NOT cms_private.activity_event_payload_v2_education_is_allowed('education','education_list',NULL,'update',
      jsonb_build_object('education',before_value),
      jsonb_build_object('education',jsonb_build_object('before',before_value,'after',before_value))) THEN
    RAISE EXCEPTION 'Owner Education collection is outside RPC contract';
  END IF;

  -- Experience: same snapshot and activity payload validation as the Test migration.
  SELECT count(*),count(*) FILTER (WHERE zh.experience_entry_id IS NOT NULL),
    count(*) FILTER (WHERE en.experience_entry_id IS NOT NULL)
    INTO record_count,zh_count,en_count
    FROM public.resume_experience_entries e
    LEFT JOIN public.resume_experience_translations zh ON zh.resume_id=e.resume_id AND zh.experience_entry_id=e.id AND zh.locale='zh'
    LEFT JOIN public.resume_experience_translations en ON en.resume_id=e.resume_id AND en.experience_entry_id=e.id AND en.locale='en'
    WHERE e.resume_id=owner_id;
  IF record_count>16 OR zh_count<>record_count OR en_count<>record_count THEN
    RAISE EXCEPTION 'Owner Experience collection is incomplete or too large';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id::text,'position',e.position,
      'zh',jsonb_build_object('organization',zh.organization,'title',zh.title,'period',zh.period,'description',zh.description,'location',zh.location),
      'en',jsonb_build_object('organization',en.organization,'title',en.title,'period',en.period,'description',en.description,'location',en.location))
      ORDER BY e.position,e.id),'[]'::jsonb)
    INTO before_value
    FROM public.resume_experience_entries e
    JOIN public.resume_experience_translations zh ON zh.resume_id=e.resume_id AND zh.experience_entry_id=e.id AND zh.locale='zh'
    JOIN public.resume_experience_translations en ON en.resume_id=e.resume_id AND en.experience_entry_id=e.id AND en.locale='en'
    WHERE e.resume_id=owner_id;
  SELECT COALESCE(max(position),-1) INTO max_pos FROM public.resume_experience_entries WHERE resume_id=owner_id;
  IF max_pos>1000000000 OR octet_length(convert_to(before_value::text,'UTF8'))>212992
    OR NOT cms_private.activity_event_payload_v2_experience_is_allowed('experience','experience_list',NULL,'update',
      jsonb_build_object('experience',before_value),
      jsonb_build_object('experience',jsonb_build_object('before',before_value,'after',before_value))) THEN
    RAISE EXCEPTION 'Owner Experience collection is outside RPC contract';
  END IF;

  -- Configuration-only activation, never mutate the resume content tables.
  UPDATE cms_private.resume_write_modes
    SET write_mode='rpc',updated_at=transaction_timestamp()
    WHERE resume_id=owner_id AND domain_key IN ('introduction','education','experience');
  INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
    VALUES (owner_id,'introduction','trusted_network_context_v11',true),
           (owner_id,'education','trusted_network_context_v11',true),
           (owner_id,'experience','trusted_network_context_v11',true)
    ON CONFLICT (resume_id,domain_key,requirement_key)
    DO UPDATE SET enabled=true,updated_at=transaction_timestamp();
  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id=owner_id AND domain_key IN ('introduction','education','experience') AND write_mode='rpc') <> 3
    OR (SELECT count(*) FROM cms_private.resume_domain_requirements
      WHERE resume_id=owner_id AND domain_key IN ('introduction','education','experience')
        AND requirement_key='trusted_network_context_v11' AND enabled) <> 3 THEN
    RAISE EXCEPTION 'Owner RPC activation postcondition failed';
  END IF;
  SELECT jsonb_agg(jsonb_build_object('domain',domain_key,'enabled',enabled) ORDER BY domain_key)
    INTO test_requirements_after FROM cms_private.resume_domain_requirements
    WHERE resume_id=test_id AND domain_key IN ('introduction','education','experience')
      AND requirement_key='trusted_network_context_v11';
  SELECT jsonb_agg(jsonb_build_object('domain',domain_key,'mode',write_mode) ORDER BY domain_key)
    INTO test_after FROM cms_private.resume_write_modes
    WHERE resume_id=test_id AND domain_key IN ('introduction','education','experience');
  IF test_before IS DISTINCT FROM test_after
    OR test_requirements_before IS DISTINCT FROM test_requirements_after THEN
    RAISE EXCEPTION 'Official Test configuration changed unexpectedly';
  END IF;
END
$owner_three_domain_guard$;
COMMIT;
