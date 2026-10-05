-- Additive transactional Profile writer. The private Storage origin is intentionally left unconfigured.
BEGIN;
DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Profile writer must be installed as postgres' USING ERRCODE='42501';
  END IF;
END
$owner_guard$;

CREATE TABLE cms_private.profile_photo_origin_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  origin text NOT NULL CHECK (
    origin ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
  )
);
ALTER TABLE cms_private.profile_photo_origin_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cms_private.profile_photo_origin_config FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION cms_private.profile_photo_url_is_allowed(target_origin text, target_resume_id uuid, target_photo_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path=''
AS $function$
DECLARE prefix_value text; filename_value text;
BEGIN
  IF target_origin IS NULL OR target_resume_id IS NULL OR target_photo_url IS NULL
    OR target_origin !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
    OR target_photo_url ~ '[?#%\\]' THEN RETURN false; END IF;
  prefix_value := target_origin || '/storage/v1/object/public/profile-images/' || target_resume_id::text || '/profile/';
  IF pg_catalog.left(target_photo_url, pg_catalog.length(prefix_value)) <> prefix_value THEN RETURN false; END IF;
  filename_value := pg_catalog.substr(target_photo_url, pg_catalog.length(prefix_value)+1);
  RETURN filename_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    AND target_photo_url = prefix_value || filename_value;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.profile_photo_url_is_allowed(text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION cms_private.profile_aggregate_is_allowed(target_profile jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path=''
AS $function$
DECLARE locale_value jsonb; locale_key text;
BEGIN
  IF pg_catalog.jsonb_typeof(target_profile) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(target_profile)) <> 2
    OR NOT (target_profile ?& ARRAY['shared','translations'])
    OR pg_catalog.jsonb_typeof(target_profile->'shared') IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(target_profile->'shared')) <> 5
    OR NOT (target_profile->'shared' ?& ARRAY['graduation_value','avatar_initials','footer_name','copyright','photo_url'])
    OR pg_catalog.jsonb_typeof(target_profile->'shared'->'graduation_value') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(target_profile->'shared'->'avatar_initials') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(target_profile->'shared'->'footer_name') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(target_profile->'shared'->'copyright') IS DISTINCT FROM 'string'
    OR NOT (pg_catalog.jsonb_typeof(target_profile->'shared'->'photo_url') IN ('string','null'))
    OR (pg_catalog.jsonb_typeof(target_profile->'shared'->'photo_url')='string' AND target_profile->'shared'->>'photo_url'='')
    OR pg_catalog.jsonb_typeof(target_profile->'translations') IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(target_profile->'translations')) <> 2
    OR NOT (target_profile->'translations' ?& ARRAY['zh','en']) THEN RETURN false; END IF;
  FOREACH locale_key IN ARRAY ARRAY['zh','en'] LOOP
    locale_value := target_profile->'translations'->locale_key;
    IF pg_catalog.jsonb_typeof(locale_value) IS DISTINCT FROM 'object'
      OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(locale_value)) <> 7
      OR NOT (locale_value ?& ARRAY['name','nav_about_label','email_action_label','graduation_label','avatar_label','contact_focus_heading','contact_status_heading'])
      OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(locale_value) AS field(key,value) WHERE pg_catalog.jsonb_typeof(field.value) IS DISTINCT FROM 'string')
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.profile_aggregate_is_allowed(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION cms_private.activity_event_payload_v2_profile_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path=''
AS $function$
DECLARE before_value jsonb; after_value jsonb;
BEGIN
  IF target_section IS DISTINCT FROM 'profile' OR target_entity_type IS DISTINCT FROM 'profile_settings'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) <> 1
    OR NOT (target_snapshot ? 'profile')
    OR pg_catalog.jsonb_typeof(target_changes) IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) <> 1
    OR NOT (target_changes ? 'profile')
    OR pg_catalog.jsonb_typeof(target_changes->'profile') IS DISTINCT FROM 'object'
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(target_changes->'profile')) <> 2
    OR NOT (target_changes->'profile' ?& ARRAY['before','after'])
    OR target_snapshot->'profile' IS DISTINCT FROM target_changes->'profile'->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text,'UTF8'))
      + pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text,'UTF8')) > 655360
  THEN RETURN false; END IF;
  before_value := target_changes->'profile'->'before';
  after_value := target_changes->'profile'->'after';
  RETURN cms_private.profile_aggregate_is_allowed(before_value)
    AND cms_private.profile_aggregate_is_allowed(after_value);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_profile_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_v2_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path=''
AS $function$
  SELECT cms_private.activity_event_payload_v2_awards_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_experience_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_skills_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_education_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_projects_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_contact_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_profile_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check CHECK
  (entity_type IN ('introduction_paragraph','education_entry','education_list','experience_entry','experience_list','project_entry','project_list',
    'award_entry','award_list','skill_group','skill_group_list','contact_focus_item','contact_status_item','contact_section','public_link','profile_settings','resume_file','profile_image'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK (
  (payload_version=2 AND entity_id IS NULL AND operation='update' AND
    ((section_key='awards' AND entity_type='award_list') OR (section_key='experience' AND entity_type='experience_list')
     OR (section_key='skills' AND entity_type='skill_group_list') OR (section_key='education' AND entity_type='education_list')
     OR (section_key='projects' AND entity_type='project_list') OR (section_key='contact' AND entity_type='contact_section')
     OR (section_key='profile' AND entity_type='profile_settings'))) OR
  (payload_version=1 AND ((section_key='introduction' AND entity_type='introduction_paragraph')
    OR (section_key='education' AND entity_type='education_entry') OR (section_key='experience' AND entity_type='experience_entry')
    OR (section_key='projects' AND entity_type='project_entry') OR (section_key='awards' AND entity_type='award_entry')
    OR (section_key='skills' AND entity_type='skill_group') OR (section_key='contact' AND entity_type IN ('contact_focus_item','contact_status_item'))
    OR (section_key='website_links' AND entity_type='public_link') OR (section_key='profile' AND entity_type='profile_settings')
    OR (section_key='files' AND entity_type IN ('resume_file','profile_image'))))
);

CREATE FUNCTION public.can_direct_write_profile(target_resume_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $function$
  SELECT public.can_manage_resume(target_resume_id)
    AND cms_private.get_resume_write_mode(target_resume_id,'profile')='direct'
$function$;
REVOKE ALL ON FUNCTION public.can_direct_write_profile(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_profile(uuid) TO authenticated;

DO $profile_policies$
DECLARE table_name text; policy_record record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['resume_profile','resume_profile_translations'] LOOP
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=table_name
      AND cmd<>'SELECT' AND policyname NOT IN ('cms_admin_scoped_all','cms_admin_scoped_select','cms_admin_scoped_direct_dml')) THEN
      RAISE EXCEPTION 'Unexpected Profile write policy requires review' USING ERRCODE='55000';
    END IF;
    FOR policy_record IN SELECT policyname FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=table_name
      AND policyname IN ('cms_admin_scoped_all','cms_admin_scoped_select','cms_admin_scoped_direct_dml') LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I',policy_record.policyname,table_name);
    END LOOP;
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_select ON public.%I FOR SELECT TO authenticated USING (public.can_manage_resume(resume_id))',table_name);
    EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_direct_dml ON public.%I FOR ALL TO authenticated USING (public.can_direct_write_profile(resume_id)) WITH CHECK (public.can_direct_write_profile(resume_id))',table_name);
  END LOOP;
END
$profile_policies$;

CREATE FUNCTION cms_private.verify_resume_profile_v1_context(target_resume_id uuid,canonical_profile text,signed_context text,signature_hex text)
RETURNS TABLE(context_value jsonb,profile_value jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE ctx jsonb; key_value bytea; supplied bytea; expected bytea; now_seconds bigint;
  issued_seconds bigint; expires_seconds bigint; profile_rows jsonb; ip_value cidr; network_text text;
BEGIN
  BEGIN
    IF signed_context IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context,'UTF8'))>8192
      OR canonical_profile IS NULL OR pg_catalog.octet_length(pg_catalog.convert_to(canonical_profile,'UTF8'))>196608
      OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid'; END IF;
    ctx:=signed_context::jsonb;
    IF pg_catalog.jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(ctx))<>14
      OR pg_catalog.jsonb_typeof(ctx->'context_version') IS DISTINCT FROM 'number' OR ctx->>'context_version'<>'1'
      OR pg_catalog.jsonb_typeof(ctx->'key_id') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(ctx->'domain') IS DISTINCT FROM 'string' OR ctx->>'domain'<>'profile'
      OR pg_catalog.jsonb_typeof(ctx->'operation') IS DISTINCT FROM 'string' OR ctx->>'operation'<>'update'
      OR pg_catalog.jsonb_typeof(ctx->'resume_id') IS DISTINCT FROM 'string' OR ctx->>'resume_id'<>target_resume_id::text
      OR pg_catalog.jsonb_typeof(ctx->'actor_user_id') IS DISTINCT FROM 'string' OR ctx->>'actor_user_id'<>(SELECT auth.uid())::text
      OR pg_catalog.jsonb_typeof(ctx->'request_id') IS DISTINCT FROM 'string'
      OR (ctx->>'request_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(ctx->'mutation_digest') IS DISTINCT FROM 'string' OR (ctx->>'mutation_digest') !~ '^[0-9a-f]{64}$'
      OR pg_catalog.jsonb_typeof(ctx->'issued_at') IS DISTINCT FROM 'number' OR (ctx->>'issued_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR pg_catalog.jsonb_typeof(ctx->'expires_at') IS DISTINCT FROM 'number' OR (ctx->>'expires_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(ctx) AS k(key_name)
        WHERE k.key_name<>ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']))
      OR NOT(ctx ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city'])
    THEN RAISE EXCEPTION 'invalid'; END IF;
    issued_seconds:=(ctx->>'issued_at')::bigint; expires_seconds:=(ctx->>'expires_at')::bigint;
    now_seconds:=pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint;
    IF issued_seconds>now_seconds+60 OR expires_seconds<=now_seconds OR expires_seconds<=issued_seconds OR expires_seconds-issued_seconds>300 THEN RAISE EXCEPTION 'invalid'; END IF;
    IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(canonical_profile,'UTF8'),'sha256'),'hex')<>ctx->>'mutation_digest' THEN RAISE EXCEPTION 'invalid'; END IF;
    profile_rows:=canonical_profile::jsonb;
    IF NOT cms_private.profile_aggregate_is_allowed(profile_rows) THEN RAISE EXCEPTION 'invalid'; END IF;
    supplied:=pg_catalog.decode(signature_hex,'hex'); key_value:=cms_private.activity_log_v11_key(ctx->>'key_id');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value)<32 THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'ip_network'<>'null'::jsonb THEN
      IF pg_catalog.jsonb_typeof(ctx->'ip_network')<>'string' THEN RAISE EXCEPTION 'invalid'; END IF;
      network_text:=ctx->>'ip_network'; ip_value:=network_text::cidr;
      IF ip_value::text<>network_text OR NOT((pg_catalog.family(ip_value)=4 AND pg_catalog.masklen(ip_value)=24) OR (pg_catalog.family(ip_value)=6 AND pg_catalog.masklen(ip_value)=48)) THEN RAISE EXCEPTION 'invalid'; END IF;
    END IF;
    IF ctx->'country_code'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'country_code')<>'string' OR (ctx->>'country_code') COLLATE "C" !~ '^[A-Z]{2}$') THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'region'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'region')<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(ctx->>'region','UTF8'))>128) THEN RAISE EXCEPTION 'invalid'; END IF;
    IF ctx->'city'<>'null'::jsonb AND (pg_catalog.jsonb_typeof(ctx->'city')<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(ctx->>'city','UTF8'))>128) THEN RAISE EXCEPTION 'invalid'; END IF;
    expected:=extensions.hmac(pg_catalog.convert_to(signed_context,'UTF8'),key_value,'sha256');
    IF NOT extensions.digest(supplied,'sha256')=extensions.digest(expected,'sha256') THEN RAISE EXCEPTION 'invalid'; END IF;
    RETURN QUERY SELECT ctx,profile_rows;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid signed Profile request' USING ERRCODE='22023';
  END;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_profile_v1_context(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.load_admin_profile_write_state(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,profile_write_mode text,profile_trusted_context_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN
    RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT target_resume_id,
    COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false),
    cms_private.get_resume_write_mode(target_resume_id,'profile'),
    COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id
      AND r.domain_key='profile' AND r.requirement_key='trusted_network_context_v11'),false);
END
$function$;
REVOKE ALL ON FUNCTION public.load_admin_profile_write_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_profile_write_state(uuid) TO authenticated;

CREATE FUNCTION public.save_resume_profile_v1(target_resume_id uuid,canonical_profile text,signed_context text,signature_hex text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $function$
DECLARE
  target_site_key text; ctx jsonb; incoming jsonb; before_value jsonb; result_value jsonb; changes_value jsonb;
  actor_id uuid; request_id_value uuid; digest_value bytea; old_digest bytea; old_result jsonb; old_completed timestamptz; old_expiry timestamptz;
  locale_key text; origin_value text; rows_changed bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
  SELECT t.resolved_site_key INTO target_site_key FROM cms_private.assert_activity_log_target(target_resume_id) t;
  IF target_site_key IS NULL THEN RAISE EXCEPTION 'Profile target is not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
  PERFORM 1 FROM cms_private.assert_activity_log_target(target_resume_id);
  IF cms_private.get_resume_write_mode(target_resume_id,'profile')<>'rpc' THEN
    RAISE EXCEPTION 'Profile RPC mode is not enabled' USING ERRCODE='42501';
  END IF;
  IF NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id
      AND r.domain_key='profile' AND r.requirement_key='trusted_network_context_v11'),false)
    OR NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false) THEN
    RAISE EXCEPTION 'Secure Profile saving is not fully enabled' USING ERRCODE='42501';
  END IF;
  SELECT v.context_value,v.profile_value INTO ctx,incoming
    FROM cms_private.verify_resume_profile_v1_context(target_resume_id,canonical_profile,signed_context,signature_hex) v;
  actor_id:=(ctx->>'actor_user_id')::uuid; request_id_value:=(ctx->>'request_id')::uuid;
  digest_value:=extensions.digest(pg_catalog.convert_to(canonical_profile,'UTF8'),'sha256');
  SELECT i.mutation_digest,i.completed_at,i.expires_at,i.result_payload
    INTO old_digest,old_completed,old_expiry,old_result
    FROM cms_private.activity_log_idempotency i
    WHERE i.actor_user_id=actor_id AND i.resume_id=target_resume_id AND i.domain_key='profile' AND i.request_id=request_id_value FOR UPDATE;
  IF FOUND THEN
    IF old_expiry<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Idempotency request has expired; use a new request ID' USING ERRCODE='22023'; END IF;
    IF old_digest<>digest_value THEN RAISE EXCEPTION 'Idempotency key conflicts with a different Profile request' USING ERRCODE='P13B1'; END IF;
    IF old_completed IS NULL OR pg_catalog.jsonb_typeof(old_result) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(old_result)<>1 THEN
      RAISE EXCEPTION 'Incomplete Profile idempotency record' USING ERRCODE='22023';
    END IF;
    RETURN old_result->0;
  END IF;
  INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,completed_at,expires_at)
    VALUES(actor_id,target_resume_id,'profile',request_id_value,digest_value,pg_catalog.transaction_timestamp(),NULL,pg_catalog.transaction_timestamp()+interval '7 days');

  IF (SELECT pg_catalog.count(*) FROM public.resume_profile WHERE resume_id=target_resume_id)<>1
    OR (SELECT pg_catalog.count(*) FROM public.resume_profile_translations WHERE resume_id=target_resume_id)<>2
    OR (SELECT pg_catalog.count(*) FROM public.resume_profile_translations WHERE resume_id=target_resume_id AND locale IN ('zh','en'))<>2 THEN
    RAISE EXCEPTION 'Profile state is incomplete' USING ERRCODE='22023';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'shared',pg_catalog.jsonb_build_object('graduation_value',p.graduation_value,'avatar_initials',p.avatar_initials,
      'footer_name',p.footer_name,'copyright',p.copyright,'photo_url',p.photo_url),
    'translations',pg_catalog.jsonb_build_object(
      'zh',pg_catalog.jsonb_build_object('name',zh.name,'nav_about_label',zh.nav_about_label,'email_action_label',zh.email_action_label,
        'graduation_label',zh.graduation_label,'avatar_label',zh.avatar_label,'contact_focus_heading',zh.contact_focus_heading,'contact_status_heading',zh.contact_status_heading),
      'en',pg_catalog.jsonb_build_object('name',en.name,'nav_about_label',en.nav_about_label,'email_action_label',en.email_action_label,
        'graduation_label',en.graduation_label,'avatar_label',en.avatar_label,'contact_focus_heading',en.contact_focus_heading,'contact_status_heading',en.contact_status_heading)
    )) INTO before_value
  FROM public.resume_profile p
  JOIN public.resume_profile_translations zh ON zh.resume_id=p.resume_id AND zh.locale='zh'
  JOIN public.resume_profile_translations en ON en.resume_id=p.resume_id AND en.locale='en'
  WHERE p.resume_id=target_resume_id;
  IF NOT cms_private.profile_aggregate_is_allowed(before_value)
    OR pg_catalog.octet_length(pg_catalog.convert_to(before_value::text,'UTF8'))>196608 THEN
    RAISE EXCEPTION 'Existing Profile state is outside the supported aggregate contract' USING ERRCODE='22023';
  END IF;

  IF incoming->'shared'->'photo_url' IS DISTINCT FROM before_value->'shared'->'photo_url'
    AND pg_catalog.jsonb_typeof(incoming->'shared'->'photo_url')='string' THEN
    SELECT c.origin INTO origin_value FROM cms_private.profile_photo_origin_config c WHERE c.singleton;
    IF origin_value IS NULL OR NOT cms_private.profile_photo_url_is_allowed(origin_value,target_resume_id,incoming->'shared'->>'photo_url') THEN
      RAISE EXCEPTION 'Profile photo URL is not an authorized managed image' USING ERRCODE='22023';
    END IF;
  END IF;

  IF incoming IS DISTINCT FROM before_value THEN
    IF incoming->'shared' IS DISTINCT FROM before_value->'shared' THEN
      UPDATE public.resume_profile SET graduation_value=incoming->'shared'->>'graduation_value',
        avatar_initials=incoming->'shared'->>'avatar_initials',footer_name=incoming->'shared'->>'footer_name',
        copyright=incoming->'shared'->>'copyright',photo_url=incoming->'shared'->>'photo_url'
      WHERE resume_id=target_resume_id
        AND (graduation_value IS DISTINCT FROM incoming->'shared'->>'graduation_value'
          OR avatar_initials IS DISTINCT FROM incoming->'shared'->>'avatar_initials'
          OR footer_name IS DISTINCT FROM incoming->'shared'->>'footer_name'
          OR copyright IS DISTINCT FROM incoming->'shared'->>'copyright'
          OR photo_url IS DISTINCT FROM incoming->'shared'->>'photo_url');
      GET DIAGNOSTICS rows_changed=ROW_COUNT;
      IF rows_changed<>1 THEN RAISE EXCEPTION 'Profile shared update was not uniquely scoped' USING ERRCODE='22023'; END IF;
    END IF;
    FOREACH locale_key IN ARRAY ARRAY['zh','en'] LOOP
      IF incoming->'translations'->locale_key IS DISTINCT FROM before_value->'translations'->locale_key THEN
        UPDATE public.resume_profile_translations SET name=incoming->'translations'->locale_key->>'name',
          nav_about_label=incoming->'translations'->locale_key->>'nav_about_label',
          email_action_label=incoming->'translations'->locale_key->>'email_action_label',
          graduation_label=incoming->'translations'->locale_key->>'graduation_label',
          avatar_label=incoming->'translations'->locale_key->>'avatar_label',
          contact_focus_heading=incoming->'translations'->locale_key->>'contact_focus_heading',
          contact_status_heading=incoming->'translations'->locale_key->>'contact_status_heading'
        WHERE resume_id=target_resume_id AND locale=locale_key
          AND (name IS DISTINCT FROM incoming->'translations'->locale_key->>'name'
            OR nav_about_label IS DISTINCT FROM incoming->'translations'->locale_key->>'nav_about_label'
            OR email_action_label IS DISTINCT FROM incoming->'translations'->locale_key->>'email_action_label'
            OR graduation_label IS DISTINCT FROM incoming->'translations'->locale_key->>'graduation_label'
            OR avatar_label IS DISTINCT FROM incoming->'translations'->locale_key->>'avatar_label'
            OR contact_focus_heading IS DISTINCT FROM incoming->'translations'->locale_key->>'contact_focus_heading'
            OR contact_status_heading IS DISTINCT FROM incoming->'translations'->locale_key->>'contact_status_heading');
        GET DIAGNOSTICS rows_changed=ROW_COUNT;
        IF rows_changed<>1 THEN RAISE EXCEPTION 'Profile translation update was not uniquely scoped' USING ERRCODE='22023'; END IF;
      END IF;
    END LOOP;

    SELECT pg_catalog.jsonb_build_object(
      'shared',pg_catalog.jsonb_build_object('graduation_value',p.graduation_value,'avatar_initials',p.avatar_initials,
        'footer_name',p.footer_name,'copyright',p.copyright,'photo_url',p.photo_url),
      'translations',pg_catalog.jsonb_build_object(
        'zh',pg_catalog.jsonb_build_object('name',zh.name,'nav_about_label',zh.nav_about_label,'email_action_label',zh.email_action_label,
          'graduation_label',zh.graduation_label,'avatar_label',zh.avatar_label,'contact_focus_heading',zh.contact_focus_heading,'contact_status_heading',zh.contact_status_heading),
        'en',pg_catalog.jsonb_build_object('name',en.name,'nav_about_label',en.nav_about_label,'email_action_label',en.email_action_label,
          'graduation_label',en.graduation_label,'avatar_label',en.avatar_label,'contact_focus_heading',en.contact_focus_heading,'contact_status_heading',en.contact_status_heading)
      )) INTO result_value
    FROM public.resume_profile p
    JOIN public.resume_profile_translations zh ON zh.resume_id=p.resume_id AND zh.locale='zh'
    JOIN public.resume_profile_translations en ON en.resume_id=p.resume_id AND en.locale='en'
    WHERE p.resume_id=target_resume_id;
    changes_value:=pg_catalog.jsonb_build_object('profile',pg_catalog.jsonb_build_object('before',before_value,'after',result_value));
    IF NOT cms_private.profile_aggregate_is_allowed(result_value)
      OR pg_catalog.octet_length(pg_catalog.convert_to(result_value::text,'UTF8'))>196608
      OR NOT cms_private.activity_event_payload_v2_profile_is_allowed('profile','profile_settings',NULL,'update',
        pg_catalog.jsonb_build_object('profile',result_value),changes_value) THEN
      RAISE EXCEPTION 'Profile result exceeds the supported aggregate contract' USING ERRCODE='22023';
    END IF;
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,
      operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
    VALUES(actor_id,(SELECT auth.jwt()->>'email'),
      (SELECT x.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) x),
      target_resume_id,target_site_key,'update','profile','profile_settings',NULL,
      pg_catalog.jsonb_build_object('profile',result_value),changes_value,2,
      (ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
  ELSE
    result_value:=before_value;
  END IF;
  UPDATE cms_private.activity_log_idempotency SET result_payload=pg_catalog.jsonb_build_array(result_value),
    completed_at=pg_catalog.transaction_timestamp()
  WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='profile' AND request_id=request_id_value;
  RETURN result_value;
END
$function$;
REVOKE ALL ON FUNCTION public.save_resume_profile_v1(uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_profile_v1(uuid,text,text,text) TO authenticated;
COMMIT;
