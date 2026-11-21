DO $edges$
BEGIN
  IF has_schema_privilege('ecv_s3_integrity','site_private','CREATE')
    OR EXISTS(SELECT FROM pg_auth_members WHERE member='postgres'::regrole AND grantor='postgres'::regrole
      AND roleid IN ('ecv_s3_integrity'::regrole,'ecv_s3_owner'::regrole))
  THEN RAISE EXCEPTION 'S36_FAULT_DEPLOYMENT_PRIVILEGE_DRIFT'; END IF;
END;
$edges$;
