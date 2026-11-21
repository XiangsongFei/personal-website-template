-- Included after BEGIN by the publication acceptance scripts.
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $scope$
BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'postgres'
    OR current_setting('server_version_num')<>'170012'
    OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl AND version='TLSv1.3')
    OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolbypassrls)
    OR NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton
      AND project_ref='vellypyadcxkvqftsbrg' AND auth_issuer='https://vellypyadcxkvqftsbrg.supabase.co/auth/v1'
      AND enabled AND proof_verifier_ready)
    OR NOT EXISTS(SELECT FROM site_private.text_publication_runtime
      WHERE singleton AND write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
  THEN RAISE EXCEPTION 'S36_HOSTED_PUBLICATION_TARGET_MISMATCH'; END IF;
END;
$scope$;
