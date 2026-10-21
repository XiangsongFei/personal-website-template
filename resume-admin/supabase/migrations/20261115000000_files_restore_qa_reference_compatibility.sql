-- Forward-only historical Files reference compatibility; no capability or authorization changes.
BEGIN;
DO $owner_guard$
DECLARE signature text; function_id oid;
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Files compatibility migration requires postgres' USING ERRCODE='42501'; END IF;
  FOREACH signature IN ARRAY ARRAY[
    'cms_private.files_historical_reference_is_allowed(text,uuid,text,text,text)',
    'cms_private.files_restore_source(uuid,uuid,text,uuid)'
  ] LOOP
    function_id := pg_catalog.to_regprocedure(signature);
    IF function_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner
      WHERE p.oid=function_id AND r.rolname=current_user AND p.prosecdef
    ) THEN RAISE EXCEPTION 'Expected existing private function owner and security mode' USING ERRCODE='42501'; END IF;
  END LOOP;
END
$owner_guard$;
-- Existing function identities, owners and ACLs are retained by CREATE OR REPLACE.
-- The old QA identifier remains a reference-format compatibility case only.
-- Current target authorization and Restore capability checks remain in the public callers.
CREATE OR REPLACE FUNCTION cms_private.files_historical_reference_is_allowed(
  target_origin text, target_resume_id uuid, target_site_key text, target_locale text, target_reference text
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $function$
DECLARE expected_prefix text; reference_path text; query_part text;
BEGIN
  IF target_origin IS NULL OR target_resume_id IS NULL OR target_locale IS NULL OR target_locale NOT IN ('zh','en')
    OR target_reference IS NULL OR target_origin !~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
    OR target_reference ~ '[#%\\]' THEN RETURN false; END IF;
  IF target_site_key IN ('example-cv-qa', 'example-cv-qa-activity-log') THEN expected_prefix := target_resume_id::text;
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

CREATE OR REPLACE FUNCTION cms_private.files_restore_source(
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
  IF site_key IN ('example-cv-qa', 'example-cv-qa-activity-log') THEN
    object_name := target_resume_id::text || '/resume_' || target_locale || '.pdf';
  ELSE object_name := 'example-cv/resume_' || target_locale || '.pdf'; END IF;
  RETURN QUERY SELECT reference_value, after_value->'translations'->target_locale->>'portfolio_href', object_name;
END
$function$;

COMMIT;
