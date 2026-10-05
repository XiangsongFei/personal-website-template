-- Typed Education aggregate writer. Installation preserves every resume's current mode.
BEGIN;
DO $owner_guard$ BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Education writer must be installed as postgres' USING ERRCODE='42501'; END IF;
END $owner_guard$;

CREATE FUNCTION public.can_direct_write_education(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$ SELECT public.can_manage_resume(target_resume_id)
  AND cms_private.get_resume_write_mode(target_resume_id,'education')='direct' $function$;
REVOKE ALL ON FUNCTION public.can_direct_write_education(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_education(uuid) TO authenticated;

DO $policy_guard$
DECLARE table_name text; policy_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['resume_education_entries','resume_education_translations'] LOOP
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=table_name
      AND cmd<>'SELECT' AND policyname NOT IN ('cms_admin_scoped_all','cms_admin_scoped_direct_dml')) THEN
      RAISE EXCEPTION 'Unexpected Education write policy requires review' USING ERRCODE='55000'; END IF;
    FOR policy_record IN SELECT policyname FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=table_name
      AND policyname IN ('cms_admin_scoped_all','cms_admin_scoped_direct_dml') LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I',policy_record.policyname,table_name);
    END LOOP;
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS cms_admin_scoped_select ON public.%I',table_name);
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_select ON public.%I FOR SELECT TO authenticated USING (public.can_manage_resume(resume_id))',table_name);
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_direct_dml ON public.%I FOR ALL TO authenticated USING (public.can_direct_write_education(resume_id)) WITH CHECK (public.can_direct_write_education(resume_id))',table_name);
  END LOOP;
END
$policy_guard$;

CREATE FUNCTION public.load_admin_education_write_state(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,education_write_mode text,education_trusted_context_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT target_resume_id,
    COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false),
    cms_private.get_resume_write_mode(target_resume_id,'education'),
    COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='education' AND r.requirement_key='trusted_network_context_v11'),false);
END
$function$;
REVOKE ALL ON FUNCTION public.load_admin_education_write_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_education_write_state(uuid) TO authenticated;

CREATE FUNCTION cms_private.verify_resume_education_v1_context(
  target_resume_id uuid,canonical_education text,signed_context text,signature_hex text
) RETURNS TABLE(context_value jsonb,education_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE ctx jsonb; rows_value jsonb; key_value bytea; supplied bytea; expected bytea; now_seconds bigint;
  issued_seconds bigint; expires_seconds bigint; item jsonb; locale_value jsonb; field_value jsonb; expected_position bigint;
BEGIN
  BEGIN
    IF signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context,'UTF8'))>8192
      OR canonical_education IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(canonical_education,'UTF8'))>196608
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid'; END IF;
    ctx:=signed_context::jsonb;
    IF pg_catalog.jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(ctx))<>14
      OR ctx->>'context_version'<>'1' OR pg_catalog.jsonb_typeof(ctx->'context_version')<>'number'
      OR ctx->>'domain'<>'education' OR pg_catalog.jsonb_typeof(ctx->'domain')<>'string'
      OR ctx->>'operation'<>'update' OR pg_catalog.jsonb_typeof(ctx->'operation')<>'string'
      OR ctx->>'resume_id'<>target_resume_id::text OR pg_catalog.jsonb_typeof(ctx->'resume_id')<>'string'
      OR ctx->>'actor_user_id'<>(SELECT auth.uid())::text OR pg_catalog.jsonb_typeof(ctx->'actor_user_id')<>'string'
      OR pg_catalog.jsonb_typeof(ctx->'key_id')<>'string' OR pg_catalog.jsonb_typeof(ctx->'request_id')<>'string'
      OR (ctx->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(ctx->'mutation_digest')<>'string' OR (ctx->>'mutation_digest') !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(ctx->'issued_at')<>'number' OR (ctx->>'issued_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR pg_catalog.jsonb_typeof(ctx->'expires_at')<>'number' OR (ctx->>'expires_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(ctx) k(key_name) WHERE k.key_name<>ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']))
      OR NOT(ctx ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']) THEN RAISE EXCEPTION 'invalid'; END IF;
    issued_seconds:=(ctx->>'issued_at')::bigint; expires_seconds:=(ctx->>'expires_at')::bigint;
    now_seconds:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
    IF issued_seconds>now_seconds+60 OR expires_seconds<=now_seconds OR expires_seconds<=issued_seconds OR expires_seconds-issued_seconds>300 THEN RAISE EXCEPTION 'invalid'; END IF;
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical_education,'UTF8'),'sha256'),'hex')<>ctx->>'mutation_digest' THEN RAISE EXCEPTION 'invalid'; END IF;
    rows_value:=canonical_education::jsonb;
    IF pg_catalog.jsonb_typeof(rows_value)<>'array' OR pg_catalog.jsonb_array_length(rows_value)>16 THEN RAISE EXCEPTION 'invalid'; END IF;
    FOR item,expected_position IN SELECT value,n FROM pg_catalog.jsonb_array_elements(rows_value) WITH ORDINALITY a(value,n) ORDER BY n LOOP
      IF pg_catalog.jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item))<>6
        OR NOT(item ?& ARRAY['id','position','entry_type','education_category','zh','en'])
        OR pg_catalog.jsonb_typeof(item->'id') NOT IN ('string','null')
        OR (item->>'id' IS NOT NULL AND (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        OR pg_catalog.jsonb_typeof(item->'position')<>'number' OR (item->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR (item->>'position')::bigint<>expected_position-1
        OR pg_catalog.jsonb_typeof(item->'entry_type')<>'string' OR item->>'entry_type' NOT IN ('standard','summerSchool')
        OR (item->'education_category'<>'null'::jsonb AND item->>'education_category' NOT IN ('undergraduate','graduate','doctoral','summerSchool','custom'))
        OR (item->'education_category'<>'null'::jsonb AND ((item->>'education_category'='summerSchool')<>(item->>'entry_type'='summerSchool')))
        OR pg_catalog.jsonb_typeof(item->'zh')<>'object' OR pg_catalog.jsonb_typeof(item->'en')<>'object' THEN RAISE EXCEPTION 'invalid'; END IF;
      FOREACH locale_value IN ARRAY ARRAY[item->'zh',item->'en'] LOOP
        IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(locale_value))<>7
          OR NOT(locale_value ?& ARRAY['title','program','period','grade','course_title','course_description','custom_category_label']) THEN RAISE EXCEPTION 'invalid'; END IF;
        IF pg_catalog.jsonb_typeof(locale_value->'title')<>'string' OR pg_catalog.jsonb_typeof(locale_value->'program')<>'string'
          OR pg_catalog.jsonb_typeof(locale_value->'period')<>'string' OR pg_catalog.jsonb_typeof(locale_value->'grade')<>'string'
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'title','UTF8'))>256
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'program','UTF8'))>256
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'period','UTF8'))>128
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'grade','UTF8'))>256 THEN RAISE EXCEPTION 'invalid'; END IF;
        IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(locale_value) f WHERE
          (f.key='course_title' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>256))
          OR (f.key='course_description' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>2048))
          OR (f.key='custom_category_label' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>256))
          OR f.key NOT IN ('title','program','period','grade','course_title','course_description','custom_category_label')) THEN RAISE EXCEPTION 'invalid'; END IF;
      END LOOP;
    END LOOP;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(rows_value) x(value) WHERE x.value->>'id' IS NOT NULL)
      <>(SELECT count(DISTINCT x.value->>'id') FROM pg_catalog.jsonb_array_elements(rows_value) x(value) WHERE x.value->>'id' IS NOT NULL) THEN RAISE EXCEPTION 'invalid'; END IF;
    supplied:=pg_catalog.decode(signature_hex,'hex'); key_value:=cms_private.activity_log_v11_key(ctx->>'key_id');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'invalid'; END IF;
    expected:=extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),key_value,'sha256');
    IF supplied<>expected THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'ip_network'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'ip_network')<>'string'
      OR ((ctx->>'ip_network')::cidr)::text<>ctx->>'ip_network'
      OR NOT((pg_catalog.family((ctx->>'ip_network')::cidr)=4 AND pg_catalog.masklen((ctx->>'ip_network')::cidr)=24)
        OR (pg_catalog.family((ctx->>'ip_network')::cidr)=6 AND pg_catalog.masklen((ctx->>'ip_network')::cidr)=48))) THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'country_code'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'country_code')<>'string' OR (ctx->>'country_code') !~ '^[A-Z]{2}$') THEN RAISE EXCEPTION 'invalid'; END IF;
    FOREACH field_value IN ARRAY ARRAY[ctx->'region',ctx->'city'] LOOP
      IF field_value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(field_value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(field_value#>>'{}','UTF8')) NOT BETWEEN 1 AND 128 OR (field_value#>>'{}') ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'invalid'; END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid signed Education request' USING ERRCODE='22023'; END;
  context_value:=ctx; education_value:=rows_value; RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_education_v1_context(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_resume_education_v1(target_resume_id uuid,canonical_education text,signed_context text,signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE target_site_key text; ctx jsonb; incoming jsonb; before_rows jsonb; result_value jsonb; change_value jsonb;
  actor_id uuid; request_id_value uuid; digest_value bytea; old_digest bytea; old_result jsonb; old_completed timestamptz; old_expiry timestamptz;
  entry jsonb; saved_id uuid; max_position integer; offset_value bigint; item_count integer; zh_count integer; en_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT t.resolved_site_key INTO target_site_key FROM cms_private.assert_activity_log_target(target_resume_id) t;
  IF target_site_key IS NULL THEN RAISE EXCEPTION 'Education target is not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  IF cms_private.get_resume_write_mode(target_resume_id,'education')<>'rpc' THEN RAISE EXCEPTION 'Education RPC mode is not enabled' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='education' AND r.requirement_key='trusted_network_context_v11'),false) THEN RAISE EXCEPTION 'Trusted Education context is not enabled' USING ERRCODE='42501'; END IF;
  SELECT v.context_value,v.education_value INTO ctx,incoming FROM cms_private.verify_resume_education_v1_context(target_resume_id,canonical_education,signed_context,signature_hex) v;
  actor_id:=(ctx->>'actor_user_id')::uuid; request_id_value:=(ctx->>'request_id')::uuid;
  digest_value:=extensions.digest(pg_catalog.convert_to(canonical_education,'UTF8'),'sha256');
  SELECT i.mutation_digest,i.completed_at,i.expires_at,i.result_payload INTO old_digest,old_completed,old_expiry,old_result FROM cms_private.activity_log_idempotency i
    WHERE i.actor_user_id=actor_id AND i.resume_id=target_resume_id AND i.domain_key='education' AND i.request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Idempotency request has expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF old_digest<>digest_value THEN RAISE EXCEPTION 'Idempotency key conflicts with a different Education request' USING ERRCODE='P13B1'; END IF;
    IF old_completed IS NULL OR old_result IS NULL THEN RAISE EXCEPTION 'Incomplete Education idempotency record' USING ERRCODE='22023'; END IF;
    RETURN old_result;
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at)
    VALUES(actor_id,target_resume_id,'education',request_id_value,digest_value,pg_catalog.transaction_timestamp(),NULL,pg_catalog.transaction_timestamp()+interval '7 days');
  SELECT count(*),count(*) FILTER(WHERE zh.education_entry_id IS NOT NULL),count(*) FILTER(WHERE en.education_entry_id IS NOT NULL)
    INTO item_count,zh_count,en_count FROM public.resume_education_entries e
    LEFT JOIN public.resume_education_translations zh ON zh.education_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_education_translations en ON en.education_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en'
    WHERE e.resume_id=target_resume_id;
  IF zh_count<>item_count OR en_count<>item_count OR item_count>16 THEN RAISE EXCEPTION 'Education locale state is incomplete or exceeds the supported bound' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,'entry_type',e.entry_type,'education_category',e.education_category,
    'zh',pg_catalog.jsonb_build_object('title',zh.title,'program',zh.program,'period',zh.period,'grade',zh.grade,'course_title',zh.course_title,'course_description',zh.course_description,'custom_category_label',zh.custom_category_label),
    'en',pg_catalog.jsonb_build_object('title',en.title,'program',en.program,'period',en.period,'grade',en.grade,'course_title',en.course_title,'course_description',en.course_description,'custom_category_label',en.custom_category_label)) ORDER BY e.position,e.id),'[]'::jsonb)
    INTO before_rows FROM public.resume_education_entries e
    JOIN public.resume_education_translations zh ON zh.education_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
    JOIN public.resume_education_translations en ON en.education_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en' WHERE e.resume_id=target_resume_id;
  IF pg_catalog.jsonb_array_length(before_rows)>16 OR pg_catalog.octet_length(pg_catalog.convert_to(before_rows::text,'UTF8'))>212992
    OR NOT cms_private.activity_event_payload_v2_education_is_allowed('education','education_list',NULL,'update',pg_catalog.jsonb_build_object('education',before_rows),
      pg_catalog.jsonb_build_object('education',pg_catalog.jsonb_build_object('before',before_rows,'after',before_rows))) THEN
    RAISE EXCEPTION 'Existing Education state is outside the supported aggregate contract' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) a(value) WHERE a.value->>'id' IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.resume_education_entries e WHERE e.id=(a.value->>'id')::uuid AND e.resume_id=target_resume_id)) THEN
    RAISE EXCEPTION 'Education entry is outside the authorized target' USING ERRCODE='42501'; END IF;
  IF pg_catalog.jsonb_array_length(before_rows)=pg_catalog.jsonb_array_length(incoming) AND NOT EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) WITH ORDINALITY a(value,n)
      LEFT JOIN pg_catalog.jsonb_array_elements(before_rows) WITH ORDINALITY b(value,n) USING(n)
    WHERE a.value->>'id' IS DISTINCT FROM b.value->>'id' OR (a.value->>'position')::integer<>a.n-1
      OR a.value->>'entry_type' IS DISTINCT FROM b.value->>'entry_type'
      OR a.value->'education_category' IS DISTINCT FROM b.value->'education_category'
      OR a.value->'zh' IS DISTINCT FROM b.value->'zh' OR a.value->'en' IS DISTINCT FROM b.value->'en') THEN result_value:=before_rows;
  ELSE
    SELECT COALESCE(max(position),-1) INTO max_position FROM public.resume_education_entries WHERE resume_id=target_resume_id;
    IF max_position>1000000000 THEN RAISE EXCEPTION 'Education ordering cannot be safely updated' USING ERRCODE='22023'; END IF;
    offset_value:=max_position::bigint+pg_catalog.jsonb_array_length(incoming)+1001;
    UPDATE public.resume_education_entries SET position=(position+offset_value)::integer WHERE resume_id=target_resume_id;
    DELETE FROM public.resume_education_translations t WHERE t.resume_id=target_resume_id
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) a(value) WHERE a.value->>'id'=t.education_entry_id::text);
    DELETE FROM public.resume_education_entries e WHERE e.resume_id=target_resume_id
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) a(value) WHERE a.value->>'id'=e.id::text);
    FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(incoming) WITH ORDINALITY a(value,n) ORDER BY n LOOP
      IF entry->>'id' IS NULL THEN
        INSERT INTO public.resume_education_entries(resume_id,source_key,position,entry_type,education_category)
          VALUES(target_resume_id,NULL,(entry->>'position')::integer,entry->>'entry_type',entry->>'education_category') RETURNING id INTO saved_id;
      ELSE
        saved_id:=(entry->>'id')::uuid;
        UPDATE public.resume_education_entries SET position=(entry->>'position')::integer,entry_type=entry->>'entry_type',
          education_category=entry->>'education_category',updated_at=pg_catalog.transaction_timestamp()
          WHERE id=saved_id AND resume_id=target_resume_id;
      END IF;
      INSERT INTO public.resume_education_translations(education_entry_id,resume_id,locale,title,program,period,grade,course_title,course_description,custom_category_label)
      VALUES(saved_id,target_resume_id,'zh',entry->'zh'->>'title',entry->'zh'->>'program',entry->'zh'->>'period',entry->'zh'->>'grade',entry->'zh'->>'course_title',entry->'zh'->>'course_description',entry->'zh'->>'custom_category_label'),
        (saved_id,target_resume_id,'en',entry->'en'->>'title',entry->'en'->>'program',entry->'en'->>'period',entry->'en'->>'grade',entry->'en'->>'course_title',entry->'en'->>'course_description',entry->'en'->>'custom_category_label')
      ON CONFLICT(education_entry_id,locale) DO UPDATE SET resume_id=EXCLUDED.resume_id,title=EXCLUDED.title,program=EXCLUDED.program,period=EXCLUDED.period,
        grade=EXCLUDED.grade,course_title=EXCLUDED.course_title,course_description=EXCLUDED.course_description,
        custom_category_label=EXCLUDED.custom_category_label,updated_at=pg_catalog.transaction_timestamp()
      WHERE public.resume_education_translations.resume_id IS DISTINCT FROM EXCLUDED.resume_id
        OR public.resume_education_translations.title IS DISTINCT FROM EXCLUDED.title OR public.resume_education_translations.program IS DISTINCT FROM EXCLUDED.program
        OR public.resume_education_translations.period IS DISTINCT FROM EXCLUDED.period OR public.resume_education_translations.grade IS DISTINCT FROM EXCLUDED.grade
        OR public.resume_education_translations.course_title IS DISTINCT FROM EXCLUDED.course_title
        OR public.resume_education_translations.course_description IS DISTINCT FROM EXCLUDED.course_description
        OR public.resume_education_translations.custom_category_label IS DISTINCT FROM EXCLUDED.custom_category_label;
    END LOOP;
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,'entry_type',e.entry_type,'education_category',e.education_category,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'program',zh.program,'period',zh.period,'grade',zh.grade,'course_title',zh.course_title,'course_description',zh.course_description,'custom_category_label',zh.custom_category_label),
      'en',pg_catalog.jsonb_build_object('title',en.title,'program',en.program,'period',en.period,'grade',en.grade,'course_title',en.course_title,'course_description',en.course_description,'custom_category_label',en.custom_category_label)) ORDER BY e.position,e.id),'[]'::jsonb)
      INTO result_value FROM public.resume_education_entries e JOIN public.resume_education_translations zh ON zh.education_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
      JOIN public.resume_education_translations en ON en.education_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en' WHERE e.resume_id=target_resume_id;
    change_value:=pg_catalog.jsonb_build_object('education',pg_catalog.jsonb_build_object('before',before_rows,'after',result_value));
    IF pg_catalog.octet_length(pg_catalog.convert_to(result_value::text,'UTF8'))>212992
      OR NOT cms_private.activity_event_payload_v2_education_is_allowed('education','education_list',NULL,'update',pg_catalog.jsonb_build_object('education',result_value),change_value) THEN
      RAISE EXCEPTION 'Education result exceeds the supported aggregate bound' USING ERRCODE='22023'; END IF;
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
      VALUES(actor_id,(SELECT auth.jwt()->>'email'),(SELECT x.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) x),target_resume_id,target_site_key,
        'update','education','education_list',NULL,pg_catalog.jsonb_build_object('education',result_value),change_value,2,(ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
  END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=result_value,completed_at=pg_catalog.transaction_timestamp()
    WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='education' AND request_id=request_id_value;
  RETURN result_value;
END
$function$;
REVOKE ALL ON FUNCTION public.save_resume_education_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_education_v1(uuid,text,text,text) TO authenticated;
COMMIT;
