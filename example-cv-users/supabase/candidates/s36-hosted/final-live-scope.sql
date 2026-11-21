SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='3s';
DO $scope$
BEGIN
 IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'postgres'
   OR current_setting('server_version_num')<>'170012'
   OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl AND version='TLSv1.3')
   OR NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND project_ref='vellypyadcxkvqftsbrg'
        AND auth_issuer='https://vellypyadcxkvqftsbrg.supabase.co/auth/v1' AND enabled AND proof_verifier_ready)
   OR NOT EXISTS(SELECT FROM site_private.text_publication_runtime WHERE singleton AND write_enabled AND NOT outbox_enabled)
   OR (SELECT count(*) FROM site_data.sites)<>2 OR (SELECT count(*) FROM auth.users)<>2
   OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='site_data.site_members'::regclass AND tgname='members_integrity'
        AND tgfoid='site_private.assert_site_integrity()'::regprocedure AND tgenabled='O'
        AND tgconstraint<>0 AND tgdeferrable AND tginitdeferred AND tgtype=29)<>1
 THEN RAISE EXCEPTION 'S36_FINAL_SCOPE'; END IF;
END;
$scope$;
