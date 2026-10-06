-- Additive Website & Links transactional writer. Installation leaves all targets in direct mode.
BEGIN;
DO $owner$ BEGIN IF current_user<>'postgres' THEN RAISE EXCEPTION 'Website & Links writer must be installed as postgres' USING ERRCODE='42501'; END IF; END $owner$;

CREATE FUNCTION public.can_direct_write_website_links(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$ SELECT public.can_manage_resume(target_resume_id) AND cms_private.get_resume_write_mode(target_resume_id,'website_links')='direct' $f$;
REVOKE ALL ON FUNCTION public.can_direct_write_website_links(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_website_links(uuid) TO authenticated;
CREATE FUNCTION public.can_direct_write_files(target_resume_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$ SELECT public.can_manage_resume(target_resume_id) AND cms_private.get_resume_write_mode(target_resume_id,'files')='direct' $f$;
REVOKE ALL ON FUNCTION public.can_direct_write_files(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_direct_write_files(uuid) TO authenticated;

DO $policies$
DECLARE t text; p record;
BEGIN
 FOREACH t IN ARRAY ARRAY['resume_public_links','resume_navigation_item_translations'] LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=t AND cmd<>'SELECT'
    AND policyname NOT IN('cms_admin_scoped_all','cms_admin_scoped_select','cms_admin_scoped_direct_dml')) THEN RAISE EXCEPTION 'Unexpected Website & Links write policy requires review' USING ERRCODE='55000'; END IF;
  FOR p IN SELECT policyname FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=t AND policyname IN('cms_admin_scoped_all','cms_admin_scoped_direct_dml') LOOP
   EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I',p.policyname,t);
  END LOOP;
  EXECUTE pg_catalog.format('DROP POLICY IF EXISTS cms_admin_scoped_select ON public.%I',t);
  EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_select ON public.%I FOR SELECT TO authenticated USING (public.can_manage_resume(resume_id))',t);
  EXECUTE pg_catalog.format('CREATE POLICY cms_admin_scoped_direct_dml ON public.%I FOR ALL TO authenticated USING (public.can_direct_write_website_links(resume_id)) WITH CHECK (public.can_direct_write_website_links(resume_id))',t);
 END LOOP;
END $policies$;

-- The shared locale table is guarded by owned columns, not by row/domain. Other
-- still-direct domains retain their independent column path.
CREATE OR REPLACE FUNCTION cms_private.enforce_website_files_locale_write_mode()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $f$
DECLARE website_changed boolean:=false; files_changed boolean:=false;
BEGIN
  IF TG_OP='INSERT' THEN
    IF current_user<>'postgres' AND (NOT public.can_direct_write_website_links(NEW.resume_id) OR NOT public.can_direct_write_files(NEW.resume_id)) THEN RAISE EXCEPTION 'Shared locale direct writes are disabled' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  ELSIF TG_OP='DELETE' THEN
    IF current_user<>'postgres' AND (NOT public.can_direct_write_website_links(OLD.resume_id) OR NOT public.can_direct_write_files(OLD.resume_id)) THEN RAISE EXCEPTION 'Shared locale direct writes are disabled' USING ERRCODE='42501'; END IF;
    RETURN OLD;
  ELSE
    website_changed:=NEW.linkedin_label IS DISTINCT FROM OLD.linkedin_label OR NEW.linkedin_href IS DISTINCT FROM OLD.linkedin_href
      OR NEW.portfolio_label IS DISTINCT FROM OLD.portfolio_label OR NEW.updated_at_label IS DISTINCT FROM OLD.updated_at_label;
    files_changed:=NEW.portfolio_href IS DISTINCT FROM OLD.portfolio_href;
    website_changed:=website_changed OR NEW.resume_id IS DISTINCT FROM OLD.resume_id OR NEW.locale IS DISTINCT FROM OLD.locale;
    files_changed:=files_changed OR NEW.resume_id IS DISTINCT FROM OLD.resume_id OR NEW.locale IS DISTINCT FROM OLD.locale;
  END IF;
  IF current_user='postgres' THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
  IF website_changed AND (NOT public.can_direct_write_website_links(OLD.resume_id) OR NOT public.can_direct_write_website_links(NEW.resume_id)) THEN
    RAISE EXCEPTION 'Website & Links direct writes are disabled' USING ERRCODE='42501'; END IF;
  IF files_changed AND (NOT public.can_direct_write_files(OLD.resume_id) OR NOT public.can_direct_write_files(NEW.resume_id)) THEN
    RAISE EXCEPTION 'Files direct writes are disabled' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION cms_private.enforce_website_files_locale_write_mode() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS enforce_website_files_locale_write_mode ON public.resume_locale_content;
CREATE TRIGGER enforce_website_files_locale_write_mode BEFORE INSERT OR UPDATE OR DELETE ON public.resume_locale_content
FOR EACH ROW EXECUTE FUNCTION cms_private.enforce_website_files_locale_write_mode();

CREATE FUNCTION cms_private.website_links_aggregate_is_allowed(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $f$
DECLARE row jsonb; locale text; ids text[]:=ARRAY[]::text[]; positions integer[]:=ARRAY[]::integer[]; expected_position integer:=0;
BEGIN
 IF pg_catalog.jsonb_typeof(v)<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v))<>3 OR NOT(v ?& ARRAY['shared','translations','navigation'])
  OR pg_catalog.jsonb_typeof(v->'shared')<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v->'shared'))<>6
  OR NOT(v->'shared' ?& ARRAY['email','github','github_label','linkedin_display_name','email_label','linkedin_label'])
  OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(v->'shared') x WHERE pg_catalog.jsonb_typeof(x.value)<>'string')
  OR pg_catalog.jsonb_typeof(v->'translations')<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v->'translations'))<>2
  OR NOT(v->'translations' ?& ARRAY['zh','en']) OR pg_catalog.jsonb_typeof(v->'navigation')<>'array'
  OR pg_catalog.jsonb_array_length(v->'navigation')<>5 THEN RETURN false; END IF;
 FOREACH locale IN ARRAY ARRAY['zh','en'] LOOP
  row:=v->'translations'->locale;
  IF pg_catalog.jsonb_typeof(row)<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(row))<>4
   OR NOT(row ?& ARRAY['linkedin_label','linkedin_href','portfolio_label','updated_at_label'])
   OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(row) x WHERE pg_catalog.jsonb_typeof(x.value)<>'string') THEN RETURN false; END IF;
 END LOOP;
 FOR row IN SELECT value FROM pg_catalog.jsonb_array_elements(v->'navigation') LOOP
  IF pg_catalog.jsonb_typeof(row)<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(row))<>4
   OR NOT(row ?& ARRAY['navigation_item_id','position','zh','en'])
   OR pg_catalog.jsonb_typeof(row->'navigation_item_id')<>'string'
   OR (row->>'navigation_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR pg_catalog.jsonb_typeof(row->'position')<>'number' OR (row->>'position') !~ '^[0-4]$'
   OR pg_catalog.jsonb_typeof(row->'zh')<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(row->'zh'))<>1
   OR pg_catalog.jsonb_typeof(row->'zh'->'label')<>'string'
   OR pg_catalog.jsonb_typeof(row->'en')<>'object' OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(row->'en'))<>1
    OR pg_catalog.jsonb_typeof(row->'en'->'label')<>'string' THEN RETURN false; END IF;
  IF (row->>'position')::integer<>expected_position THEN RETURN false; END IF;
  ids:=pg_catalog.array_append(ids,pg_catalog.lower(row->>'navigation_item_id')); positions:=pg_catalog.array_append(positions,(row->>'position')::integer);
  expected_position:=expected_position+1;
 END LOOP;
 RETURN (SELECT count(DISTINCT x) FROM pg_catalog.unnest(ids) x)=5 AND (SELECT count(DISTINCT x) FROM pg_catalog.unnest(positions) x)=5
   AND (SELECT min(x)=0 AND max(x)=4 FROM pg_catalog.unnest(positions) x);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $f$;
REVOKE ALL ON FUNCTION cms_private.website_links_aggregate_is_allowed(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.verify_resume_d7_v1_context(target_resume_id uuid,target_domain text,canonical_body text,signed_context text,signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE ctx jsonb; key_value bytea; supplied bytea; expected bytea; now_seconds bigint; issued_seconds bigint; expires_seconds bigint; ip_value cidr; net text;
BEGIN
 BEGIN
  IF target_domain NOT IN('website_links','files') OR canonical_body IS NULL OR octet_length(convert_to(canonical_body,'UTF8'))>196608
   OR signed_context IS NULL OR octet_length(convert_to(signed_context,'UTF8'))>8192 OR signature_hex IS NULL OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid'; END IF;
  ctx:=signed_context::jsonb;
  IF jsonb_typeof(ctx) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(ctx))<>14
   OR ctx->>'context_version'<>'1' OR jsonb_typeof(ctx->'key_id') IS DISTINCT FROM 'string'
   OR ctx->>'domain'<>target_domain OR ctx->>'operation'<>'update' OR ctx->>'resume_id'<>target_resume_id::text
   OR ctx->>'actor_user_id'<>(SELECT auth.uid())::text
   OR ctx->>'request_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR ctx->>'mutation_digest'<>encode(extensions.digest(convert_to(canonical_body,'UTF8'),'sha256'),'hex')
   OR ctx->>'issued_at' !~ '^(0|[1-9][0-9]{0,11})$' OR ctx->>'expires_at' !~ '^(0|[1-9][0-9]{0,11})$'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(ctx) k WHERE k<>ALL(ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']))
   OR NOT(ctx ?& ARRAY['context_version','key_id','actor_user_id','resume_id','domain','operation','request_id','mutation_digest','issued_at','expires_at','ip_network','country_code','region','city']) THEN RAISE EXCEPTION 'invalid'; END IF;
  issued_seconds:=(ctx->>'issued_at')::bigint; expires_seconds:=(ctx->>'expires_at')::bigint; now_seconds:=floor(date_part('epoch',clock_timestamp()))::bigint;
  IF issued_seconds>now_seconds+60 OR expires_seconds<=now_seconds OR expires_seconds<=issued_seconds OR expires_seconds-issued_seconds>300 THEN RAISE EXCEPTION 'invalid'; END IF;
  IF ctx->'ip_network'<>'null'::jsonb THEN
   IF jsonb_typeof(ctx->'ip_network')<>'string' THEN RAISE EXCEPTION 'invalid'; END IF;
   net:=ctx->>'ip_network'; ip_value:=net::cidr; IF ip_value::text<>net OR NOT((family(ip_value)=4 AND masklen(ip_value)=24) OR (family(ip_value)=6 AND masklen(ip_value)=48)) THEN RAISE EXCEPTION 'invalid'; END IF;
  END IF;
  IF ctx->'country_code'<>'null'::jsonb AND (jsonb_typeof(ctx->'country_code')<>'string' OR (ctx->>'country_code') COLLATE "C" !~ '^[A-Z]{2}$') THEN RAISE EXCEPTION 'invalid'; END IF;
  IF ctx->'region'<>'null'::jsonb AND (jsonb_typeof(ctx->'region')<>'string' OR octet_length(convert_to(ctx->>'region','UTF8'))>128) THEN RAISE EXCEPTION 'invalid'; END IF;
  IF ctx->'city'<>'null'::jsonb AND (jsonb_typeof(ctx->'city')<>'string' OR octet_length(convert_to(ctx->>'city','UTF8'))>128) THEN RAISE EXCEPTION 'invalid'; END IF;
  key_value:=cms_private.activity_log_v11_key(ctx->>'key_id'); supplied:=decode(signature_hex,'hex');
  IF key_value IS NULL OR octet_length(key_value)<32 THEN RAISE EXCEPTION 'invalid'; END IF;
  expected:=extensions.hmac(convert_to(signed_context,'UTF8'),key_value,'sha256'); IF supplied<>expected THEN RAISE EXCEPTION 'invalid'; END IF;
  RETURN ctx;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid signed D-7 request' USING ERRCODE='22023'; END;
END $f$;
REVOKE ALL ON FUNCTION cms_private.verify_resume_d7_v1_context(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.activity_event_payload_v2_website_links_is_allowed(s text,e text,i text,o text,snap jsonb,ch jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $f$
BEGIN
 RETURN s='website_links' AND e='website_links_settings' AND i IS NULL AND o='update'
  AND pg_catalog.jsonb_typeof(snap)='object' AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(snap))=1 AND snap ? 'website_links'
  AND pg_catalog.jsonb_typeof(ch)='object' AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(ch))=1 AND ch ? 'website_links'
  AND pg_catalog.jsonb_typeof(ch->'website_links')='object' AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(ch->'website_links'))=2
  AND (ch->'website_links' ?& ARRAY['before','after']) AND snap->'website_links'=ch->'website_links'->'after'
  AND cms_private.website_links_aggregate_is_allowed(ch->'website_links'->'before')
  AND cms_private.website_links_aggregate_is_allowed(ch->'website_links'->'after')
  AND pg_catalog.octet_length(snap::text)+pg_catalog.octet_length(ch::text)<=655360;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $f$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_website_links_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

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
$f$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check CHECK(entity_type IN
 ('introduction_paragraph','education_entry','education_list','experience_entry','experience_list','project_entry','project_list','award_entry','award_list','skill_group','skill_group_list','contact_focus_item','contact_status_item','contact_section','public_link','profile_settings','resume_file','profile_image','website_links_settings','resume_file_set'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK(
 (payload_version=2 AND entity_id IS NULL AND operation='update' AND
  ((section_key='awards' AND entity_type='award_list') OR (section_key='experience' AND entity_type='experience_list') OR (section_key='skills' AND entity_type='skill_group_list') OR (section_key='education' AND entity_type='education_list') OR (section_key='projects' AND entity_type='project_list') OR (section_key='contact' AND entity_type='contact_section') OR (section_key='profile' AND entity_type='profile_settings') OR (section_key='website_links' AND entity_type='website_links_settings') OR (section_key='files' AND entity_type='resume_file_set'))) OR
 (payload_version=1 AND ((section_key='introduction' AND entity_type='introduction_paragraph') OR (section_key='education' AND entity_type='education_entry') OR (section_key='experience' AND entity_type='experience_entry') OR (section_key='projects' AND entity_type='project_entry') OR (section_key='awards' AND entity_type='award_entry') OR (section_key='skills' AND entity_type='skill_group') OR (section_key='contact' AND entity_type IN('contact_focus_item','contact_status_item')) OR (section_key='website_links' AND entity_type='public_link') OR (section_key='profile' AND entity_type='profile_settings') OR (section_key='files' AND entity_type IN('resume_file','profile_image')))));

CREATE FUNCTION public.load_admin_website_links_write_state(target_resume_id uuid)
RETURNS TABLE(resume_id uuid,activity_log_enabled boolean,website_links_write_mode text,website_links_trusted_context_required boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$ BEGIN
 IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id) THEN RAISE EXCEPTION 'Admin target is not authorized' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT target_resume_id,COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false),
  cms_private.get_resume_write_mode(target_resume_id,'website_links'),COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='website_links' AND r.requirement_key='trusted_network_context_v11'),false);
END $f$;
REVOKE ALL ON FUNCTION public.load_admin_website_links_write_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.load_admin_website_links_write_state(uuid) TO authenticated;

CREATE FUNCTION cms_private.website_links_aggregate(target_resume_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE result jsonb;
BEGIN
 IF (SELECT count(*) FROM public.resume_navigation_items n WHERE n.resume_id=target_resume_id)<>5
  OR EXISTS(SELECT 1 FROM public.resume_navigation_items n WHERE n.resume_id=target_resume_id AND n.position NOT BETWEEN 0 AND 4)
  OR (SELECT count(DISTINCT n.position) FROM public.resume_navigation_items n WHERE n.resume_id=target_resume_id)<>5
  OR EXISTS(SELECT 1 FROM public.resume_navigation_items n WHERE n.resume_id=target_resume_id AND (SELECT count(*) FROM public.resume_navigation_item_translations t WHERE t.resume_id=n.resume_id AND t.navigation_item_id=n.id)<>2)
  OR (SELECT count(*) FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id AND l.locale IN('zh','en'))<>2 THEN RAISE EXCEPTION 'Website & Links source structure is incomplete' USING ERRCODE='22023'; END IF;
 SELECT jsonb_build_object('shared',jsonb_build_object('email',p.email,'github',p.github,'github_label',p.github_label,'linkedin_display_name',p.linkedin_display_name,'email_label',p.email_label,'linkedin_label',p.linkedin_label),
  'translations',jsonb_build_object('zh',(SELECT jsonb_build_object('linkedin_label',l.linkedin_label,'linkedin_href',l.linkedin_href,'portfolio_label',l.portfolio_label,'updated_at_label',l.updated_at_label) FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id AND l.locale='zh'),
   'en',(SELECT jsonb_build_object('linkedin_label',l.linkedin_label,'linkedin_href',l.linkedin_href,'portfolio_label',l.portfolio_label,'updated_at_label',l.updated_at_label) FROM public.resume_locale_content l WHERE l.resume_id=target_resume_id AND l.locale='en')),
  'navigation',(SELECT jsonb_agg(jsonb_build_object('navigation_item_id',n.id,'position',n.position,'zh',jsonb_build_object('label',zh.label),'en',jsonb_build_object('label',en.label)) ORDER BY n.position)
    FROM public.resume_navigation_items n JOIN public.resume_navigation_item_translations zh ON zh.navigation_item_id=n.id AND zh.resume_id=n.resume_id AND zh.locale='zh'
    JOIN public.resume_navigation_item_translations en ON en.navigation_item_id=n.id AND en.resume_id=n.resume_id AND en.locale='en' WHERE n.resume_id=target_resume_id)) INTO result
 FROM public.resume_public_links p WHERE p.resume_id=target_resume_id;
 RETURN result;
END $f$;
REVOKE ALL ON FUNCTION cms_private.website_links_aggregate(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_resume_website_links_v1(target_resume_id uuid,canonical_website_links text,signed_context text,signature_hex text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE ctx jsonb; incoming jsonb; before_value jsonb; result_value jsonb; actor_id uuid; rid uuid; digest bytea; old_digest bytea; old_done timestamptz; old_expiry timestamptz; old_result jsonb; site_key text; nav jsonb; row_count bigint;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT t.resolved_site_key INTO site_key FROM cms_private.assert_activity_log_target(target_resume_id) t;
 IF site_key IS NULL THEN RAISE EXCEPTION 'Website & Links target is not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE;
 IF cms_private.get_resume_write_mode(target_resume_id,'website_links')<>'rpc' OR NOT COALESCE((SELECT r.enabled FROM cms_private.resume_domain_requirements r WHERE r.resume_id=target_resume_id AND r.domain_key='website_links' AND r.requirement_key='trusted_network_context_v11'),false)
   OR NOT COALESCE((SELECT c.enabled FROM cms_private.resume_capabilities c WHERE c.resume_id=target_resume_id AND c.capability_key='activity_log'),false) THEN RAISE EXCEPTION 'Secure Website & Links saving is not enabled' USING ERRCODE='42501'; END IF;
 IF canonical_website_links IS NULL OR octet_length(convert_to(canonical_website_links,'UTF8'))>65536 OR signed_context IS NULL OR octet_length(convert_to(signed_context,'UTF8'))>8192 OR signature_hex !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid Website & Links request' USING ERRCODE='22023'; END IF;
 incoming:=canonical_website_links::jsonb;
 IF NOT cms_private.website_links_aggregate_is_allowed(incoming) THEN RAISE EXCEPTION 'Invalid Website & Links aggregate' USING ERRCODE='22023'; END IF;
 ctx:=cms_private.verify_resume_d7_v1_context(target_resume_id,'website_links',canonical_website_links,signed_context,signature_hex);
 actor_id:=(ctx->>'actor_user_id')::uuid; rid:=(ctx->>'request_id')::uuid; digest:=extensions.digest(convert_to(canonical_website_links,'UTF8'),'sha256');
 before_value:=cms_private.website_links_aggregate(target_resume_id);
 IF before_value IS NULL THEN RAISE EXCEPTION 'Website & Links target is incomplete' USING ERRCODE='22023'; END IF;
 -- The fixed five rows are locked and compared by both identity and position; source_key is intentionally irrelevant.
 PERFORM 1 FROM public.resume_navigation_items n WHERE n.resume_id=target_resume_id ORDER BY n.position FOR UPDATE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(incoming->'navigation') x WHERE NOT EXISTS(SELECT 1 FROM public.resume_navigation_items n WHERE n.resume_id=target_resume_id AND n.id=(x.value->>'navigation_item_id')::uuid AND n.position=(x.value->>'position')::integer)) THEN RAISE EXCEPTION 'Navigation identity/order is fixed' USING ERRCODE='22023'; END IF;
 SELECT mutation_digest,completed_at,expires_at,result_payload INTO old_digest,old_done,old_expiry,old_result FROM cms_private.activity_log_idempotency WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='website_links' AND request_id=rid FOR UPDATE;
 IF FOUND THEN IF old_expiry<=clock_timestamp() OR old_digest<>digest THEN RAISE EXCEPTION 'Website & Links request conflicts or expired' USING ERRCODE='P13B1'; END IF; IF old_done IS NULL OR jsonb_typeof(old_result)<>'array' OR jsonb_array_length(old_result)<>1 THEN RAISE EXCEPTION 'Incomplete Website & Links idempotency' USING ERRCODE='22023'; END IF; RETURN old_result->0; END IF;
 INSERT INTO cms_private.activity_log_idempotency(actor_user_id,resume_id,domain_key,request_id,mutation_digest,created_at,expires_at) VALUES(actor_id,target_resume_id,'website_links',rid,digest,transaction_timestamp(),transaction_timestamp()+interval '7 days');
 IF before_value IS DISTINCT FROM incoming THEN
  UPDATE public.resume_public_links SET email=incoming->'shared'->>'email',github=incoming->'shared'->>'github',github_label=incoming->'shared'->>'github_label',linkedin_display_name=incoming->'shared'->>'linkedin_display_name',email_label=incoming->'shared'->>'email_label',linkedin_label=incoming->'shared'->>'linkedin_label' WHERE resume_id=target_resume_id;
  GET DIAGNOSTICS row_count=ROW_COUNT; IF row_count<>1 THEN RAISE EXCEPTION 'Website & Links singleton update failed' USING ERRCODE='22023'; END IF;
  UPDATE public.resume_locale_content l SET linkedin_label=incoming->'translations'->l.locale->>'linkedin_label',linkedin_href=incoming->'translations'->l.locale->>'linkedin_href',portfolio_label=incoming->'translations'->l.locale->>'portfolio_label',updated_at_label=incoming->'translations'->l.locale->>'updated_at_label'
   WHERE l.resume_id=target_resume_id AND l.locale IN('zh','en');
  GET DIAGNOSTICS row_count=ROW_COUNT; IF row_count<>2 THEN RAISE EXCEPTION 'Website & Links locale update failed' USING ERRCODE='22023'; END IF;
  FOR nav IN SELECT value FROM jsonb_array_elements(incoming->'navigation') LOOP
   UPDATE public.resume_navigation_item_translations t SET label=nav->'zh'->>'label' WHERE t.resume_id=target_resume_id AND t.navigation_item_id=(nav->>'navigation_item_id')::uuid AND t.locale='zh';
   GET DIAGNOSTICS row_count=ROW_COUNT; IF row_count<>1 THEN RAISE EXCEPTION 'Navigation Chinese label update failed' USING ERRCODE='22023'; END IF;
   UPDATE public.resume_navigation_item_translations t SET label=nav->'en'->>'label' WHERE t.resume_id=target_resume_id AND t.navigation_item_id=(nav->>'navigation_item_id')::uuid AND t.locale='en';
   GET DIAGNOSTICS row_count=ROW_COUNT; IF row_count<>1 THEN RAISE EXCEPTION 'Navigation English label update failed' USING ERRCODE='22023'; END IF;
  END LOOP;
  result_value:=cms_private.website_links_aggregate(target_resume_id);
  IF result_value IS DISTINCT FROM incoming OR NOT cms_private.activity_event_payload_v2_website_links_is_allowed('website_links','website_links_settings',NULL,'update',jsonb_build_object('website_links',result_value),jsonb_build_object('website_links',jsonb_build_object('before',before_value,'after',result_value))) THEN RAISE EXCEPTION 'Website & Links result validation failed' USING ERRCODE='22023'; END IF;
  INSERT INTO cms_private.activity_log_events(actor_user_id,actor_email_snapshot,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_id,entity_snapshot,changes,payload_version,ip_network,country_code,region,city)
   VALUES(actor_id,auth.jwt()->>'email',(SELECT x.resolved_role FROM cms_private.assert_activity_log_target(target_resume_id) x),target_resume_id,site_key,'update','website_links','website_links_settings',NULL,jsonb_build_object('website_links',result_value),jsonb_build_object('website_links',jsonb_build_object('before',before_value,'after',result_value)),2,(ctx->>'ip_network')::cidr,ctx->>'country_code',ctx->>'region',ctx->>'city');
 ELSE result_value:=before_value; END IF;
 UPDATE cms_private.activity_log_idempotency SET result_payload=jsonb_build_array(result_value),completed_at=transaction_timestamp() WHERE actor_user_id=actor_id AND resume_id=target_resume_id AND domain_key='website_links' AND request_id=rid;
 RETURN result_value;
END $f$;
REVOKE ALL ON FUNCTION public.save_resume_website_links_v1(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_resume_website_links_v1(uuid,text,text,text) TO authenticated;
COMMIT;
