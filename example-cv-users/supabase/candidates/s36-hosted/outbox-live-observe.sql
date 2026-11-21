BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir outbox-live-scope.sql
SELECT jsonb_build_object(
 'outbox_enabled',(SELECT outbox_enabled FROM site_private.text_publication_runtime WHERE singleton),
 'worker_login',(
  SELECT jsonb_build_object('attributes',ARRAY[r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls],
   'limit',r.rolconnlimit,'valid',r.rolvaliduntil>clock_timestamp() AND r.rolvaliduntil<=clock_timestamp()+interval '10 minutes',
   'mark',shobj_description(r.oid,'pg_authid'),
   'set_only',pg_has_role(r.oid,'ecv_s36_outbox_worker','SET') AND NOT pg_has_role(r.oid,'ecv_s36_outbox_worker','USAGE'),
   'own_memberships',(SELECT count(*) FROM pg_auth_members WHERE member=r.oid),
   'edge',(SELECT jsonb_build_array(admin_option,inherit_option,set_option) FROM pg_auth_members
     WHERE member=r.oid AND roleid='ecv_s36_outbox_worker'::regrole AND grantor='postgres'::regrole))
  FROM pg_roles r WHERE r.rolname=:'login'),
 'sessions',(SELECT coalesce(jsonb_agg(pid ORDER BY pid),'[]') FROM pg_stat_activity WHERE usename=:'login'),
 'worker_edges',(SELECT count(*) FROM pg_auth_members WHERE roleid='ecv_s36_outbox_worker'::regrole),
 'pointer',(SELECT jsonb_build_object('publication_revision',publication_revision,'state',state) FROM site_data.site_publications
   WHERE site_id=:'alice_site'::uuid AND snapshot_id IS NULL),
 'events',(SELECT jsonb_agg(to_jsonb(o) ORDER BY publication_revision) FROM site_private.publication_outbox o),
 'clock',floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
ROLLBACK;
