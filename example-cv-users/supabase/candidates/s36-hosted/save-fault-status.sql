BEGIN READ ONLY;
\ir publication-target.sql
SELECT jsonb_build_object(
 'function_absent',to_regprocedure('site_private.s36_test_abort_save()') IS NULL,
 'triggers_absent',NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='s36_test_abort_save'),
 'deployment_edges_clear',NOT EXISTS(SELECT FROM pg_auth_members WHERE member='postgres'::regrole AND grantor='postgres'::regrole
   AND roleid IN ('ecv_s3_integrity'::regrole,'ecv_s3_owner'::regrole)),
 'create_revoked',NOT has_schema_privilege('ecv_s3_integrity','site_private','CREATE'),
 'publish_closed',NOT has_function_privilege('authenticated','site_api.publish_site(uuid,jsonb,text)','EXECUTE')
   AND NOT has_function_privilege('authenticated','site_api.unpublish_site(uuid,jsonb,text)','EXECUTE'));
ROLLBACK;
