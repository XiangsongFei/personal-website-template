-- Additive Files-reference writer. PDF objects remain a separate Storage persistence leg.
BEGIN;
DO $owner$ BEGIN IF current_user<>'postgres' THEN RAISE EXCEPTION 'Files writer must be installed as postgres' USING ERRCODE='42501'; END IF; END $owner$;

CREATE OR REPLACE FUNCTION public.can_manage_resume_storage_object(target_bucket text,object_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $f$
DECLARE path_resume_id uuid;
BEGIN
 IF target_bucket IS NULL OR target_bucket NOT IN('profile-images','resume-files') OR object_name IS NULL THEN RETURN false; END IF;
 IF target_bucket='profile-images' AND object_name ~ '^example-cv/profile/[^/]+\.(jpg|jpeg|png|webp)$' THEN
  RETURN public.is_resume_owner() AND public.can_manage_resume((SELECT s.id FROM public.resume_sites s WHERE s.site_key='example-cv')); END IF;
 IF target_bucket='resume-files' AND object_name IN('example-cv/resume_zh.pdf','example-cv/resume_en.pdf') THEN RETURN public.is_resume_owner(); END IF;
 IF pg_catalog.split_part(object_name,'/',1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 path_resume_id:=pg_catalog.split_part(object_name,'/',1)::uuid;
 IF target_bucket='profile-images' AND object_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/profile/[^/]+\.(jpg|jpeg|png|webp)$' THEN RETURN false; END IF;
 IF target_bucket='resume-files' AND object_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(resume_(zh|en)\.pdf|(zh|en)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf)$' THEN RETURN false; END IF;
 RETURN public.can_manage_resume(path_resume_id);
END $f$;
REVOKE ALL ON FUNCTION public.can_manage_resume_storage_object(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_resume_storage_object(text,text) TO authenticated;

CREATE FUNCTION cms_private.files_aggregate_is_allowed(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $f$
BEGIN
 RETURN pg_catalog.jsonb_typeof(v)='object' AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v))=1 AND v ? 'translations'
  AND pg_catalog.jsonb_typeof(v->'translations')='object' AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v->'translations'))=2 AND v->'translations' ?& ARRAY['zh','en']
  AND (v->'translations'->'zh') ? 'portfolio_href' AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v->'translations'->'zh'))=1
  AND (v->'translations'->'en') ? 'portfolio_href' AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v->'translations'->'en'))=1
  AND pg_catalog.jsonb_typeof(v->'translations'->'zh'->'portfolio_href') IS NOT DISTINCT FROM 'string'
  AND pg_catalog.jsonb_typeof(v->'translations'->'en'->'portfolio_href') IS NOT DISTINCT FROM 'string';
EXCEPTION WHEN OTHERS THEN RETURN false;
END $f$;
REVOKE ALL ON FUNCTION cms_private.files_aggregate_is_allowed(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.files_reference_is_allowed(target_origin text,target_resume_id uuid,target_locale text,target_reference text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $f$
DECLARE prefix text; filename text;
BEGIN
 IF target_origin IS NULL OR target_resume_id IS NULL OR target_locale NOT IN('zh','en') OR target_reference IS NULL
  OR target_origin !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
  OR target_reference ~ '[?#%\\]' THEN RETURN false; END IF;
 prefix:=target_origin||'/storage/v1/object/public/resume-files/'||target_resume_id::text||'/'||target_locale||'/';
 IF pg_catalog.left(target_reference,pg_catalog.length(prefix))<>prefix THEN RETURN false; END IF;
 filename:=pg_catalog.substr(target_reference,pg_catalog.length(prefix)+1);
 RETURN filename ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$' AND target_reference=prefix||filename;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $f$;
REVOKE ALL ON FUNCTION cms_private.files_reference_is_allowed(text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.activity_event_payload_v2_files_is_allowed(s text,e text,i text,o text,snap jsonb,ch jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $f$
DECLARE before_value jsonb; after_value jsonb;
BEGIN
 IF s IS DISTINCT FROM 'files' OR e IS DISTINCT FROM 'resume_file_set' OR i IS NOT NULL OR o IS DISTINCT FROM 'update'
  OR jsonb_typeof(snap) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(snap))<>1 OR NOT(snap ? 'files')
  OR jsonb_typeof(ch) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(ch))<>1 OR NOT(ch ? 'files')
  OR jsonb_typeof(ch->'files') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(ch->'files'))<>2
  OR NOT(ch->'files' ?& ARRAY['before','after']) OR snap->'files' IS DISTINCT FROM ch->'files'->'after'
  OR octet_length(snap::text)+octet_length(ch::text)>655360 THEN RETURN false; END IF;
 before_value:=ch->'files'->'before'; after_value:=ch->'files'->'after';
 RETURN cms_private.files_aggregate_is_allowed(before_value) AND cms_private.files_aggregate_is_allowed(after_value);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $f$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_files_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_v2_is_allowed(target_section text,target_entity_type text,target_entity_id text,target_operation text,target_snapshot jsonb,target_changes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''
AS $f$
 SELECT cms_private.activity_event_payload_v2_awards_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_experience_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_skills_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_education_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_projects_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_contact_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_profile_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_website_links_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_files_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
$f$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.load_admin_files_write_state(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,files_write_mode text,files_trusted_context_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$ BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT target_resume_id,COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false),
  cms_private.get_resume_write_mode(target_resume_id,'files'),COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='files' AND r.requirement_key='trusted_network_context_v11'),false);
END $f$;
REVOKE ALL ON FUNCTION public.load_admin_files_write_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_files_write_state(uuid) TO authenticated;

CREATE FUNCTION cms_private.files_aggregate(target_resume_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT jsonb_build_object('translations',jsonb_build_object('zh',jsonb_build_object('portfolio_href',zh.portfolio_href),'en',jsonb_build_object('portfolio_href',en.portfolio_href)))
 FROM public.resume_locale_content zh JOIN public.resume_locale_content en ON en.resume_id=zh.resume_id AND en.locale='en'
 WHERE zh.resume_id=target_resume_id AND zh.locale='zh' AND (SELECT count(*) FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id)=2
$f$;
REVOKE ALL ON FUNCTION cms_private.files_aggregate(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_resume_files_v1(target_resume_id uuid,canonical_files text,signed_context text,signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE ctx jsonb; incoming jsonb; before_value jsonb; result_value jsonb; actor_id uuid; rid uuid; digest bytea; old_digest bytea; old_done timestamptz; old_expiry timestamptz; old_result jsonb; site_key text; origin text; locale text; changed_count integer; row_count bigint;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT t.resolved_site_key INTO site_key FROM cms_private.assert_activity_log_target(target_resume_id) t;
 IF site_key IS NULL THEN RAISE EXCEPTION 'Files target is not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
 IF cms_private.get_resume_write_mode(target_resume_id,'files')<>'rpc' OR NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='files' AND r.requirement_key='trusted_network_context_v11'),false)
   OR NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false) THEN RAISE EXCEPTION 'Secure Files saving is not enabled' USING ERRCODE='42501'; END IF;
 IF canonical_files IS NULL OR octet_length(convert_to(canonical_files,'UTF8'))>16384 THEN RAISE EXCEPTION 'Files payload exceeds the supported size' USING ERRCODE='22023'; END IF;
 incoming:=canonical_files::jsonb; IF NOT cms_private.files_aggregate_is_allowed(incoming) THEN RAISE EXCEPTION 'Invalid Files aggregate' USING ERRCODE='22023'; END IF;
 ctx:=cms_private.verify_resume_d7_v1_context(target_resume_id,'files',canonical_files,signed_context,signature_hex);
 actor_id:=(ctx->>'actor_user_id')::uuid; rid:=(ctx->>'request_id')::uuid; digest:=extensions.digest(convert_to(canonical_files,'UTF8'),'sha256');
 before_value:=cms_private.files_aggregate(target_resume_id); IF before_value IS NULL THEN RAISE EXCEPTION 'Files source state is incomplete' USING ERRCODE='22023'; END IF;
 SELECT c.origin INTO origin FROM cms_private.profile_photo_origin_config c WHERE c.singleton;
 IF origin IS NULL OR (SELECT count(*) FROM cms_private.profile_photo_origin_config)<>1 THEN RAISE EXCEPTION 'Files origin configuration is unavailable' USING ERRCODE='22023'; END IF;
 changed_count:=0;
 FOREACH locale IN ARRAY ARRAY['zh','en'] LOOP
  IF incoming->'translations'->locale->>'portfolio_href' IS DISTINCT FROM before_value->'translations'->locale->>'portfolio_href' THEN
   IF NOT cms_private.files_reference_is_allowed(origin,target_resume_id,locale,incoming->'translations'->locale->>'portfolio_href') THEN RAISE EXCEPTION 'Files reference is not an approved managed candidate' USING ERRCODE='22023'; END IF;
   changed_count:=changed_count+1;
  END IF;
 END LOOP;
 SELECT mutation_digest,completed_at,expires_at,result_payload INTO old_digest,old_done,old_expiry,old_result FROM cms_private.activity_log_idempotency WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='files' AND request_id=rid FOR UPDATE;
 IF FOUND THEN IF old_expiry<=clock_timestamp() OR old_digest<>digest THEN RAISE EXCEPTION 'Files request conflicts or expired' USING ERRCODE='P13B1'; END IF; IF old_done IS NULL OR jsonb_typeof(old_result)<>'array' OR jsonb_array_length(old_result)<>1 THEN RAISE EXCEPTION 'Incomplete Files idempotency' USING ERRCODE='22023'; END IF; RETURN old_result->0; END IF;
 INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,expires_at) VALUES(actor_id,target_resume_id,'files',rid,digest,transaction_timestamp(),transaction_timestamp()+interval '7 days');
 IF changed_count>0 THEN
  UPDATE public.resume_locale_content l SET portfolio_href=incoming->'translations'->l.locale->>'portfolio_href' WHERE l.resume_id=target_resume_id AND l.locale IN('zh','en')
   AND l.portfolio_href IS DISTINCT FROM incoming->'translations'->l.locale->>'portfolio_href';
  GET DIAGNOSTICS row_count=ROW_COUNT; IF row_count<>changed_count THEN RAISE EXCEPTION 'Files reference update was not uniquely scoped' USING ERRCODE='22023'; END IF;
  result_value:=cms_private.files_aggregate(target_resume_id);
  IF result_value IS DISTINCT FROM incoming OR NOT cms_private.activity_event_payload_v2_files_is_allowed('files','resume_file_set',NULL,'update',jsonb_build_object('files',result_value),jsonb_build_object('files',jsonb_build_object('before',before_value,'after',result_value))) THEN RAISE EXCEPTION 'Files result validation failed' USING ERRCODE='22023'; END IF;
  INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
   VALUES(actor_id,auth.jwt()->>'email',(SELECT x.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) x),target_resume_id,site_key,'update','files','resume_file_set',NULL,jsonb_build_object('files',result_value),jsonb_build_object('files',jsonb_build_object('before',before_value,'after',result_value)),2,(ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
 ELSE result_value:=before_value; END IF;
 UPDATE cms_private.activity_log_idempotency SET result_payload=jsonb_build_array(result_value),completed_at=transaction_timestamp() WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='files' AND request_id=rid;
 RETURN result_value;
END $f$;
REVOKE ALL ON FUNCTION public.save_resume_files_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_files_v1(uuid,text,text,text) TO authenticated;
COMMIT;
