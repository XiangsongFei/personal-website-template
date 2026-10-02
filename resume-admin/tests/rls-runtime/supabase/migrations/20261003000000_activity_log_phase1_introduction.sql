-- Phase 1: atomic Introduction writes and Activity Log for the isolated QA target.
-- Apply only after migration review. This migration does not alter the official target.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Phase 1 must be installed as postgres (current_user=%)', current_user
      USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

DO $target_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resume_sites WHERE site_key = 'example-cv' AND is_published = true) THEN
    RAISE EXCEPTION 'Phase 1 requires the published example-cv target';
  END IF;
END
$target_guard$;

DO $qa_target_guard$
BEGIN
  IF (SELECT count(*) FROM public.resume_sites
      WHERE id='ea111111-1111-4111-8111-111111111111'
        AND site_key='example-cv-qa' AND is_published=false) <> 1
    OR EXISTS (SELECT 1 FROM public.resume_sites
      WHERE site_key='example-cv-qa' AND id <> 'ea111111-1111-4111-8111-111111111111') THEN
    RAISE EXCEPTION 'Phase 1 requires the exact unpublished example-cv-qa target';
  END IF;
END
$qa_target_guard$;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_is_allowed(
  target_entity_type text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE allowed_fields text[]; legacy_fields text[]; change_entry record; side_entry jsonb;
BEGIN
  allowed_fields := CASE target_entity_type
    WHEN 'introduction_paragraph' THEN ARRAY['position','text','text_zh','text_en']
    WHEN 'education_entry' THEN ARRAY['position','institution','title','program','date','grade','course_name','course_description']
    WHEN 'experience_entry' THEN ARRAY['position','organization','role','period','location','description']
    WHEN 'project_entry' THEN ARRAY['position','title','course_title','description','url','methods']
    WHEN 'award_entry' THEN ARRAY['position','name','year']
    WHEN 'skill_group' THEN ARRAY['position','title','items']
    WHEN 'contact_focus_item' THEN ARRAY['position','title','detail']
    WHEN 'contact_status_item' THEN ARRAY['position','title','detail','status_type','date']
    WHEN 'public_link' THEN ARRAY['email_address','email_label','github_url','github_label','linkedin_url','linkedin_label','linkedin_display_name','linkedin_homepage_label']
    WHEN 'profile_settings' THEN ARRAY['graduation_value','avatar_initials','footer_name','copyright']
    WHEN 'resume_file' THEN ARRAY['locale','object_key','file_name','content_type','size_bytes']
    WHEN 'profile_image' THEN ARRAY['object_key','file_name','content_type','size_bytes']
    ELSE NULL END;
  IF allowed_fields IS NULL THEN RETURN false; END IF;
  IF target_entity_type = 'introduction_paragraph'
    AND (target_snapshot ? 'paragraphs' OR target_snapshot ? 'text_zh' OR target_snapshot ? 'text_en'
      OR target_changes ? 'text_zh' OR target_changes ? 'text_en') THEN
    IF pg_catalog.jsonb_typeof(target_snapshot) <> 'object'
      OR pg_catalog.jsonb_typeof(target_changes) <> 'object' THEN RETURN false; END IF;
    IF pg_catalog.octet_length(target_snapshot::text) > 250000
      OR pg_catalog.octet_length(target_changes::text) > 250000
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) <> 1
      OR NOT (target_snapshot ? 'paragraphs')
      OR pg_catalog.jsonb_typeof(target_snapshot->'paragraphs') <> 'array'
      OR pg_catalog.jsonb_array_length(target_snapshot->'paragraphs') > 200
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) > 3
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(target_changes) AS k(key_name)
        WHERE k.key_name <> ALL(ARRAY['text_zh','text_en','position']))
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_snapshot->'paragraphs') AS row_value(value)
        WHERE pg_catalog.jsonb_typeof(row_value.value) <> 'object'
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(row_value.value)) <> 4
          OR NOT (row_value.value ? 'id') OR NOT (row_value.value ? 'position')
          OR NOT (row_value.value ? 'text_zh') OR NOT (row_value.value ? 'text_en')
          OR pg_catalog.jsonb_typeof(row_value.value->'id') <> 'string'
          OR pg_catalog.jsonb_typeof(row_value.value->'position') <> 'number'
          OR pg_catalog.jsonb_typeof(row_value.value->'text_zh') <> 'string'
          OR pg_catalog.jsonb_typeof(row_value.value->'text_en') <> 'string'
          OR pg_catalog.length(row_value.value->>'text_zh') > 12000
          OR pg_catalog.length(row_value.value->>'text_en') > 12000
          OR row_value.value->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(target_snapshot->'paragraphs'))
        <> (SELECT count(DISTINCT row_value.value->>'id') FROM pg_catalog.jsonb_array_elements(target_snapshot->'paragraphs') AS row_value(value)) THEN
      RETURN false;
    END IF;
    FOR change_entry IN SELECT key,value FROM pg_catalog.jsonb_each(target_changes) LOOP
      IF pg_catalog.jsonb_typeof(change_entry.value) <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(change_entry.value)) <> 2
        OR NOT (change_entry.value ? 'before') OR NOT (change_entry.value ? 'after')
        OR pg_catalog.jsonb_typeof(change_entry.value->'before') <> 'array'
        OR pg_catalog.jsonb_typeof(change_entry.value->'after') <> 'array'
        OR pg_catalog.jsonb_array_length(change_entry.value->'before') > 200
        OR pg_catalog.jsonb_array_length(change_entry.value->'after') > 200 THEN RETURN false; END IF;
      FOREACH side_entry IN ARRAY ARRAY[change_entry.value->'before',change_entry.value->'after'] LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(side_entry) AS row_value(value)
          WHERE pg_catalog.jsonb_typeof(row_value.value) <> 'object'
            OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(row_value.value)) <> 2
            OR NOT (row_value.value ? 'id') OR NOT (row_value.value ? 'value')
            OR pg_catalog.jsonb_typeof(row_value.value->'id') <> 'string'
            OR row_value.value->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR (change_entry.key IN ('text_zh','text_en') AND pg_catalog.jsonb_typeof(row_value.value->'value') NOT IN ('string','null'))
            OR (change_entry.key = 'position' AND pg_catalog.jsonb_typeof(row_value.value->'value') NOT IN ('number','null'))
            OR pg_catalog.length(row_value.value->>'value') > 12000)
          OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(side_entry))
            <> (SELECT count(DISTINCT row_value.value->>'id') FROM pg_catalog.jsonb_array_elements(side_entry) AS row_value(value)) THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
    RETURN true;
  END IF;
  IF target_entity_type = 'introduction_paragraph' THEN
    -- Preserve the exact Phase 0B per-paragraph contract for legacy events.
    -- This deliberately retains its scalar-only rule (including no required
    -- position/text types) and SQL NULL behavior; aggregate markers above
    -- always select the stricter Phase 1 contract instead.
    legacy_fields := ARRAY['position','text'];
    IF pg_catalog.jsonb_typeof(target_snapshot) <> 'object'
      OR pg_catalog.jsonb_typeof(target_changes) <> 'object'
      OR pg_catalog.octet_length(target_snapshot::text) > 12000
      OR pg_catalog.octet_length(target_changes::text) > 12000 THEN RETURN false; END IF;
    IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) > 24
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) > 24
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(target_snapshot) AS k(key_name)
        WHERE k.key_name <> ALL(legacy_fields))
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(target_snapshot) AS f(field_name,field_value)
        WHERE pg_catalog.jsonb_typeof(f.field_value) IN ('object','array')) THEN RETURN false; END IF;
    FOR change_entry IN SELECT key,value FROM pg_catalog.jsonb_each(target_changes) LOOP
      IF change_entry.key <> ALL(legacy_fields) OR pg_catalog.jsonb_typeof(change_entry.value) <> 'object'
        OR NOT (change_entry.value ? 'before') OR NOT (change_entry.value ? 'after')
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(change_entry.value)) <> 2
        OR pg_catalog.jsonb_typeof(change_entry.value->'before') IN ('object','array')
        OR pg_catalog.jsonb_typeof(change_entry.value->'after') IN ('object','array') THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF pg_catalog.jsonb_typeof(target_snapshot) <> 'object'
    OR pg_catalog.jsonb_typeof(target_changes) <> 'object' THEN RETURN false; END IF;
  IF pg_catalog.octet_length(target_snapshot::text) > 12000
    OR pg_catalog.octet_length(target_changes::text) > 12000 THEN RETURN false; END IF;
  IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) > 24
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) > 24
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(target_snapshot) AS k(key_name) WHERE k.key_name <> ALL(allowed_fields))
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(target_snapshot) AS f(field_name,field_value)
      WHERE pg_catalog.jsonb_typeof(f.field_value) IN ('object','array')) THEN RETURN false; END IF;
  FOR change_entry IN SELECT key,value FROM pg_catalog.jsonb_each(target_changes) LOOP
    IF change_entry.key <> ALL(allowed_fields) OR pg_catalog.jsonb_typeof(change_entry.value) <> 'object'
      OR NOT (change_entry.value ? 'before') OR NOT (change_entry.value ? 'after')
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(change_entry.value)) <> 2
      OR pg_catalog.jsonb_typeof(change_entry.value->'before') IN ('object','array')
      OR pg_catalog.jsonb_typeof(change_entry.value->'after') IN ('object','array') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_is_allowed(text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Exposes only the currently authorized target's capability and Introduction mode.
CREATE FUNCTION public.load_admin_feature_state(target_resume_id uuid)
RETURNS TABLE (activity_log_enabled boolean, introduction_write_mode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN
    RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT COALESCE((SELECT capability.enabled FROM cms_private.resume_capabilities AS capability
      WHERE capability.resume_id = target_resume_id AND capability.capability_key = 'activity_log'), false),
    cms_private.get_resume_write_mode(target_resume_id, 'introduction');
END
$function$;

CREATE FUNCTION public.can_direct_write_introduction(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT COALESCE(public.can_manage_resume(target_resume_id)
    AND cms_private.get_resume_write_mode(target_resume_id,'introduction') <> 'rpc',false);
$function$;

CREATE FUNCTION public.save_resume_introduction(target_resume_id uuid, target_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  site_key_value text; actor_role_value text; actor_email_value text; item jsonb;
  saved_id uuid; requested_id text; item_position integer;
  before_rows jsonb; after_rows jsonb; changes_value jsonb;
  field_before jsonb; field_after jsonb;
  max_position integer; position_offset bigint; desired_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT context.resolved_site_key, context.resolved_role INTO site_key_value, actor_role_value
  FROM cms_private.assert_activity_log_target(target_resume_id) AS context;
  PERFORM 1 FROM public.resume_sites AS site WHERE site.id=target_resume_id FOR UPDATE;
  IF site_key_value IS NULL THEN RAISE EXCEPTION 'Introduction target is not authorized' USING ERRCODE = '42501'; END IF;
  IF cms_private.get_resume_write_mode(target_resume_id, 'introduction') <> 'rpc' THEN
    RAISE EXCEPTION 'Introduction RPC mode is not enabled for this target' USING ERRCODE = '42501';
  END IF;
  actor_email_value := (SELECT auth.jwt() ->> 'email');
  IF target_items IS NULL OR pg_catalog.jsonb_typeof(target_items) <> 'array'
    OR pg_catalog.jsonb_array_length(target_items) > 200 THEN
    RAISE EXCEPTION 'Invalid Introduction items' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
    WHERE pg_catalog.jsonb_typeof(e.value) <> 'object'
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(e.value)) <> 3
      OR NOT (e.value ? 'id') OR NOT (e.value ? 'zh') OR NOT (e.value ? 'en')
      OR pg_catalog.jsonb_typeof(e.value->'id') NOT IN ('string','null')
      OR pg_catalog.jsonb_typeof(e.value->'zh') <> 'string'
      OR pg_catalog.jsonb_typeof(e.value->'en') <> 'string'
      OR pg_catalog.length(e.value->>'zh') > 12000 OR pg_catalog.length(e.value->>'en') > 12000) THEN
    RAISE EXCEPTION 'Invalid Introduction item shape' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
    WHERE e.value->>'id' IS NOT NULL AND e.value->>'id' !~ '^local-[0-9]+-[0-9]+$'
      AND e.value->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'Invalid Introduction item identity' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM (SELECT e.value->>'id' AS id FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
      WHERE e.value->>'id' IS NOT NULL AND e.value->>'id' NOT LIKE 'local-%' GROUP BY e.value->>'id' HAVING count(*) > 1) AS duplicates) > 0 THEN
    RAISE EXCEPTION 'Duplicate Introduction item identity' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
    WHERE e.value->>'id' IS NOT NULL AND e.value->>'id' NOT LIKE 'local-%'
      AND NOT EXISTS (SELECT 1 FROM public.resume_intro_paragraphs AS p WHERE p.id::text=e.value->>'id' AND p.resume_id=target_resume_id)) THEN
    RAISE EXCEPTION 'Introduction item is outside the target' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id::text, 'position', p.position, 'text_zh', COALESCE(zh.text,''), 'text_en', COALESCE(en.text,'')) ORDER BY p.position,p.id), '[]'::jsonb)
    INTO before_rows FROM public.resume_intro_paragraphs AS p
    LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
    WHERE p.resume_id=target_resume_id;

  SELECT count(*)::integer INTO desired_count FROM pg_catalog.jsonb_array_elements(target_items);
  SELECT COALESCE(max(position),-1) INTO max_position FROM public.resume_intro_paragraphs WHERE resume_id=target_resume_id;
  IF max_position > ((2147483647 - desired_count - 1001) / 2) THEN RAISE EXCEPTION 'Introduction ordering cannot be safely updated'; END IF;
  IF desired_count = pg_catalog.jsonb_array_length(before_rows)
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) WITH ORDINALITY AS incoming(value,ordinality)
      LEFT JOIN pg_catalog.jsonb_array_elements(before_rows) WITH ORDINALITY AS current_row(value,ordinality)
        ON current_row.ordinality=incoming.ordinality
      WHERE incoming.value->>'id' IS DISTINCT FROM current_row.value->>'id'
        OR current_row.value->>'position' IS DISTINCT FROM ((incoming.ordinality-1)::text)
        OR incoming.value->>'zh' IS DISTINCT FROM current_row.value->>'text_zh'
        OR incoming.value->>'en' IS DISTINCT FROM current_row.value->>'text_en'
    ) THEN
    RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id::text,'position',p.position,'translations',pg_catalog.jsonb_build_object(
        'zh',pg_catalog.jsonb_build_object('text',COALESCE(zh.text,'')),
        'en',pg_catalog.jsonb_build_object('text',COALESCE(en.text,'')))) ORDER BY p.position,p.id),'[]'::jsonb)
      FROM public.resume_intro_paragraphs AS p
      LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
      LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
      WHERE p.resume_id=target_resume_id);
  END IF;
  position_offset := max_position::bigint + desired_count + 1001;
  UPDATE public.resume_intro_paragraphs SET position=(position + position_offset)::integer
    WHERE resume_id=target_resume_id;

  FOR item, item_position IN SELECT e.value, (e.ordinality-1)::integer
    FROM pg_catalog.jsonb_array_elements(target_items) WITH ORDINALITY AS e(value,ordinality) LOOP
    requested_id := item->>'id';
    IF requested_id IS NULL OR requested_id LIKE 'local-%' THEN
      INSERT INTO public.resume_intro_paragraphs(resume_id,position,source_key)
        VALUES(target_resume_id,item_position,NULL) RETURNING id INTO saved_id;
    ELSE
      saved_id := requested_id::uuid;
      UPDATE public.resume_intro_paragraphs SET position=item_position, updated_at=pg_catalog.transaction_timestamp()
        WHERE id=saved_id AND resume_id=target_resume_id AND position IS DISTINCT FROM item_position;
    END IF;
    INSERT INTO public.resume_intro_paragraph_translations(paragraph_id,resume_id,locale,text)
      VALUES(saved_id,target_resume_id,'zh',item->>'zh'),(saved_id,target_resume_id,'en',item->>'en')
      ON CONFLICT(paragraph_id,resume_id,locale) DO UPDATE SET text=EXCLUDED.text, updated_at=pg_catalog.transaction_timestamp()
      WHERE public.resume_intro_paragraph_translations.text IS DISTINCT FROM EXCLUDED.text;
  END LOOP;

  DELETE FROM public.resume_intro_paragraphs AS p WHERE p.resume_id=target_resume_id
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(target_items) AS e(value)
      WHERE e.value->>'id'=p.id::text AND e.value->>'id' NOT LIKE 'local-%');

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id::text, 'position', p.position, 'text_zh', COALESCE(zh.text,''), 'text_en', COALESCE(en.text,'')) ORDER BY p.position,p.id), '[]'::jsonb)
    INTO after_rows FROM public.resume_intro_paragraphs AS p
    LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
    WHERE p.resume_id=target_resume_id;

  changes_value := '{}'::jsonb;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',old_row.value->'text_zh')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb),
    COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',new_row.value->'text_zh')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb)
    INTO field_before,field_after FROM pg_catalog.jsonb_array_elements(before_rows) AS old_row(value)
    FULL JOIN pg_catalog.jsonb_array_elements(after_rows) AS new_row(value) ON old_row.value->>'id'=new_row.value->>'id'
    WHERE old_row.value->'text_zh' IS DISTINCT FROM new_row.value->'text_zh';
  IF pg_catalog.jsonb_array_length(field_before)>0 THEN changes_value := changes_value || pg_catalog.jsonb_build_object('text_zh',pg_catalog.jsonb_build_object('before',field_before,'after',field_after)); END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',old_row.value->'text_en')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb),
    COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',new_row.value->'text_en')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb)
    INTO field_before,field_after FROM pg_catalog.jsonb_array_elements(before_rows) AS old_row(value)
    FULL JOIN pg_catalog.jsonb_array_elements(after_rows) AS new_row(value) ON old_row.value->>'id'=new_row.value->>'id'
    WHERE old_row.value->'text_en' IS DISTINCT FROM new_row.value->'text_en';
  IF pg_catalog.jsonb_array_length(field_before)>0 THEN changes_value := changes_value || pg_catalog.jsonb_build_object('text_en',pg_catalog.jsonb_build_object('before',field_before,'after',field_after)); END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',old_row.value->'position')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb),
    COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',COALESCE(old_row.value->>'id',new_row.value->>'id'),'value',new_row.value->'position')
      ORDER BY COALESCE((old_row.value->>'position')::integer,(new_row.value->>'position')::integer),COALESCE(old_row.value->>'id',new_row.value->>'id')),'[]'::jsonb)
    INTO field_before,field_after FROM pg_catalog.jsonb_array_elements(before_rows) AS old_row(value)
    FULL JOIN pg_catalog.jsonb_array_elements(after_rows) AS new_row(value) ON old_row.value->>'id'=new_row.value->>'id'
    WHERE old_row.value->'position' IS DISTINCT FROM new_row.value->'position';
  IF pg_catalog.jsonb_array_length(field_before)>0 THEN changes_value := changes_value || pg_catalog.jsonb_build_object('position',pg_catalog.jsonb_build_object('before',field_before,'after',field_after)); END IF;

  IF changes_value <> '{}'::jsonb THEN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,entity_id,entity_snapshot,changes)
    VALUES((SELECT auth.uid()),actor_email_value,actor_role_value,target_resume_id,site_key_value,
      'update','introduction','introduction_paragraph','introduction',
      pg_catalog.jsonb_build_object('paragraphs',after_rows),changes_value);
  END IF;
  RETURN (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',p.id::text,'position',p.position,'translations',pg_catalog.jsonb_build_object(
      'zh',pg_catalog.jsonb_build_object('text',COALESCE(zh.text,'')),
      'en',pg_catalog.jsonb_build_object('text',COALESCE(en.text,'')))) ORDER BY p.position,p.id),'[]'::jsonb)
    FROM public.resume_intro_paragraphs AS p
    LEFT JOIN public.resume_intro_paragraph_translations AS zh ON zh.paragraph_id=p.id AND zh.resume_id=p.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_intro_paragraph_translations AS en ON en.paragraph_id=p.id AND en.resume_id=p.resume_id AND en.locale='en'
    WHERE p.resume_id=target_resume_id);
END
$function$;

-- Replace only the Introduction direct-write policy. SELECT remains allowed for
-- authorized editors; stale clients cannot perform unaudited direct DML in RPC mode.
DO $replace_intro_write_policies$
DECLARE target_table text; policy_row record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['resume_intro_paragraphs','resume_intro_paragraph_translations'] LOOP
    FOR policy_row IN SELECT policyname FROM pg_catalog.pg_policies
      WHERE schemaname='public' AND tablename=target_table AND cmd IN ('ALL','INSERT','UPDATE','DELETE') LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I',policy_row.policyname,target_table);
    END LOOP;
  END LOOP;
END
$replace_intro_write_policies$;
DROP POLICY IF EXISTS cms_admin_scoped_select ON public.resume_intro_paragraphs;
DROP POLICY IF EXISTS cms_admin_scoped_select ON public.resume_intro_paragraph_translations;
DROP POLICY IF EXISTS cms_admin_scoped_direct_dml ON public.resume_intro_paragraphs;
DROP POLICY IF EXISTS cms_admin_scoped_direct_dml ON public.resume_intro_paragraph_translations;
CREATE POLICY cms_admin_scoped_select ON public.resume_intro_paragraphs FOR SELECT TO authenticated
  USING (public.can_manage_resume(resume_id));
CREATE POLICY cms_admin_scoped_select ON public.resume_intro_paragraph_translations FOR SELECT TO authenticated
  USING (public.can_manage_resume(resume_id));
CREATE POLICY cms_admin_scoped_direct_dml ON public.resume_intro_paragraphs FOR ALL TO authenticated
  USING (public.can_manage_resume(resume_id) AND public.can_direct_write_introduction(resume_id))
  WITH CHECK (public.can_manage_resume(resume_id) AND public.can_direct_write_introduction(resume_id));
CREATE POLICY cms_admin_scoped_direct_dml ON public.resume_intro_paragraph_translations FOR ALL TO authenticated
  USING (public.can_manage_resume(resume_id) AND public.can_direct_write_introduction(resume_id))
  WITH CHECK (public.can_manage_resume(resume_id) AND public.can_direct_write_introduction(resume_id));

REVOKE ALL ON FUNCTION public.load_admin_feature_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_feature_state(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_direct_write_introduction(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_introduction(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.save_resume_introduction(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_introduction(uuid,jsonb) TO authenticated;

INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
SELECT site.id,'activity_log',true FROM public.resume_sites AS site
WHERE site.id='ea111111-1111-4111-8111-111111111111'
  AND site.site_key='example-cv-qa' AND site.is_published=false
ON CONFLICT(resume_id,capability_key) DO UPDATE SET enabled=true, updated_at=pg_catalog.transaction_timestamp();
UPDATE cms_private.resume_write_modes SET write_mode='rpc',updated_at=pg_catalog.transaction_timestamp()
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND domain_key='introduction'
  AND EXISTS(SELECT 1 FROM public.resume_sites WHERE id=resume_id AND site_key='example-cv-qa' AND is_published=false);
DO $mode_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resume_sites
      WHERE id='ea111111-1111-4111-8111-111111111111'
        AND site_key='example-cv-qa' AND is_published=false)
    OR NOT EXISTS (SELECT 1 FROM cms_private.resume_capabilities
      WHERE resume_id='ea111111-1111-4111-8111-111111111111'
        AND capability_key='activity_log' AND enabled)
    OR cms_private.get_resume_write_mode('ea111111-1111-4111-8111-111111111111','introduction') <> 'rpc'
    OR (SELECT count(*) FROM cms_private.resume_write_modes
      WHERE resume_id='ea111111-1111-4111-8111-111111111111'
        AND domain_key IN ('introduction','education','experience','awards','skills','contact','projects','website_links','profile','files')) <> 10
    OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes
      WHERE resume_id='ea111111-1111-4111-8111-111111111111'
        AND ((domain_key='introduction' AND write_mode <> 'rpc')
          OR (domain_key <> 'introduction' AND write_mode <> 'direct'))) THEN
    RAISE EXCEPTION 'Phase 1 QA target state is not scoped correctly';
  END IF;
  IF EXISTS(SELECT 1 FROM cms_private.resume_capabilities WHERE enabled AND resume_id <> 'ea111111-1111-4111-8111-111111111111')
    OR (SELECT write_mode FROM cms_private.resume_write_modes WHERE resume_id=(SELECT id FROM public.resume_sites WHERE site_key='example-cv') AND domain_key='introduction') <> 'direct' THEN
    RAISE EXCEPTION 'Phase 1 target state is not QA-only';
  END IF;
END
$mode_guard$;

COMMENT ON FUNCTION public.save_resume_introduction(uuid,jsonb) IS
  'Atomic target-scoped Introduction save; computes and appends audit events server-side.';
COMMIT;
