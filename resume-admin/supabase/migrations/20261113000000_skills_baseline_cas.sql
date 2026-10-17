-- Skills baseline CAS: database-signed snapshot and stale-write rejection under the existing target lock.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Skills writer must be installed as postgres' USING ERRCODE='42501'; END IF;
END
$owner_guard$;

DROP FUNCTION public.load_admin_skills_write_state(uuid);

CREATE FUNCTION public.load_admin_skills_write_state(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,skills_write_mode text,skills_trusted_context_required boolean,skills_snapshot jsonb,skills_baseline_digest text,skills_baseline_proof text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE snapshot_value jsonb; digest_value text; key_value bytea; proof_payload text; proof_value text; item_count integer; zh_count integer; en_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501'; END IF;
  SELECT count(*),count(*) FILTER(WHERE zh.skill_group_id IS NOT NULL),count(*) FILTER(WHERE en.skill_group_id IS NOT NULL)
    INTO item_count,zh_count,en_count FROM public.resume_skill_groups AS g
    LEFT JOIN public.resume_skill_group_translations AS zh ON zh.skill_group_id=g.id AND zh.resume_id=g.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_skill_group_translations AS en ON en.skill_group_id=g.id AND en.resume_id=g.resume_id AND en.locale='en'
    WHERE g.resume_id=target_resume_id;
  IF zh_count<>item_count OR en_count<>item_count OR item_count>16 THEN
    RAISE EXCEPTION 'Existing Skills state is outside the supported aggregate contract' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',g.id::text,'position',g.position,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'items',zh.items),
      'en',pg_catalog.jsonb_build_object('title',en.title,'items',en.items)) ORDER BY g.position,g.id),'[]'::jsonb)
    INTO snapshot_value FROM public.resume_skill_groups AS g
    JOIN public.resume_skill_group_translations AS zh ON zh.skill_group_id=g.id AND zh.resume_id=g.resume_id AND zh.locale='zh'
    JOIN public.resume_skill_group_translations AS en ON en.skill_group_id=g.id AND en.resume_id=g.resume_id AND en.locale='en'
    WHERE g.resume_id=target_resume_id;
  IF pg_catalog.jsonb_array_length(snapshot_value)>16 OR pg_catalog.octet_length(pg_catalog.convert_to(snapshot_value::text,'UTF8'))>212992 THEN
    RAISE EXCEPTION 'Existing Skills state is outside the supported aggregate contract' USING ERRCODE='22023'; END IF;
  digest_value:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(snapshot_value::text,'UTF8'),'sha256'),'hex');
  key_value:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
  IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'Skills baseline signing unavailable'; END IF;
  proof_payload:='skills-baseline-v1:' || target_resume_id::text || ':' || (SELECT auth.uid())::text || ':' || digest_value;
  proof_value:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(proof_payload,'UTF8'),key_value,'sha256'),'hex');
  RETURN QUERY SELECT target_resume_id,
    COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false),
    cms_private.get_resume_write_mode(target_resume_id,'skills'),
    COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='skills' AND r.requirement_key='trusted_network_context_v11'),false),
    snapshot_value,digest_value,proof_value;
END
$function$;
REVOKE ALL ON FUNCTION public.load_admin_skills_write_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_skills_write_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION cms_private.verify_resume_skills_v1_context(target_resume_id uuid,canonical_skills text,signed_context text,signature_hex text)
RETURNS TABLE(context_value jsonb,skills_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE ctx jsonb; rows_value jsonb; key_value bytea; baseline_key_value bytea; supplied bytea; expected bytea; expected_baseline_digest text; baseline_proof text;
  now_seconds bigint; issued_seconds bigint; expires_seconds bigint; item jsonb; expected_position bigint; locale_value jsonb;
BEGIN
  BEGIN
    IF signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context,'UTF8'))>8192
      OR canonical_skills IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(canonical_skills,'UTF8'))>196608
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid'; END IF;
    ctx:=signed_context::jsonb;
    expected_baseline_digest:=ctx->>'expected_baseline_digest'; baseline_proof:=ctx->>'baseline_proof';
    IF pg_catalog.jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(ctx))<>16
      OR ctx->>'context_version'<>'1' OR pg_catalog.jsonb_typeof(ctx->'context_version')<>'number'
      OR ctx->>'domain'<>'skills' OR pg_catalog.jsonb_typeof(ctx->'domain')<>'string'
      OR ctx->>'operation'<>'update' OR pg_catalog.jsonb_typeof(ctx->'operation')<>'string'
      OR ctx->>'resume_id'<>target_resume_id::text OR pg_catalog.jsonb_typeof(ctx->'resume_id')<>'string'
      OR ctx->>'actor_user_id'<>(SELECT auth.uid())::text OR pg_catalog.jsonb_typeof(ctx->'actor_user_id')<>'string'
      OR pg_catalog.jsonb_typeof(ctx->'key_id')<>'string' OR pg_catalog.jsonb_typeof(ctx->'request_id')<>'string'
      OR (ctx->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(ctx->'mutation_digest')<>'string' OR (ctx->>'mutation_digest') !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(ctx->'expected_baseline_digest')<>'string'
      OR expected_baseline_digest IS NULL OR expected_baseline_digest !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(ctx->'baseline_proof')<>'string'
      OR baseline_proof IS NULL OR baseline_proof !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(ctx->'issued_at')<>'number' OR (ctx->>'issued_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR pg_catalog.jsonb_typeof(ctx->'expires_at')<>'number' OR (ctx->>'expires_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(ctx) k(key_name) WHERE k.key_name<>ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','expected_baseline_digest','baseline_proof','issued_at','expires_at','ip_network','country_code','region','city']))
      OR NOT(ctx ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','expected_baseline_digest','baseline_proof','issued_at','expires_at','ip_network','country_code','region','city']) THEN RAISE EXCEPTION 'invalid'; END IF;
    issued_seconds:=(ctx->>'issued_at')::bigint; expires_seconds:=(ctx->>'expires_at')::bigint;
    now_seconds:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
    IF issued_seconds>now_seconds+60 OR expires_seconds<=now_seconds OR expires_seconds<=issued_seconds OR expires_seconds-issued_seconds>300 THEN RAISE EXCEPTION 'invalid'; END IF;
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical_skills,'UTF8'),'sha256'),'hex')<>ctx->>'mutation_digest' THEN RAISE EXCEPTION 'invalid'; END IF;
    rows_value:=canonical_skills::jsonb;
    IF pg_catalog.jsonb_typeof(rows_value)<>'array' OR pg_catalog.jsonb_array_length(rows_value)>16 THEN RAISE EXCEPTION 'invalid'; END IF;
    FOR item,expected_position IN SELECT value,n FROM pg_catalog.jsonb_array_elements(rows_value) WITH ORDINALITY a(value,n) ORDER BY n LOOP
      IF pg_catalog.jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item))<>4
        OR NOT(item ?& ARRAY['id','position','zh','en'])
        OR pg_catalog.jsonb_typeof(item->'id') NOT IN ('string','null')
        OR (item->>'id' IS NOT NULL AND (item->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        OR pg_catalog.jsonb_typeof(item->'position')<>'number' OR (item->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR (item->>'position')::bigint<>expected_position-1
        OR pg_catalog.jsonb_typeof(item->'zh')<>'object' OR pg_catalog.jsonb_typeof(item->'en')<>'object' THEN RAISE EXCEPTION 'invalid'; END IF;
      FOREACH locale_value IN ARRAY ARRAY[item->'zh',item->'en'] LOOP
        IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(locale_value))<>2 OR NOT(locale_value ?& ARRAY['title','items'])
          OR pg_catalog.jsonb_typeof(locale_value->'title')<>'string' OR pg_catalog.jsonb_typeof(locale_value->'items')<>'string'
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'title','UTF8'))>64
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'items','UTF8'))>896 THEN RAISE EXCEPTION 'invalid'; END IF;
      END LOOP;
    END LOOP;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(rows_value) x(value) WHERE x.value->>'id' IS NOT NULL)
      <> (SELECT count(DISTINCT x.value->>'id') FROM pg_catalog.jsonb_array_elements(rows_value) x(value) WHERE x.value->>'id' IS NOT NULL) THEN RAISE EXCEPTION 'invalid'; END IF;
    supplied:=pg_catalog.decode(signature_hex,'hex'); key_value:=cms_private.activity_log_v11_key(ctx->>'key_id');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'invalid'; END IF;
    expected:=extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),key_value,'sha256'); IF supplied<>expected THEN RAISE EXCEPTION 'invalid'; END IF;
    baseline_key_value:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
    IF baseline_key_value IS NULL OR pg_catalog.octet_length(baseline_key_value)<32
      OR pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('skills-baseline-v1:' || target_resume_id::text || ':' || (SELECT auth.uid())::text || ':' || expected_baseline_digest,'UTF8'),baseline_key_value,'sha256'),'hex')<>baseline_proof THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'ip_network'<>'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(ctx->'ip_network')<>'string' OR ((ctx->>'ip_network')::cidr)::text<>ctx->>'ip_network'
        OR NOT ((pg_catalog.family((ctx->>'ip_network')::cidr)=4 AND pg_catalog.masklen((ctx->>'ip_network')::cidr)=24)
          OR (pg_catalog.family((ctx->>'ip_network')::cidr)=6 AND pg_catalog.masklen((ctx->>'ip_network')::cidr)=48)) THEN RAISE EXCEPTION 'invalid'; END IF;
    END IF;
    IF ctx->'country_code'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'country_code')<>'string' OR (ctx->>'country_code') !~ '^[A-Z]{2}$') THEN RAISE EXCEPTION 'invalid'; END IF;
    FOREACH locale_value IN ARRAY ARRAY[ctx->'region',ctx->'city'] LOOP
      IF locale_value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(locale_value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value#>>'{}','UTF8')) NOT BETWEEN 1 AND 128 OR (locale_value#>>'{}') ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'invalid'; END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid signed Skills request' USING ERRCODE='22023'; END;
  context_value:=ctx; skills_value:=rows_value; RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_skills_v1_context(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.save_resume_skills_v1(target_resume_id uuid,canonical_skills text,signed_context text,signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE target_site_key text; ctx jsonb; incoming jsonb; before_rows jsonb; result_value jsonb; change_value jsonb;
  actor_id uuid; request_id_value uuid; digest_value bytea; current_baseline_digest text; old_digest bytea; old_result jsonb; old_completed timestamptz; old_expiry timestamptz;
  entry jsonb; saved_id uuid; max_position integer; offset_value bigint; item_count integer; zh_count integer; en_count integer;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT t.resolved_site_key INTO target_site_key FROM cms_private.assert_activity_log_target(target_resume_id) t;
  IF target_site_key IS NULL THEN RAISE EXCEPTION 'Skills target is not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  IF cms_private.get_resume_write_mode(target_resume_id,'skills')<>'rpc' THEN RAISE EXCEPTION 'Skills RPC mode is not enabled' USING ERRCODE='42501'; END IF;
  IF NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='skills' AND r.requirement_key='trusted_network_context_v11'),false) THEN RAISE EXCEPTION 'Trusted Skills context is not enabled' USING ERRCODE='42501'; END IF;
  SELECT v.context_value,v.skills_value INTO ctx,incoming FROM cms_private.verify_resume_skills_v1_context(target_resume_id,canonical_skills,signed_context,signature_hex) v;
  actor_id:=(ctx->>'actor_user_id')::uuid; request_id_value:=(ctx->>'request_id')::uuid; expected_baseline_digest:=ctx->>'expected_baseline_digest'; digest_value:=extensions.digest(pg_catalog.convert_to(canonical_skills || ':' || expected_baseline_digest,'UTF8'),'sha256');
  SELECT i.mutation_digest,i.completed_at,i.expires_at,i.result_payload INTO old_digest,old_completed,old_expiry,old_result FROM cms_private.activity_log_idempotency i
    WHERE i.actor_user_id=actor_id AND i.resume_id=target_resume_id AND i.domain_key='skills' AND i.request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Idempotency request has expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF old_digest<>digest_value THEN RAISE EXCEPTION 'Idempotency key conflicts with a different Skills request' USING ERRCODE='P13B1'; END IF;
    IF old_completed IS NULL OR old_result IS NULL THEN RAISE EXCEPTION 'Incomplete Skills idempotency record' USING ERRCODE='22023'; END IF;
    RETURN old_result;
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at)
    VALUES(actor_id,target_resume_id,'skills',request_id_value,digest_value,pg_catalog.transaction_timestamp(),NULL,pg_catalog.transaction_timestamp()+interval '7 days');
  SELECT count(*),count(*) FILTER(WHERE zh.skill_group_id IS NOT NULL),count(*) FILTER(WHERE en.skill_group_id IS NOT NULL)
    INTO item_count,zh_count,en_count FROM public.resume_skill_groups g
    LEFT JOIN public.resume_skill_group_translations zh ON zh.skill_group_id=g.id AND zh.resume_id=g.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_skill_group_translations en ON en.skill_group_id=g.id AND en.resume_id=g.resume_id AND en.locale='en'
    WHERE g.resume_id=target_resume_id;
  IF zh_count<>item_count OR en_count<>item_count OR item_count>16 THEN RAISE EXCEPTION 'Skills locale state is incomplete or exceeds the supported bound' USING ERRCODE='22023'; END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',g.id::text,'position',g.position,
    'zh',pg_catalog.jsonb_build_object('title',zh.title,'items',zh.items),'en',pg_catalog.jsonb_build_object('title',en.title,'items',en.items)) ORDER BY g.position,g.id),'[]'::jsonb)
    INTO before_rows FROM public.resume_skill_groups g
    JOIN public.resume_skill_group_translations zh ON zh.skill_group_id=g.id AND zh.resume_id=g.resume_id AND zh.locale='zh'
    JOIN public.resume_skill_group_translations en ON en.skill_group_id=g.id AND en.resume_id=g.resume_id AND en.locale='en'
    WHERE g.resume_id=target_resume_id;
  IF pg_catalog.jsonb_array_length(before_rows)>16
    OR pg_catalog.octet_length(pg_catalog.convert_to(before_rows::text,'UTF8'))>212992
    OR NOT cms_private.activity_event_payload_v2_skills_is_allowed('skills','skill_group_list',NULL,'update',
      pg_catalog.jsonb_build_object('skills',before_rows),pg_catalog.jsonb_build_object('skills',pg_catalog.jsonb_build_object('before',before_rows,'after',before_rows))) THEN
    RAISE EXCEPTION 'Existing Skills state is outside the supported aggregate contract' USING ERRCODE='22023'; END IF;
  current_baseline_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_rows::text,'UTF8'),'sha256'),'hex');
  IF current_baseline_digest<>expected_baseline_digest THEN
    RAISE EXCEPTION 'Skills baseline changed since the request was created' USING ERRCODE='P13B2';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) a(value) WHERE a.value->>'id' IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM public.resume_skill_groups g WHERE g.id=(a.value->>'id')::uuid AND g.resume_id=target_resume_id)) THEN
    RAISE EXCEPTION 'Skills group is outside the authorized target' USING ERRCODE='42501'; END IF;
  IF pg_catalog.jsonb_array_length(before_rows)=pg_catalog.jsonb_array_length(incoming) AND NOT EXISTS(
    SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) WITH ORDINALITY a(value,n)
      LEFT JOIN pg_catalog.jsonb_array_elements(before_rows) WITH ORDINALITY b(value,n) USING(n)
    WHERE a.value->>'id' IS DISTINCT FROM b.value->>'id' OR (a.value->>'position')::integer<>a.n-1
      OR a.value->'zh' IS DISTINCT FROM b.value->'zh' OR a.value->'en' IS DISTINCT FROM b.value->'en') THEN result_value:=before_rows;
  ELSE
    SELECT COALESCE(max(position),-1) INTO max_position FROM public.resume_skill_groups WHERE resume_id=target_resume_id;
    IF max_position>1000000000 THEN RAISE EXCEPTION 'Skills ordering cannot be safely updated' USING ERRCODE='22023'; END IF;
    offset_value:=max_position::bigint+pg_catalog.jsonb_array_length(incoming)+1001;
    UPDATE public.resume_skill_groups SET position=(position+offset_value)::integer WHERE resume_id=target_resume_id;
    DELETE FROM public.resume_skill_group_translations t WHERE t.resume_id=target_resume_id
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) a(value) WHERE a.value->>'id'=t.skill_group_id::text);
    DELETE FROM public.resume_skill_groups g WHERE g.resume_id=target_resume_id
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(incoming) a(value) WHERE a.value->>'id'=g.id::text);
    FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(incoming) WITH ORDINALITY a(value,n) ORDER BY n LOOP
      IF entry->>'id' IS NULL THEN INSERT INTO public.resume_skill_groups(resume_id,source_key,position) VALUES(target_resume_id,NULL,(entry->>'position')::integer) RETURNING id INTO saved_id;
      ELSE saved_id:=(entry->>'id')::uuid; UPDATE public.resume_skill_groups SET position=(entry->>'position')::integer,updated_at=pg_catalog.transaction_timestamp() WHERE id=saved_id AND resume_id=target_resume_id; END IF;
      INSERT INTO public.resume_skill_group_translations(skill_group_id,resume_id,locale,title,items)
      VALUES(saved_id,target_resume_id,'zh',entry->'zh'->>'title',entry->'zh'->>'items'),(saved_id,target_resume_id,'en',entry->'en'->>'title',entry->'en'->>'items')
      ON CONFLICT(skill_group_id,locale) DO UPDATE SET title=EXCLUDED.title,items=EXCLUDED.items,updated_at=pg_catalog.transaction_timestamp()
      WHERE public.resume_skill_group_translations.title IS DISTINCT FROM EXCLUDED.title OR public.resume_skill_group_translations.items IS DISTINCT FROM EXCLUDED.items;
    END LOOP;
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',g.id::text,'position',g.position,
      'zh',pg_catalog.jsonb_build_object('title',zh.title,'items',zh.items),'en',pg_catalog.jsonb_build_object('title',en.title,'items',en.items)) ORDER BY g.position,g.id),'[]'::jsonb)
      INTO result_value FROM public.resume_skill_groups g JOIN public.resume_skill_group_translations zh ON zh.skill_group_id=g.id AND zh.resume_id=g.resume_id AND zh.locale='zh'
      JOIN public.resume_skill_group_translations en ON en.skill_group_id=g.id AND en.resume_id=g.resume_id AND en.locale='en' WHERE g.resume_id=target_resume_id;
    change_value:=pg_catalog.jsonb_build_object('skills',pg_catalog.jsonb_build_object('before',before_rows,'after',result_value));
    IF pg_catalog.octet_length(pg_catalog.convert_to(result_value::text,'UTF8'))>212992 OR NOT cms_private.activity_event_payload_v2_skills_is_allowed('skills','skill_group_list',NULL,'update',pg_catalog.jsonb_build_object('skills',result_value),change_value) THEN
      RAISE EXCEPTION 'Skills result exceeds the supported aggregate bound' USING ERRCODE='22023'; END IF;
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
    VALUES(actor_id,(SELECT auth.jwt()->>'email'),(SELECT x.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) x),target_resume_id,target_site_key,
      'update','skills','skill_group_list',NULL,pg_catalog.jsonb_build_object('skills',result_value),change_value,2,(ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
  END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=result_value,completed_at=pg_catalog.transaction_timestamp()
    WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='skills' AND request_id=request_id_value;
  RETURN result_value;
END
$function$;
REVOKE ALL ON FUNCTION public.save_resume_skills_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_skills_v1(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.can_direct_write_skills(uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.load_admin_skills_write_state(uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.save_resume_skills_v1(uuid,text,text,text) FROM PUBLIC,anon,service_role;
-- Refresh Restore's internal Skills writer context with the same authenticated baseline proof.
CREATE OR REPLACE FUNCTION public.restore_domain_v1(
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
  baseline_resume_id uuid; baseline_digest_value text; baseline_proof_value text;
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
  IF domain_value='awards' THEN
    -- The outer Restore transaction already holds the same target row lock as the Awards writer.
    -- Obtain the baseline and proof from the authenticated database reader, never from client input.
    SELECT state.resume_id,state.awards_baseline_digest,state.awards_baseline_proof
      INTO baseline_resume_id,baseline_digest_value,baseline_proof_value
      FROM public.load_admin_awards_write_state(target_resume_id) AS state;
    IF baseline_resume_id IS DISTINCT FROM target_resume_id
      OR baseline_digest_value IS NULL OR baseline_digest_value !~ '^[0-9a-f]{64}$'
      OR baseline_proof_value IS NULL OR baseline_proof_value !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Restore Awards baseline is unavailable' USING ERRCODE='42501';
    END IF;
    internal_context:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
      'actor_user_id',auth.uid(),'resume_id',target_resume_id,'domain',domain_value,'operation','update',
      'request_id',request_id,'mutation_digest',pg_catalog.encode(body_digest,'hex'),
      'expected_baseline_digest',baseline_digest_value,'baseline_proof',baseline_proof_value,
      'issued_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint,
      'expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint+240,
      'ip_network',context_value->'ip_network','country_code',context_value->'country_code',
      'region',context_value->'region','city',context_value->'city');
  ELSIF domain_value='skills' THEN
    SELECT state.resume_id,state.skills_baseline_digest,state.skills_baseline_proof
      INTO baseline_resume_id,baseline_digest_value,baseline_proof_value
      FROM public.load_admin_skills_write_state(target_resume_id) AS state;
    IF baseline_resume_id IS DISTINCT FROM target_resume_id
      OR baseline_digest_value IS NULL OR baseline_digest_value !~ '^[0-9a-f]{64}$'
      OR baseline_proof_value IS NULL OR baseline_proof_value !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Restore Skills baseline is unavailable' USING ERRCODE='42501';
    END IF;
    internal_context:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
      'actor_user_id',auth.uid(),'resume_id',target_resume_id,'domain',domain_value,'operation','update',
      'request_id',request_id,'mutation_digest',pg_catalog.encode(body_digest,'hex'),
      'expected_baseline_digest',baseline_digest_value,'baseline_proof',baseline_proof_value,
      'issued_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint,
      'expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint+240,
      'ip_network',context_value->'ip_network','country_code',context_value->'country_code',
      'region',context_value->'region','city',context_value->'city');
  ELSE
    internal_context:=pg_catalog.jsonb_build_object('context_version',1,'key_id','activity_log_v11_hmac_v1',
      'actor_user_id',auth.uid(),'resume_id',target_resume_id,'domain',domain_value,'operation','update',
      'request_id',request_id,'mutation_digest',pg_catalog.encode(body_digest,'hex'),
      'issued_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint,
      'expires_at',pg_catalog.floor(pg_catalog.date_part('epoch',clock_timestamp()))::bigint+240,
      'ip_network',context_value->'ip_network','country_code',context_value->'country_code',
      'region',context_value->'region','city',context_value->'city');
  END IF;
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
    WHEN 'awards' THEN writer_result:=public.save_resume_awards_v1(target_resume_id,body_text,baseline_digest_value,baseline_proof_value,internal_text,internal_signature);
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
COMMIT;
