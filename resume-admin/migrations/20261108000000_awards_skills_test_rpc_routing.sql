-- TEST-ONLY: route Awards and Skills through their existing signed-context RPC writers.
-- This changes configuration for the official unpublished Test target only.
-- It does not change content, history events, Owner settings, or Restore capability.
BEGIN;
SET LOCAL lock_timeout = '2s';

DO $awards_skills_test_activation$
DECLARE
  owner_id constant uuid := '10000000-0000-4000-8000-000000000001';
  test_id constant uuid := 'f6000000-0000-4000-8000-000000000001';
  row_count_value bigint;
  zh_count bigint;
  en_count bigint;
  min_position integer;
  max_position integer;
  awards_before jsonb;
  skills_before jsonb;
  owner_modes_before jsonb;
  owner_requirements_before jsonb;
  owner_capabilities_before jsonb;
  test_other_modes_before jsonb;
  test_other_requirements_before jsonb;
  test_capabilities_before jsonb;
  events_before jsonb;
  system_events_before jsonb;
  content_before jsonb;
  content_after jsonb;
  awards_after jsonb;
  skills_after jsonb;
  changed_rows bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Test Awards/Skills RPC routing requires postgres' USING ERRCODE = '42501';
  END IF;

  IF (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv' AND is_published IS TRUE) <> 1
    OR (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv-qa-activity-log' AND is_published IS FALSE) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=owner_id AND site_key='example-cv' AND is_published IS TRUE)
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=test_id AND site_key='example-cv-qa-activity-log' AND is_published IS FALSE) THEN
    RAISE EXCEPTION 'Owner/Test identity mapping does not match the approved targets';
  END IF;

  -- Drain only Awards/Skills direct writes. RPC writers lock the site row before
  -- these content tables, so NOWAIT below safely aborts if one is in flight.
  LOCK TABLE public.resume_award_entries, public.resume_award_translations,
    public.resume_skill_groups, public.resume_skill_group_translations IN SHARE MODE;

  PERFORM 1 FROM public.resume_sites
    WHERE id IN (owner_id,test_id) ORDER BY id FOR UPDATE NOWAIT;
  IF (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv' AND is_published IS TRUE) <> 1
    OR (SELECT count(*) FROM public.resume_sites WHERE site_key='example-cv-qa-activity-log' AND is_published IS FALSE) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=owner_id AND site_key='example-cv' AND is_published IS TRUE)
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE id=test_id AND site_key='example-cv-qa-activity-log' AND is_published IS FALSE) THEN
    RAISE EXCEPTION 'Owner/Test identity changed while acquiring activation locks';
  END IF;

  -- Lock only these targets' mode, requirement, and capability rows in a stable
  -- order. No other section's configuration is written by this migration.
  PERFORM 1 FROM cms_private.resume_write_modes
    WHERE resume_id IN (owner_id,test_id) AND domain_key IN ('awards','skills')
    ORDER BY resume_id,domain_key FOR UPDATE NOWAIT;
  PERFORM 1 FROM cms_private.resume_domain_requirements
    WHERE resume_id IN (owner_id,test_id) AND domain_key IN ('awards','skills')
      AND requirement_key='trusted_network_context_v11'
    ORDER BY resume_id,domain_key FOR UPDATE NOWAIT;
  PERFORM 1 FROM cms_private.resume_capabilities
    WHERE resume_id IN (owner_id,test_id) AND capability_key IN ('activity_log','restore')
    ORDER BY resume_id,capability_key FOR UPDATE NOWAIT;

  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id=test_id AND domain_key IN ('awards','skills')) <> 2
    OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id=test_id AND domain_key IN ('awards','skills') AND write_mode <> 'direct') THEN
    RAISE EXCEPTION 'Test Awards/Skills modes are not at the expected direct baseline';
  END IF;
  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id=owner_id AND domain_key IN ('awards','skills')) <> 2
    OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id=owner_id AND domain_key IN ('awards','skills') AND write_mode <> 'direct') THEN
    RAISE EXCEPTION 'Owner Awards/Skills modes are not at the expected direct baseline';
  END IF;
  -- A missing requirement row is the existing default-false state, as used by
  -- the RPC readers. Any present row must be explicitly false.
  IF EXISTS (SELECT 1 FROM cms_private.resume_domain_requirements
      WHERE resume_id=test_id AND domain_key IN ('awards','skills')
        AND requirement_key='trusted_network_context_v11' AND enabled IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Test Awards/Skills trusted-context settings are not at the expected false baseline';
  END IF;
  IF EXISTS (SELECT 1 FROM cms_private.resume_domain_requirements
      WHERE resume_id=owner_id AND domain_key IN ('awards','skills')
        AND requirement_key='trusted_network_context_v11' AND enabled IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Owner Awards/Skills trusted-context settings are not at the expected false baseline';
  END IF;
  IF (SELECT count(*) FROM cms_private.resume_capabilities
      WHERE resume_id IN (owner_id,test_id) AND capability_key='activity_log' AND enabled IS TRUE) <> 2
    OR (SELECT count(*) FROM cms_private.resume_capabilities
      WHERE resume_id IN (owner_id,test_id) AND capability_key='restore' AND enabled IS FALSE) <> 2 THEN
    RAISE EXCEPTION 'Activity Log must be enabled and Restore must remain disabled for Owner and Test';
  END IF;

  -- Validate current Test Awards using the same frozen bilingual aggregate
  -- payload accepted by the writer and Version History reader.
  SELECT count(*),count(*) FILTER (WHERE zh.award_entry_id IS NOT NULL),
    count(*) FILTER (WHERE en.award_entry_id IS NOT NULL),
    min(e.position),max(e.position)
    INTO row_count_value,zh_count,en_count,min_position,max_position
    FROM public.resume_award_entries e
    LEFT JOIN public.resume_award_translations zh ON zh.resume_id=e.resume_id
      AND zh.award_entry_id=e.id AND zh.locale='zh'
    LEFT JOIN public.resume_award_translations en ON en.resume_id=e.resume_id
      AND en.award_entry_id=e.id AND en.locale='en'
    WHERE e.resume_id=test_id;
  IF row_count_value>32 OR zh_count<>row_count_value OR en_count<>row_count_value
    OR COALESCE(min_position,0)<0 OR COALESCE(max_position,-1)>1000000000
    OR EXISTS (SELECT 1 FROM public.resume_award_translations tr
      WHERE tr.resume_id=test_id AND tr.locale IN ('zh','en')
        AND (length(tr.name)>200 OR length(tr.year)>64)) THEN
    RAISE EXCEPTION 'Test Awards collection is incomplete or outside the RPC contract';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id::text,'position',e.position,
      'zh',jsonb_build_object('name',COALESCE(zh.name,''),'year',COALESCE(zh.year,'')),
      'en',jsonb_build_object('name',COALESCE(en.name,''),'year',COALESCE(en.year,'')))
      ORDER BY e.position,e.id),'[]'::jsonb)
    INTO awards_before
    FROM public.resume_award_entries e
    JOIN public.resume_award_translations zh ON zh.resume_id=e.resume_id
      AND zh.award_entry_id=e.id AND zh.locale='zh'
    JOIN public.resume_award_translations en ON en.resume_id=e.resume_id
      AND en.award_entry_id=e.id AND en.locale='en'
    WHERE e.resume_id=test_id;
  IF octet_length(convert_to(awards_before::text,'UTF8'))>8192
    OR NOT cms_private.activity_event_payload_v2_awards_is_allowed(
      'awards','award_list',NULL,'update',jsonb_build_object('awards',awards_before),
      jsonb_build_object('awards',jsonb_build_object('before',awards_before,'after',awards_before))) THEN
    RAISE EXCEPTION 'Test Awards snapshot is outside the writer/history payload contract';
  END IF;

  -- Validate Skills against the writer's count, locale, field-size, collection,
  -- and Activity Log aggregate checks.
  SELECT count(*),count(*) FILTER (WHERE zh.skill_group_id IS NOT NULL),
    count(*) FILTER (WHERE en.skill_group_id IS NOT NULL),
    min(g.position),max(g.position)
    INTO row_count_value,zh_count,en_count,min_position,max_position
    FROM public.resume_skill_groups g
    LEFT JOIN public.resume_skill_group_translations zh ON zh.resume_id=g.resume_id
      AND zh.skill_group_id=g.id AND zh.locale='zh'
    LEFT JOIN public.resume_skill_group_translations en ON en.resume_id=g.resume_id
      AND en.skill_group_id=g.id AND en.locale='en'
    WHERE g.resume_id=test_id;
  IF row_count_value>16 OR zh_count<>row_count_value OR en_count<>row_count_value
    OR COALESCE(min_position,0)<0 OR COALESCE(max_position,-1)>1000000000
    OR EXISTS (SELECT 1 FROM public.resume_skill_group_translations tr
      WHERE tr.resume_id=test_id AND tr.locale IN ('zh','en')
        AND (octet_length(convert_to(tr.title,'UTF8'))>64
          OR octet_length(convert_to(tr.items,'UTF8'))>896)) THEN
    RAISE EXCEPTION 'Test Skills collection is incomplete or outside the RPC contract';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',g.id::text,'position',g.position,
      'zh',jsonb_build_object('title',zh.title,'items',zh.items),
      'en',jsonb_build_object('title',en.title,'items',en.items))
      ORDER BY g.position,g.id),'[]'::jsonb)
    INTO skills_before
    FROM public.resume_skill_groups g
    JOIN public.resume_skill_group_translations zh ON zh.resume_id=g.resume_id
      AND zh.skill_group_id=g.id AND zh.locale='zh'
    JOIN public.resume_skill_group_translations en ON en.resume_id=g.resume_id
      AND en.skill_group_id=g.id AND en.locale='en'
    WHERE g.resume_id=test_id;
  IF octet_length(convert_to(skills_before::text,'UTF8'))>212992
    OR NOT cms_private.activity_event_payload_v2_skills_is_allowed(
      'skills','skill_group_list',NULL,'update',jsonb_build_object('skills',skills_before),
      jsonb_build_object('skills',jsonb_build_object('before',skills_before,'after',skills_before))) THEN
    RAISE EXCEPTION 'Test Skills snapshot is outside the writer/history payload contract';
  END IF;

  -- Capture target-scoped state so the postconditions prove that this migration
  -- changed only the two requested Test routing settings.
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key),'[]'::jsonb)
    INTO owner_modes_before FROM cms_private.resume_write_modes r WHERE r.resume_id=owner_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key,r.requirement_key),'[]'::jsonb)
    INTO owner_requirements_before FROM cms_private.resume_domain_requirements r WHERE r.resume_id=owner_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.capability_key),'[]'::jsonb)
    INTO owner_capabilities_before FROM cms_private.resume_capabilities r WHERE r.resume_id=owner_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key),'[]'::jsonb)
    INTO test_other_modes_before FROM cms_private.resume_write_modes r
    WHERE r.resume_id=test_id AND r.domain_key NOT IN ('awards','skills');
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key,r.requirement_key),'[]'::jsonb)
    INTO test_other_requirements_before FROM cms_private.resume_domain_requirements r
    WHERE r.resume_id=test_id AND NOT (r.domain_key IN ('awards','skills')
      AND r.requirement_key='trusted_network_context_v11');
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.capability_key),'[]'::jsonb)
    INTO test_capabilities_before FROM cms_private.resume_capabilities r WHERE r.resume_id=test_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb)
    INTO events_before FROM cms_private.activity_log_events e WHERE e.resume_id IN (owner_id,test_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.event_id),'[]'::jsonb)
    INTO system_events_before FROM cms_private.activity_log_system_events e WHERE e.resume_id IN (owner_id,test_id);
  SELECT jsonb_build_object(
      'awardEntries',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.id)
        FROM public.resume_award_entries r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb),
      'awardTranslations',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.award_entry_id,r.locale)
        FROM public.resume_award_translations r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb),
      'skillGroups',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.id)
        FROM public.resume_skill_groups r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb),
      'skillTranslations',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.skill_group_id,r.locale)
        FROM public.resume_skill_group_translations r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb)
    ) INTO content_before;

  UPDATE cms_private.resume_write_modes
    SET write_mode='rpc',updated_at=transaction_timestamp()
    WHERE resume_id=test_id AND domain_key IN ('awards','skills');
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows<>2 THEN RAISE EXCEPTION 'Test Awards/Skills mode activation updated an unexpected row count'; END IF;

  INSERT INTO cms_private.resume_domain_requirements(resume_id,domain_key,requirement_key,enabled)
    VALUES (test_id,'awards','trusted_network_context_v11',true),
           (test_id,'skills','trusted_network_context_v11',true)
    ON CONFLICT (resume_id,domain_key,requirement_key)
    DO UPDATE SET enabled=true,updated_at=transaction_timestamp()
      WHERE cms_private.resume_domain_requirements.enabled IS DISTINCT FROM true;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows<>2 THEN RAISE EXCEPTION 'Test Awards/Skills trusted-context activation updated an unexpected row count'; END IF;

  IF (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id=test_id AND domain_key IN ('awards','skills') AND write_mode='rpc')<>2
    OR (SELECT count(*) FROM cms_private.resume_domain_requirements
      WHERE resume_id=test_id AND domain_key IN ('awards','skills')
        AND requirement_key='trusted_network_context_v11' AND enabled IS TRUE)<>2 THEN
    RAISE EXCEPTION 'Test Awards/Skills activation postcondition failed';
  END IF;

  IF (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key),'[]'::jsonb)
      FROM cms_private.resume_write_modes r WHERE r.resume_id=owner_id) IS DISTINCT FROM owner_modes_before
    OR (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key,r.requirement_key),'[]'::jsonb)
      FROM cms_private.resume_domain_requirements r WHERE r.resume_id=owner_id) IS DISTINCT FROM owner_requirements_before
    OR (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.capability_key),'[]'::jsonb)
      FROM cms_private.resume_capabilities r WHERE r.resume_id=owner_id) IS DISTINCT FROM owner_capabilities_before THEN
    RAISE EXCEPTION 'Owner configuration changed unexpectedly';
  END IF;
  IF (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key),'[]'::jsonb)
      FROM cms_private.resume_write_modes r WHERE r.resume_id=test_id AND r.domain_key NOT IN ('awards','skills'))
      IS DISTINCT FROM test_other_modes_before
    OR (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.domain_key,r.requirement_key),'[]'::jsonb)
      FROM cms_private.resume_domain_requirements r WHERE r.resume_id=test_id
        AND NOT (r.domain_key IN ('awards','skills') AND r.requirement_key='trusted_network_context_v11'))
      IS DISTINCT FROM test_other_requirements_before
    OR (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.capability_key),'[]'::jsonb)
      FROM cms_private.resume_capabilities r WHERE r.resume_id=test_id) IS DISTINCT FROM test_capabilities_before THEN
    RAISE EXCEPTION 'Unrelated Test configuration changed unexpectedly';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',e.id::text,'position',e.position,
      'zh',jsonb_build_object('name',zh.name,'year',zh.year),
      'en',jsonb_build_object('name',en.name,'year',en.year)) ORDER BY e.position,e.id),'[]'::jsonb)
    INTO awards_after FROM public.resume_award_entries e
    JOIN public.resume_award_translations zh ON zh.resume_id=e.resume_id AND zh.award_entry_id=e.id AND zh.locale='zh'
    JOIN public.resume_award_translations en ON en.resume_id=e.resume_id AND en.award_entry_id=e.id AND en.locale='en'
    WHERE e.resume_id=test_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',g.id::text,'position',g.position,
      'zh',jsonb_build_object('title',zh.title,'items',zh.items),
      'en',jsonb_build_object('title',en.title,'items',en.items)) ORDER BY g.position,g.id),'[]'::jsonb)
    INTO skills_after FROM public.resume_skill_groups g
    JOIN public.resume_skill_group_translations zh ON zh.resume_id=g.resume_id AND zh.skill_group_id=g.id AND zh.locale='zh'
    JOIN public.resume_skill_group_translations en ON en.resume_id=g.resume_id AND en.skill_group_id=g.id AND en.locale='en'
    WHERE g.resume_id=test_id;
  SELECT jsonb_build_object(
      'awardEntries',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.id)
        FROM public.resume_award_entries r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb),
      'awardTranslations',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.award_entry_id,r.locale)
        FROM public.resume_award_translations r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb),
      'skillGroups',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.id)
        FROM public.resume_skill_groups r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb),
      'skillTranslations',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.resume_id,r.skill_group_id,r.locale)
        FROM public.resume_skill_group_translations r WHERE r.resume_id IN (owner_id,test_id)),'[]'::jsonb)
    ) INTO content_after;
  IF awards_after IS DISTINCT FROM awards_before OR skills_after IS DISTINCT FROM skills_before
    OR content_after IS DISTINCT FROM content_before
    OR (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb)
      FROM cms_private.activity_log_events e WHERE e.resume_id IN (owner_id,test_id)) IS DISTINCT FROM events_before
    OR (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.event_id),'[]'::jsonb)
      FROM cms_private.activity_log_system_events e WHERE e.resume_id IN (owner_id,test_id)) IS DISTINCT FROM system_events_before THEN
    RAISE EXCEPTION 'Content or Activity Log history changed unexpectedly';
  END IF;
END
$awards_skills_test_activation$;

COMMIT;
