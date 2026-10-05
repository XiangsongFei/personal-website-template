-- Transactional Contact aggregate writer. Installation does not activate a target.
BEGIN;
DO $owner_guard$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Contact writer must be installed as postgres' USING ERRCODE='42501'; END IF;
END $owner_guard$;

CREATE FUNCTION cms_private.contact_aggregate_is_allowed(target_contact jsonb, require_dense_positions boolean, allow_new_ids boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $function$
DECLARE locale_key text; collection_key text; item_value jsonb; locale_value jsonb; item_index integer; prior_position integer;
  position_value integer; expected_keys text;
BEGIN
  IF pg_catalog.jsonb_typeof(target_contact) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_contact))<>3
    OR NOT(target_contact ?& ARRAY['translations','focus','status'])
    OR pg_catalog.jsonb_typeof(target_contact->'translations') IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_contact->'translations'))<>2
    OR NOT(target_contact->'translations' ?& ARRAY['zh','en']) THEN RETURN false; END IF;
  FOREACH locale_key IN ARRAY ARRAY['zh','en'] LOOP
    locale_value:=target_contact->'translations'->locale_key;
    IF pg_catalog.jsonb_typeof(locale_value) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(locale_value))<>2
      OR NOT(locale_value ?& ARRAY['contact_label','availability'])
      OR pg_catalog.jsonb_typeof(locale_value->'contact_label') IS DISTINCT FROM 'string'
      OR pg_catalog.jsonb_typeof(locale_value->'availability') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  END LOOP;
  FOREACH collection_key IN ARRAY ARRAY['focus','status'] LOOP
    IF pg_catalog.jsonb_typeof(target_contact->collection_key) IS DISTINCT FROM 'array'
      OR pg_catalog.jsonb_array_length(target_contact->collection_key)>32 THEN RETURN false; END IF;
    item_index:=0; prior_position:=-1;
    FOR item_value IN SELECT value FROM pg_catalog.jsonb_array_elements(target_contact->collection_key) LOOP
      item_index:=item_index+1;
      expected_keys:=CASE collection_key WHEN 'focus' THEN 'en,id,position,zh' ELSE 'en,id,position,status_type,zh' END;
      IF pg_catalog.jsonb_typeof(item_value) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item_value))<>(CASE collection_key WHEN 'focus' THEN 4 ELSE 5 END)
        OR (SELECT pg_catalog.string_agg(key_name,',' ORDER BY key_name) FROM pg_catalog.jsonb_object_keys(item_value) AS k(key_name))<>expected_keys
        OR (allow_new_ids AND pg_catalog.jsonb_typeof(item_value->'id') NOT IN ('string','null'))
        OR (NOT allow_new_ids AND pg_catalog.jsonb_typeof(item_value->'id') IS DISTINCT FROM 'string')
        OR (item_value->>'id' IS NOT NULL AND (item_value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
        OR pg_catalog.jsonb_typeof(item_value->'position') IS DISTINCT FROM 'number'
        OR (item_value->>'position') !~ '^(0|[1-9][0-9]{0,8})$' THEN RETURN false; END IF;
      position_value:=(item_value->>'position')::integer;
      IF (require_dense_positions AND position_value<>item_index-1)
        OR (NOT require_dense_positions AND position_value<=prior_position) THEN RETURN false; END IF;
      prior_position:=position_value;
      IF collection_key='status' AND (item_value->>'status_type' IS NULL OR item_value->>'status_type' NOT IN ('study','graduation','open')) THEN RETURN false; END IF;
      FOREACH locale_key IN ARRAY ARRAY['zh','en'] LOOP
        locale_value:=item_value->locale_key;
        IF pg_catalog.jsonb_typeof(locale_value) IS DISTINCT FROM 'object'
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(locale_value))<>2
          OR (SELECT pg_catalog.string_agg(key_name,',' ORDER BY key_name) FROM pg_catalog.jsonb_object_keys(locale_value) AS k(key_name))<>'detail,title'
          OR pg_catalog.jsonb_typeof(locale_value->'title') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(locale_value->'detail') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(target_contact->collection_key) AS x(value) WHERE x.value->>'id' IS NOT NULL) <>
       (SELECT count(DISTINCT value->>'id') FROM pg_catalog.jsonb_array_elements(target_contact->collection_key) AS x(value) WHERE x.value->>'id' IS NOT NULL) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.contact_aggregate_is_allowed(jsonb,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION cms_private.activity_event_payload_v2_contact_is_allowed(
  target_section text,target_entity_type text,target_entity_id text,target_operation text,target_snapshot jsonb,target_changes jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $function$
DECLARE contact_change jsonb;
BEGIN
  IF target_section IS DISTINCT FROM 'contact' OR target_entity_type IS DISTINCT FROM 'contact_section'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(target_changes) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot))<>1 OR NOT(target_snapshot ? 'contact')
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes))<>1 OR NOT(target_changes ? 'contact') THEN RETURN false; END IF;
  contact_change:=target_changes->'contact';
  IF pg_catalog.jsonb_typeof(contact_change) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(contact_change))<>2
    OR NOT(contact_change ?& ARRAY['before','after'])
    OR target_snapshot->'contact' IS DISTINCT FROM contact_change->'after'
    OR NOT cms_private.contact_aggregate_is_allowed(contact_change->'before',false,false)
    OR NOT cms_private.contact_aggregate_is_allowed(contact_change->'after',true,false)
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text,'UTF8'))
      +pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text,'UTF8'))>655360 THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_contact_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_v2_is_allowed(
  target_section text,target_entity_type text,target_entity_id text,target_operation text,target_snapshot jsonb,target_changes jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''
AS $function$
  SELECT cms_private.activity_event_payload_v2_awards_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_experience_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_skills_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_education_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_projects_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_contact_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check CHECK
  (entity_type IN ('introduction_paragraph','education_entry','education_list','experience_entry','experience_list','project_entry','project_list',
    'award_entry','award_list','skill_group','skill_group_list','contact_focus_item','contact_status_item','contact_section','public_link','profile_settings','resume_file','profile_image'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK (
  (payload_version=2 AND entity_id IS NULL AND operation='update' AND
    ((section_key='awards' AND entity_type='award_list') OR (section_key='experience' AND entity_type='experience_list')
     OR (section_key='skills' AND entity_type='skill_group_list') OR (section_key='education' AND entity_type='education_list')
     OR (section_key='projects' AND entity_type='project_list') OR (section_key='contact' AND entity_type='contact_section'))) OR
  (payload_version=1 AND ((section_key='introduction' AND entity_type='introduction_paragraph')
    OR (section_key='education' AND entity_type='education_entry') OR (section_key='experience' AND entity_type='experience_entry')
    OR (section_key='projects' AND entity_type='project_entry') OR (section_key='awards' AND entity_type='award_entry')
    OR (section_key='skills' AND entity_type='skill_group') OR (section_key='contact' AND entity_type IN ('contact_focus_item','contact_status_item'))
    OR (section_key='website_links' AND entity_type='public_link') OR (section_key='profile' AND entity_type='profile_settings')
    OR (section_key='files' AND entity_type IN ('resume_file','profile_image'))))
);
COMMIT;
