-- Before and after snapshots must be taken on independent Unix-socket connections to s36_rebuild.
-- For R02 compare the complete result. For R06 compare m3_rows and m3_pointer across the successful 01 installation.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
DO $guard$
BEGIN
 IF current_database()<>'s36_rebuild' OR inet_server_addr() IS NOT NULL OR session_user<>'postgres'
   OR current_user<>session_user
   OR current_setting('server_version_num')<>'170012'
   OR current_setting('unix_socket_directories') NOT IN ('/private/var/tmp/s36-rebuild/socket','"/private/var/tmp/s36-rebuild/socket"')
   OR current_setting('port')<>'55436'
   OR NOT EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
   OR NOT EXISTS(SELECT FROM site_data.draft_revisions WHERE site_revision=0)
 THEN RAISE EXCEPTION 'S36_REHEARSAL_TARGET'; END IF;
END;
$guard$;
SELECT jsonb_build_object(
 'm3_rows',(SELECT coalesce(jsonb_agg(to_jsonb(d)-'digest_encoding'-'previous_revision' ORDER BY d.id),'[]')
   FROM site_data.draft_revisions d WHERE d.site_revision=0),
 'm3_legacy_digest_matches',(SELECT bool_and(d.digest=encode(sha256(convert_to(d.payload::text,'UTF8')),'hex'))
   FROM site_data.draft_revisions d WHERE d.site_revision=0),
 'm3_pointer',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY site_id),'[]') FROM site_data.site_publications p),
 'm3_pointer_closed',(SELECT bool_and(publication_revision=0 AND state='unpublished' AND snapshot_id IS NULL)
   FROM site_data.site_publications),
 'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY rolname),'[]') FROM pg_roles r WHERE rolname LIKE 'ecv\_%'),
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor),'[]')
   FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname LIKE 'ecv\_%'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity)
    ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('site_private','site_api','site_data')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.atttypid,a.attnotnull,a.attacl,
     pg_get_expr(d.adbin,d.adrelid)) ORDER BY n.nspname,c.relname,a.attnum)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
   LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
   WHERE n.nspname IN ('site_private','site_api','site_data') AND a.attnum>0 AND NOT a.attisdropped),
 'functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.oid::regprocedure::text,p.proowner,p.proacl,p.prosecdef,p.proconfig,
     md5(pg_get_functiondef(p.oid))) ORDER BY n.nspname,p.oid::regprocedure::text)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f'
    AND (n.nspname IN ('site_private','site_api','site_data') OR (n.nspname='public' AND p.proname='read_public_text'))),
 'schemas',(SELECT jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl) ORDER BY nspname) FROM pg_namespace
   WHERE nspname IN ('site_private','site_api','site_data','public')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p
    WHERE schemaname IN ('site_private','site_api','site_data')),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid))
     ORDER BY n.nspname,c.relname,t.tgname)
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('site_private','site_api','site_data') AND NOT t.tgisinternal),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid))
     ORDER BY n.nspname,c.relname,k.conname)
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('site_private','site_api','site_data')),
 'runtime_exists',to_regclass('site_private.text_publication_runtime') IS NOT NULL);
ROLLBACK;
