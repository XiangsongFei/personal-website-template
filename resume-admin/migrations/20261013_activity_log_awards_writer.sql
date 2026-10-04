-- Awards V1.3D-1: typed, target-scoped signed writer. Installing this migration
-- does not change any target's capability, write mode, or trusted-context gate.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Awards writer must be installed as postgres' USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

CREATE FUNCTION public.can_direct_write_awards(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT public.can_manage_resume(target_resume_id)
    AND cms_private.get_resume_write_mode(target_resume_id, 'awards') = 'direct'
$function$;
REVOKE ALL ON FUNCTION public.can_direct_write_awards(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_awards(uuid) TO authenticated;

DO $awards_policy_guard$
DECLARE table_name text; policy_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['resume_award_entries','resume_award_translations'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname='public' AND tablename=table_name AND cmd <> 'SELECT'
        AND policyname <> 'cms_admin_scoped_all' AND policyname <> 'cms_admin_scoped_direct_dml') THEN
      RAISE EXCEPTION 'Unexpected Awards write policy requires review' USING ERRCODE='55000';
    END IF;
    FOR policy_record IN SELECT policyname, cmd FROM pg_catalog.pg_policies
      WHERE schemaname='public' AND tablename=table_name
        AND policyname IN ('cms_admin_scoped_all','cms_admin_scoped_direct_dml')
    LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I', policy_record.policyname, table_name);
    END LOOP;
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS cms_admin_scoped_select ON public.%I', table_name);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS cms_admin_scoped_direct_dml ON public.%I', table_name);
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_select ON public.%I FOR SELECT TO authenticated USING (public.can_manage_resume(resume_id))', table_name);
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_direct_dml ON public.%I FOR ALL TO authenticated USING (public.can_direct_write_awards(resume_id)) WITH CHECK (public.can_direct_write_awards(resume_id))', table_name);
  END LOOP;
END
$awards_policy_guard$;

CREATE FUNCTION public.load_admin_awards_write_state(target_resume_id uuid)
RETURNS TABLE (resume_id uuid, activity_log_enabled boolean, awards_write_mode text,
  awards_trusted_context_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN
    RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT target_resume_id,
    COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities AS c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'), false),
    cms_private.get_resume_write_mode(target_resume_id, 'awards'),
    COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements AS r WHERE r.resume_id=target_resume_id
      AND r.domain_key='awards' AND r.requirement_key='trusted_network_context_v11'), false);
END
$function$;
REVOKE ALL ON FUNCTION public.load_admin_awards_write_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_awards_write_state(uuid) TO authenticated;

CREATE FUNCTION cms_private.verify_resume_awards_v1_context(
  target_resume_id uuid, canonical_awards text, signed_context text, signature_hex text
)
RETURNS TABLE (context_value jsonb, awards_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE ctx jsonb; rows_value jsonb; key_value bytea; supplied bytea; expected bytea;
  now_seconds bigint; issued_seconds bigint; expires_seconds bigint; ip_value cidr; network_text text; text_value text;
BEGIN
  BEGIN
    IF signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context,'UTF8')) > 8192
      OR canonical_awards IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(canonical_awards,'UTF8')) > 4096
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid'; END IF;
    ctx := signed_context::jsonb;
    IF pg_catalog.jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(ctx)) <> 14
      OR pg_catalog.jsonb_typeof(ctx->'context_version') IS DISTINCT FROM 'number' OR ctx->>'context_version' <> '1'
      OR pg_catalog.jsonb_typeof(ctx->'key_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'domain') IS DISTINCT FROM 'string' OR ctx->>'domain' <> 'awards'
      OR pg_catalog.jsonb_typeof(ctx->'operation') IS DISTINCT FROM 'string' OR ctx->>'operation' <> 'update'
      OR pg_catalog.jsonb_typeof(ctx->'resume_id') IS DISTINCT FROM 'string' OR ctx->>'resume_id' <> target_resume_id::text
      OR pg_catalog.jsonb_typeof(ctx->'actor_user_id') IS DISTINCT FROM 'string' OR ctx->>'actor_user_id' <> (SELECT auth.uid())::text
      OR pg_catalog.jsonb_typeof(ctx->'request_id') IS DISTINCT FROM 'string'
      OR (ctx->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(ctx->'mutation_digest') IS DISTINCT FROM 'string'
      OR (ctx->>'mutation_digest') !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(ctx->'issued_at') IS DISTINCT FROM 'number'
      OR (ctx->>'issued_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR pg_catalog.jsonb_typeof(ctx->'expires_at') IS DISTINCT FROM 'number'
      OR (ctx->>'expires_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(ctx) AS k(key_name)
        WHERE k.key_name <> ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']))
      OR NOT (ctx ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']) THEN RAISE EXCEPTION 'invalid'; END IF;
    issued_seconds := (ctx->>'issued_at')::bigint; expires_seconds := (ctx->>'expires_at')::bigint;
    now_seconds := pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
    IF issued_seconds > now_seconds + 60 OR expires_seconds <= now_seconds OR expires_seconds <= issued_seconds OR expires_seconds-issued_seconds > 300 THEN RAISE EXCEPTION 'invalid'; END IF;
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical_awards,'UTF8'),'sha256'),'hex') <> ctx->>'mutation_digest' THEN RAISE EXCEPTION 'invalid'; END IF;
    rows_value := canonical_awards::jsonb;
    IF pg_catalog.jsonb_typeof(rows_value) <> 'array' OR pg_catalog.jsonb_array_length(rows_value) > 32 OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(rows_value) WITH ORDINALITY AS a(value,n)
      WHERE pg_catalog.jsonb_typeof(a.value) <> 'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(a.value)) <> 4
        OR NOT (a.value ?& ARRAY['id','position','zh','en'])
        OR pg_catalog.jsonb_typeof(a.value->'id') NOT IN ('string','null')
        OR (a.value->>'id' IS NOT NULL AND (a.value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        OR pg_catalog.jsonb_typeof(a.value->'position') <> 'number' OR (a.value->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR (a.value->>'position')::integer <> a.n-1
        OR pg_catalog.jsonb_typeof(a.value->'zh') <> 'object' OR pg_catalog.jsonb_typeof(a.value->'en') <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(a.value->'zh')) <> 2 OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(a.value->'en')) <> 2
        OR NOT (a.value->'zh' ?& ARRAY['name','year']) OR NOT (a.value->'en' ?& ARRAY['name','year'])
        OR pg_catalog.jsonb_typeof(a.value->'zh'->'name') <> 'string' OR pg_catalog.jsonb_typeof(a.value->'zh'->'year') <> 'string'
        OR pg_catalog.jsonb_typeof(a.value->'en'->'name') <> 'string' OR pg_catalog.jsonb_typeof(a.value->'en'->'year') <> 'string'
        OR pg_catalog.length(a.value->'zh'->>'name') > 200 OR pg_catalog.length(a.value->'en'->>'name') > 200
        OR pg_catalog.length(a.value->'zh'->>'year') > 64 OR pg_catalog.length(a.value->'en'->>'year') > 64
    ) THEN RAISE EXCEPTION 'invalid'; END IF;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(rows_value) AS a(value) WHERE a.value->>'id' IS NOT NULL)
       <> (SELECT count(DISTINCT a.value->>'id') FROM pg_catalog.jsonb_array_elements(rows_value) AS a(value) WHERE a.value->>'id' IS NOT NULL) THEN RAISE EXCEPTION 'invalid'; END IF;
    supplied := pg_catalog.decode(signature_hex,'hex');
    key_value := cms_private.activity_log_v11_key(ctx->>'key_id');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value) < 32 THEN RAISE EXCEPTION 'invalid'; END IF;
    expected := extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),key_value,'sha256');
    IF supplied <> expected THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'ip_network' <> 'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(ctx->'ip_network') <> 'string' THEN RAISE EXCEPTION 'invalid'; END IF;
      network_text := ctx->>'ip_network'; ip_value := network_text::cidr;
      IF ip_value::text <> network_text OR NOT ((pg_catalog.family(ip_value)=4 AND pg_catalog.masklen(ip_value)=24) OR (pg_catalog.family(ip_value)=6 AND pg_catalog.masklen(ip_value)=48)) THEN RAISE EXCEPTION 'invalid'; END IF;
    END IF;
    text_value := ctx->>'country_code';
    IF ctx->'country_code' <> 'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'country_code') <> 'string' OR text_value COLLATE "C" !~ '^[A-Z]{2}$') THEN RAISE EXCEPTION 'invalid'; END IF;
    FOREACH text_value IN ARRAY ARRAY['region','city'] LOOP
      IF ctx->text_value <> 'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->text_value) <> 'string' OR pg_catalog.octet_length(ctx->>text_value) NOT BETWEEN 1 AND 128 OR (ctx->>text_value) ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'invalid'; END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid signed Awards request' USING ERRCODE='22023';
  END;
  context_value := ctx; awards_value := rows_value; RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_awards_v1_context(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.save_resume_awards_v1(target_resume_id uuid, canonical_awards text, signed_context text, signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE target_site_key text; gate_enabled boolean; ctx jsonb; incoming jsonb; before_rows jsonb; after_rows jsonb;
  actor_id uuid; request_id_value uuid; digest_value bytea; old_digest bytea; old_result jsonb; old_completed timestamptz; old_expiry timestamptz;
  item jsonb; saved_id uuid; max_position integer; offset_value bigint; changed boolean; result_value jsonb;
  change_value jsonb; duplicate_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT c.resolved_site_key INTO target_site_key FROM cms_private.assert_activity_log_target(target_resume_id) AS c;
  IF target_site_key IS NULL THEN RAISE EXCEPTION 'Awards target is not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resume_sites AS s WHERE s.id=target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  IF cms_private.get_resume_write_mode(target_resume_id,'awards') <> 'rpc' THEN RAISE EXCEPTION 'Awards RPC mode is not enabled' USING ERRCODE='42501'; END IF;
  SELECT r.enabled INTO gate_enabled FROM cms_private.resume_domain_requirements AS r
    WHERE r.resume_id=target_resume_id AND r.domain_key='awards' AND r.requirement_key='trusted_network_context_v11';
  IF NOT COALESCE(gate_enabled,false) THEN RAISE EXCEPTION 'Trusted Awards context is not enabled' USING ERRCODE='42501'; END IF;
  SELECT v.context_value,v.awards_value INTO ctx,incoming FROM cms_private.verify_resume_awards_v1_context(target_resume_id,canonical_awards,signed_context,signature_hex) AS v;
  actor_id := (ctx->>'actor_user_id')::uuid; request_id_value := (ctx->>'request_id')::uuid;
  digest_value := extensions.digest(pg_catalog.convert_to(canonical_awards,'UTF8'),'sha256');
  SELECT i.mutation_digest,i.completed_at,i.expires_at,i.result_payload INTO old_digest,old_completed,old_expiry,old_result
    FROM cms_private.activity_log_idempotency AS i WHERE i.actor_user_id=actor_id AND i.resume_id=target_resume_id AND i.domain_key='awards' AND i.request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Idempotency request has expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF old_digest <> digest_value THEN RAISE EXCEPTION 'Idempotency key conflicts with a different Awards request' USING ERRCODE='P13B1'; END IF;
    IF old_completed IS NULL OR old_result IS NULL THEN RAISE EXCEPTION 'Incomplete Awards idempotency record' USING ERRCODE='22023'; END IF;
    RETURN old_result;
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at)
    VALUES(actor_id,target_resume_id,'awards',request_id_value,digest_value,pg_catalog.transaction_timestamp(),NULL,pg_catalog.transaction_timestamp()+interval '7 days');

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
    'zh',pg_catalog.jsonb_build_object('name',COALESCE(zh.name,''),'year',COALESCE(zh.year,'')),
    'en',pg_catalog.jsonb_build_object('name',COALESCE(en.name,''),'year',COALESCE(en.year,''))) ORDER BY e.position,e.id),'[]'::jsonb)
    INTO before_rows FROM public.resume_award_entries AS e
    LEFT JOIN public.resume_award_translations AS zh ON zh.award_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_award_translations AS en ON en.award_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en'
    WHERE e.resume_id=target_resume_id;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) AS a(value)
    WHERE a.value->>'id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.resume_award_entries AS e WHERE e.id=(a.value->>'id')::uuid AND e.resume_id=target_resume_id)) THEN
    RAISE EXCEPTION 'Award entry is outside the authorized target' USING ERRCODE='42501';
  END IF;
  IF pg_catalog.jsonb_array_length(before_rows)=pg_catalog.jsonb_array_length(incoming)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) WITH ORDINALITY AS a(value,n)
      LEFT JOIN pg_catalog.jsonb_array_elements(before_rows) WITH ORDINALITY AS b(value,n) USING(n)
      WHERE a.value->>'id' IS DISTINCT FROM b.value->>'id' OR (a.value->>'position')::integer <> a.n-1
        OR a.value->'zh' IS DISTINCT FROM b.value->'zh' OR a.value->'en' IS DISTINCT FROM b.value->'en') THEN
    result_value := before_rows;
  ELSE
    changed := true;
    SELECT COALESCE(max(position),-1) INTO max_position FROM public.resume_award_entries WHERE resume_id=target_resume_id;
    IF max_position > 1000000000 THEN RAISE EXCEPTION 'Awards ordering cannot be safely updated' USING ERRCODE='22023'; END IF;
    offset_value := max_position::bigint + pg_catalog.jsonb_array_length(incoming) + 1001;
    UPDATE public.resume_award_entries SET position=(position + offset_value)::integer WHERE resume_id=target_resume_id;
    FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(incoming) WITH ORDINALITY AS a(value,n) ORDER BY n LOOP
      IF item->>'id' IS NULL THEN
        INSERT INTO public.resume_award_entries(resume_id,source_key,position) VALUES(target_resume_id,NULL,(item->>'position')::integer) RETURNING id INTO saved_id;
      ELSE
        saved_id := (item->>'id')::uuid;
        UPDATE public.resume_award_entries SET position=(item->>'position')::integer,updated_at=pg_catalog.transaction_timestamp()
          WHERE id=saved_id AND resume_id=target_resume_id;
      END IF;
      INSERT INTO public.resume_award_translations(award_entry_id,resume_id,locale,name,year)
        VALUES(saved_id,target_resume_id,'zh',item->'zh'->>'name',item->'zh'->>'year'),(saved_id,target_resume_id,'en',item->'en'->>'name',item->'en'->>'year')
        ON CONFLICT(award_entry_id,locale) DO UPDATE SET name=EXCLUDED.name,year=EXCLUDED.year,updated_at=pg_catalog.transaction_timestamp()
          WHERE public.resume_award_translations.name IS DISTINCT FROM EXCLUDED.name OR public.resume_award_translations.year IS DISTINCT FROM EXCLUDED.year;
      IF item->>'id' IS NULL THEN
        incoming := pg_catalog.jsonb_set(incoming,ARRAY[(item->>'position')], item || pg_catalog.jsonb_build_object('id',saved_id::text));
      END IF;
    END LOOP;
    DELETE FROM public.resume_award_entries AS e WHERE e.resume_id=target_resume_id
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) AS a(value) WHERE a.value->>'id'=e.id::text);
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
      'zh',pg_catalog.jsonb_build_object('name',COALESCE(zh.name,''),'year',COALESCE(zh.year,'')),
      'en',pg_catalog.jsonb_build_object('name',COALESCE(en.name,''),'year',COALESCE(en.year,''))) ORDER BY e.position,e.id),'[]'::jsonb)
      INTO result_value FROM public.resume_award_entries AS e
      LEFT JOIN public.resume_award_translations AS zh ON zh.award_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
      LEFT JOIN public.resume_award_translations AS en ON en.award_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en'
      WHERE e.resume_id=target_resume_id;
    IF pg_catalog.octet_length(pg_catalog.convert_to(result_value::text,'UTF8')) > 8192
      OR pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('awards',result_value)::text,'UTF8'))
       + pg_catalog.octet_length(pg_catalog.convert_to(pg_catalog.jsonb_build_object('awards',pg_catalog.jsonb_build_object('before',before_rows,'after',result_value))::text,'UTF8')) > 12000 THEN
      RAISE EXCEPTION 'Awards event exceeds the supported size' USING ERRCODE='22023';
    END IF;
    change_value := pg_catalog.jsonb_build_object('awards',pg_catalog.jsonb_build_object('before',before_rows,'after',result_value));
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
    VALUES(actor_id,(SELECT auth.jwt()->>'email'),(SELECT c.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) AS c),
      target_resume_id,target_site_key,'update','awards','award_list',NULL,pg_catalog.jsonb_build_object('awards',result_value),change_value,2,
      (ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
  END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=result_value,completed_at=pg_catalog.transaction_timestamp()
    WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='awards' AND request_id=request_id_value;
  RETURN result_value;
END
$function$;
REVOKE ALL ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.can_direct_write_awards(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.load_admin_awards_write_state(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text) FROM PUBLIC, anon, service_role;

COMMIT;
