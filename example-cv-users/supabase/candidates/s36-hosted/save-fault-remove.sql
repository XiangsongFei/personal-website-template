BEGIN;
\ir publication-target.sql
\ir save-fault-deploy-guard.sql
GRANT ecv_s3_owner, ecv_s3_integrity TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres;
LOCK TABLE site_private.text_publication_audit IN ACCESS EXCLUSIVE MODE;
-- Hold the table lock while checking trigger identity and removing the pair.
\ir save-fault-catalog.sql
DROP TRIGGER s36_test_abort_save ON site_private.text_publication_audit RESTRICT;
DROP FUNCTION site_private.s36_test_abort_save() RESTRICT;
REVOKE ecv_s3_owner,ecv_s3_integrity FROM postgres GRANTED BY postgres RESTRICT;
\ir save-fault-deploy-guard.sql
COMMIT;
