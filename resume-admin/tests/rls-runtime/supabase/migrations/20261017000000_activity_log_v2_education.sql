-- Add the frozen Education aggregate shape to Activity Log V2 validation.
BEGIN;
DO $owner_guard$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Education Activity Log V2 must be installed as postgres' USING ERRCODE='42501'; END IF;
END $owner_guard$;

CREATE FUNCTION cms_private.activity_event_payload_v2_education_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $function$
DECLARE side_value jsonb; item_value jsonb; locale_value jsonb;
BEGIN
  IF target_section IS DISTINCT FROM 'education' OR target_entity_type IS DISTINCT FROM 'education_list'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) IS DISTINCT FROM 'object'
    OR pg_catalog.jsonb_typeof(target_changes) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot))<>1 OR NOT(target_snapshot ? 'education')
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes))<>1 OR NOT(target_changes ? 'education')
    OR pg_catalog.jsonb_typeof(target_changes->'education') IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes->'education'))<>2
    OR NOT(target_changes->'education' ?& ARRAY['before','after'])
    OR pg_catalog.jsonb_typeof(target_changes->'education'->'before') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(target_changes->'education'->'after') IS DISTINCT FROM 'array'
    OR target_snapshot->'education' IS DISTINCT FROM target_changes->'education'->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text,'UTF8'))
      +pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text,'UTF8'))>655360 THEN RETURN false; END IF;
  FOREACH side_value IN ARRAY ARRAY[target_changes->'education'->'before',target_changes->'education'->'after'] LOOP
    IF pg_catalog.jsonb_array_length(side_value)>16 THEN RETURN false; END IF;
    FOR item_value IN SELECT value FROM pg_catalog.jsonb_array_elements(side_value) LOOP
      IF pg_catalog.jsonb_typeof(item_value) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item_value))<>6
        OR NOT(item_value ?& ARRAY['id','position','entry_type','education_category','zh','en'])
        OR pg_catalog.jsonb_typeof(item_value->'id') IS DISTINCT FROM 'string'
        OR (item_value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR pg_catalog.jsonb_typeof(item_value->'position') IS DISTINCT FROM 'number'
        OR (item_value->>'position') !~ '^(0|[1-9][0-9]*)$'
        OR pg_catalog.jsonb_typeof(item_value->'entry_type') IS DISTINCT FROM 'string'
        OR item_value->>'entry_type' NOT IN ('standard','summerSchool')
        OR (item_value->'education_category'<>'null'::jsonb AND
          (pg_catalog.jsonb_typeof(item_value->'education_category') IS DISTINCT FROM 'string'
           OR item_value->>'education_category' NOT IN ('undergraduate','graduate','doctoral','summerSchool','custom')))
        OR (item_value->'education_category'<>'null'::jsonb AND
          ((item_value->>'education_category'='summerSchool')<>(item_value->>'entry_type'='summerSchool')))
        OR pg_catalog.jsonb_typeof(item_value->'zh') IS DISTINCT FROM 'object'
        OR pg_catalog.jsonb_typeof(item_value->'en') IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item_value->'zh'))<>7
        OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(item_value->'en'))<>7
        OR NOT(item_value->'zh' ?& ARRAY['title','program','period','grade','course_title','course_description','custom_category_label'])
        OR NOT(item_value->'en' ?& ARRAY['title','program','period','grade','course_title','course_description','custom_category_label'])
      THEN RETURN false; END IF;
      FOREACH locale_value IN ARRAY ARRAY[item_value->'zh',item_value->'en'] LOOP
        IF pg_catalog.jsonb_typeof(locale_value->'title') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(locale_value->'program') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(locale_value->'period') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(locale_value->'grade') IS DISTINCT FROM 'string'
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'title','UTF8'))>256
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'program','UTF8'))>256
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'period','UTF8'))>128
          OR pg_catalog.octet_length(pg_catalog.convert_to(locale_value->>'grade','UTF8'))>256 THEN RETURN false; END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(locale_value) f WHERE
          (f.key='course_title' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>256))
          OR (f.key='course_description' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>2048))
          OR (f.key='custom_category_label' AND f.value<>'null'::jsonb AND (pg_catalog.jsonb_typeof(f.value)<>'string' OR pg_catalog.octet_length(pg_catalog.convert_to(f.value#>>'{}','UTF8'))>256))
          OR f.key NOT IN ('title','program','period','grade','course_title','course_description','custom_category_label')) THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
    IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(side_value) WITH ORDINALITY a(value,n)
      WHERE (a.value->>'position')::integer<>a.n-1)
      OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(side_value))<>
         (SELECT count(DISTINCT value->>'id') FROM pg_catalog.jsonb_array_elements(side_value) AS item(value)) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_education_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_v2_is_allowed(
  target_section text,target_entity_type text,target_entity_id text,target_operation text,target_snapshot jsonb,target_changes jsonb
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=''
AS $function$
  SELECT cms_private.activity_event_payload_v2_awards_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_experience_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_skills_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
    OR cms_private.activity_event_payload_v2_education_is_allowed(target_section,target_entity_type,target_entity_id,target_operation,target_snapshot,target_changes)
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check
  CHECK (entity_type IN ('introduction_paragraph','education_entry','education_list','experience_entry','experience_list','project_entry',
    'award_entry','award_list','skill_group','skill_group_list','contact_focus_item','contact_status_item','public_link',
    'profile_settings','resume_file','profile_image'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK (
  (payload_version=2 AND entity_id IS NULL AND operation='update' AND
    ((section_key='awards' AND entity_type='award_list') OR (section_key='experience' AND entity_type='experience_list')
     OR (section_key='skills' AND entity_type='skill_group_list') OR (section_key='education' AND entity_type='education_list'))) OR
  (payload_version=1 AND ((section_key='introduction' AND entity_type='introduction_paragraph')
    OR (section_key='education' AND entity_type='education_entry') OR (section_key='experience' AND entity_type='experience_entry')
    OR (section_key='projects' AND entity_type='project_entry') OR (section_key='awards' AND entity_type='award_entry')
    OR (section_key='skills' AND entity_type='skill_group') OR (section_key='contact' AND entity_type IN ('contact_focus_item','contact_status_item'))
    OR (section_key='website_links' AND entity_type='public_link') OR (section_key='profile' AND entity_type='profile_settings')
    OR (section_key='files' AND entity_type IN ('resume_file','profile_image'))))
);
COMMIT;
