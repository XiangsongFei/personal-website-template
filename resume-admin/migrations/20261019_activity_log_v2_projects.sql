-- Add the bounded Projects aggregate shape to Activity Log V2.
BEGIN;
DO $owner_guard$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Projects Activity Log V2 must be installed as postgres' USING ERRCODE='42501'; END IF;
END $owner_guard$;

CREATE FUNCTION cms_private.activity_event_payload_v2_projects_is_allowed(
  target_section text,target_entity_type text,target_entity_id text,target_operation text,target_snapshot jsonb,target_changes jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $function$
DECLARE side_value jsonb; project_value jsonb; locale_value jsonb; method_value jsonb; locale_key text;
  side_index integer:=0; project_index integer; method_index integer;
  project_position integer; prior_project_position integer;
  method_position integer; prior_method_position integer;
BEGIN
  IF target_section IS DISTINCT FROM 'projects' OR target_entity_type IS DISTINCT FROM 'project_list'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(target_changes) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot))<>1 OR NOT(target_snapshot ? 'projects')
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes))<>1 OR NOT(target_changes ? 'projects')
    OR pg_catalog.jsonb_typeof(target_changes->'projects') IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes->'projects'))<>2
    OR NOT(target_changes->'projects' ?& ARRAY['before','after'])
    OR pg_catalog.jsonb_typeof(target_changes->'projects'->'before') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(target_changes->'projects'->'after') IS DISTINCT FROM 'array'
    OR target_snapshot->'projects' IS DISTINCT FROM target_changes->'projects'->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text,'UTF8'))
      +pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text,'UTF8'))>655360 THEN RETURN false; END IF;
  FOREACH side_value IN ARRAY ARRAY[target_changes->'projects'->'before',target_changes->'projects'->'after'] LOOP
    side_index:=side_index+1; project_index:=0; prior_project_position:=-1;
    IF pg_catalog.jsonb_array_length(side_value)>16 THEN RETURN false; END IF;
    FOR project_value IN SELECT value FROM pg_catalog.jsonb_array_elements(side_value) LOOP
      project_index:=project_index+1; project_position:=(project_value->>'position')::integer;
      IF pg_catalog.jsonb_typeof(project_value) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(project_value))<>5
        OR NOT(project_value ?& ARRAY['id','position','zh','en','methods'])
        OR pg_catalog.jsonb_typeof(project_value->'id') IS DISTINCT FROM 'string'
        OR (project_value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR pg_catalog.jsonb_typeof(project_value->'position') IS DISTINCT FROM 'number'
        OR (project_value->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR (side_index=2 AND project_position<>project_index-1) OR (side_index=1 AND project_position<=prior_project_position)
        OR pg_catalog.jsonb_typeof(project_value->'methods') IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(project_value->'methods'))<>2
        OR NOT(project_value->'methods' ?& ARRAY['zh','en']) THEN RETURN false; END IF;
      FOREACH locale_key IN ARRAY ARRAY['zh','en'] LOOP
        locale_value:=project_value->locale_key;
        IF pg_catalog.jsonb_typeof(locale_value) IS DISTINCT FROM 'object'
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(locale_value))<>5
          OR NOT(locale_value ?& ARRAY['title','subtitle','period','description','href'])
          OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(locale_value) f WHERE
            f.key NOT IN ('title','subtitle','period','description','href') OR pg_catalog.jsonb_typeof(f.value) IS DISTINCT FROM 'string'
            OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>CASE f.key
              WHEN 'title' THEN 2048 WHEN 'subtitle' THEN 2048 WHEN 'period' THEN 1024 WHEN 'description' THEN 16384 ELSE 2048 END) THEN RETURN false; END IF;
        method_index:=0; prior_method_position:=-1;
        IF pg_catalog.jsonb_typeof(project_value->'methods'->locale_key) IS DISTINCT FROM 'array'
          OR pg_catalog.jsonb_array_length(project_value->'methods'->locale_key)>64 THEN RETURN false; END IF;
        FOR method_value IN SELECT value FROM pg_catalog.jsonb_array_elements(project_value->'methods'->locale_key) LOOP
          method_index:=method_index+1; method_position:=(method_value->>'position')::integer;
          IF pg_catalog.jsonb_typeof(method_value) IS DISTINCT FROM 'object'
            OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(method_value))<>3
            OR NOT(method_value ?& ARRAY['id','position','value'])
            OR pg_catalog.jsonb_typeof(method_value->'id') IS DISTINCT FROM 'string'
            OR (method_value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR pg_catalog.jsonb_typeof(method_value->'position') IS DISTINCT FROM 'number'
            OR (method_value->>'position') !~ '^(0|[1-9][0-9]*)$'
            OR (side_index=2 AND method_position<>method_index-1) OR (side_index=1 AND method_position<=prior_method_position)
            OR pg_catalog.jsonb_typeof(method_value->'value') IS DISTINCT FROM 'string'
            OR pg_catalog.octet_length(pg_catalog.convert_to(method_value->>'value','UTF8'))>2048 THEN RETURN false; END IF;
          prior_method_position:=method_position;
        END LOOP;
        IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(project_value->'methods'->locale_key))<>
             (SELECT count(DISTINCT value->>'id') FROM pg_catalog.jsonb_array_elements(project_value->'methods'->locale_key) AS m(value)) THEN RETURN false; END IF;
      END LOOP;
      prior_project_position:=project_position;
    END LOOP;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(side_value))<>
         (SELECT count(DISTINCT value->>'id') FROM pg_catalog.jsonb_array_elements(side_value) AS p(value)) THEN RETURN false; END IF;
    IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(side_value) p(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(p.value->'methods'->'zh') z(value)
      JOIN LATERAL pg_catalog.jsonb_array_elements(p.value->'methods'->'en') e(value)
        ON z.value->>'id'=e.value->>'id') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_projects_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_v2_is_allowed(
  target_section text,target_entity_type text,target_entity_id text,target_operation text,target_snapshot jsonb,target_changes jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''
AS $function$
  SELECT cms_private.activity_event_payload_v2_awards_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_experience_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_skills_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_education_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_projects_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check
  CHECK (entity_type IN ('introduction_paragraph','education_entry','education_list','experience_entry','experience_list','project_entry','project_list',
    'award_entry','award_list','skill_group','skill_group_list','contact_focus_item','contact_status_item','public_link','profile_settings','resume_file','profile_image'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK (
  (payload_version=2 AND entity_id IS NULL AND operation='update' AND
    ((section_key='awards' AND entity_type='award_list') OR (section_key='experience' AND entity_type='experience_list')
     OR (section_key='skills' AND entity_type='skill_group_list') OR (section_key='education' AND entity_type='education_list')
     OR (section_key='projects' AND entity_type='project_list'))) OR
  (payload_version=1 AND ((section_key='introduction' AND entity_type='introduction_paragraph')
    OR (section_key='education' AND entity_type='education_entry') OR (section_key='experience' AND entity_type='experience_entry')
    OR (section_key='projects' AND entity_type='project_entry') OR (section_key='awards' AND entity_type='award_entry')
    OR (section_key='skills' AND entity_type='skill_group') OR (section_key='contact' AND entity_type IN ('contact_focus_item','contact_status_item'))
    OR (section_key='website_links' AND entity_type='public_link') OR (section_key='profile' AND entity_type='profile_settings')
    OR (section_key='files' AND entity_type IN ('resume_file','profile_image'))))
);
COMMIT;
