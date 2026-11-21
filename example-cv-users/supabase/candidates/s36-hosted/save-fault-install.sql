-- Run with the exact per-request body staged beside this file. No IF NOT EXISTS.
BEGIN;
\ir publication-target.sql
\ir save-fault-deploy-guard.sql
DO $guard$
BEGIN
  IF to_regprocedure('site_private.s36_test_abort_save()') IS NOT NULL
    OR EXISTS(SELECT FROM pg_trigger WHERE tgname='s36_test_abort_save')
    OR (SELECT relowner FROM pg_class WHERE oid='site_private.text_publication_audit'::regclass)<>'ecv_s3_owner'::regrole

  THEN RAISE EXCEPTION 'S36_FAULT_INSTALL_SCOPE'; END IF;
END;
$guard$;
GRANT ecv_s3_owner, ecv_s3_integrity TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
GRANT CREATE ON SCHEMA site_private TO ecv_s3_integrity;
\ir save-fault-bound.sql
ALTER FUNCTION site_private.s36_test_abort_save() OWNER TO ecv_s3_integrity;
REVOKE ALL ON FUNCTION site_private.s36_test_abort_save() FROM PUBLIC,anon,authenticated,authenticator,service_role;
CREATE CONSTRAINT TRIGGER s36_test_abort_save AFTER INSERT ON site_private.text_publication_audit
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 EXECUTE FUNCTION site_private.s36_test_abort_save();
REVOKE CREATE ON SCHEMA site_private FROM ecv_s3_integrity;
REVOKE ecv_s3_owner,ecv_s3_integrity FROM postgres GRANTED BY postgres RESTRICT;
\ir save-fault-catalog.sql
\ir save-fault-deploy-guard.sql
COMMIT;
