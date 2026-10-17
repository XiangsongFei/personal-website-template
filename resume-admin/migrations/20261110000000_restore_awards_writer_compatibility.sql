-- Adapt the existing Restore transaction to the authenticated Awards baseline/CAS writer.
BEGIN;

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
COMMENT ON FUNCTION public.restore_domain_v1(uuid,uuid,text,uuid,text,text) IS
  'Target-authorized, idempotent Restore V1 mutation using server-derived domain state and domain writer validation.';

COMMIT;
