-- Activity Log payload v2 is additive. Historical v1 validation remains the
-- authority for every existing event; v2 is restricted to Awards collections.
BEGIN;

DO $owner_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Activity Log collection v2 must be installed as postgres' USING ERRCODE = '42501';
  END IF;
END
$owner_guard$;

CREATE FUNCTION cms_private.activity_event_payload_v2_is_allowed(
  target_section text, target_entity_type text, target_entity_id text,
  target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $function$
DECLARE side_value jsonb;
BEGIN
  IF target_section IS DISTINCT FROM 'awards' OR target_entity_type IS DISTINCT FROM 'award_list'
    OR target_entity_id IS NOT NULL OR target_operation IS DISTINCT FROM 'update'
    OR pg_catalog.jsonb_typeof(target_snapshot) <> 'object'
    OR pg_catalog.jsonb_typeof(target_changes) <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) <> 1
    OR NOT (target_snapshot ? 'awards')
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes)) <> 1
    OR NOT (target_changes ? 'awards')
    OR pg_catalog.jsonb_typeof(target_changes->'awards') <> 'object'
    OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_changes->'awards')) <> 2
    OR NOT (target_changes->'awards' ? 'before')
    OR NOT (target_changes->'awards' ? 'after')
    OR pg_catalog.jsonb_typeof(target_changes->'awards'->'before') <> 'array'
    OR pg_catalog.jsonb_typeof(target_changes->'awards'->'after') <> 'array'
    OR target_snapshot->'awards' IS DISTINCT FROM target_changes->'awards'->'after'
    OR pg_catalog.octet_length(pg_catalog.convert_to(target_snapshot::text, 'UTF8'))
       + pg_catalog.octet_length(pg_catalog.convert_to(target_changes::text, 'UTF8')) > 12000 THEN
    RETURN false;
  END IF;
  FOREACH side_value IN ARRAY ARRAY[target_changes->'awards'->'before', target_changes->'awards'->'after'] LOOP
    IF pg_catalog.jsonb_array_length(side_value) > 32
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(side_value) WITH ORDINALITY AS entry(value, ordinal)
        WHERE pg_catalog.jsonb_typeof(entry.value) <> 'object'
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value)) <> 4
          OR NOT (entry.value ? 'id') OR NOT (entry.value ? 'position')
          OR NOT (entry.value ? 'zh') OR NOT (entry.value ? 'en')
          OR pg_catalog.jsonb_typeof(entry.value->'id') <> 'string'
          OR (entry.value->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR pg_catalog.jsonb_typeof(entry.value->'position') <> 'number'
          OR (entry.value->>'position') !~ '^(0|[1-9][0-9]*)$'
          OR (entry.value->>'position')::integer <> entry.ordinal - 1
          OR pg_catalog.jsonb_typeof(entry.value->'zh') <> 'object'
          OR pg_catalog.jsonb_typeof(entry.value->'en') <> 'object'
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'zh')) <> 2
          OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(entry.value->'en')) <> 2
          OR NOT (entry.value->'zh' ? 'name') OR NOT (entry.value->'zh' ? 'year')
          OR NOT (entry.value->'en' ? 'name') OR NOT (entry.value->'en' ? 'year')
          OR pg_catalog.jsonb_typeof(entry.value->'zh'->'name') <> 'string'
          OR pg_catalog.jsonb_typeof(entry.value->'zh'->'year') <> 'string'
          OR pg_catalog.jsonb_typeof(entry.value->'en'->'name') <> 'string'
          OR pg_catalog.jsonb_typeof(entry.value->'en'->'year') <> 'string'
          OR pg_catalog.length(entry.value->'zh'->>'name') > 200
          OR pg_catalog.length(entry.value->'zh'->>'year') > 64
          OR pg_catalog.length(entry.value->'en'->>'name') > 200
          OR pg_catalog.length(entry.value->'en'->>'year') > 64
      )
      OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(side_value))
         <> (SELECT count(DISTINCT entry.value->>'id') FROM pg_catalog.jsonb_array_elements(side_value) AS entry(value)) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_v2_is_allowed(text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION cms_private.activity_event_payload_version_is_allowed(
  target_version smallint, target_section text, target_entity_type text,
  target_entity_id text, target_operation text, target_snapshot jsonb, target_changes jsonb
)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $function$
  SELECT CASE target_version
    WHEN 1 THEN target_entity_type IS DISTINCT FROM 'award_list'
      AND cms_private.activity_event_payload_is_allowed(target_entity_type, target_snapshot, target_changes)
    WHEN 2 THEN cms_private.activity_event_payload_v2_is_allowed(target_section, target_entity_type,
      target_entity_id, target_operation, target_snapshot, target_changes)
    ELSE false
  END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_event_payload_version_is_allowed(smallint,text,text,text,text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_payload_version_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_payload_version_check
  CHECK (payload_version IN (1,2));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_entity_type_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_events_entity_type_check
  CHECK (entity_type IN ('introduction_paragraph','education_entry','experience_entry','project_entry',
    'award_entry','award_list','skill_group','contact_focus_item','contact_status_item','public_link',
    'profile_settings','resume_file','profile_image'));
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_entity_section_check CHECK (
  (payload_version = 2 AND section_key = 'awards' AND entity_type = 'award_list'
    AND entity_id IS NULL AND operation = 'update') OR
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
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_payload_allowlist_check;
ALTER TABLE cms_private.activity_log_events ADD CONSTRAINT activity_log_payload_allowlist_check CHECK (
  cms_private.activity_event_payload_version_is_allowed(payload_version, section_key, entity_type,
    entity_id, operation, entity_snapshot, changes)
);

COMMIT;
