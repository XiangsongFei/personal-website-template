BEGIN;
\ir publication-target.sql
DO $catalog$
DECLARE r record; f record; actual boolean; expected boolean;
BEGIN
 IF EXISTS (
   SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE ((n.nspname='site_private' AND p.proname LIKE 's36\_%')
      OR (n.nspname='site_api' AND p.proname IN ('read_introduction','save_text_draft','read_text_publication_operation','publish_site','unpublish_site'))
      OR (n.nspname='public' AND p.proname='read_public_text'))
     AND a.grantee=0
 ) THEN RAISE EXCEPTION 'R03_PUBLIC_EXECUTE'; END IF;
 FOR r IN SELECT oid,rolname FROM pg_roles WHERE rolname IN ('authenticated','anon','service_role','authenticator') LOOP
   IF NOT pg_has_role('postgres',r.oid,'SET')
    OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('site_data','site_private') AND c.relkind IN ('r','p','v')
       AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
    OR EXISTS (SELECT FROM pg_namespace n WHERE n.nspname IN ('site_data','site_private')
         AND has_schema_privilege(r.oid,n.oid,'USAGE,CREATE'))
   THEN RAISE EXCEPTION 'R03_EFFECTIVE_ACL %',r.rolname; END IF;
   FOR f IN SELECT p.oid,p.proname,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE (n.nspname='site_private' AND p.proname LIKE 's36\_%')
       OR (n.nspname='site_api' AND p.proname IN ('read_introduction','save_text_draft','read_text_publication_operation','publish_site','unpublish_site'))
       OR (n.nspname='public' AND p.proname='read_public_text')
   LOOP
     expected := (r.rolname='anon' AND f.nspname='public')
       OR (r.rolname='authenticated' AND f.nspname='site_api'
           AND f.proname IN ('read_introduction','save_text_draft','read_text_publication_operation'));
     actual := has_function_privilege(r.oid,f.oid,'EXECUTE');
     IF actual<>expected THEN RAISE EXCEPTION 'R03_FUNCTION_ACL % %',r.rolname,f.proname; END IF;
   END LOOP;
 END LOOP;
END;
$catalog$;
DO $roles$
DECLARE role_name text; statement text; checked int:=0;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['authenticated','anon','service_role','authenticator'] LOOP
   EXECUTE format('SET LOCAL ROLE %I',role_name);
   IF current_user<>role_name THEN RAISE EXCEPTION 'R03_ROLE_NOT_ASSUMED'; END IF;
   FOR statement IN
     SELECT unnest(ARRAY[
       'SELECT id FROM site_data.sites LIMIT 0',
       'UPDATE site_data.sites SET draft_revision=draft_revision WHERE false',
       'SELECT id FROM site_data.published_snapshots LIMIT 0',
       'SELECT id FROM site_private.operation_requests LIMIT 0',
       'UPDATE site_private.publication_outbox SET attempt_count=attempt_count WHERE false',
       'SELECT site_private.s36_history_js(NULL::uuid,0::bigint)',
       'SELECT site_api.publish_site(NULL::uuid,NULL::jsonb,NULL::text)',
       'SELECT site_api.unpublish_site(NULL::uuid,NULL::jsonb,NULL::text)'
     ] || CASE WHEN role_name<>'authenticated' THEN ARRAY[
       'SELECT site_api.read_introduction(NULL::uuid)',
       'SELECT site_api.save_text_draft(NULL::uuid,NULL::jsonb,NULL::text)',
       'SELECT site_api.read_text_publication_operation(NULL::uuid,NULL::text,NULL::jsonb,NULL::text)'
     ] ELSE ARRAY[]::text[] END || CASE WHEN role_name<>'anon' THEN ARRAY[
       'SELECT public.read_public_text(NULL::text,NULL::text)'
     ] ELSE ARRAY[]::text[] END)
   LOOP
     BEGIN
       EXECUTE statement;
       RAISE EXCEPTION 'R03_EXPECTED_DENIAL %',role_name;
     EXCEPTION WHEN insufficient_privilege THEN
       -- An application-generated BUSINESS_DENIED is not an ACL denial.
       IF SQLERRM NOT LIKE 'permission denied for %' THEN RAISE; END IF;
       checked:=checked+1;
     END;
   END LOOP;
   RESET ROLE;
 END LOOP;
 IF checked<>44 THEN RAISE EXCEPTION 'R03_COUNT %',checked; END IF;
END;
$roles$;
SELECT '{"catalog":true,"direct_denials":44,"sqlstate":"42501","roles":["authenticated","anon","service_role","authenticator"]}'::jsonb;
ROLLBACK;
