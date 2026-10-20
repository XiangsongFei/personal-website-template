-- Transactional, bilingual aggregate writer for the six public section titles.
-- No target is activated by installing this migration; missing write-mode rows stay direct.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Section Titles migration must be installed as postgres' USING ERRCODE='42501'; END IF;
END
$owner_guard$;

ALTER TABLE cms_private.activity_log_idempotency DROP CONSTRAINT activity_log_idempotency_domain_key_check;
ALTER TABLE cms_private.activity_log_idempotency ADD CONSTRAINT activity_log_idempotency_domain_key_check CHECK (domain_key IN (
  'introduction','education','experience','awards','skills','contact','projects','website_links','profile','files','section_titles'));

ALTER TABLE cms_private.resume_write_modes DROP CONSTRAINT resume_write_modes_domain_key_check;
ALTER TABLE cms_private.resume_write_modes ADD CONSTRAINT resume_write_modes_domain_key_check CHECK (domain_key IN (
  'introduction','education','experience','awards','skills','contact','projects','website_links','profile','files','section_titles'));
ALTER TABLE cms_private.resume_domain_requirements DROP CONSTRAINT resume_domain_requirements_domain_key_check;
ALTER TABLE cms_private.resume_domain_requirements ADD CONSTRAINT resume_domain_requirements_domain_key_check CHECK (domain_key IN (
  'introduction','education','experience','awards','skills','contact','projects','website_links','profile','files','section_titles'));

CREATE OR REPLACE FUNCTION cms_private.get_resume_write_mode(target_resume_id uuid,target_domain text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE resolved_mode text;
BEGIN
  IF target_domain IS NULL OR target_domain NOT IN ('introduction','education','experience','awards','skills','contact','projects','website_links','profile','files','section_titles') THEN
    RAISE EXCEPTION 'Unknown CMS write domain' USING ERRCODE='22023';
  END IF;
  SELECT mode.write_mode INTO resolved_mode FROM cms_private.resume_write_modes mode
    WHERE mode.resume_id=target_resume_id AND mode.domain_key=target_domain;
  RETURN COALESCE(resolved_mode,'direct');
END
$function$;

CREATE FUNCTION cms_private.section_titles_aggregate_is_allowed(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $function$
DECLARE locale_value text; titles jsonb; title_value text;
BEGIN
  IF pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(value))<>1 OR NOT(value ? 'translations')
    OR pg_catalog.jsonb_typeof(value->'translations') IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(value->'translations'))<>2
    OR NOT(value->'translations' ?& ARRAY['zh','en']) THEN RETURN false; END IF;
  FOREACH locale_value IN ARRAY ARRAY['zh','en'] LOOP
    titles:=value->'translations'->locale_value;
    IF pg_catalog.jsonb_typeof(titles) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(titles))<>6
      OR NOT(titles ?& ARRAY['education_label','experience_label','skills_label','honors_label','project_heading','kaggle_label']) THEN RETURN false; END IF;
    FOREACH title_value IN ARRAY ARRAY['education_label','experience_label','skills_label','honors_label','project_heading','kaggle_label'] LOOP
      IF pg_catalog.jsonb_typeof(titles->title_value) IS DISTINCT FROM 'string'
        OR pg_catalog.octet_length(pg_catalog.convert_to(titles->>title_value,'UTF8'))>1024 THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN pg_catalog.octet_length(pg_catalog.convert_to(value::text,'UTF8'))<=16384;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.section_titles_aggregate_is_allowed(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.section_titles_aggregate(target_resume_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE result_value jsonb;
BEGIN
  IF (SELECT count(*) FROM public.resume_locale_content locale WHERE locale.resume_id=target_resume_id AND locale.locale IN ('zh','en'))<>2 THEN
    RAISE EXCEPTION 'Section Titles locale rows are incomplete' USING ERRCODE='22023';
  END IF;
  SELECT pg_catalog.jsonb_build_object('translations',pg_catalog.jsonb_build_object(
    'zh',(SELECT pg_catalog.jsonb_build_object('education_label',locale.education_label,'experience_label',locale.experience_label,
      'skills_label',locale.skills_label,'honors_label',locale.honors_label,'project_heading',locale.project_heading,'kaggle_label',locale.kaggle_label)
      FROM public.resume_locale_content locale WHERE locale.resume_id=target_resume_id AND locale.locale='zh'),
    'en',(SELECT pg_catalog.jsonb_build_object('education_label',locale.education_label,'experience_label',locale.experience_label,
      'skills_label',locale.skills_label,'honors_label',locale.honors_label,'project_heading',locale.project_heading,'kaggle_label',locale.kaggle_label)
      FROM public.resume_locale_content locale WHERE locale.resume_id=target_resume_id AND locale.locale='en')))
    INTO result_value;
  IF NOT cms_private.section_titles_aggregate_is_allowed(result_value) THEN RAISE EXCEPTION 'Section Titles state is outside the supported aggregate contract' USING ERRCODE='22023'; END IF;
  RETURN result_value;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.section_titles_aggregate(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.activity_event_payload_v2_section_titles_is_allowed(section_value text,entity_value text,id_value text,operation_value text,snapshot_value jsonb,changes_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $function$
DECLARE change_value jsonb;
BEGIN
  IF section_value IS DISTINCT FROM 'section_titles' OR entity_value IS DISTINCT FROM 'section_titles_settings'
    OR id_value IS NOT NULL OR operation_value IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(snapshot_value) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(snapshot_value))<>1 OR NOT(snapshot_value ? 'section_titles')
    OR pg_catalog.jsonb_typeof(changes_value) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(changes_value))<>1 OR NOT(changes_value ? 'section_titles') THEN RETURN false; END IF;
  change_value:=changes_value->'section_titles';
  IF pg_catalog.jsonb_typeof(change_value) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(change_value))<>2
    OR NOT(change_value ?& ARRAY['before','after'])
    OR snapshot_value->'section_titles' IS DISTINCT FROM change_value->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(snapshot_value::text,'UTF8'))
      +pg_catalog.octet_length(pg_catalog.convert_to(changes_value::text,'UTF8'))>65536 THEN RETURN false; END IF;
  RETURN cms_private.section_titles_aggregate_is_allowed(change_value->'before')
    AND cms_private.section_titles_aggregate_is_allowed(change_value->'after');
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_section_titles_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_v2_is_allowed(target_section text,target_entity_type text,target_entity_id text,target_operation text,target_snapshot jsonb,target_changes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''
AS $function$
 SELECT cms_private.activity_event_payload_v2_awards_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_experience_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_skills_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_education_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_projects_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_contact_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_profile_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_website_links_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_files_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
 OR cms_private.activity_event_payload_v2_section_titles_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check CHECK(entity_type IN
 ('introduction_paragraph','education_entry','education_list','experience_entry','experience_list','project_entry','project_list','award_entry','award_list','skill_group','skill_group_list','contact_focus_item','contact_status_item','contact_section','public_link','profile_settings','resume_file','profile_image','website_links_settings','resume_file_set','section_titles_settings'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK(
 (payload_version=2 AND entity_id IS NULL AND operation='update' AND
  ((section_key='awards' AND entity_type='award_list') OR (section_key='experience' AND entity_type='experience_list') OR (section_key='skills' AND entity_type='skill_group_list') OR (section_key='education' AND entity_type='education_list') OR (section_key='projects' AND entity_type='project_list') OR (section_key='contact' AND entity_type='contact_section') OR (section_key='profile' AND entity_type='profile_settings') OR (section_key='website_links' AND entity_type='website_links_settings') OR (section_key='files' AND entity_type='resume_file_set') OR (section_key='section_titles' AND entity_type='section_titles_settings'))) OR
 (payload_version=1 AND ((section_key='introduction' AND entity_type='introduction_paragraph') OR (section_key='education' AND entity_type='education_entry') OR (section_key='experience' AND entity_type='experience_entry') OR (section_key='projects' AND entity_type='project_entry') OR (section_key='awards' AND entity_type='award_entry') OR (section_key='skills' AND entity_type='skill_group') OR (section_key='contact' AND entity_type IN('contact_focus_item','contact_status_item')) OR (section_key='website_links' AND entity_type='public_link') OR (section_key='profile' AND entity_type='profile_settings') OR (section_key='files' AND entity_type IN('resume_file','profile_image')))));

CREATE FUNCTION public.load_admin_section_titles_write_state(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,section_titles_write_mode text,section_titles_trusted_context_required boolean,section_titles_snapshot jsonb,section_titles_baseline_digest text,section_titles_baseline_proof text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE snapshot_value jsonb; digest_value text; key_value bytea; proof_value text;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501'; END IF;
  snapshot_value:=cms_private.section_titles_aggregate(target_resume_id);
  digest_value:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(snapshot_value::text,'UTF8'),'sha256'),'hex');
  key_value:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
  IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'Section Titles baseline signing unavailable' USING ERRCODE='22023'; END IF;
  proof_value:=pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('section-titles-baseline-v1:'||target_resume_id::text||':'||(SELECT auth.uid())::text||':'||digest_value,'UTF8'),key_value,'sha256'),'hex');
  RETURN QUERY SELECT target_resume_id,
    COALESCE((SELECT capability.enabled FROM cms_private.resume_capabilities capability WHERE capability.resume_id=target_resume_id AND capability.capability_key='activity_log'),false),
    cms_private.get_resume_write_mode(target_resume_id,'section_titles'),
    COALESCE((SELECT requirement.enabled FROM cms_private.resume_domain_requirements requirement WHERE requirement.resume_id=target_resume_id AND requirement.domain_key='section_titles' AND requirement.requirement_key='trusted_network_context_v11'),false),
    snapshot_value,digest_value,proof_value;
END
$function$;
REVOKE ALL ON FUNCTION public.load_admin_section_titles_write_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_section_titles_write_state(uuid) TO authenticated;

CREATE FUNCTION cms_private.verify_resume_section_titles_v1_context(target_resume_id uuid,canonical_section_titles text,signed_context text,signature_hex text)
RETURNS TABLE(context_value jsonb,section_titles_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE context_row jsonb; titles_value jsonb; key_value bytea; baseline_key bytea; supplied bytea; expected bytea;
  now_seconds bigint; issued_seconds bigint; expires_seconds bigint; baseline_digest text; baseline_proof text; network_value cidr; field_name text;
BEGIN
  BEGIN
    IF canonical_section_titles IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(canonical_section_titles,'UTF8'))>16384
      OR signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context,'UTF8'))>8192
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid'; END IF;
    context_row:=signed_context::jsonb; baseline_digest:=context_row->>'expected_baseline_digest'; baseline_proof:=context_row->>'baseline_proof';
    IF pg_catalog.jsonb_typeof(context_row) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(context_row))<>16
      OR context_row->>'context_version'<>'1' OR pg_catalog.jsonb_typeof(context_row->'context_version')<>'number'
      OR context_row->>'domain'<>'section_titles' OR context_row->>'operation'<>'update'
      OR context_row->>'resume_id'<>target_resume_id::text OR context_row->>'actor_user_id'<>(SELECT auth.uid())::text
      OR context_row->>'request_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR context_row->>'mutation_digest'<>pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical_section_titles,'UTF8'),'sha256'),'hex')
      OR baseline_digest !~ '^[0-9a-f]{64}$' OR baseline_proof !~ '^[0-9a-f]{64}$'
      OR context_row->>'issued_at' !~ '^(0|[1-9][0-9]{0,11})$' OR context_row->>'expires_at' !~ '^(0|[1-9][0-9]{0,11})$'
      OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(context_row) key(name) WHERE key.name<>ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','expected_baseline_digest','baseline_proof','issued_at','expires_at','ip_network','country_code','region','city']))
      OR NOT(context_row ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','expected_baseline_digest','baseline_proof','issued_at','expires_at','ip_network','country_code','region','city']) THEN RAISE EXCEPTION 'invalid'; END IF;
    issued_seconds:=(context_row->>'issued_at')::bigint; expires_seconds:=(context_row->>'expires_at')::bigint;
    now_seconds:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
    IF issued_seconds>now_seconds+60 OR expires_seconds<=now_seconds OR expires_seconds<=issued_seconds OR expires_seconds-issued_seconds>300 THEN RAISE EXCEPTION 'invalid'; END IF;
    IF context_row->'ip_network'<>'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(context_row->'ip_network')<>'string' THEN RAISE EXCEPTION 'invalid'; END IF;
      network_value:=(context_row->>'ip_network')::cidr;
      IF network_value::text<>context_row->>'ip_network' OR NOT((pg_catalog.family(network_value)=4 AND pg_catalog.masklen(network_value)=24) OR (pg_catalog.family(network_value)=6 AND pg_catalog.masklen(network_value)=48)) THEN RAISE EXCEPTION 'invalid'; END IF;
    END IF;
    IF context_row->'country_code'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(context_row->'country_code')<>'string' OR context_row->>'country_code' !~ '^[A-Z]{2}$') THEN RAISE EXCEPTION 'invalid'; END IF;
    FOREACH field_name IN ARRAY ARRAY['region','city'] LOOP
      IF context_row->field_name<>'null'::jsonb AND (pg_catalog.jsonb_typeof(context_row->field_name)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(context_row->>field_name,'UTF8')) NOT BETWEEN 1 AND 128 OR (context_row->>field_name) ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'invalid'; END IF;
    END LOOP;
    titles_value:=canonical_section_titles::jsonb;
    IF NOT cms_private.section_titles_aggregate_is_allowed(titles_value) THEN RAISE EXCEPTION 'invalid'; END IF;
    key_value:=cms_private.activity_log_v11_key(context_row->>'key_id'); supplied:=pg_catalog.decode(signature_hex,'hex');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'invalid'; END IF;
    expected:=extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),key_value,'sha256'); IF supplied<>expected THEN RAISE EXCEPTION 'invalid'; END IF;
    baseline_key:=cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
    IF baseline_key IS NULL OR pg_catalog.octet_length(baseline_key)<32
      OR pg_catalog.encode(extensions.hmac(pg_catalog.convert_to('section-titles-baseline-v1:'||target_resume_id::text||':'||(SELECT auth.uid())::text||':'||baseline_digest,'UTF8'),baseline_key,'sha256'),'hex')<>baseline_proof THEN RAISE EXCEPTION 'invalid'; END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid signed Section Titles request' USING ERRCODE='22023'; END;
  context_value:=context_row; section_titles_value:=titles_value; RETURN NEXT;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_section_titles_v1_context(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.can_direct_write_section_titles(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$ SELECT public.can_manage_resume(target_resume_id) AND cms_private.get_resume_write_mode(target_resume_id,'section_titles')='direct' $function$;
REVOKE ALL ON FUNCTION public.can_direct_write_section_titles(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_section_titles(uuid) TO authenticated;

CREATE FUNCTION cms_private.enforce_section_titles_locale_write_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
  IF current_user<>'postgres' AND (
    NEW.education_label IS DISTINCT FROM OLD.education_label OR NEW.experience_label IS DISTINCT FROM OLD.experience_label
    OR NEW.skills_label IS DISTINCT FROM OLD.skills_label OR NEW.honors_label IS DISTINCT FROM OLD.honors_label
    OR NEW.project_heading IS DISTINCT FROM OLD.project_heading OR NEW.kaggle_label IS DISTINCT FROM OLD.kaggle_label
  ) AND (NOT public.can_direct_write_section_titles(OLD.resume_id) OR NOT public.can_direct_write_section_titles(NEW.resume_id)) THEN
    RAISE EXCEPTION 'Section Titles direct writes are disabled' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.enforce_section_titles_locale_write_mode() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enforce_section_titles_locale_write_mode BEFORE UPDATE OF education_label,experience_label,skills_label,honors_label,project_heading,kaggle_label
ON public.resume_locale_content FOR EACH ROW EXECUTE FUNCTION cms_private.enforce_section_titles_locale_write_mode();

CREATE FUNCTION public.save_resume_section_titles_v1(target_resume_id uuid,canonical_section_titles text,signed_context text,signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE target_site_key text; context_row jsonb; incoming jsonb; before_value jsonb; after_value jsonb; event_changes jsonb;
  actor_id uuid; request_value uuid; expected_digest text; digest_value bytea; old_digest bytea; old_result jsonb;
  old_completed timestamptz; old_expiry timestamptz; locale_value text; saved_count bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT context.resolved_site_key INTO target_site_key FROM cms_private.assert_activity_log_target(target_resume_id) context;
  IF target_site_key IS NULL THEN RAISE EXCEPTION 'Section Titles target is not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resume_sites site WHERE site.id=target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  IF cms_private.get_resume_write_mode(target_resume_id,'section_titles')<>'rpc'
    OR NOT COALESCE((SELECT requirement.enabled FROM cms_private.resume_domain_requirements requirement WHERE requirement.resume_id=target_resume_id AND requirement.domain_key='section_titles' AND requirement.requirement_key='trusted_network_context_v11'),false)
    OR NOT COALESCE((SELECT capability.enabled FROM cms_private.resume_capabilities capability WHERE capability.resume_id=target_resume_id AND capability.capability_key='activity_log'),false) THEN
    RAISE EXCEPTION 'Secure Section Titles saving is not enabled' USING ERRCODE='42501'; END IF;
  SELECT verified.context_value,verified.section_titles_value INTO context_row,incoming
    FROM cms_private.verify_resume_section_titles_v1_context(target_resume_id,canonical_section_titles,signed_context,signature_hex) verified;
  actor_id:=(context_row->>'actor_user_id')::uuid; request_value:=(context_row->>'request_id')::uuid;
  expected_digest:=context_row->>'expected_baseline_digest';
  digest_value:=extensions.digest(pg_catalog.convert_to(canonical_section_titles||':'||expected_digest,'UTF8'),'sha256');
  SELECT idem.mutation_digest,idem.result_payload,idem.completed_at,idem.expires_at INTO old_digest,old_result,old_completed,old_expiry
    FROM cms_private.activity_log_idempotency idem WHERE idem.actor_user_id=actor_id AND idem.resume_id=target_resume_id
      AND idem.domain_key='section_titles' AND idem.request_id=request_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Section Titles request expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF old_digest IS DISTINCT FROM digest_value THEN RAISE EXCEPTION 'Section Titles request ID conflicts with a different payload' USING ERRCODE='P13B1'; END IF;
    IF old_completed IS NULL OR old_result IS NULL OR NOT cms_private.section_titles_aggregate_is_allowed(old_result) THEN RAISE EXCEPTION 'Incomplete Section Titles idempotency result' USING ERRCODE='22023'; END IF;
    RETURN old_result;
  END IF;
  before_value:=cms_private.section_titles_aggregate(target_resume_id);
  IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(before_value::text,'UTF8'),'sha256'),'hex')<>expected_digest THEN
    RAISE EXCEPTION 'Section Titles baseline changed since the request was created' USING ERRCODE='P13B2';
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at)
    VALUES(actor_id,target_resume_id,'section_titles',request_value,digest_value,pg_catalog.transaction_timestamp(),NULL,pg_catalog.transaction_timestamp()+interval '7 days');
  IF before_value IS DISTINCT FROM incoming THEN
    FOREACH locale_value IN ARRAY ARRAY['zh','en'] LOOP
      UPDATE public.resume_locale_content locale SET
        education_label=incoming->'translations'->locale_value->>'education_label',
        experience_label=incoming->'translations'->locale_value->>'experience_label',
        skills_label=incoming->'translations'->locale_value->>'skills_label',
        honors_label=incoming->'translations'->locale_value->>'honors_label',
        project_heading=incoming->'translations'->locale_value->>'project_heading',
        kaggle_label=incoming->'translations'->locale_value->>'kaggle_label'
      WHERE locale.resume_id=target_resume_id AND locale.locale=locale_value;
      GET DIAGNOSTICS saved_count=ROW_COUNT; IF saved_count<>1 THEN RAISE EXCEPTION 'Section Titles locale update failed' USING ERRCODE='22023'; END IF;
    END LOOP;
    after_value:=cms_private.section_titles_aggregate(target_resume_id);
    event_changes:=pg_catalog.jsonb_build_object('section_titles',pg_catalog.jsonb_build_object('before',before_value,'after',after_value));
    IF NOT cms_private.activity_event_payload_v2_section_titles_is_allowed('section_titles','section_titles_settings',NULL,'update',
      pg_catalog.jsonb_build_object('section_titles',after_value),event_changes) THEN RAISE EXCEPTION 'Section Titles audit payload is invalid' USING ERRCODE='22023'; END IF;
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
      VALUES(actor_id,(SELECT auth.jwt()->>'email'),(SELECT authorized.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) authorized),target_resume_id,target_site_key,
        'update','section_titles','section_titles_settings',NULL,pg_catalog.jsonb_build_object('section_titles',after_value),event_changes,2,
        (context_row->>'ip_network')::cidr,context_row->>'country_code',context_row->>'region',context_row->>'city');
  ELSE after_value:=before_value; END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=after_value,completed_at=pg_catalog.transaction_timestamp()
    WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='section_titles' AND request_id=request_value;
  RETURN after_value;
END
$function$;
REVOKE ALL ON FUNCTION public.save_resume_section_titles_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_section_titles_v1(uuid,text,text,text) TO authenticated;


-- Extend the existing read contracts without changing their authorization or output shape.
CREATE OR REPLACE FUNCTION public.read_activity_log_events_v13c(
  target_resume_id uuid,
  page_limit integer DEFAULT 50,
  before_occurred_at timestamptz DEFAULT NULL,
  before_id uuid DEFAULT NULL,
  before_source_rank integer DEFAULT NULL,
  event_filter text DEFAULT 'all',
  section_filter text DEFAULT NULL,
  operation_filter text DEFAULT NULL,
  actor_email_filter text DEFAULT NULL,
  date_from timestamptz DEFAULT NULL,
  date_to_exclusive timestamptz DEFAULT NULL,
  search_query text DEFAULT NULL
)
RETURNS TABLE (
  event_source text,
  source_rank integer,
  id uuid,
  occurred_at timestamptz,
  actor_user_id uuid,
  actor_email_snapshot text,
  actor_role_snapshot text,
  resume_id uuid,
  site_key_snapshot text,
  operation text,
  section_key text,
  entity_type text,
  entity_id text,
  entity_snapshot jsonb,
  changes jsonb,
  payload_version smallint,
  event_kind text,
  outcome text,
  failure_stage text,
  failure_code text,
  request_id uuid,
  ip_network cidr,
  country_code text,
  region text,
  city text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  normalized_event_filter text;
  normalized_section_filter text;
  normalized_operation_filter text;
  normalized_actor_filter text;
  normalized_search text;
  escaped_search text;
  authorization_context record;
BEGIN
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 100 THEN
    RAISE EXCEPTION 'page_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    (before_occurred_at IS NULL AND before_id IS NULL AND before_source_rank IS NULL)
    OR
    (before_occurred_at IS NOT NULL AND before_id IS NOT NULL AND before_source_rank IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'All cursor fields must be provided together' USING ERRCODE = '22023';
  END IF;
  IF before_source_rank IS NOT NULL AND before_source_rank NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Invalid Activity Log cursor source rank' USING ERRCODE = '22023';
  END IF;

  normalized_event_filter := COALESCE(pg_catalog.lower(pg_catalog.btrim(event_filter)), 'all');
  normalized_section_filter := NULLIF(pg_catalog.btrim(section_filter), '');
  normalized_operation_filter := NULLIF(pg_catalog.lower(pg_catalog.btrim(operation_filter)), '');
  normalized_actor_filter := NULLIF(pg_catalog.lower(pg_catalog.btrim(actor_email_filter)), '');
  normalized_search := NULLIF(pg_catalog.btrim(search_query), '');

  IF normalized_event_filter NOT IN ('all', 'successful', 'rejected') THEN
    RAISE EXCEPTION 'Invalid Activity Log event filter' USING ERRCODE = '22023';
  END IF;
  IF normalized_section_filter IS NOT NULL AND normalized_section_filter NOT IN (
    'introduction', 'education', 'experience', 'awards', 'skills',
    'contact', 'projects', 'website_links', 'profile', 'files', 'section_titles'
  ) THEN
    RAISE EXCEPTION 'Invalid Activity Log section filter' USING ERRCODE = '22023';
  END IF;
  IF normalized_operation_filter IS NOT NULL AND normalized_operation_filter NOT IN (
    'create', 'update', 'delete', 'reorder', 'upload', 'remove'
  ) THEN
    RAISE EXCEPTION 'Invalid Activity Log operation filter' USING ERRCODE = '22023';
  END IF;
  IF date_from IS NOT NULL AND date_to_exclusive IS NOT NULL AND date_to_exclusive <= date_from THEN
    RAISE EXCEPTION 'Invalid Activity Log date range' USING ERRCODE = '22023';
  END IF;
  IF normalized_search IS NOT NULL AND pg_catalog.char_length(normalized_search) > 128 THEN
    RAISE EXCEPTION 'Activity Log search query is too long' USING ERRCODE = '22023';
  END IF;

  SELECT context.resolved_site_key, context.resolved_role
    INTO authorization_context
    FROM cms_private.assert_activity_log_target(target_resume_id) AS context;

  IF normalized_search IS NOT NULL THEN
    escaped_search := '%' || pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(normalized_search, E'\\', E'\\\\'),
        '%', E'\\%'
      ),
      '_', E'\\_'
    ) || '%';
  END IF;

  RETURN QUERY
    WITH unified_events AS (
      SELECT
        'activity'::text AS event_source,
        1::integer AS source_rank,
        event.id AS id,
        event.occurred_at AS occurred_at,
        event.actor_user_id AS actor_user_id,
        event.actor_email_snapshot AS actor_email_snapshot,
        event.actor_role_snapshot AS actor_role_snapshot,
        event.resume_id AS resume_id,
        event.site_key_snapshot AS site_key_snapshot,
        event.operation AS operation,
        event.section_key AS section_key,
        event.entity_type AS entity_type,
        event.entity_id AS entity_id,
        event.entity_snapshot AS entity_snapshot,
        event.changes AS changes,
        event.payload_version AS payload_version,
        NULL::text AS event_kind,
        NULL::text AS outcome,
        NULL::text AS failure_stage,
        NULL::text AS failure_code,
        NULL::uuid AS request_id,
        event.ip_network AS ip_network,
        event.country_code AS country_code,
        event.region AS region,
        event.city AS city
      FROM cms_private.activity_log_events AS event
      WHERE event.resume_id = target_resume_id
        AND normalized_event_filter IN ('all', 'successful')
        AND (normalized_section_filter IS NULL OR event.section_key = normalized_section_filter)
        AND (normalized_operation_filter IS NULL OR event.operation = normalized_operation_filter)
        AND (normalized_actor_filter IS NULL OR pg_catalog.lower(event.actor_email_snapshot) = normalized_actor_filter)
        AND (date_from IS NULL OR event.occurred_at >= date_from)
        AND (date_to_exclusive IS NULL OR event.occurred_at < date_to_exclusive)
        AND (normalized_search IS NULL OR pg_catalog.concat_ws(
          ' ', event.section_key, event.entity_type, event.entity_id, event.changes::text
        ) ILIKE escaped_search ESCAPE E'\\')

      UNION ALL

      SELECT
        'system'::text AS event_source,
        2::integer AS source_rank,
        event.event_id AS id,
        event.occurred_at AS occurred_at,
        event.actor_user_id AS actor_user_id,
        event.actor_email_snapshot AS actor_email_snapshot,
        event.actor_role_snapshot AS actor_role_snapshot,
        event.resume_id AS resume_id,
        event.site_key_snapshot AS site_key_snapshot,
        event.operation AS operation,
        event.section_key AS section_key,
        NULL::text AS entity_type,
        NULL::text AS entity_id,
        NULL::jsonb AS entity_snapshot,
        NULL::jsonb AS changes,
        NULL::smallint AS payload_version,
        event.event_kind AS event_kind,
        event.outcome AS outcome,
        event.failure_stage AS failure_stage,
        event.failure_code AS failure_code,
        event.request_id AS request_id,
        event.ip_network AS ip_network,
        event.country_code AS country_code,
        event.region AS region,
        event.city AS city
      FROM cms_private.activity_log_system_events AS event
      WHERE event.resume_id = target_resume_id
        AND event.event_kind = 'operation_failure'
        AND event.outcome = 'rejected'
        AND normalized_event_filter IN ('all', 'rejected')
        AND (normalized_section_filter IS NULL OR event.section_key = normalized_section_filter)
        AND (normalized_operation_filter IS NULL OR event.operation = normalized_operation_filter)
        AND (normalized_actor_filter IS NULL OR pg_catalog.lower(event.actor_email_snapshot) = normalized_actor_filter)
        AND (date_from IS NULL OR event.occurred_at >= date_from)
        AND (date_to_exclusive IS NULL OR event.occurred_at < date_to_exclusive)
        AND (normalized_search IS NULL OR pg_catalog.concat_ws(
          ' ', event.section_key, event.operation, event.failure_stage,
          event.failure_code, event.request_id::text
        ) ILIKE escaped_search ESCAPE E'\\')
    )
    SELECT unified_events.event_source,
           unified_events.source_rank,
           unified_events.id,
           unified_events.occurred_at,
           unified_events.actor_user_id,
           unified_events.actor_email_snapshot,
           unified_events.actor_role_snapshot,
           unified_events.resume_id,
           unified_events.site_key_snapshot,
           unified_events.operation,
           unified_events.section_key,
           unified_events.entity_type,
           unified_events.entity_id,
           unified_events.entity_snapshot,
           unified_events.changes,
           unified_events.payload_version,
           unified_events.event_kind,
           unified_events.outcome,
           unified_events.failure_stage,
           unified_events.failure_code,
           unified_events.request_id,
           unified_events.ip_network,
           unified_events.country_code,
           unified_events.region,
           unified_events.city
    FROM unified_events
    WHERE before_id IS NULL
       OR unified_events.occurred_at < before_occurred_at
       OR (unified_events.occurred_at = before_occurred_at AND unified_events.id < before_id)
       OR (unified_events.occurred_at = before_occurred_at
           AND unified_events.id = before_id
           AND unified_events.source_rank < before_source_rank)
    ORDER BY unified_events.occurred_at DESC,
             unified_events.id DESC,
             unified_events.source_rank DESC
    LIMIT page_limit;
END
$function$;

REVOKE ALL ON FUNCTION public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_version_history_v1(
  target_resume_id uuid,
  page_limit integer DEFAULT 25,
  before_occurred_at timestamptz DEFAULT NULL,
  before_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  event_id uuid,
  occurred_at timestamptz,
  actor_account_label text,
  actor_role text,
  domain_key text,
  operation text,
  payload_version smallint,
  entity_type text,
  entity_id text,
  comparison_kind text,
  comparison jsonb,
  has_more boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  authorized_site_key text;
BEGIN
  IF target_resume_id IS NULL THEN
    RAISE EXCEPTION 'Version History target is required' USING ERRCODE = '22023';
  END IF;
  IF page_limit IS NULL OR page_limit < 1 OR page_limit > 100 THEN
    RAISE EXCEPTION 'page_limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  IF (before_occurred_at IS NULL) <> (before_event_id IS NULL) THEN
    RAISE EXCEPTION 'Both cursor fields must be provided together' USING ERRCODE = '22023';
  END IF;

  -- This helper checks authentication, admin/QA assignment, unpublished QA target,
  -- can_manage_resume, and the target's Activity Log capability on every call.
  SELECT context.resolved_site_key
    INTO authorized_site_key
    FROM cms_private.assert_activity_log_read_target(target_resume_id) AS context;

  RETURN QUERY
    WITH supported AS (
      SELECT
        event.id,
        event.occurred_at,
        CASE WHEN NULLIF(pg_catalog.btrim(event.actor_email_snapshot), '') IS NOT NULL
          THEN pg_catalog.btrim(event.actor_email_snapshot)
          WHEN event.actor_role_snapshot = 'owner' THEN 'Owner account'
          ELSE 'QA account'
        END AS actor_account_label,
        event.actor_role_snapshot AS actor_role,
        CASE
          WHEN event.section_key = 'introduction' AND event.entity_type = 'introduction_paragraph' THEN 'introduction'
          WHEN event.section_key = 'awards' AND event.entity_type IN ('award_entry','award_list') THEN 'awards'
          WHEN event.section_key = 'experience' AND event.entity_type IN ('experience_entry','experience_list') THEN 'experience'
          WHEN event.section_key = 'skills' AND event.entity_type IN ('skill_group','skill_group_list') THEN 'skills'
          WHEN event.section_key = 'education' AND event.entity_type IN ('education_entry','education_list') THEN 'education'
          WHEN event.section_key = 'projects' AND event.entity_type IN ('project_entry','project_list') THEN 'projects'
          WHEN event.section_key = 'contact' AND event.entity_type IN ('contact_focus_item','contact_status_item','contact_section') THEN 'contact'
          WHEN event.section_key = 'profile' AND event.entity_type = 'profile_settings' THEN 'profile'
          -- Legacy profile_image events use section_key=files in the frozen schema.
          WHEN event.section_key = 'files' AND event.entity_type = 'profile_image' THEN 'profile'
          WHEN event.section_key = 'website_links' AND event.entity_type IN ('public_link','website_links_settings') THEN 'website_links'
          WHEN event.section_key = 'section_titles' AND event.entity_type = 'section_titles_settings' THEN 'section_titles'
          WHEN event.section_key = 'files' AND event.entity_type IN ('resume_file','resume_file_set') THEN 'files'
          ELSE NULL
        END AS domain_key,
        event.operation,
        event.payload_version,
        event.entity_type,
        event.entity_id,
        event.section_key,
        event.entity_snapshot,
        event.changes
      FROM cms_private.activity_log_events AS event
      WHERE event.resume_id = target_resume_id
        AND event.site_key_snapshot = authorized_site_key
        AND (before_event_id IS NULL OR (event.occurred_at, event.id) < (before_occurred_at, before_event_id))
    ), adapted AS (
      SELECT
        s.*,
        CASE
          WHEN s.payload_version = 1
            AND s.domain_key = 'introduction'
            AND s.section_key = 'introduction'
            AND s.entity_type = 'introduction_paragraph'
            AND cms_private.activity_event_payload_is_allowed(s.entity_type, s.entity_snapshot, s.changes)
            AND s.changes <> '{}'::jsonb
            AND s.entity_snapshot ? 'paragraphs'
            THEN 'paragraph_changes'
          WHEN s.payload_version = 1
            AND ((s.domain_key = 'introduction' AND s.section_key = 'introduction' AND s.entity_type = 'introduction_paragraph' AND NOT (s.entity_snapshot ? 'paragraphs'))
              OR (s.domain_key = 'awards' AND s.section_key = 'awards' AND s.entity_type = 'award_entry')
              OR (s.domain_key = 'experience' AND s.entity_type = 'experience_entry')
              OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group')
              OR (s.domain_key = 'education' AND s.entity_type = 'education_entry')
              OR (s.domain_key = 'projects' AND s.entity_type = 'project_entry')
              OR (s.domain_key = 'contact' AND s.entity_type IN ('contact_focus_item','contact_status_item'))
              OR (s.domain_key = 'profile' AND ((s.section_key = 'profile' AND s.entity_type = 'profile_settings')
                OR (s.section_key = 'files' AND s.entity_type = 'profile_image')))
              OR (s.domain_key = 'website_links' AND s.entity_type = 'public_link')
              OR (s.domain_key = 'files' AND s.section_key = 'files' AND s.entity_type = 'resume_file'))
            AND cms_private.activity_event_payload_is_allowed(s.entity_type, s.entity_snapshot, s.changes)
            AND s.changes <> '{}'::jsonb
            -- Version History exposes file references only, not filenames or file metadata.
            AND (s.domain_key NOT IN ('files','profile') OR s.entity_type NOT IN ('resume_file','profile_image')
              OR (s.changes - ARRAY['file_name','content_type','size_bytes']) <> '{}'::jsonb)
            THEN 'entity_fields'
          WHEN s.payload_version = 2
            AND ((s.domain_key = 'awards' AND s.entity_type = 'award_list')
              OR (s.domain_key = 'experience' AND s.entity_type = 'experience_list')
              OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group_list')
              OR (s.domain_key = 'education' AND s.entity_type = 'education_list')
              OR (s.domain_key = 'projects' AND s.entity_type = 'project_list')
              OR (s.domain_key = 'contact' AND s.entity_type = 'contact_section')
              OR (s.domain_key = 'profile' AND s.section_key = 'profile' AND s.entity_type = 'profile_settings')
              OR (s.domain_key = 'website_links' AND s.entity_type = 'website_links_settings')
              OR (s.domain_key = 'section_titles' AND s.section_key = 'section_titles' AND s.entity_type = 'section_titles_settings')
              OR (s.domain_key = 'files' AND s.entity_type = 'resume_file_set'))
            AND cms_private.activity_event_payload_v2_is_allowed(
              s.section_key, s.entity_type, s.entity_id, s.operation, s.entity_snapshot, s.changes)
            THEN 'aggregate'
          ELSE 'unavailable'
        END AS comparison_kind
      FROM supported AS s
      WHERE s.domain_key IS NOT NULL
        AND (
          (s.payload_version = 1 AND (
            (s.domain_key = 'introduction' AND s.section_key = 'introduction' AND s.entity_type = 'introduction_paragraph')
            OR (s.domain_key = 'awards' AND s.entity_type = 'award_entry')
            OR (s.domain_key = 'experience' AND s.entity_type = 'experience_entry')
            OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group')
            OR (s.domain_key = 'education' AND s.entity_type = 'education_entry')
            OR (s.domain_key = 'projects' AND s.entity_type = 'project_entry')
            OR (s.domain_key = 'contact' AND s.entity_type IN ('contact_focus_item','contact_status_item'))
            OR (s.domain_key = 'profile' AND s.entity_type IN ('profile_settings','profile_image'))
            OR (s.domain_key = 'website_links' AND s.entity_type = 'public_link')
            OR (s.domain_key = 'files' AND s.entity_type = 'resume_file')
          ))
          OR (s.payload_version = 2 AND (
            (s.domain_key = 'awards' AND s.entity_type = 'award_list')
            OR (s.domain_key = 'experience' AND s.entity_type = 'experience_list')
            OR (s.domain_key = 'skills' AND s.entity_type = 'skill_group_list')
            OR (s.domain_key = 'education' AND s.entity_type = 'education_list')
            OR (s.domain_key = 'projects' AND s.entity_type = 'project_list')
            OR (s.domain_key = 'contact' AND s.entity_type = 'contact_section')
            OR (s.domain_key = 'profile' AND s.entity_type = 'profile_settings' AND s.section_key = 'profile')
            OR (s.domain_key = 'website_links' AND s.entity_type = 'website_links_settings')
              OR (s.domain_key = 'section_titles' AND s.section_key = 'section_titles' AND s.entity_type = 'section_titles_settings')
            OR (s.domain_key = 'files' AND s.entity_type = 'resume_file_set')
          ))
          OR s.payload_version NOT IN (1,2)
        )
    ), limited AS (
      SELECT
        a.*,
        CASE
          WHEN a.comparison_kind = 'paragraph_changes' THEN (
            WITH items AS (
              SELECT field.key AS field_key, item.id, item.side, item.value, item.ordinality
              FROM pg_catalog.jsonb_each(a.changes) AS field(key, value)
              CROSS JOIN LATERAL (
                SELECT element.value->>'id' AS id, 'before'::text AS side,
                  element.value->'value' AS value, element.ordinality
                FROM pg_catalog.jsonb_array_elements(field.value->'before') WITH ORDINALITY AS element(value, ordinality)
                UNION ALL
                SELECT element.value->>'id', 'after'::text, element.value->'value', element.ordinality
                FROM pg_catalog.jsonb_array_elements(field.value->'after') WITH ORDINALITY AS element(value, ordinality)
              ) AS item
            ), pairs AS (
              SELECT items.id, items.field_key,
                COALESCE((pg_catalog.jsonb_agg(items.value) FILTER (WHERE items.side = 'before'))->0, 'null'::jsonb) AS before_value,
                COALESCE((pg_catalog.jsonb_agg(items.value) FILTER (WHERE items.side = 'after'))->0, 'null'::jsonb) AS after_value,
                pg_catalog.min(items.ordinality) AS first_ordinality
              FROM items
              GROUP BY items.id, items.field_key
            ), paragraphs AS (
              SELECT pairs.id,
                CASE WHEN pg_catalog.bool_or(pairs.before_value <> 'null'::jsonb)
                    AND pg_catalog.bool_or(pairs.after_value <> 'null'::jsonb) THEN 'updated'
                  WHEN pg_catalog.bool_or(pairs.after_value <> 'null'::jsonb) THEN 'added' ELSE 'removed' END AS state,
                pg_catalog.jsonb_object_agg(pairs.field_key,
                  pg_catalog.jsonb_build_object('before', pairs.before_value, 'after', pairs.after_value)) AS fields,
                pg_catalog.min(pairs.first_ordinality) AS first_ordinality
              FROM pairs
              GROUP BY pairs.id
              HAVING pg_catalog.bool_or(pairs.before_value <> 'null'::jsonb OR pairs.after_value <> 'null'::jsonb)
            )
            SELECT pg_catalog.jsonb_build_object('paragraphs',
              COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('state', paragraphs.state, 'fields', paragraphs.fields)
                ORDER BY paragraphs.first_ordinality, paragraphs.id), '[]'::jsonb))
            FROM paragraphs
          )
          WHEN a.comparison_kind = 'entity_fields' AND a.domain_key IN ('files','profile') AND a.entity_type IN ('resume_file','profile_image')
            THEN pg_catalog.jsonb_build_object('changes', a.changes - ARRAY['file_name','content_type','size_bytes'])
          WHEN a.comparison_kind = 'entity_fields' THEN pg_catalog.jsonb_build_object('changes', a.changes)
          WHEN a.comparison_kind = 'aggregate' THEN pg_catalog.jsonb_build_object(
            'before', a.changes->a.domain_key->'before',
            'after', a.changes->a.domain_key->'after'
          )
          ELSE NULL::jsonb
        END AS comparison
      FROM adapted AS a
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT page_limit + 1
    ), ranked AS (
      SELECT l.*, pg_catalog.row_number() OVER (ORDER BY l.occurred_at DESC, l.id DESC) AS row_number,
        pg_catalog.count(*) OVER () AS candidate_count
      FROM limited AS l
    )
    SELECT ranked.id,
      ranked.occurred_at,
      ranked.actor_account_label,
      ranked.actor_role,
      ranked.domain_key,
      ranked.operation,
      ranked.payload_version,
      ranked.entity_type,
      CASE WHEN ranked.entity_type IN ('resume_file','profile_image','introduction_paragraph') THEN NULL ELSE ranked.entity_id END,
      ranked.comparison_kind,
      ranked.comparison,
      ranked.candidate_count > page_limit
    FROM ranked
    WHERE ranked.row_number <= page_limit
    ORDER BY ranked.occurred_at DESC, ranked.id DESC;
END
$function$;

REVOKE ALL ON FUNCTION public.read_version_history_v1(uuid,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_version_history_v1(uuid,integer,timestamptz,uuid) TO authenticated;

COMMIT;
