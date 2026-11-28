-- Forward candidate after 01-resume-text.sql. The gate and RPC ACL remain closed.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $guard$
BEGIN
  IF current_user<>'postgres' OR session_user<>current_user OR
     NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolcreaterole)
  THEN RAISE EXCEPTION 'S47_CLOSED_DEPLOYER_REQUIRED'; END IF;
END;
$guard$;
GRANT ecv_s3_owner,ecv_s3_command_writer TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT FROM site_private.resume_text_runtime WHERE singleton AND NOT enabled)
     OR NOT EXISTS(SELECT FROM site_private.text_publication_runtime WHERE singleton AND NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
     OR NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND NOT enabled AND NOT proof_verifier_ready)
  THEN RAISE EXCEPTION 'S47_CLOSED_DEPLOYER_REQUIRED'; END IF;
END;
$guard$;
ALTER TABLE site_private.resume_text_revisions DROP CONSTRAINT resume_text_known_section;
ALTER TABLE site_private.resume_text_revisions ADD CONSTRAINT resume_text_known_section CHECK
  (section IN ('profile','contact','links','site-text','education','experience','projects','skills','awards'));

CREATE OR REPLACE FUNCTION site_private.resume_text_authorize(target uuid, section_key text) RETURNS record
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE who record;
BEGIN
  SELECT * INTO STRICT who FROM site_private.lock_business_qualification();
  IF NOT EXISTS (SELECT FROM site_private.resume_text_runtime WHERE singleton AND enabled)
     OR NOT EXISTS (SELECT FROM site_private.text_publication_runtime WHERE singleton AND write_enabled)
  THEN RAISE EXCEPTION 'RESUME_TEXT_DISABLED' USING ERRCODE='PT503'; END IF;
  IF section_key IS NULL OR section_key NOT IN ('profile','contact','links','site-text','education','experience','projects','skills','awards')
  THEN RAISE EXCEPTION 'SECTION_INVALID' USING ERRCODE='22023'; END IF;
  IF target IS NULL OR NOT site_private.business_site_complete(target)
  THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN who;
END;
$fn$;

CREATE OR REPLACE FUNCTION site_private.resume_text_ids(section_key text, payload jsonb)
RETURNS TABLE(record_id uuid,record_scope text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
  WITH rows AS (
    SELECT value FROM jsonb_array_elements(CASE WHEN section_key IN
      ('education','experience','projects','skills','awards') THEN payload->'entries' ELSE '[]'::jsonb END)
  )
  SELECT (item.value->>'id')::uuid, group_name
  FROM (VALUES ('focus'),('status')) AS groups(group_name)
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN section_key='contact'
    THEN payload->groups.group_name ELSE '[]'::jsonb END) AS item(value)
  UNION ALL
  SELECT (value->>'id')::uuid, 'row' FROM rows
  UNION ALL
  SELECT (item.value->>'id')::uuid, 'method:'||(rows.value->>'id')||':'||language
  FROM rows CROSS JOIN (VALUES ('zh'),('en')) AS locales(language)
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN section_key='projects'
    THEN rows.value->'methods'->locales.language ELSE '[]'::jsonb END) AS item(value);
$fn$;

REVOKE ecv_s3_owner,ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;
