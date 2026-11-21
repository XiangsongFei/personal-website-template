-- psql variable: expected_02 (true or false). Both closed catalog phases use READ ONLY.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir publication-target.sql
SELECT set_config('s36_test.expected_02',:'expected_02',true) AS expected
\gset
DO $catalog$
DECLARE worker oid:=to_regrole('ecv_s36_outbox_worker');
        expected boolean:=current_setting('s36_test.expected_02')::boolean;
BEGIN
  IF expected IS DISTINCT FROM (worker IS NOT NULL)
    OR NOT EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
    OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolcreaterole)
    OR EXISTS(SELECT FROM pg_roles WHERE left(rolname,10)='cli_login_')
    OR EXISTS(SELECT FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname<>'postgres' AND pg_has_role(r.oid,'postgres','MEMBER'))
    OR (SELECT count(*) FROM pg_class c WHERE c.oid IN ('site_data.site_publications'::regclass,'site_data.published_snapshots'::regclass,
      'site_private.publication_outbox'::regclass,'site_private.publication_revisions'::regclass,
      'site_private.text_publication_audit'::regclass,'site_private.text_publication_runtime'::regclass)
      AND c.relowner='ecv_s3_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity)<>6
    OR EXISTS(SELECT FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator','service_role')
      AND (has_function_privilege(r.oid,'site_api.publish_site(uuid,jsonb,text)','EXECUTE')
        OR has_function_privilege(r.oid,'site_api.unpublish_site(uuid,jsonb,text)','EXECUTE')))
    OR NOT pg_has_role('postgres','anon','SET')
    OR NOT has_function_privilege('anon','public.read_public_text(text,text)','EXECUTE')
  THEN RAISE EXCEPTION 'S36_PUBLICATION_CLOSED_CATALOG'; END IF;
  IF expected AND (
    NOT EXISTS(SELECT FROM pg_roles WHERE oid=worker
      AND NOT (rolcanlogin OR rolsuper OR rolinherit OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
    OR (SELECT count(*) FROM pg_auth_members WHERE roleid=worker)<>1
    OR EXISTS(SELECT FROM pg_auth_members WHERE roleid=worker
      AND (member<>'postgres'::regrole OR grantor<>10 OR NOT admin_option OR inherit_option OR set_option))
    OR has_schema_privilege(worker,'site_private','CREATE')
    OR has_table_privilege(worker,'site_private.publication_outbox','UPDATE')
    OR has_table_privilege(worker,'site_data.site_publications','UPDATE')
    OR NOT has_column_privilege(worker,'site_private.publication_outbox','lease_generation','UPDATE')
    OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='site_private' AND p.proowner=worker)<>11
    OR EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.proowner=worker AND a.grantee<>worker)
    OR (SELECT count(*) FROM pg_policy WHERE worker=ANY(polroles))<>4
    OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='site_private.publication_outbox'::regclass
      AND tgname IN ('s36_outbox_guard','s36_outbox_no_truncate') AND tgenabled='O')<>2)
  THEN RAISE EXCEPTION 'S36_OUTBOX_CLOSED_CATALOG'; END IF;
END;
$catalog$;
SELECT jsonb_build_object('project','vellypyadcxkvqftsbrg','closed_02_check',current_setting('s36_test.expected_02')::boolean);
ROLLBACK;
