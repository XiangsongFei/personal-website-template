-- Narrow D-7 restoration of one historical Files reference from a successful Files V2 event.
BEGIN;

DO $owner$ BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Files legacy restore migration must be installed as postgres' USING ERRCODE='42501';
  END IF;
END $owner$;

CREATE FUNCTION cms_private.files_historical_reference_is_allowed(
  target_origin text, target_resume_id uuid, target_site_key text, target_locale text, target_reference text
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE expected_prefix text; reference_path text; query_part text;
BEGIN
  IF target_origin IS NULL OR target_resume_id IS NULL OR target_locale IS NULL OR target_locale NOT IN ('zh','en')
    OR target_reference IS NULL OR target_origin !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
    OR target_reference ~ '[#%\\]' THEN RETURN false; END IF;
  IF target_site_key = 'example-cv-qa' THEN expected_prefix := target_resume_id::text;
  ELSIF target_site_key = 'example-cv' THEN expected_prefix := 'example-cv';
  ELSE RETURN false; END IF;
  IF target_reference LIKE '%?%' THEN
    IF target_reference ~ '[?].*[?]' THEN RETURN false; END IF;
    query_part := pg_catalog.substr(target_reference, pg_catalog.strpos(target_reference,'?')+1);
    IF query_part !~ '^cacheNonce=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
    reference_path := pg_catalog.left(target_reference, pg_catalog.strpos(target_reference,'?')-1);
  ELSE reference_path := target_reference; END IF;
  RETURN reference_path = target_origin || '/storage/v1/object/public/resume-files/' || expected_prefix || '/resume_' || target_locale || '.pdf';
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.files_historical_reference_is_allowed(text,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.files_restore_source(
  target_resume_id uuid, source_event_id uuid, target_locale text, target_actor_id uuid
)
RETURNS TABLE(historical_reference text, expected_current_reference text, storage_object_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE source_event cms_private.activity_log_events%ROWTYPE; before_value jsonb; after_value jsonb;
  site_key text; origin text; reference_value text; object_name text;
BEGIN
  SELECT e.* INTO source_event FROM cms_private.activity_log_events e
   WHERE e.id=source_event_id AND e.resume_id=target_resume_id;
  IF NOT FOUND OR source_event.actor_user_id IS DISTINCT FROM target_actor_id
    OR NOT cms_private.activity_event_payload_v2_files_is_allowed(source_event.section_key,source_event.entity_type,
      source_event.entity_id,source_event.operation,source_event.entity_snapshot,source_event.changes)
    OR source_event.payload_version IS DISTINCT FROM 2
    OR target_locale IS NULL OR target_locale NOT IN ('zh','en') THEN RAISE EXCEPTION 'Files restore source is not eligible' USING ERRCODE='22023'; END IF;
  before_value := source_event.changes->'files'->'before';
  after_value := source_event.changes->'files'->'after';
  reference_value := before_value->'translations'->target_locale->>'portfolio_href';
  SELECT s.site_key INTO site_key FROM public.resume_sites s WHERE s.id=target_resume_id;
  SELECT c.origin INTO origin FROM cms_private.profile_photo_origin_config c WHERE c.singleton;
  IF (SELECT count(*) FROM cms_private.profile_photo_origin_config)<>1 OR site_key IS NULL
    OR NOT cms_private.files_historical_reference_is_allowed(origin,target_resume_id,site_key,target_locale,reference_value)
    OR after_value->'translations'->target_locale->>'portfolio_href' IS NULL THEN
    RAISE EXCEPTION 'Files restore source reference is invalid' USING ERRCODE='22023';
  END IF;
  IF site_key='example-cv-qa' THEN
    object_name := target_resume_id::text || '/resume_' || target_locale || '.pdf';
  ELSE object_name := 'example-cv/resume_' || target_locale || '.pdf'; END IF;
  RETURN QUERY SELECT reference_value, after_value->'translations'->target_locale->>'portfolio_href', object_name;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.files_restore_source(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- This narrow authenticated read is used only by the Worker to verify the exact persisted object's availability before mutation.
CREATE FUNCTION public.load_admin_files_restore_source_v1(target_resume_id uuid, source_event_id uuid, target_locale text, target_request_id uuid, canonical_restore text)
RETURNS TABLE(historical_reference text, already_completed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN
    RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501';
  END IF;
  IF canonical_restore IS DISTINCT FROM ('{"action":"restore_before","locale":"' || target_locale || '","source_event_id":"' || source_event_id::text || '","target_resume_id":"' || target_resume_id::text || '","version":1}') THEN
    RAISE EXCEPTION 'Invalid Files restore intent' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
    SELECT NULL::text, true
    FROM cms_private.activity_log_idempotency i
    WHERE i.actor_user_id=(SELECT auth.uid()) AND i.resume_id=target_resume_id AND i.domain_key='files' AND i.request_id=target_request_id
      AND i.expires_at>clock_timestamp() AND i.completed_at IS NOT NULL
      AND i.mutation_digest=extensions.digest(convert_to(canonical_restore,'UTF8'),'sha256')
      AND jsonb_typeof(i.result_payload)='array' AND jsonb_array_length(i.result_payload)=1
    UNION ALL
    SELECT source.historical_reference, false
    FROM cms_private.files_restore_source(target_resume_id,source_event_id,target_locale,(SELECT auth.uid())) source
    WHERE NOT EXISTS (SELECT 1 FROM cms_private.activity_log_idempotency i WHERE i.actor_user_id=(SELECT auth.uid())
      AND i.resume_id=target_resume_id AND i.domain_key='files' AND i.request_id=target_request_id);
  IF NOT FOUND AND EXISTS (SELECT 1 FROM cms_private.activity_log_idempotency i WHERE i.actor_user_id=(SELECT auth.uid())
    AND i.resume_id=target_resume_id AND i.domain_key='files' AND i.request_id=target_request_id) THEN
    RAISE EXCEPTION 'Files restore request conflicts or is incomplete' USING ERRCODE='P13B1';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.load_admin_files_restore_source_v1(uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_files_restore_source_v1(uuid,uuid,text,uuid,text) TO authenticated;

CREATE FUNCTION public.restore_resume_files_from_event_v1(
  target_resume_id uuid, source_event_id uuid, target_locale text, canonical_restore text, signed_context text, signature_hex text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE ctx jsonb; actor_id uuid; request_id_value uuid; digest bytea; old_digest bytea; old_done timestamptz;
  old_expiry timestamptz; old_result jsonb; source record; before_value jsonb; result_value jsonb;
  site_key text; origin text; current_reference text; expected_canonical text; affected bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT t.resolved_site_key INTO site_key FROM cms_private.assert_activity_log_target(target_resume_id) t;
  IF site_key IS NULL THEN RAISE EXCEPTION 'Files target is not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
  IF cms_private.get_resume_write_mode(target_resume_id,'files')<>'rpc'
    OR NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='files' AND r.requirement_key='trusted_network_context_v11'),false)
    OR NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false) THEN
    RAISE EXCEPTION 'Secure Files restoration is not enabled' USING ERRCODE='42501';
  END IF;
  IF target_locale IS NULL OR target_locale NOT IN ('zh','en') OR source_event_id IS NULL OR canonical_restore IS NULL OR octet_length(convert_to(canonical_restore,'UTF8'))>4096 THEN
    RAISE EXCEPTION 'Invalid Files restore intent' USING ERRCODE='22023';
  END IF;
  expected_canonical := '{"action":"restore_before","locale":"' || target_locale || '","source_event_id":"' || source_event_id::text || '","target_resume_id":"' || target_resume_id::text || '","version":1}';
  IF canonical_restore IS DISTINCT FROM expected_canonical THEN RAISE EXCEPTION 'Invalid Files restore intent' USING ERRCODE='22023'; END IF;
  ctx := cms_private.verify_resume_d7_v1_context(target_resume_id,'files',canonical_restore,signed_context,signature_hex);
  actor_id := (ctx->>'actor_user_id')::uuid; request_id_value := (ctx->>'request_id')::uuid;
  digest := extensions.digest(convert_to(canonical_restore,'UTF8'),'sha256');
  SELECT mutation_digest,completed_at,expires_at,result_payload INTO old_digest,old_done,old_expiry,old_result
    FROM cms_private.activity_log_idempotency WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='files' AND request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry<=clock_timestamp() OR old_digest<>digest THEN RAISE EXCEPTION 'Files restore request conflicts or expired' USING ERRCODE='P13B1'; END IF;
    IF old_done IS NULL OR jsonb_typeof(old_result)<>'array' OR jsonb_array_length(old_result)<>1 THEN RAISE EXCEPTION 'Incomplete Files restore idempotency' USING ERRCODE='22023'; END IF;
    RETURN old_result->0;
  END IF;
  SELECT * INTO source FROM cms_private.files_restore_source(target_resume_id,source_event_id,target_locale,actor_id);
  SELECT c.origin INTO origin FROM cms_private.profile_photo_origin_config c WHERE c.singleton;
  IF origin IS NULL OR (SELECT count(*) FROM cms_private.profile_photo_origin_config)<>1 THEN RAISE EXCEPTION 'Files origin configuration is unavailable' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='resume-files' AND o.name=source.storage_object_name) THEN
    RAISE EXCEPTION 'Historical Files object is unavailable' USING ERRCODE='22023';
  END IF;
  before_value := cms_private.files_aggregate(target_resume_id);
  IF before_value IS NULL THEN RAISE EXCEPTION 'Files source state is incomplete' USING ERRCODE='22023'; END IF;
  current_reference := before_value->'translations'->target_locale->>'portfolio_href';
  IF current_reference IS DISTINCT FROM source.expected_current_reference
    AND current_reference IS DISTINCT FROM source.historical_reference THEN
    RAISE EXCEPTION 'Files restore source is stale' USING ERRCODE='P0001';
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,expires_at)
    VALUES(actor_id,target_resume_id,'files',request_id_value,digest,transaction_timestamp(),transaction_timestamp()+interval '7 days');
  IF current_reference IS DISTINCT FROM source.historical_reference THEN
    UPDATE public.resume_locale_content l SET portfolio_href=source.historical_reference
      WHERE l.resume_id=target_resume_id AND l.locale=target_locale AND l.portfolio_href IS DISTINCT FROM source.historical_reference;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected<>1 THEN RAISE EXCEPTION 'Files restore was not uniquely scoped' USING ERRCODE='22023'; END IF;
    result_value := cms_private.files_aggregate(target_resume_id);
    IF result_value IS NULL OR result_value->'translations'->target_locale->>'portfolio_href' IS DISTINCT FROM source.historical_reference
      OR result_value->'translations'->(CASE WHEN target_locale='zh' THEN 'en' ELSE 'zh' END)->>'portfolio_href'
        IS DISTINCT FROM before_value->'translations'->(CASE WHEN target_locale='zh' THEN 'en' ELSE 'zh' END)->>'portfolio_href' THEN
      RAISE EXCEPTION 'Files restore result validation failed' USING ERRCODE='22023';
    END IF;
    IF NOT cms_private.activity_event_payload_v2_files_is_allowed('files','resume_file_set',NULL,'update',jsonb_build_object('files',result_value),
      jsonb_build_object('files',jsonb_build_object('before',before_value,'after',result_value))) THEN RAISE EXCEPTION 'Files restore event validation failed' USING ERRCODE='22023'; END IF;
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
      VALUES(actor_id,auth.jwt()->>'email',(SELECT x.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) x),target_resume_id,site_key,'update','files','resume_file_set',NULL,
        jsonb_build_object('files',result_value),jsonb_build_object('files',jsonb_build_object('before',before_value,'after',result_value)),2,
        (ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
  ELSE result_value := before_value; END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=jsonb_build_array(jsonb_build_object('files',result_value,'superseded_reference',current_reference)),completed_at=transaction_timestamp()
    WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='files' AND request_id=request_id_value;
  RETURN jsonb_build_object('files',result_value,'superseded_reference',current_reference);
END
$function$;
REVOKE ALL ON FUNCTION public.restore_resume_files_from_event_v1(uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.restore_resume_files_from_event_v1(uuid,uuid,text,text,text,text) TO authenticated;

COMMIT;
