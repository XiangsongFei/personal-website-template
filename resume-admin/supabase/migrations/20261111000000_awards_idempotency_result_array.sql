-- Keep Awards RPC idempotency results within the shared JSON-array storage contract.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_resume_awards_v1(target_resume_id uuid, canonical_awards text, expected_baseline_digest text, baseline_proof text, signed_context text, signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE target_site_key text; gate_enabled boolean; ctx jsonb; incoming jsonb; before_rows jsonb; after_rows jsonb;
  actor_id uuid; request_id_value uuid; digest_value bytea; old_digest bytea; old_result jsonb; old_completed timestamptz; old_expiry timestamptz;
  item jsonb; saved_id uuid; max_position integer; offset_value bigint; changed boolean; result_value jsonb;
  change_value jsonb; duplicate_count integer; response_position bigint; current_baseline_digest text; result_baseline_digest text; result_baseline_proof text; result_response_value jsonb; result_payload_value jsonb; response_value jsonb; key_value bytea; proof_payload text;
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
  SELECT v.context_value,v.awards_value INTO ctx,incoming FROM cms_private.verify_resume_awards_v1_context(target_resume_id,canonical_awards,expected_baseline_digest,baseline_proof,signed_context,signature_hex) AS v;
  actor_id := (ctx->>'actor_user_id')::uuid; request_id_value := (ctx->>'request_id')::uuid;
  digest_value := extensions.digest(pg_catalog.convert_to(canonical_awards || ':' || expected_baseline_digest,'UTF8'),'sha256');
  SELECT i.mutation_digest,i.completed_at,i.expires_at,i.result_payload INTO old_digest,old_completed,old_expiry,old_result
    FROM cms_private.activity_log_idempotency AS i WHERE i.actor_user_id=actor_id AND i.resume_id=target_resume_id AND i.domain_key='awards' AND i.request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Idempotency request has expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF old_digest <> digest_value THEN RAISE EXCEPTION 'Idempotency key conflicts with a different Awards request' USING ERRCODE='P13B1'; END IF;
    IF old_completed IS NULL OR old_result IS NULL THEN
      RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
    END IF;
    IF pg_catalog.jsonb_typeof(old_result) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
    END IF;
    IF pg_catalog.jsonb_array_length(old_result) <> 1 THEN
      RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
    END IF;
    response_value := old_result->0;
    IF pg_catalog.jsonb_typeof(response_value) IS DISTINCT FROM 'object'
      OR pg_catalog.jsonb_object_length(response_value) <> 3
      OR NOT (response_value ?& ARRAY['awards','baseline_digest','baseline_proof'])
      OR pg_catalog.jsonb_typeof(response_value->'awards') IS DISTINCT FROM 'array'
      OR COALESCE(response_value->>'baseline_digest' ~ '^[0-9a-f]{64}$',false) IS NOT TRUE
      OR COALESCE(response_value->>'baseline_proof' ~ '^[0-9a-f]{64}$',false) IS NOT TRUE
      OR pg_catalog.octet_length(pg_catalog.convert_to(old_result::text,'UTF8')) > 8192 THEN
      RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
    END IF;
    duplicate_count := 0;
    FOR item,response_position IN
      SELECT award.value,award.ordinality-1
      FROM pg_catalog.jsonb_array_elements(response_value->'awards') WITH ORDINALITY AS award(value,ordinality)
    LOOP
      IF pg_catalog.jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_object_length(item) <> 4
        OR NOT (item ?& ARRAY['id','position','zh','en'])
        OR COALESCE(item->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) IS NOT TRUE
        OR pg_catalog.jsonb_typeof(item->'position') IS DISTINCT FROM 'number'
        OR COALESCE((item->>'position') ~ '^(0|[1-9][0-9]*)$',false) IS NOT TRUE
        OR COALESCE((item->>'position')::numeric <> response_position::numeric,true) IS NOT FALSE THEN
        RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
      END IF;
      IF pg_catalog.jsonb_typeof(item->'zh') IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_object_length(item->'zh') <> 2
        OR NOT ((item->'zh') ?& ARRAY['name','year'])
        OR pg_catalog.jsonb_typeof(item->'zh'->'name') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(item->'zh'->'year') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(item->'en') IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_object_length(item->'en') <> 2
        OR NOT ((item->'en') ?& ARRAY['name','year'])
        OR pg_catalog.jsonb_typeof(item->'en'->'name') IS DISTINCT FROM 'string'
        OR pg_catalog.jsonb_typeof(item->'en'->'year') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
      END IF;
    END LOOP;
    SELECT pg_catalog.count(*)-pg_catalog.count(DISTINCT award.value->>'id') INTO duplicate_count
      FROM pg_catalog.jsonb_array_elements(response_value->'awards') AS award(value);
    IF duplicate_count <> 0 THEN
      RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
    END IF;
    result_baseline_digest := pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to((response_value->'awards')::text,'UTF8'),'sha256'),'hex');
    IF response_value->>'baseline_digest' IS DISTINCT FROM result_baseline_digest THEN
      RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
    END IF;
    key_value := cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN
      RAISE EXCEPTION 'Awards baseline signing unavailable';
    END IF;
    proof_payload := 'awards-baseline-v1:' || target_resume_id::text || ':' || actor_id::text || ':' || result_baseline_digest;
    result_baseline_proof := pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(proof_payload,'UTF8'),key_value,'sha256'),'hex');
    IF response_value->>'baseline_proof' IS DISTINCT FROM result_baseline_proof THEN
      RAISE EXCEPTION 'Legacy or incomplete Awards idempotency result cannot be replayed safely' USING ERRCODE='22023';
    END IF;
    RETURN response_value;
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',e.id::text,'position',e.position,
    'zh',pg_catalog.jsonb_build_object('name',COALESCE(zh.name,''),'year',COALESCE(zh.year,'')),
    'en',pg_catalog.jsonb_build_object('name',COALESCE(en.name,''),'year',COALESCE(en.year,''))) ORDER BY e.position,e.id),'[]'::jsonb)
    INTO before_rows FROM public.resume_award_entries AS e
    LEFT JOIN public.resume_award_translations AS zh ON zh.award_entry_id=e.id AND zh.resume_id=e.resume_id AND zh.locale='zh'
    LEFT JOIN public.resume_award_translations AS en ON en.award_entry_id=e.id AND en.resume_id=e.resume_id AND en.locale='en'
    WHERE e.resume_id=target_resume_id;
  current_baseline_digest := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_rows::text,'UTF8'),'sha256'),'hex');
  IF current_baseline_digest <> expected_baseline_digest THEN
    RAISE EXCEPTION 'Awards baseline changed since the request was created' USING ERRCODE='P13B2';
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at)
    VALUES(actor_id,target_resume_id,'awards',request_id_value,digest_value,pg_catalog.transaction_timestamp(),NULL,pg_catalog.transaction_timestamp()+interval '7 days');
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
  result_baseline_digest := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(result_value::text,'UTF8'),'sha256'),'hex');
  proof_payload := 'awards-baseline-v1:' || target_resume_id::text || ':' || actor_id::text || ':' || result_baseline_digest;
  key_value := cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
  IF key_value IS NULL OR pg_catalog.octet_length(key_value) < 32 THEN RAISE EXCEPTION 'Awards baseline signing unavailable'; END IF;
  result_baseline_proof := pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(proof_payload,'UTF8'),key_value,'sha256'),'hex');
  result_response_value := pg_catalog.jsonb_build_object('awards',result_value,'baseline_digest',result_baseline_digest,'baseline_proof',result_baseline_proof);
  result_payload_value := pg_catalog.jsonb_build_array(result_response_value);
  IF pg_catalog.octet_length(pg_catalog.convert_to(result_response_value::text,'UTF8')) > 8192
    OR pg_catalog.octet_length(pg_catalog.convert_to(result_payload_value::text,'UTF8')) > 8192 THEN
    RAISE EXCEPTION 'Awards idempotency result exceeds the supported size' USING ERRCODE='22023';
  END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=result_payload_value,completed_at=pg_catalog.transaction_timestamp()
    WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='awards' AND request_id=request_id_value;
  RETURN result_response_value;
END
$function$;
REVOKE ALL ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text,text,text) TO authenticated;

COMMIT;
