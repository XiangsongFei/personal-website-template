-- Restore V1: target-scoped, domain-level restoration from validated V2 BEFORE state.
-- Additive only. No target is enabled by this migration.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Restore V1 must be installed as postgres' USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

ALTER TABLE cms_private.resume_capabilities
  DROP CONSTRAINT resume_capabilities_capability_key_check;
ALTER TABLE cms_private.resume_capabilities
  ADD CONSTRAINT resume_capabilities_capability_key_check
  CHECK (capability_key IN ('activity_log', 'activity_log_system_events', 'restore'));

CREATE TABLE cms_private.activity_log_restore_links (
  result_event_id uuid PRIMARY KEY REFERENCES cms_private.activity_log_events(id) ON DELETE CASCADE,
  source_event_id uuid NOT NULL REFERENCES cms_private.activity_log_events(id) ON DELETE RESTRICT,
  resume_id uuid NOT NULL REFERENCES public.resume_sites(id) ON DELETE CASCADE,
  domain_key text NOT NULL CHECK (domain_key IN
    ('awards','experience','skills','education','projects','contact','website_links')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CHECK (result_event_id <> source_event_id)
);
CREATE INDEX activity_log_restore_links_source_idx
  ON cms_private.activity_log_restore_links(resume_id, source_event_id, created_at DESC);
ALTER TABLE cms_private.activity_log_restore_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cms_private.activity_log_restore_links
  FROM PUBLIC, anon, authenticated, service_role, pg_write_all_data;

CREATE FUNCTION cms_private.enforce_activity_log_restore_link()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE result_row cms_private.activity_log_events%ROWTYPE;
  source_row cms_private.activity_log_events%ROWTYPE;
BEGIN
  SELECT * INTO result_row FROM cms_private.activity_log_events WHERE id=NEW.result_event_id;
  SELECT * INTO source_row FROM cms_private.activity_log_events WHERE id=NEW.source_event_id;
  IF result_row.id IS NULL OR source_row.id IS NULL
    OR result_row.resume_id IS DISTINCT FROM NEW.resume_id
    OR source_row.resume_id IS DISTINCT FROM NEW.resume_id
    OR result_row.operation IS DISTINCT FROM 'update'
    OR result_row.payload_version IS DISTINCT FROM 2
    OR result_row.section_key IS DISTINCT FROM NEW.domain_key
    OR source_row.section_key IS DISTINCT FROM NEW.domain_key
    OR source_row.payload_version IS DISTINCT FROM 2
    OR source_row.operation IS DISTINCT FROM 'update' THEN
    RAISE EXCEPTION 'Restore event linkage is inconsistent' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.enforce_activity_log_restore_link() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER activity_log_restore_link_consistency
  BEFORE INSERT OR UPDATE ON cms_private.activity_log_restore_links
  FOR EACH ROW EXECUTE FUNCTION cms_private.enforce_activity_log_restore_link();

CREATE FUNCTION cms_private.restore_domain_for_event(
  target_section text, target_entity_type text, target_entity_id text
)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE
    WHEN target_section='awards' AND target_entity_type='award_list' AND target_entity_id IS NULL THEN 'awards'
    WHEN target_section='experience' AND target_entity_type='experience_list' AND target_entity_id IS NULL THEN 'experience'
    WHEN target_section='skills' AND target_entity_type='skill_group_list' AND target_entity_id IS NULL THEN 'skills'
    WHEN target_section='education' AND target_entity_type='education_list' AND target_entity_id IS NULL THEN 'education'
    WHEN target_section='projects' AND target_entity_type='project_list' AND target_entity_id IS NULL THEN 'projects'
    WHEN target_section='contact' AND target_entity_type='contact_section' AND target_entity_id IS NULL THEN 'contact'
    WHEN target_section='website_links' AND target_entity_type='website_links_settings' AND target_entity_id IS NULL THEN 'website_links'
    ELSE NULL END
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_domain_for_event(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.restore_dense_positions(target_domain text, aggregate_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE output_value jsonb;
BEGIN
  IF target_domain='contact' THEN
    SELECT pg_catalog.jsonb_set(pg_catalog.jsonb_set(aggregate_value,'{focus}',
      COALESCE((SELECT pg_catalog.jsonb_agg(item.value || pg_catalog.jsonb_build_object('position',(item.ordinality-1)::integer) ORDER BY item.ordinality)
        FROM pg_catalog.jsonb_array_elements(aggregate_value->'focus') WITH ORDINALITY item(value,ordinality)),'[]'::jsonb)),
      '{status}',COALESCE((SELECT pg_catalog.jsonb_agg(item.value || pg_catalog.jsonb_build_object('position',(item.ordinality-1)::integer) ORDER BY item.ordinality)
        FROM pg_catalog.jsonb_array_elements(aggregate_value->'status') WITH ORDINALITY item(value,ordinality)),'[]'::jsonb))
      INTO output_value;
    RETURN output_value;
  ELSIF target_domain='projects' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(
      p.value || pg_catalog.jsonb_build_object('position',(p.ordinality-1)::integer,'methods',
        pg_catalog.jsonb_build_object('zh',COALESCE((SELECT pg_catalog.jsonb_agg(m.value || pg_catalog.jsonb_build_object('position',(m.ordinality-1)::integer) ORDER BY m.ordinality)
          FROM pg_catalog.jsonb_array_elements(p.value->'methods'->'zh') WITH ORDINALITY m(value,ordinality)),'[]'::jsonb),
          'en',COALESCE((SELECT pg_catalog.jsonb_agg(m.value || pg_catalog.jsonb_build_object('position',(m.ordinality-1)::integer) ORDER BY m.ordinality)
          FROM pg_catalog.jsonb_array_elements(p.value->'methods'->'en') WITH ORDINALITY m(value,ordinality)),'[]'::jsonb)))
      ORDER BY p.ordinality),'[]'::jsonb) INTO output_value
      FROM pg_catalog.jsonb_array_elements(aggregate_value) WITH ORDINALITY p(value,ordinality);
    RETURN output_value;
  END IF;
  RETURN aggregate_value;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_dense_positions(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.restore_aggregate_is_allowed(target_domain text, aggregate_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE snap jsonb; changes_value jsonb;
BEGIN
  IF target_domain NOT IN ('awards','experience','skills','education','projects','contact','website_links') THEN RETURN false; END IF;
  aggregate_value:=cms_private.restore_dense_positions(target_domain,aggregate_value);
  snap:=pg_catalog.jsonb_build_object(target_domain,aggregate_value);
  changes_value:=pg_catalog.jsonb_build_object(target_domain,
    pg_catalog.jsonb_build_object('before',aggregate_value,'after',aggregate_value));
  RETURN cms_private.activity_event_payload_v2_is_allowed(
    target_domain,
    CASE target_domain WHEN 'awards' THEN 'award_list' WHEN 'experience' THEN 'experience_list'
      WHEN 'skills' THEN 'skill_group_list' WHEN 'education' THEN 'education_list'
      WHEN 'projects' THEN 'project_list' WHEN 'contact' THEN 'contact_section'
      ELSE 'website_links_settings' END,
    NULL,'update',snap,changes_value);
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_aggregate_is_allowed(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.restore_current_aggregate(target_resume_id uuid, target_domain text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE value jsonb;
BEGIN
  CASE target_domain
  WHEN 'awards' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
      'zh',pg_catalog.jsonb_build_object('name',zh.name,'year',zh.year),
      'en',pg_catalog.jsonb_build_object('name',en.name,'year',en.year)) ORDER BY e.position),'[]'::jsonb)
      INTO value FROM public.resume_award_entries e
      JOIN public.resume_award_translations zh ON zh.resume_id=e.resume_id AND zh.award_entry_id=e.id AND zh.locale='zh'
      JOIN public.resume_award_translations en ON en.resume_id=e.resume_id AND en.award_entry_id=e.id AND en.locale='en'
      WHERE e.resume_id=target_resume_id;
  WHEN 'experience' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
      'zh',pg_catalog.jsonb_build_object('organization',zh.organization,'title',zh.title,'period',zh.period,'description',zh.description,'location',zh.location),
      'en',pg_catalog.jsonb_build_object('organization',en.organization,'title',en.title,'period',en.period,'description',en.description,'location',en.location)) ORDER BY e.position),'[]'::jsonb)
      INTO value FROM public.resume_experience_entries e
      JOIN public.resume_experience_translations zh ON zh.resume_id=e.resume_id AND zh.experience_entry_id=e.id AND zh.locale='zh'
      JOIN public.resume_experience_translations en ON en.resume_id=e.resume_id AND en.experience_entry_id=e.id AND en.locale='en'
      WHERE e.resume_id=target_resume_id;
  WHEN 'skills' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'items',zh.items),
      'en',pg_catalog.jsonb_build_object('title',en.title,'items',en.items)) ORDER BY e.position),'[]'::jsonb)
      INTO value FROM public.resume_skill_groups e
      JOIN public.resume_skill_group_translations zh ON zh.resume_id=e.resume_id AND zh.skill_group_id=e.id AND zh.locale='zh'
      JOIN public.resume_skill_group_translations en ON en.resume_id=e.resume_id AND en.skill_group_id=e.id AND en.locale='en'
      WHERE e.resume_id=target_resume_id;
  WHEN 'education' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
      'entry_type',e.entry_type,'education_category',e.education_category,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'program',zh.program,'period',zh.period,'grade',zh.grade,
        'course_title',zh.course_title,'course_description',zh.course_description,'custom_category_label',zh.custom_category_label),
      'en',pg_catalog.jsonb_build_object('title',en.title,'program',en.program,'period',en.period,'grade',en.grade,
        'course_title',en.course_title,'course_description',en.course_description,'custom_category_label',en.custom_category_label)) ORDER BY e.position),'[]'::jsonb)
      INTO value FROM public.resume_education_entries e
      JOIN public.resume_education_translations zh ON zh.resume_id=e.resume_id AND zh.education_entry_id=e.id AND zh.locale='zh'
      JOIN public.resume_education_translations en ON en.resume_id=e.resume_id AND en.education_entry_id=e.id AND en.locale='en'
      WHERE e.resume_id=target_resume_id;
  WHEN 'projects' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'subtitle',zh.subtitle,'period',zh.period,'description',zh.description,'href',zh.href),
      'en',pg_catalog.jsonb_build_object('title',en.title,'subtitle',en.subtitle,'period',en.period,'description',en.description,'href',en.href),
      'methods',pg_catalog.jsonb_build_object(
        'zh',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id::text,'position',m.position,'value',m.value) ORDER BY m.position)
          FROM public.resume_project_methods m WHERE m.resume_id=e.resume_id AND m.project_entry_id=e.id AND m.locale='zh'),'[]'::jsonb),
        'en',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',m.id::text,'position',m.position,'value',m.value) ORDER BY m.position)
          FROM public.resume_project_methods m WHERE m.resume_id=e.resume_id AND m.project_entry_id=e.id AND m.locale='en'),'[]'::jsonb))) ORDER BY e.position),'[]'::jsonb)
      INTO value FROM public.resume_project_entries e
      JOIN public.resume_project_translations zh ON zh.resume_id=e.resume_id AND zh.project_entry_id=e.id AND zh.locale='zh'
      JOIN public.resume_project_translations en ON en.resume_id=e.resume_id AND en.project_entry_id=e.id AND en.locale='en'
      WHERE e.resume_id=target_resume_id;
  WHEN 'contact' THEN
    SELECT pg_catalog.jsonb_build_object(
      'translations',pg_catalog.jsonb_build_object(
        'zh',pg_catalog.jsonb_build_object('contact_label',zh.contact_label,'availability',zh.availability),
        'en',pg_catalog.jsonb_build_object('contact_label',en.contact_label,'availability',en.availability)),
      'focus',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',f.id::text,'position',f.position,
        'zh',pg_catalog.jsonb_build_object('title',fz.title,'detail',fz.detail),
        'en',pg_catalog.jsonb_build_object('title',fe.title,'detail',fe.detail)) ORDER BY f.position)
        FROM public.resume_contact_focus_items f
        JOIN public.resume_contact_focus_translations fz ON fz.resume_id=f.resume_id AND fz.focus_item_id=f.id AND fz.locale='zh'
        JOIN public.resume_contact_focus_translations fe ON fe.resume_id=f.resume_id AND fe.focus_item_id=f.id AND fe.locale='en'
        WHERE f.resume_id=target_resume_id),'[]'::jsonb),
      'status',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id::text,'position',s.position,'status_type',s.status_type,
        'zh',pg_catalog.jsonb_build_object('title',sz.title,'detail',sz.detail),
        'en',pg_catalog.jsonb_build_object('title',se.title,'detail',se.detail)) ORDER BY s.position)
        FROM public.resume_contact_status_items s
        JOIN public.resume_contact_status_translations sz ON sz.resume_id=s.resume_id AND sz.status_item_id=s.id AND sz.locale='zh'
        JOIN public.resume_contact_status_translations se ON se.resume_id=s.resume_id AND se.status_item_id=s.id AND se.locale='en'
        WHERE s.resume_id=target_resume_id),'[]'::jsonb))
      INTO value FROM public.resume_locale_content zh JOIN public.resume_locale_content en ON en.resume_id=zh.resume_id
      WHERE zh.resume_id=target_resume_id AND zh.locale='zh' AND en.locale='en';
  WHEN 'website_links' THEN
    value:=cms_private.website_links_aggregate(target_resume_id);
  ELSE
    RETURN NULL;
  END CASE;
  RETURN value;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_current_aggregate(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.restore_current_aggregate_is_complete(target_resume_id uuid,target_domain text,aggregate_value jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE parent_count bigint; translation_count bigint; child_count bigint; aggregate_count bigint;
BEGIN
  IF aggregate_value IS NULL OR NOT cms_private.restore_aggregate_is_allowed(target_domain,aggregate_value) THEN RETURN false; END IF;
  CASE target_domain
  WHEN 'awards' THEN
    SELECT count(*) INTO parent_count FROM public.resume_award_entries WHERE resume_id=target_resume_id;
    SELECT count(*) INTO translation_count FROM public.resume_award_translations WHERE resume_id=target_resume_id;
    aggregate_count:=pg_catalog.jsonb_array_length(aggregate_value);
  WHEN 'experience' THEN
    SELECT count(*) INTO parent_count FROM public.resume_experience_entries WHERE resume_id=target_resume_id;
    SELECT count(*) INTO translation_count FROM public.resume_experience_translations WHERE resume_id=target_resume_id;
    aggregate_count:=pg_catalog.jsonb_array_length(aggregate_value);
  WHEN 'skills' THEN
    SELECT count(*) INTO parent_count FROM public.resume_skill_groups WHERE resume_id=target_resume_id;
    SELECT count(*) INTO translation_count FROM public.resume_skill_group_translations WHERE resume_id=target_resume_id;
    aggregate_count:=pg_catalog.jsonb_array_length(aggregate_value);
  WHEN 'education' THEN
    SELECT count(*) INTO parent_count FROM public.resume_education_entries WHERE resume_id=target_resume_id;
    SELECT count(*) INTO translation_count FROM public.resume_education_translations WHERE resume_id=target_resume_id;
    aggregate_count:=pg_catalog.jsonb_array_length(aggregate_value);
  WHEN 'projects' THEN
    SELECT count(*) INTO parent_count FROM public.resume_project_entries WHERE resume_id=target_resume_id;
    SELECT count(*) INTO translation_count FROM public.resume_project_translations WHERE resume_id=target_resume_id;
    SELECT count(*) INTO child_count FROM public.resume_project_methods WHERE resume_id=target_resume_id;
    SELECT COALESCE(sum(pg_catalog.jsonb_array_length(p.value->'methods'->'zh')+
      pg_catalog.jsonb_array_length(p.value->'methods'->'en')),0) INTO aggregate_count
      FROM pg_catalog.jsonb_array_elements(aggregate_value) p(value);
    IF child_count<>aggregate_count THEN RETURN false; END IF;
    aggregate_count:=pg_catalog.jsonb_array_length(aggregate_value);
  WHEN 'contact' THEN
    SELECT count(*) INTO parent_count FROM public.resume_contact_focus_items WHERE resume_id=target_resume_id;
    SELECT count(*) INTO child_count FROM public.resume_contact_status_items WHERE resume_id=target_resume_id;
    SELECT count(*) INTO translation_count FROM public.resume_contact_focus_translations WHERE resume_id=target_resume_id;
    SELECT translation_count + count(*) INTO translation_count FROM public.resume_contact_status_translations WHERE resume_id=target_resume_id;
    IF pg_catalog.jsonb_array_length(aggregate_value->'focus')<>parent_count
      OR pg_catalog.jsonb_array_length(aggregate_value->'status')<>child_count
      OR translation_count<>2*(parent_count+child_count)
      OR (SELECT count(*) FROM public.resume_locale_content WHERE resume_id=target_resume_id AND locale IN('zh','en'))<>2 THEN RETURN false; END IF;
    RETURN true;
  WHEN 'website_links' THEN
    RETURN cms_private.website_links_aggregate_is_allowed(aggregate_value)
      AND (SELECT count(*) FROM public.resume_navigation_items WHERE resume_id=target_resume_id)=5
      AND (SELECT count(*) FROM public.resume_navigation_item_translations WHERE resume_id=target_resume_id)=10;
  ELSE RETURN false;
  END CASE;
  RETURN parent_count=aggregate_count AND translation_count=2*parent_count;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_current_aggregate_is_complete(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.restore_historical_ids_exist(target_resume_id uuid,target_domain text,aggregate_value jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE item jsonb; nested jsonb; locale_key text; exists_value boolean; expected_ids text[]; actual_ids text[];
BEGIN
  IF NOT cms_private.restore_aggregate_is_allowed(target_domain,aggregate_value) THEN RETURN false; END IF;
  IF target_domain='website_links' THEN
    SELECT array_agg(value->>'navigation_item_id' ORDER BY (value->>'position')::integer)
      INTO expected_ids FROM pg_catalog.jsonb_array_elements(aggregate_value->'navigation');
    SELECT array_agg(id::text ORDER BY position) INTO actual_ids FROM public.resume_navigation_items WHERE resume_id=target_resume_id;
    RETURN expected_ids IS NOT DISTINCT FROM actual_ids;
  END IF;
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(
    CASE WHEN target_domain IN ('contact') THEN aggregate_value->'focus' || aggregate_value->'status'
      ELSE aggregate_value END) LOOP
    IF target_domain='projects' THEN
      SELECT EXISTS(SELECT 1 FROM public.resume_project_entries e WHERE e.id=(item->>'id')::uuid AND e.resume_id=target_resume_id) INTO exists_value;
    ELSIF target_domain='awards' THEN
      SELECT EXISTS(SELECT 1 FROM public.resume_award_entries e WHERE e.id=(item->>'id')::uuid AND e.resume_id=target_resume_id) INTO exists_value;
    ELSIF target_domain='experience' THEN
      SELECT EXISTS(SELECT 1 FROM public.resume_experience_entries e WHERE e.id=(item->>'id')::uuid AND e.resume_id=target_resume_id) INTO exists_value;
    ELSIF target_domain='skills' THEN
      SELECT EXISTS(SELECT 1 FROM public.resume_skill_groups e WHERE e.id=(item->>'id')::uuid AND e.resume_id=target_resume_id) INTO exists_value;
    ELSIF target_domain='education' THEN
      SELECT EXISTS(SELECT 1 FROM public.resume_education_entries e WHERE e.id=(item->>'id')::uuid AND e.resume_id=target_resume_id) INTO exists_value;
    ELSIF target_domain='contact' AND item ? 'status_type' THEN
      SELECT EXISTS(SELECT 1 FROM public.resume_contact_status_items e WHERE e.id=(item->>'id')::uuid AND e.resume_id=target_resume_id) INTO exists_value;
    ELSE
      SELECT EXISTS(SELECT 1 FROM public.resume_contact_focus_items e WHERE e.id=(item->>'id')::uuid AND e.resume_id=target_resume_id) INTO exists_value;
    END IF;
    IF NOT COALESCE(exists_value,false) THEN RETURN false; END IF;
    IF target_domain='projects' THEN
      FOR locale_key IN SELECT unnest(ARRAY['zh','en']) LOOP
        FOR nested IN SELECT value FROM pg_catalog.jsonb_array_elements(item->'methods'->locale_key) LOOP
          SELECT EXISTS(SELECT 1 FROM public.resume_project_methods m WHERE m.id=(nested->>'id')::uuid
            AND m.resume_id=target_resume_id AND m.project_entry_id=(item->>'id')::uuid AND m.locale=locale_key)
            INTO exists_value;
          IF NOT COALESCE(exists_value,false) THEN RETURN false; END IF;
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_historical_ids_exist(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.restore_source_v1(target_resume_id uuid,target_event_id uuid)
RETURNS TABLE(domain_key text,source_occurred_at timestamptz,historical_state jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE event_row cms_private.activity_log_events%ROWTYPE; resolved_domain text; before_value jsonb;
BEGIN
  SELECT * INTO event_row FROM cms_private.activity_log_events e
    WHERE e.id=target_event_id AND e.resume_id=target_resume_id;
  IF event_row.id IS NULL OR event_row.operation IS DISTINCT FROM 'update'
    OR event_row.payload_version IS DISTINCT FROM 2
    OR event_row.site_key_snapshot IS DISTINCT FROM
       (SELECT site.site_key FROM public.resume_sites site WHERE site.id=target_resume_id) THEN
    RAISE EXCEPTION 'Restore source is not eligible' USING ERRCODE='22023';
  END IF;
  resolved_domain:=cms_private.restore_domain_for_event(event_row.section_key,event_row.entity_type,event_row.entity_id);
  IF resolved_domain IS NULL OR NOT cms_private.activity_event_payload_v2_is_allowed(
    event_row.section_key,event_row.entity_type,event_row.entity_id,event_row.operation,
    event_row.entity_snapshot,event_row.changes) THEN
    RAISE EXCEPTION 'Restore source is not eligible' USING ERRCODE='22023';
  END IF;
  before_value:=cms_private.restore_dense_positions(resolved_domain,event_row.changes->resolved_domain->'before');
  IF NOT cms_private.restore_aggregate_is_allowed(resolved_domain,before_value)
    OR NOT cms_private.restore_historical_ids_exist(target_resume_id,resolved_domain,before_value) THEN
    RAISE EXCEPTION 'Restore source is not eligible' USING ERRCODE='22023';
  END IF;
  domain_key:=resolved_domain; source_occurred_at:=event_row.occurred_at; historical_state:=before_value;
  RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_source_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.restore_expected_digest(target_resume_id uuid,target_domain text,current_state jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array('restore-v1',target_resume_id::text,target_domain,current_state)::text,'UTF8'),'sha256'),'hex')
$function$;
REVOKE ALL ON FUNCTION cms_private.restore_expected_digest(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.preview_restore_v1(target_resume_id uuid,source_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE site_key_value text; domain_value text; source_time timestamptz; historic jsonb; current_value jsonb; digest_value text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT context.resolved_site_key INTO site_key_value FROM cms_private.assert_activity_log_target(target_resume_id) context;
  IF NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='restore'),false)
    THEN RAISE EXCEPTION 'Restore is disabled for this target' USING ERRCODE='42501'; END IF;
  SELECT w.domain_key INTO domain_value FROM cms_private.restore_source_v1(target_resume_id,source_event_id) w;
  IF cms_private.get_resume_write_mode(target_resume_id,domain_value)<>'rpc'
    OR NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id
      AND r.domain_key=domain_value AND r.requirement_key='trusted_network_context_v11'),false) THEN
    RAISE EXCEPTION 'Restore write configuration is not enabled' USING ERRCODE='42501';
  END IF;
  SELECT w.source_occurred_at,w.historical_state INTO source_time,historic
    FROM cms_private.restore_source_v1(target_resume_id,source_event_id) w;
  current_value:=cms_private.restore_current_aggregate(target_resume_id,domain_value);
  IF NOT cms_private.restore_current_aggregate_is_complete(target_resume_id,domain_value,current_value) THEN
    RAISE EXCEPTION 'Current domain state is not eligible for Restore' USING ERRCODE='22023';
  END IF;
  digest_value:=cms_private.restore_expected_digest(target_resume_id,domain_value,current_value);
  RETURN pg_catalog.jsonb_build_object('status',CASE WHEN current_value=historic THEN 'no_change' ELSE 'ready' END,
    'source_event_id',source_event_id,'source_occurred_at',source_time,'domain',domain_value,
    'historical_state',historic,'current_state',current_value,
    'comparison',pg_catalog.jsonb_build_object('before',current_value,'after',historic),
    'expected_current_digest',digest_value);
END
$function$;
REVOKE ALL ON FUNCTION public.preview_restore_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_restore_v1(uuid,uuid) TO authenticated;

CREATE FUNCTION cms_private.verify_restore_v1_context(
  target_resume_id uuid,target_event_id uuid,target_request_id uuid,target_expected_digest text,
  signed_context text,signature_hex text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE ctx jsonb; key_value bytea; expected bytea; supplied bytea; now_seconds bigint;
BEGIN
  BEGIN
    IF signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context,'UTF8'))>8192
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$'
      OR target_expected_digest IS NULL OR target_expected_digest !~ '^[0-9a-f]{64}$'
      OR target_request_id IS NULL OR target_event_id IS NULL OR target_resume_id IS NULL THEN RAISE EXCEPTION 'invalid'; END IF;
    ctx:=signed_context::jsonb;
    IF pg_catalog.jsonb_typeof(ctx) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(ctx))<>11
      OR NOT(ctx ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','source_event_id','expected_current_digest','issued_at','expires_at'])
      OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(ctx) k WHERE k<>ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','source_event_id','expected_current_digest','issued_at','expires_at']))
      OR pg_catalog.jsonb_typeof(ctx->'context_version') IS DISTINCT FROM 'number'
      OR ctx->>'context_version'<>'1'
      OR pg_catalog.jsonb_typeof(ctx->'key_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'actor_user_id') IS DISTINCT FROM 'string'
      OR ctx->>'actor_user_id'<>(SELECT auth.uid())::text
      OR pg_catalog.jsonb_typeof(ctx->'resume_id') IS DISTINCT FROM 'string'
      OR ctx->>'resume_id'<>target_resume_id::text OR ctx->>'request_id'<>target_request_id::text
      OR pg_catalog.jsonb_typeof(ctx->'request_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'source_event_id') IS DISTINCT FROM 'string'
      OR ctx->>'source_event_id'<>target_event_id::text OR ctx->>'expected_current_digest'<>target_expected_digest
      OR pg_catalog.jsonb_typeof(ctx->'expected_current_digest') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'domain') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'operation') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'issued_at') IS DISTINCT FROM 'number'
      OR pg_catalog.jsonb_typeof(ctx->'expires_at') IS DISTINCT FROM 'number'
      OR ctx->>'domain' NOT IN('awards','experience','skills','education','projects','contact','website_links')
      OR ctx->>'operation'<>'restore' OR ctx->>'key_id' !~ '^[A-Za-z0-9._-]{1,64}$'
      OR ctx->>'issued_at' !~ '^(0|[1-9][0-9]{0,11})$' OR ctx->>'expires_at' !~ '^(0|[1-9][0-9]{0,11})$'
      THEN RAISE EXCEPTION 'invalid'; END IF;
    now_seconds:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
    IF (ctx->>'issued_at')::bigint>now_seconds+60 OR (ctx->>'expires_at')::bigint<=now_seconds
      OR (ctx->>'expires_at')::bigint<=(ctx->>'issued_at')::bigint
      OR (ctx->>'expires_at')::bigint-(ctx->>'issued_at')::bigint>300 THEN RAISE EXCEPTION 'invalid'; END IF;
    key_value:=cms_private.activity_log_v11_key(ctx->>'key_id');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'invalid'; END IF;
    expected:=extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),key_value,'sha256');
    supplied:=pg_catalog.decode(signature_hex,'hex');
    IF supplied<>expected THEN RAISE EXCEPTION 'invalid'; END IF;
    RETURN ctx;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid signed Restore request' USING ERRCODE='22023'; END;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_restore_v1_context(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.restore_domain_v1(
  target_resume_id uuid,source_event_id uuid,expected_current_digest text,request_id uuid,
  signed_context text,signature_hex text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE site_key_value text; caller_role text; domain_value text; source_time timestamptz; historic jsonb;
  current_value jsonb; result_value jsonb; context_value jsonb; internal_context jsonb; internal_text text;
  key_value bytea; internal_signature text; body_text text; body_digest bytea; restore_digest bytea;
  prior_digest bytea; prior_result jsonb; prior_done timestamptz; prior_expiry timestamptz; new_event_id uuid; before_count bigint;
  writer_result jsonb; response_value jsonb; affected bigint; prior_matching_events uuid[]; matching_count bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT context.resolved_site_key,context.resolved_role INTO site_key_value,caller_role
    FROM cms_private.assert_activity_log_target(target_resume_id) context;
  IF NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='restore'),false)
    THEN RAISE EXCEPTION 'Restore is disabled for this target' USING ERRCODE='42501'; END IF;
  -- Match every current domain writer's serialization boundary.
  PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  SELECT w.domain_key,w.source_occurred_at,w.historical_state INTO domain_value,source_time,historic
    FROM cms_private.restore_source_v1(target_resume_id,source_event_id) w;
  IF cms_private.get_resume_write_mode(target_resume_id,domain_value)<>'rpc'
    OR NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id
      AND r.domain_key=domain_value AND r.requirement_key='trusted_network_context_v11'),false) THEN
    RAISE EXCEPTION 'Restore write configuration is not enabled' USING ERRCODE='42501';
  END IF;
  context_value:=cms_private.verify_restore_v1_context(target_resume_id,source_event_id,request_id,
    expected_current_digest,signed_context,signature_hex);
  IF context_value->>'domain' IS DISTINCT FROM domain_value THEN RAISE EXCEPTION 'Signed Restore domain mismatch' USING ERRCODE='42501'; END IF;
  restore_digest:=extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'version',1,'actor',auth.uid(),'resume_id',target_resume_id,'domain',domain_value,
    'source_event_id',source_event_id,'direction','before','expected_current_digest',expected_current_digest)::text,'UTF8'),'sha256');
  SELECT idem.mutation_digest,idem.result_payload,idem.completed_at,idem.expires_at INTO prior_digest,prior_result,prior_done,prior_expiry
    FROM cms_private.activity_log_idempotency AS idem WHERE idem.actor_user_id=auth.uid() AND idem.resume_id=target_resume_id
      AND idem.domain_key=domain_value AND idem.request_id=restore_domain_v1.request_id FOR UPDATE;
  IF FOUND THEN
    IF prior_expiry<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Restore request has expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF prior_digest IS DISTINCT FROM restore_digest THEN RAISE EXCEPTION 'Restore request identity conflict' USING ERRCODE='23505'; END IF;
    IF prior_done IS NULL THEN RAISE EXCEPTION 'Restore request is pending' USING ERRCODE='55000'; END IF;
    IF pg_catalog.jsonb_typeof(prior_result) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(prior_result)<>1
      OR pg_catalog.jsonb_typeof(prior_result->0) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Restore replay result is invalid' USING ERRCODE='55000'; END IF;
    RETURN prior_result->0;
  END IF;
  current_value:=cms_private.restore_current_aggregate(target_resume_id,domain_value);
  IF NOT cms_private.restore_current_aggregate_is_complete(target_resume_id,domain_value,current_value)
    OR NOT cms_private.restore_historical_ids_exist(target_resume_id,domain_value,historic) THEN
    RAISE EXCEPTION 'Restore state is not eligible' USING ERRCODE='22023';
  END IF;
  IF cms_private.restore_expected_digest(target_resume_id,domain_value,current_value) IS DISTINCT FROM expected_current_digest THEN
    RAISE EXCEPTION 'Restore current state conflict' USING ERRCODE='40001';
  END IF;
  IF current_value=historic THEN
    response_value:=pg_catalog.jsonb_build_object('status','no_change','domain',domain_value,
      'source_event_id',source_event_id,'result_event_id',NULL);
    INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,
      result_payload,created_at,completed_at,expires_at)
      VALUES(auth.uid(),target_resume_id,domain_value,request_id,restore_digest,pg_catalog.jsonb_build_array(response_value),
        transaction_timestamp(),transaction_timestamp(),transaction_timestamp()+interval '7 days');
    RETURN response_value;
  END IF;

  -- The nested writer receives only the server-derived historical aggregate.
  -- Its existing, domain-specific validator and target lock remain authoritative.
  body_text:=historic::text;
  body_digest:=extensions.digest(pg_catalog.convert_to(body_text,'UTF8'),'sha256');
  internal_context:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
    'actor_user_id',auth.uid(),'resume_id',target_resume_id,'domain',domain_value,'operation','update',
    'request_id',request_id,'mutation_digest',pg_catalog.encode(body_digest,'hex'),
    'issued_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint,
    'expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint+240,
    'ip_network',context_value->'ip_network','country_code',context_value->'country_code',
    'region',context_value->'region','city',context_value->'city');
  internal_text:=internal_context::text;
  key_value:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
  IF key_value IS NULL OR octet_length(key_value)<32 THEN RAISE EXCEPTION 'Restore signing is unavailable' USING ERRCODE='42501'; END IF;
  internal_signature:=encode(extensions.hmac(convert_to(internal_text,'UTF8'),key_value,'sha256'),'hex');
  SELECT count(*) INTO before_count FROM cms_private.activity_log_events e WHERE e.resume_id=target_resume_id;
  result_value:=historic;
  SELECT COALESCE(pg_catalog.array_agg(e.id),ARRAY[]::uuid[]) INTO prior_matching_events
    FROM cms_private.activity_log_events e
    WHERE e.resume_id=target_resume_id AND e.actor_user_id=auth.uid() AND e.occurred_at=transaction_timestamp()
      AND e.operation='update' AND e.section_key=domain_value AND e.payload_version=2
      AND e.entity_snapshot=pg_catalog.jsonb_build_object(domain_value,result_value)
      AND e.changes=pg_catalog.jsonb_build_object(domain_value,pg_catalog.jsonb_build_object('before',current_value,'after',result_value));
  CASE domain_value
    WHEN 'awards' THEN writer_result:=public.save_resume_awards_v1(target_resume_id,body_text,internal_text,internal_signature);
    WHEN 'experience' THEN writer_result:=public.save_resume_experience_v1(target_resume_id,body_text,internal_text,internal_signature);
    WHEN 'skills' THEN writer_result:=public.save_resume_skills_v1(target_resume_id,body_text,internal_text,internal_signature);
    WHEN 'education' THEN writer_result:=public.save_resume_education_v1(target_resume_id,body_text,internal_text,internal_signature);
    WHEN 'projects' THEN writer_result:=public.save_resume_projects_v1(target_resume_id,body_text,internal_text,internal_signature);
    WHEN 'contact' THEN writer_result:=public.save_resume_contact_v1(target_resume_id,body_text,internal_text,internal_signature);
    WHEN 'website_links' THEN writer_result:=public.save_resume_website_links_v1(target_resume_id,body_text,internal_text,internal_signature);
    ELSE RAISE EXCEPTION 'Restore domain is unsupported' USING ERRCODE='22023';
  END CASE;
  result_value:=cms_private.restore_current_aggregate(target_resume_id,domain_value);
  IF result_value IS DISTINCT FROM historic OR NOT cms_private.restore_aggregate_is_allowed(domain_value,result_value) THEN
    RAISE EXCEPTION 'Restore result validation failed' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM cms_private.activity_log_events e WHERE e.resume_id=target_resume_id)<>before_count+1 THEN
    RAISE EXCEPTION 'Restore writer did not produce exactly one event' USING ERRCODE='22023';
  END IF;
  SELECT count(*),min(e.id::text)::uuid INTO matching_count,new_event_id FROM cms_private.activity_log_events e
    WHERE e.resume_id=target_resume_id AND e.actor_user_id=auth.uid() AND e.occurred_at=transaction_timestamp()
      AND e.operation='update' AND e.section_key=domain_value AND e.payload_version=2
      AND e.entity_snapshot=pg_catalog.jsonb_build_object(domain_value,result_value)
      AND e.changes=pg_catalog.jsonb_build_object(domain_value,pg_catalog.jsonb_build_object('before',current_value,'after',result_value))
      AND NOT (e.id=ANY(prior_matching_events));
  IF matching_count<>1 OR new_event_id IS NULL THEN RAISE EXCEPTION 'Restore result event could not be resolved uniquely' USING ERRCODE='22023'; END IF;
  INSERT INTO cms_private.activity_log_restore_links(result_event_id,source_event_id,resume_id,domain_key)
    VALUES(new_event_id,source_event_id,target_resume_id,domain_value);
  response_value:=pg_catalog.jsonb_build_object('status','restored','domain',domain_value,
    'source_event_id',source_event_id,'result_event_id',new_event_id,'occurred_at',transaction_timestamp());
  UPDATE cms_private.activity_log_idempotency AS idem SET mutation_digest=restore_digest,
      result_payload=pg_catalog.jsonb_build_array(response_value)
    WHERE idem.actor_user_id=auth.uid() AND idem.resume_id=target_resume_id AND idem.domain_key=domain_value
      AND idem.request_id=restore_domain_v1.request_id;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'Restore idempotency record was not uniquely completed' USING ERRCODE='22023'; END IF;
  RETURN response_value;
END
$function$;
REVOKE ALL ON FUNCTION public.restore_domain_v1(uuid,uuid,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.restore_domain_v1(uuid,uuid,text,uuid,text,text) TO authenticated;

COMMENT ON FUNCTION public.preview_restore_v1(uuid,uuid) IS
  'Target-authorized Restore V1 preview for eligible V2 domain updates. Returns validated BEFORE state and current comparison only.';
COMMENT ON FUNCTION public.restore_domain_v1(uuid,uuid,text,uuid,text,text) IS
  'Target-authorized, idempotent Restore V1 mutation using a signed request and server-derived V2 BEFORE aggregate.';

COMMIT;
