-- Correct the Introduction translation conflict arbiter to match the production key.
-- CREATE OR REPLACE preserves the existing function owner and ACL.

CREATE OR REPLACE FUNCTION public.save_resume_introduction(target_resume_id uuid, target_items jsonb)
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
      ON CONFLICT(paragraph_id,locale) DO UPDATE SET text=EXCLUDED.text, updated_at=pg_catalog.transaction_timestamp()
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
