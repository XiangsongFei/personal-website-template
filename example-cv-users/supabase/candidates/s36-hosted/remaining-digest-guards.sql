BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.alice_site',:'alice_site',true) AS alice_site,
       set_config('s36_test.bob_site',:'bob_site',true) AS bob_site
\gset
DO $guard$
BEGIN
 IF (SELECT count(*) FROM site_data.sites WHERE
     (id=current_setting('s36_test.alice_site')::uuid AND draft_revision=5)
     OR (id=current_setting('s36_test.bob_site')::uuid AND draft_revision=0))<>2
   OR (SELECT count(*) FROM site_data.sites)<>2
   OR EXISTS(SELECT FROM pg_trigger WHERE tgfoid='site_private.s36_guard_material()'::regprocedure AND tgenabled<>'O')
   OR (SELECT count(*) FROM pg_trigger WHERE tgfoid='site_private.s36_guard_material()'::regprocedure AND tgtype=7)<>3
   OR pg_has_role('postgres','ecv_s3_owner','SET')
   OR pg_has_role('postgres','ecv_s3_command_writer','SET')
 THEN RAISE EXCEPTION 'R17_SCOPE'; END IF;
END;
$guard$;
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
SET LOCAL ROLE ecv_s3_owner;
GRANT INSERT ON site_data.draft_revisions,site_data.published_snapshots,site_private.text_digest_mappings TO postgres;
RESET ROLE;
GRANT ecv_s3_command_writer TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
SET LOCAL ROLE ecv_s3_command_writer;
GRANT EXECUTE ON FUNCTION site_private.s36_payload_text(jsonb),site_private.s36_json_string(text),
 site_private.s36_utf16_length(text),site_private.s36_uint(jsonb) TO postgres;
RESET ROLE;
DO $cases$
DECLARE a uuid:=current_setting('s36_test.alice_site')::uuid;
        b uuid:=current_setting('s36_test.bob_site')::uuid;
        d site_data.draft_revisions%ROWTYPE; s site_data.published_snapshots%ROWTYPE;
        m site_private.text_digest_mappings%ROWTYPE; invalid text; actual text;
BEGIN
 SELECT * INTO STRICT d FROM site_data.draft_revisions WHERE site_id=a AND site_revision=5;
 SELECT * INTO STRICT s FROM site_data.published_snapshots WHERE site_id=a AND source_draft_revision=4;
 SELECT * INTO STRICT m FROM site_private.text_digest_mappings WHERE site_id=b AND source_revision=0;
 invalid:=encode(sha256(convert_to(d.payload::text,'UTF8')),'hex');
 IF d.digest_encoding<>'js-json-stringify-v1' OR invalid=d.digest OR m.legacy_digest=m.js_digest
  OR m.canonical_payload::jsonb IS DISTINCT FROM (SELECT payload FROM site_data.draft_revisions WHERE id=m.source_draft_id)
 THEN RAISE EXCEPTION 'R17_FIXTURE'; END IF;
 BEGIN
   INSERT INTO site_data.draft_revisions SELECT d.*;
   RAISE EXCEPTION 'R17_VALID_DUPLICATE_MISSING';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 d.digest:=invalid;
 BEGIN
   INSERT INTO site_data.draft_revisions SELECT d.*;
   RAISE EXCEPTION 'R17_DRAFT_REJECT_MISSING';
 EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS actual=MESSAGE_TEXT;
   IF actual<>'HISTORY_DIGEST_MISMATCH' THEN RAISE; END IF;
 END;
 BEGIN
   INSERT INTO site_data.published_snapshots SELECT s.*;
   RAISE EXCEPTION 'R17_VALID_DUPLICATE_MISSING';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 s.digest:=encode(sha256(convert_to(s.payload::text,'UTF8')),'hex');
 BEGIN
   INSERT INTO site_data.published_snapshots SELECT s.*;
   RAISE EXCEPTION 'R17_SNAPSHOT_REJECT_MISSING';
 EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS actual=MESSAGE_TEXT;
   IF actual<>'SNAPSHOT_SOURCE_MISMATCH' THEN RAISE; END IF;
 END;
 BEGIN
   INSERT INTO site_private.text_digest_mappings SELECT m.*;
   RAISE EXCEPTION 'R17_VALID_DUPLICATE_MISSING';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 m.js_digest:=m.legacy_digest;
 BEGIN
   INSERT INTO site_private.text_digest_mappings SELECT m.*;
   RAISE EXCEPTION 'R17_MAPPING_REJECT_MISSING';
 EXCEPTION WHEN check_violation THEN
   GET STACKED DIAGNOSTICS actual=MESSAGE_TEXT;
   IF actual<>'DIGEST_MAPPING_MISMATCH' THEN RAISE; END IF;
 END;
END;
$cases$;
SELECT '{"valid_digest_controls":3,"sqlstate":"23514","rejections":["HISTORY_DIGEST_MISMATCH","SNAPSHOT_SOURCE_MISMATCH","DIGEST_MAPPING_MISMATCH"]}'::jsonb;
ROLLBACK;
