-- Correct Contact translation conflict targets to match installed composite primary keys.
BEGIN;
CREATE OR REPLACE FUNCTION public.save_resume_contact_v1(target_resume_id uuid,canonical_contact text,signed_context text,signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE target_site_key text; ctx jsonb; incoming jsonb; before_value jsonb; result_value jsonb; changes_value jsonb;
  actor_id uuid; request_id_value uuid; digest_value bytea; old_digest bytea; old_result jsonb; old_completed timestamptz; old_expiry timestamptz;
  item_value jsonb; locale_key text; saved_id uuid; max_position integer; offset_value bigint; contact_changed boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT t.resolved_site_key INTO target_site_key FROM cms_private.assert_activity_log_target(target_resume_id) t;
  IF target_site_key IS NULL THEN RAISE EXCEPTION 'Contact target is not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  IF cms_private.get_resume_write_mode(target_resume_id,'contact')<>'rpc' THEN RAISE EXCEPTION 'Contact RPC mode is not enabled' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='contact' AND r.requirement_key='trusted_network_context_v11'),false)
    OR NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false) THEN RAISE EXCEPTION 'Secure Contact saving is not fully enabled' USING ERRCODE='42501'; END IF;
  SELECT v.context_value,v.contact_value INTO ctx,incoming FROM cms_private.verify_resume_contact_v1_context(target_resume_id,canonical_contact,signed_context,signature_hex) v;
  actor_id:=(ctx->>'actor_user_id')::uuid; request_id_value:=(ctx->>'request_id')::uuid;
  digest_value:=extensions.digest(pg_catalog.convert_to(canonical_contact,'UTF8'),'sha256');
  SELECT i.mutation_digest,i.completed_at,i.expires_at,i.result_payload INTO old_digest,old_completed,old_expiry,old_result
  FROM cms_private.activity_log_idempotency i WHERE i.actor_user_id=actor_id AND i.resume_id=target_resume_id AND i.domain_key='contact' AND i.request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Idempotency request has expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF old_digest<>digest_value THEN RAISE EXCEPTION 'Idempotency key conflicts with a different Contact request' USING ERRCODE='P13B1'; END IF;
    IF old_completed IS NULL OR pg_catalog.jsonb_typeof(old_result) IS DISTINCT FROM 'array'
      OR pg_catalog.jsonb_array_length(old_result)<>1 THEN RAISE EXCEPTION 'Incomplete Contact idempotency record' USING ERRCODE='22023'; END IF;
    RETURN old_result->0;
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at)
    VALUES(actor_id,target_resume_id,'contact',request_id_value,digest_value,pg_catalog.transaction_timestamp(),NULL,pg_catalog.transaction_timestamp()+interval '7 days');

  IF (SELECT pg_catalog.count(*) FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id AND l.locale IN ('zh','en'))<>2
    OR (SELECT pg_catalog.count(*) FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id)<>2 THEN RAISE EXCEPTION 'Contact locale state is incomplete' USING ERRCODE='22023'; END IF;
  IF (SELECT pg_catalog.count(*) FROM public.resume_contact_focus_items WHERE resume_id=target_resume_id)>32
    OR (SELECT pg_catalog.count(*) FROM public.resume_contact_status_items WHERE resume_id=target_resume_id)>32 THEN RAISE EXCEPTION 'Contact collection exceeds the supported bound' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.resume_contact_focus_items p WHERE p.resume_id=target_resume_id AND
    (SELECT pg_catalog.count(*) FROM public.resume_contact_focus_translations t WHERE t.resume_id=p.resume_id AND t.focus_item_id=p.id)<>2)
    OR EXISTS(SELECT 1 FROM public.resume_contact_status_items p WHERE p.resume_id=target_resume_id AND
    (SELECT pg_catalog.count(*) FROM public.resume_contact_status_translations t WHERE t.resume_id=p.resume_id AND t.status_item_id=p.id)<>2) THEN RAISE EXCEPTION 'Contact translations are incomplete' USING ERRCODE='22023'; END IF;

  SELECT pg_catalog.jsonb_build_object('translations',pg_catalog.jsonb_build_object(
      'zh',pg_catalog.jsonb_build_object('contact_label',zh.contact_label,'availability',zh.availability),
      'en',pg_catalog.jsonb_build_object('contact_label',en.contact_label,'availability',en.availability)),
    'focus',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id::text,'position',p.position,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'detail',zh.detail),'en',pg_catalog.jsonb_build_object('title',en.title,'detail',en.detail)) ORDER BY p.position,p.id)
      FROM public.resume_contact_focus_items p JOIN public.resume_contact_focus_translations zh ON zh.resume_id=p.resume_id AND zh.focus_item_id=p.id AND zh.locale='zh'
      JOIN public.resume_contact_focus_translations en ON en.resume_id=p.resume_id AND en.focus_item_id=p.id AND en.locale='en' WHERE p.resume_id=target_resume_id),'[]'::jsonb),
    'status',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id::text,'position',p.position,'status_type',p.status_type,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'detail',zh.detail),'en',pg_catalog.jsonb_build_object('title',en.title,'detail',en.detail)) ORDER BY p.position,p.id)
      FROM public.resume_contact_status_items p JOIN public.resume_contact_status_translations zh ON zh.resume_id=p.resume_id AND zh.status_item_id=p.id AND zh.locale='zh'
      JOIN public.resume_contact_status_translations en ON en.resume_id=p.resume_id AND en.status_item_id=p.id AND en.locale='en' WHERE p.resume_id=target_resume_id),'[]'::jsonb)) INTO before_value
  FROM public.resume_locale_content zh JOIN public.resume_locale_content en ON en.resume_id=zh.resume_id AND en.locale='en'
  WHERE zh.resume_id=target_resume_id AND zh.locale='zh';
  IF pg_catalog.octet_length(pg_catalog.convert_to(before_value::text,'UTF8'))>196608
    OR NOT cms_private.contact_aggregate_is_allowed(before_value,false,false) THEN RAISE EXCEPTION 'Existing Contact state is outside the supported aggregate contract' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming->'focus') x(value) WHERE x.value->>'id' IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.resume_contact_focus_items p WHERE p.id=(x.value->>'id')::uuid AND p.resume_id=target_resume_id))
    OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming->'status') x(value) WHERE x.value->>'id' IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.resume_contact_status_items p WHERE p.id=(x.value->>'id')::uuid AND p.resume_id=target_resume_id)) THEN
    RAISE EXCEPTION 'Contact identity is outside the authorized target' USING ERRCODE='42501'; END IF;
  contact_changed:=incoming->'translations' IS DISTINCT FROM before_value->'translations'
    OR pg_catalog.jsonb_array_length(incoming->'focus')<>pg_catalog.jsonb_array_length(before_value->'focus')
    OR pg_catalog.jsonb_array_length(incoming->'status')<>pg_catalog.jsonb_array_length(before_value->'status')
    OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming->'focus') WITH ORDINALITY n(value,ord)
      LEFT JOIN pg_catalog.jsonb_array_elements(before_value->'focus') WITH ORDINALITY o(value,ord) USING(ord)
      WHERE n.value->>'id' IS DISTINCT FROM o.value->>'id' OR n.value->'zh' IS DISTINCT FROM o.value->'zh' OR n.value->'en' IS DISTINCT FROM o.value->'en')
    OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming->'status') WITH ORDINALITY n(value,ord)
      LEFT JOIN pg_catalog.jsonb_array_elements(before_value->'status') WITH ORDINALITY o(value,ord) USING(ord)
      WHERE n.value->>'id' IS DISTINCT FROM o.value->>'id' OR n.value->>'status_type' IS DISTINCT FROM o.value->>'status_type'
        OR n.value->'zh' IS DISTINCT FROM o.value->'zh' OR n.value->'en' IS DISTINCT FROM o.value->'en');
  IF NOT contact_changed THEN result_value:=before_value;
  ELSE
    SELECT COALESCE(max(position),-1) INTO max_position FROM public.resume_contact_focus_items WHERE resume_id=target_resume_id;
    IF max_position>100000000 THEN RAISE EXCEPTION 'Contact Focus ordering cannot be safely updated' USING ERRCODE='22023'; END IF;
    offset_value:=max_position::bigint+pg_catalog.jsonb_array_length(incoming->'focus')+1001;
    UPDATE public.resume_contact_focus_items SET position=(position+offset_value)::integer WHERE resume_id=target_resume_id;
    DELETE FROM public.resume_contact_focus_items p WHERE p.resume_id=target_resume_id AND NOT EXISTS
      (SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming->'focus') x(value) WHERE x.value->>'id'=p.id::text);
    FOR item_value IN SELECT value FROM pg_catalog.jsonb_array_elements(incoming->'focus') WITH ORDINALITY x(value,ord) ORDER BY ord LOOP
      IF item_value->>'id' IS NULL THEN INSERT INTO public.resume_contact_focus_items(resume_id,position) VALUES(target_resume_id,(item_value->>'position')::integer) RETURNING id INTO saved_id;
      ELSE saved_id:=(item_value->>'id')::uuid; UPDATE public.resume_contact_focus_items SET position=(item_value->>'position')::integer,updated_at=pg_catalog.transaction_timestamp() WHERE id=saved_id AND resume_id=target_resume_id; END IF;
      INSERT INTO public.resume_contact_focus_translations(focus_item_id,resume_id,locale,title,detail)
        VALUES(saved_id,target_resume_id,'zh',item_value->'zh'->>'title',item_value->'zh'->>'detail'),(saved_id,target_resume_id,'en',item_value->'en'->>'title',item_value->'en'->>'detail')
        ON CONFLICT(focus_item_id,locale) DO UPDATE SET title=EXCLUDED.title,detail=EXCLUDED.detail,updated_at=pg_catalog.transaction_timestamp()
        WHERE public.resume_contact_focus_translations.title IS DISTINCT FROM EXCLUDED.title OR public.resume_contact_focus_translations.detail IS DISTINCT FROM EXCLUDED.detail;
    END LOOP;

    SELECT COALESCE(max(position),-1) INTO max_position FROM public.resume_contact_status_items WHERE resume_id=target_resume_id;
    IF max_position>100000000 THEN RAISE EXCEPTION 'Contact Status ordering cannot be safely updated' USING ERRCODE='22023'; END IF;
    offset_value:=max_position::bigint+pg_catalog.jsonb_array_length(incoming->'status')+1001;
    UPDATE public.resume_contact_status_items SET position=(position+offset_value)::integer WHERE resume_id=target_resume_id;
    DELETE FROM public.resume_contact_status_items p WHERE p.resume_id=target_resume_id AND NOT EXISTS
      (SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming->'status') x(value) WHERE x.value->>'id'=p.id::text);
    FOR item_value IN SELECT value FROM pg_catalog.jsonb_array_elements(incoming->'status') WITH ORDINALITY x(value,ord) ORDER BY ord LOOP
      IF item_value->>'id' IS NULL THEN INSERT INTO public.resume_contact_status_items(resume_id,position,status_type)
        VALUES(target_resume_id,(item_value->>'position')::integer,item_value->>'status_type') RETURNING id INTO saved_id;
      ELSE saved_id:=(item_value->>'id')::uuid; UPDATE public.resume_contact_status_items SET position=(item_value->>'position')::integer,status_type=item_value->>'status_type',updated_at=pg_catalog.transaction_timestamp() WHERE id=saved_id AND resume_id=target_resume_id; END IF;
      INSERT INTO public.resume_contact_status_translations(status_item_id,resume_id,locale,title,detail)
        VALUES(saved_id,target_resume_id,'zh',item_value->'zh'->>'title',item_value->'zh'->>'detail'),(saved_id,target_resume_id,'en',item_value->'en'->>'title',item_value->'en'->>'detail')
        ON CONFLICT(status_item_id,locale) DO UPDATE SET title=EXCLUDED.title,detail=EXCLUDED.detail,updated_at=pg_catalog.transaction_timestamp()
        WHERE public.resume_contact_status_translations.title IS DISTINCT FROM EXCLUDED.title OR public.resume_contact_status_translations.detail IS DISTINCT FROM EXCLUDED.detail;
    END LOOP;
    UPDATE public.resume_locale_content l SET contact_label=incoming->'translations'->l.locale->>'contact_label',availability=incoming->'translations'->l.locale->>'availability'
      WHERE l.resume_id=target_resume_id AND l.locale IN ('zh','en') AND
        (l.contact_label IS DISTINCT FROM incoming->'translations'->l.locale->>'contact_label' OR l.availability IS DISTINCT FROM incoming->'translations'->l.locale->>'availability');
    SELECT pg_catalog.jsonb_build_object('translations',pg_catalog.jsonb_build_object(
        'zh',pg_catalog.jsonb_build_object('contact_label',zh.contact_label,'availability',zh.availability),
        'en',pg_catalog.jsonb_build_object('contact_label',en.contact_label,'availability',en.availability)),
      'focus',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id::text,'position',p.position,'zh',pg_catalog.jsonb_build_object('title',zh.title,'detail',zh.detail),'en',pg_catalog.jsonb_build_object('title',en.title,'detail',en.detail)) ORDER BY p.position,p.id)
        FROM public.resume_contact_focus_items p JOIN public.resume_contact_focus_translations zh ON zh.resume_id=p.resume_id AND zh.focus_item_id=p.id AND zh.locale='zh'
        JOIN public.resume_contact_focus_translations en ON en.resume_id=p.resume_id AND en.focus_item_id=p.id AND en.locale='en' WHERE p.resume_id=target_resume_id),'[]'::jsonb),
      'status',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id::text,'position',p.position,'status_type',p.status_type,'zh',pg_catalog.jsonb_build_object('title',zh.title,'detail',zh.detail),'en',pg_catalog.jsonb_build_object('title',en.title,'detail',en.detail)) ORDER BY p.position,p.id)
        FROM public.resume_contact_status_items p JOIN public.resume_contact_status_translations zh ON zh.resume_id=p.resume_id AND zh.status_item_id=p.id AND zh.locale='zh'
        JOIN public.resume_contact_status_translations en ON en.resume_id=p.resume_id AND en.status_item_id=p.id AND en.locale='en' WHERE p.resume_id=target_resume_id),'[]'::jsonb)) INTO result_value
    FROM public.resume_locale_content zh JOIN public.resume_locale_content en ON en.resume_id=zh.resume_id AND en.locale='en'
    WHERE zh.resume_id=target_resume_id AND zh.locale='zh';
    changes_value:=pg_catalog.jsonb_build_object('contact',pg_catalog.jsonb_build_object('before',before_value,'after',result_value));
    IF pg_catalog.octet_length(pg_catalog.convert_to(result_value::text,'UTF8'))>196608 OR NOT cms_private.activity_event_payload_v2_contact_is_allowed('contact','contact_section',NULL,'update',pg_catalog.jsonb_build_object('contact',result_value),changes_value) THEN
      RAISE EXCEPTION 'Contact result exceeds the supported aggregate contract' USING ERRCODE='22023'; END IF;
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
      VALUES(actor_id,(SELECT auth.jwt()->>'email'),(SELECT x.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) x),target_resume_id,target_site_key,'update','contact','contact_section',NULL,
        pg_catalog.jsonb_build_object('contact',result_value),changes_value,2,(ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
  END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=pg_catalog.jsonb_build_array(result_value),completed_at=pg_catalog.transaction_timestamp()
    WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='contact' AND request_id=request_id_value;
  RETURN result_value;
END
$function$;
REVOKE ALL ON FUNCTION public.save_resume_contact_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_contact_v1(uuid,text,text,text) TO authenticated;
COMMIT;
