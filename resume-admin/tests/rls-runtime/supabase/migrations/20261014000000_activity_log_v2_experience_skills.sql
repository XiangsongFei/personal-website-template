-- Extend Activity Log V2 only for the two frozen aggregate payload contracts.
-- The existing Awards validator remains an unchanged, separately callable branch.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Experience/Skills Activity Log V2 must be installed as postgres' USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

CREATE FUNCTION cms_private.activity_event_payload_v2_awards_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE side_value jsonb;
BEGIN
  IF target_section IS DISTINCT FROM 'awards' OR target_entity_type IS DISTINCT FROM 'award_list'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) <> 'object' OR pg_catalog.jsonb_typeof(target_changes) <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) <> 1 OR NOT (target_snapshot ? 'awards')
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) <> 1 OR NOT (target_changes ? 'awards')
    OR pg_catalog.jsonb_typeof(target_changes->'awards') <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes->'awards')) <> 2
    OR NOT (target_changes->'awards' ? 'before') OR NOT (target_changes->'awards' ? 'after')
    OR pg_catalog.jsonb_typeof(target_changes->'awards'->'before') <> 'array'
    OR pg_catalog.jsonb_typeof(target_changes->'awards'->'after') <> 'array'
    OR target_snapshot->'awards' IS DISTINCT FROM target_changes->'awards'->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text, 'UTF8'))
       + pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text, 'UTF8')) > 12000 THEN RETURN false; END IF;
  FOREACH side_value IN ARRAY ARRAY[target_changes->'awards'->'before', target_changes->'awards'->'after'] LOOP
    IF pg_catalog.jsonb_array_length(side_value) > 32 OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(side_value) WITH ORDINALITY AS entry(value,ordinal)
      WHERE pg_catalog.jsonb_typeof(entry.value) <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value)) <> 4
        OR NOT (entry.value ?& ARRAY['id','position','zh','en'])
        OR pg_catalog.jsonb_typeof(entry.value->'id') <> 'string'
        OR (entry.value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR pg_catalog.jsonb_typeof(entry.value->'position') <> 'number'
        OR (entry.value->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR (entry.value->>'position')::integer <> entry.ordinal-1
        OR pg_catalog.jsonb_typeof(entry.value->'zh') <> 'object' OR pg_catalog.jsonb_typeof(entry.value->'en') <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'zh')) <> 2
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'en')) <> 2
        OR NOT (entry.value->'zh' ?& ARRAY['name','year']) OR NOT (entry.value->'en' ?& ARRAY['name','year'])
        OR pg_catalog.jsonb_typeof(entry.value->'zh'->'name') <> 'string' OR pg_catalog.jsonb_typeof(entry.value->'zh'->'year') <> 'string'
        OR pg_catalog.jsonb_typeof(entry.value->'en'->'name') <> 'string' OR pg_catalog.jsonb_typeof(entry.value->'en'->'year') <> 'string'
        OR pg_catalog.length(entry.value->'zh'->>'name') > 200 OR pg_catalog.length(entry.value->'en'->>'name') > 200
        OR pg_catalog.length(entry.value->'zh'->>'year') > 64 OR pg_catalog.length(entry.value->'en'->>'year') > 64
    ) OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(side_value))
       <> (SELECT count(DISTINCT value->>'id') FROM pg_catalog.jsonb_array_elements(side_value) AS item(value)) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_awards_is_allowed(text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION cms_private.activity_event_payload_v2_experience_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE side_value jsonb;
BEGIN
  IF target_section IS DISTINCT FROM 'experience' OR target_entity_type IS DISTINCT FROM 'experience_list'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) <> 'object' OR pg_catalog.jsonb_typeof(target_changes) <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) <> 1 OR NOT (target_snapshot ? 'experience')
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) <> 1 OR NOT (target_changes ? 'experience')
    OR pg_catalog.jsonb_typeof(target_changes->'experience') <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes->'experience')) <> 2
    OR NOT (target_changes->'experience' ?& ARRAY['before','after'])
    OR pg_catalog.jsonb_typeof(target_changes->'experience'->'before') <> 'array'
    OR pg_catalog.jsonb_typeof(target_changes->'experience'->'after') <> 'array'
    OR target_snapshot->'experience' IS DISTINCT FROM target_changes->'experience'->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text,'UTF8'))
       + pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text,'UTF8')) > 655360 THEN RETURN false; END IF;
  FOREACH side_value IN ARRAY ARRAY[target_changes->'experience'->'before',target_changes->'experience'->'after'] LOOP
    IF pg_catalog.jsonb_array_length(side_value) > 16 OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(side_value) WITH ORDINALITY AS entry(value,ordinal)
      WHERE pg_catalog.jsonb_typeof(entry.value) <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value)) <> 4
        OR NOT (entry.value ?& ARRAY['id','position','zh','en'])
        OR pg_catalog.jsonb_typeof(entry.value->'id') <> 'string'
        OR (entry.value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR pg_catalog.jsonb_typeof(entry.value->'position') <> 'number'
        OR (entry.value->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR (entry.value->>'position')::integer <> entry.ordinal-1
        OR pg_catalog.jsonb_typeof(entry.value->'zh') <> 'object' OR pg_catalog.jsonb_typeof(entry.value->'en') <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'zh')) <> 5
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'en')) <> 5
        OR NOT (entry.value->'zh' ?& ARRAY['organization','title','period','description','location'])
        OR NOT (entry.value->'en' ?& ARRAY['organization','title','period','description','location'])
        OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(entry.value->'zh') f WHERE f.key <> ALL(ARRAY['organization','title','period','description','location'])
          OR (f.key='organization' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>64))
          OR (f.key='title' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>64))
          OR (f.key='period' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>32))
          OR (f.key='description' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>768))
          OR (f.key='location' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>64)))
        OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(entry.value->'en') f WHERE f.key <> ALL(ARRAY['organization','title','period','description','location'])
          OR (f.key='organization' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>64))
          OR (f.key='title' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>64))
          OR (f.key='period' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>32))
          OR (f.key='description' AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>768))
          OR (f.key='location' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>64)))
    ) OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(side_value))
       <> (SELECT count(DISTINCT value->>'id') FROM pg_catalog.jsonb_array_elements(side_value) AS item(value)) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_experience_is_allowed(text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION cms_private.activity_event_payload_v2_skills_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE side_value jsonb;
BEGIN
  IF target_section IS DISTINCT FROM 'skills' OR target_entity_type IS DISTINCT FROM 'skill_group_list'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) <> 'object' OR pg_catalog.jsonb_typeof(target_changes) <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) <> 1 OR NOT (target_snapshot ? 'skills')
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) <> 1 OR NOT (target_changes ? 'skills')
    OR pg_catalog.jsonb_typeof(target_changes->'skills') <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes->'skills')) <> 2
    OR NOT (target_changes->'skills' ?& ARRAY['before','after'])
    OR pg_catalog.jsonb_typeof(target_changes->'skills'->'before') <> 'array'
    OR pg_catalog.jsonb_typeof(target_changes->'skills'->'after') <> 'array'
    OR target_snapshot->'skills' IS DISTINCT FROM target_changes->'skills'->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text,'UTF8'))
       + pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text,'UTF8')) > 655360 THEN RETURN false; END IF;
  FOREACH side_value IN ARRAY ARRAY[target_changes->'skills'->'before',target_changes->'skills'->'after'] LOOP
    IF pg_catalog.jsonb_array_length(side_value) > 16 OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(side_value) WITH ORDINALITY AS entry(value,ordinal)
      WHERE pg_catalog.jsonb_typeof(entry.value) <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value)) <> 4
        OR NOT (entry.value ?& ARRAY['id','position','zh','en'])
        OR pg_catalog.jsonb_typeof(entry.value->'id') <> 'string'
        OR (entry.value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR pg_catalog.jsonb_typeof(entry.value->'position') <> 'number'
        OR (entry.value->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR (entry.value->>'position')::integer <> entry.ordinal-1
        OR pg_catalog.jsonb_typeof(entry.value->'zh') <> 'object' OR pg_catalog.jsonb_typeof(entry.value->'en') <> 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'zh')) <> 2
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'en')) <> 2
        OR NOT (entry.value->'zh' ?& ARRAY['title','items']) OR NOT (entry.value->'en' ?& ARRAY['title','items'])
        OR pg_catalog.jsonb_typeof(entry.value->'zh'->'title')<>'string' OR pg_catalog.jsonb_typeof(entry.value->'en'->'title')<>'string'
        OR pg_catalog.jsonb_typeof(entry.value->'zh'->'items')<>'string' OR pg_catalog.jsonb_typeof(entry.value->'en'->'items')<>'string'
        OR pg_catalog.octet_length(pg_catalog.convert_to(entry.value->'zh'->>'title','UTF8'))>64
        OR pg_catalog.octet_length(pg_catalog.convert_to(entry.value->'en'->>'title','UTF8'))>64
        OR pg_catalog.octet_length(pg_catalog.convert_to(entry.value->'zh'->>'items','UTF8'))>896
        OR pg_catalog.octet_length(pg_catalog.convert_to(entry.value->'en'->>'items','UTF8'))>896
    ) OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(side_value))
       <> (SELECT count(DISTINCT value->>'id') FROM pg_catalog.jsonb_array_elements(side_value) AS item(value)) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_skills_is_allowed(text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_v2_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT cms_private.activity_event_payload_v2_awards_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_experience_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_skills_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check
  CHECK (entity_type IN ('introduction_paragraph','education_entry','experience_entry','experience_list','project_entry',
    'award_entry','award_list','skill_group','skill_group_list','contact_focus_item','contact_status_item','public_link',
    'profile_settings','resume_file','profile_image'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK (
  (payload_version = 2 AND entity_id IS NULL AND operation='update' AND
    ((section_key='awards' AND entity_type='award_list') OR
     (section_key='experience' AND entity_type='experience_list') OR
     (section_key='skills' AND entity_type='skill_group_list'))) OR
  (payload_version = 1 AND (
    (section_key = 'introduction' AND entity_type = 'introduction_paragraph') OR
    (section_key = 'education' AND entity_type = 'education_entry') OR
    (section_key = 'experience' AND entity_type = 'experience_entry') OR
    (section_key = 'projects' AND entity_type = 'project_entry') OR
    (section_key = 'awards' AND entity_type = 'award_entry') OR
    (section_key = 'skills' AND entity_type = 'skill_group') OR
    (section_key = 'contact' AND entity_type IN ('contact_focus_item','contact_status_item')) OR
    (section_key = 'website_links' AND entity_type = 'public_link') OR
    (section_key = 'profile' AND entity_type = 'profile_settings') OR
    (section_key = 'files' AND entity_type IN ('resume_file','profile_image'))
  ))
);
COMMIT;
