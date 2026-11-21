SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='3s';
DO $scope$
BEGIN
 IF session_user<>'postgres' OR current_user<>session_user OR current_database()<>'postgres'
   OR current_setting('server_version_num')<>'170012'
   OR NOT EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl AND version='TLSv1.3')
   OR NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND project_ref='vellypyadcxkvqftsbrg'
                AND auth_issuer='https://vellypyadcxkvqftsbrg.supabase.co/auth/v1')
   OR NOT EXISTS(SELECT FROM site_private.text_publication_runtime WHERE singleton AND NOT public_read_enabled)
   OR has_function_privilege('authenticated','site_api.publish_site(uuid,jsonb,text)','EXECUTE')
   OR has_function_privilege('authenticated','site_api.unpublish_site(uuid,jsonb,text)','EXECUTE')
   OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='ecv_s36_outbox_worker'
     AND NOT (rolcanlogin OR rolinherit OR rolbypassrls OR rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication))
 THEN RAISE EXCEPTION 'S36_OUTBOX_LIVE_SCOPE'; END IF;
END;
$scope$;
