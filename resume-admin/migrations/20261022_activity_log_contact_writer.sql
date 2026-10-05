-- Transactional, typed Contact writer. Installation deliberately preserves all targets.
BEGIN;
DO $owner_guard$ BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Contact writer must be installed as postgres' USING ERRCODE='42501'; END IF;
END $owner_guard$;

CREATE FUNCTION public.can_direct_write_contact(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$ SELECT public.can_manage_resume(target_resume_id) AND cms_private.get_resume_write_mode(target_resume_id,'contact')='direct' $function$;
REVOKE ALL ON FUNCTION public.can_direct_write_contact(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_contact(uuid) TO authenticated;

DO $policy_guard$
DECLARE table_name text; policy_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['resume_contact_focus_items','resume_contact_focus_translations','resume_contact_status_items','resume_contact_status_translations'] LOOP
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=table_name
      AND cmd<>'SELECT' AND policyname NOT IN ('cms_admin_scoped_all','cms_admin_scoped_direct_dml')) THEN
      RAISE EXCEPTION 'Unexpected Contact write policy requires review' USING ERRCODE='55000'; END IF;
    FOR policy_record IN SELECT policyname FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=table_name
      AND policyname IN ('cms_admin_scoped_all','cms_admin_scoped_direct_dml') LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I',policy_record.policyname,table_name);
    END LOOP;
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS cms_admin_scoped_select ON public.%I',table_name);
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_select ON public.%I FOR SELECT TO authenticated USING (public.can_manage_resume(resume_id))',table_name);
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_direct_dml ON public.%I FOR ALL TO authenticated USING (public.can_direct_write_contact(resume_id)) WITH CHECK (public.can_direct_write_contact(resume_id))',table_name);
  END LOOP;
END
$policy_guard$;

-- resume_locale_content is shared with other domains. An UPDATE of unrelated
-- columns with stable row identity remains governed only by the existing shared
-- table policies. INSERT/DELETE necessarily create/remove the non-null Contact
-- values on that row; key changes move those Contact values and shared identity.
-- The invoker trigger sees authenticated for Data API writes and postgres inside
-- the narrowly granted SECURITY DEFINER Contact RPC.
CREATE FUNCTION cms_private.enforce_contact_locale_write_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
  IF current_user='postgres' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='INSERT' THEN
    IF NOT public.can_direct_write_contact(NEW.resume_id) THEN
      RAISE EXCEPTION 'Contact direct writes are disabled' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    IF NOT public.can_direct_write_contact(OLD.resume_id) THEN
      RAISE EXCEPTION 'Contact direct writes are disabled' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.contact_label IS DISTINCT FROM OLD.contact_label
      OR NEW.availability IS DISTINCT FROM OLD.availability
      OR NEW.resume_id IS DISTINCT FROM OLD.resume_id
      OR NEW.locale IS DISTINCT FROM OLD.locale THEN
      IF NOT public.can_direct_write_contact(OLD.resume_id)
        OR NOT public.can_direct_write_contact(NEW.resume_id) THEN
        RAISE EXCEPTION 'Contact direct writes are disabled' USING ERRCODE='42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported Contact locale operation' USING ERRCODE='42501';
END
$function$;
REVOKE ALL ON FUNCTION cms_private.enforce_contact_locale_write_mode() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS enforce_contact_locale_write_mode ON public.resume_locale_content;
CREATE TRIGGER enforce_contact_locale_write_mode BEFORE INSERT OR UPDATE OR DELETE ON public.resume_locale_content
FOR EACH ROW EXECUTE FUNCTION cms_private.enforce_contact_locale_write_mode();

CREATE FUNCTION public.load_admin_contact_write_state(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,contact_write_mode text,contact_trusted_context_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT target_resume_id,
    COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false),
    cms_private.get_resume_write_mode(target_resume_id,'contact'),
    COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='contact' AND r.requirement_key='trusted_network_context_v11'),false);
END
$function$;
REVOKE ALL ON FUNCTION public.load_admin_contact_write_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_contact_write_state(uuid) TO authenticated;

CREATE FUNCTION cms_private.verify_resume_contact_v1_context(target_resume_id uuid,canonical_contact text,signed_context text,signature_hex text)
RETURNS TABLE(context_value jsonb,contact_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE ctx jsonb; contact_rows jsonb; key_value bytea; supplied bytea; expected bytea; now_seconds bigint;
  issued_seconds bigint; expires_seconds bigint; ip_value cidr; network_text text; locale_key text;
BEGIN
  BEGIN
    IF signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context,'UTF8'))>8192
      OR canonical_contact IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(canonical_contact,'UTF8'))>196608
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid'; END IF;
    ctx:=signed_context::jsonb;
    IF pg_catalog.jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(ctx))<>14
      OR pg_catalog.jsonb_typeof(ctx->'context_version') IS DISTINCT FROM 'number' OR ctx->>'context_version'<>'1'
      OR pg_catalog.jsonb_typeof(ctx->'key_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'domain') IS DISTINCT FROM 'string' OR ctx->>'domain'<>'contact'
      OR pg_catalog.jsonb_typeof(ctx->'operation') IS DISTINCT FROM 'string' OR ctx->>'operation'<>'update'
      OR pg_catalog.jsonb_typeof(ctx->'resume_id') IS DISTINCT FROM 'string' OR ctx->>'resume_id'<>target_resume_id::text
      OR pg_catalog.jsonb_typeof(ctx->'actor_user_id') IS DISTINCT FROM 'string' OR ctx->>'actor_user_id'<>(SELECT auth.uid())::text
      OR pg_catalog.jsonb_typeof(ctx->'request_id') IS DISTINCT FROM 'string'
      OR (ctx->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(ctx->'mutation_digest') IS DISTINCT FROM 'string' OR (ctx->>'mutation_digest') !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(ctx->'issued_at') IS DISTINCT FROM 'number' OR (ctx->>'issued_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR pg_catalog.jsonb_typeof(ctx->'expires_at') IS DISTINCT FROM 'number' OR (ctx->>'expires_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(ctx) AS k(key_name) WHERE k.key_name<>ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']))
      OR NOT(ctx ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']) THEN RAISE EXCEPTION 'invalid'; END IF;
    issued_seconds:=(ctx->>'issued_at')::bigint; expires_seconds:=(ctx->>'expires_at')::bigint;
    now_seconds:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
    IF issued_seconds>now_seconds+60 OR expires_seconds<=now_seconds OR expires_seconds<=issued_seconds OR expires_seconds-issued_seconds>300 THEN RAISE EXCEPTION 'invalid'; END IF;
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical_contact,'UTF8'),'sha256'),'hex')<>ctx->>'mutation_digest' THEN RAISE EXCEPTION 'invalid'; END IF;
    contact_rows:=canonical_contact::jsonb;
    IF NOT cms_private.contact_aggregate_is_allowed(contact_rows,true,true)
      OR pg_catalog.octet_length(pg_catalog.convert_to(contact_rows::text,'UTF8'))>196608 THEN RAISE EXCEPTION 'invalid'; END IF;
    supplied:=pg_catalog.decode(signature_hex,'hex'); key_value:=cms_private.activity_log_v11_key(ctx->>'key_id');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'invalid'; END IF;
    expected:=extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),key_value,'sha256');
    IF supplied<>expected THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'ip_network'<>'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(ctx->'ip_network')<>'string' THEN RAISE EXCEPTION 'invalid'; END IF;
      network_text:=ctx->>'ip_network'; ip_value:=network_text::cidr;
      IF ip_value::text<>network_text OR NOT((pg_catalog.family(ip_value)=4 AND pg_catalog.masklen(ip_value)=24) OR (pg_catalog.family(ip_value)=6 AND pg_catalog.masklen(ip_value)=48)) THEN RAISE EXCEPTION 'invalid'; END IF;
    END IF;
    IF ctx->'country_code'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'country_code')<>'string' OR (ctx->>'country_code') COLLATE "C" !~ '^[A-Z]{2}$') THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'region'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'region')<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(ctx->>'region','UTF8'))>128) THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'city'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'city')<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(ctx->>'city','UTF8'))>128) THEN RAISE EXCEPTION 'invalid'; END IF;
    RETURN QUERY SELECT ctx,contact_rows;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid signed Contact request' USING ERRCODE='22023';
  END;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_contact_v1_context(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_resume_contact_v1(target_resume_id uuid,canonical_contact text,signed_context text,signature_hex text)
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
        ON CONFLICT(focus_item_id,resume_id,locale) DO UPDATE SET title=EXCLUDED.title,detail=EXCLUDED.detail,updated_at=pg_catalog.transaction_timestamp()
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
        ON CONFLICT(status_item_id,resume_id,locale) DO UPDATE SET title=EXCLUDED.title,detail=EXCLUDED.detail,updated_at=pg_catalog.transaction_timestamp()
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
