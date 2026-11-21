-- Separate approval required. psql variables: action (enable or close), alice_site, bob_site.
BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.acl_action',:'action',true) AS action,
       set_config('s36_test.alice_site',:'alice_site',true) AS alice_site,
       set_config('s36_test.bob_site',:'bob_site',true) AS bob_site
\gset
DO $before$
DECLARE action text:=current_setting('s36_test.acl_action');
BEGIN
  IF action NOT IN ('enable','close') OR to_regrole('ecv_s36_outbox_worker') IS NULL
    OR EXISTS(SELECT FROM pg_roles WHERE left(rolname,10)='cli_login_')
    OR EXISTS(SELECT FROM pg_auth_members
      WHERE roleid='ecv_s3_command_writer'::regrole AND (member<>'postgres'::regrole OR grantor<>10 OR NOT admin_option OR inherit_option OR set_option))
  THEN RAISE EXCEPTION 'S36_PUBLICATION_ACL_SCOPE'; END IF;
  IF action='enable' AND (
     current_setting('s36_test.alice_site')::uuid=current_setting('s36_test.bob_site')::uuid
     OR (SELECT count(*) FROM site_data.sites)<>2 OR (SELECT count(*) FROM auth.users)<>2
     OR NOT EXISTS(SELECT FROM site_data.sites s WHERE s.id=current_setting('s36_test.alice_site')::uuid AND draft_revision=4 AND status='active')
     OR NOT EXISTS(SELECT FROM site_data.sites s WHERE s.id=current_setting('s36_test.bob_site')::uuid AND draft_revision=0 AND status='active')
     OR (SELECT count(*) FROM site_data.site_publications WHERE state='unpublished' AND publication_revision=0 AND snapshot_id IS NULL)<>2
     OR (SELECT count(*) FROM site_private.operation_requests WHERE operation='save_text_draft' AND state='succeeded')<>4
     OR (SELECT count(*) FROM site_private.text_publication_audit)<>4
     OR EXISTS(SELECT FROM site_data.published_snapshots) OR EXISTS(SELECT FROM site_private.publication_outbox)
     OR EXISTS(SELECT FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator','service_role')
       AND (has_function_privilege(r.oid,'site_api.publish_site(uuid,jsonb,text)','EXECUTE')
         OR has_function_privilege(r.oid,'site_api.unpublish_site(uuid,jsonb,text)','EXECUTE'))))
  THEN RAISE EXCEPTION 'S36_PUBLICATION_BASELINE_CHANGED'; END IF;
END;
$before$;
GRANT ecv_s3_command_writer TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
SET LOCAL ROLE ecv_s3_command_writer;
DO $acl$
BEGIN
  IF current_setting('s36_test.acl_action')='enable' THEN
    GRANT EXECUTE ON FUNCTION site_api.publish_site(uuid,jsonb,text),site_api.unpublish_site(uuid,jsonb,text) TO authenticated;
  ELSE
    REVOKE EXECUTE ON FUNCTION site_api.publish_site(uuid,jsonb,text),site_api.unpublish_site(uuid,jsonb,text) FROM authenticated;
  END IF;
END;
$acl$;
RESET ROLE;
REVOKE ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;
DO $after$
DECLARE enabled boolean:=current_setting('s36_test.acl_action')='enable';
BEGIN
  IF has_function_privilege('authenticated','site_api.publish_site(uuid,jsonb,text)','EXECUTE')<>enabled
    OR has_function_privilege('authenticated','site_api.unpublish_site(uuid,jsonb,text)','EXECUTE')<>enabled
    OR EXISTS(SELECT FROM pg_roles r WHERE r.rolname IN ('anon','authenticator','service_role')
       AND (has_function_privilege(r.oid,'site_api.publish_site(uuid,jsonb,text)','EXECUTE')
         OR has_function_privilege(r.oid,'site_api.unpublish_site(uuid,jsonb,text)','EXECUTE')))
    OR NOT has_function_privilege('authenticated','site_api.save_text_draft(uuid,jsonb,text)','EXECUTE')
    OR pg_has_role('postgres','ecv_s3_command_writer','SET')
    OR pg_has_role('postgres','ecv_s3_command_writer','USAGE')
  THEN RAISE EXCEPTION 'S36_PUBLICATION_ACL_POSTCONDITION'; END IF;
END;
$after$;
COMMIT;
