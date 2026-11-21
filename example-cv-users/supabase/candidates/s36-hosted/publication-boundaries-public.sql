-- One rollback transaction. Administrator establishes only the two synthetic fixtures.
-- Every projection is evaluated as anon using the installed public RPC.
BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.alice_site',:'alice_site',true),
 set_config('s36_test.bob_site',:'bob_site',true),
 set_config('s36_test.old_snapshot',:'old_snapshot',true)
\g /dev/null
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
DO $fixtures$
DECLARE alice uuid:=current_setting('s36_test.alice_site')::uuid; bob uuid:=current_setting('s36_test.bob_site')::uuid;
        a text; b text;
BEGIN
 IF alice=bob OR NOT EXISTS (SELECT FROM site_data.site_publications WHERE site_id=alice AND state='published'
   AND publication_revision=4 AND snapshot_id=current_setting('s36_test.old_snapshot')::uuid)
   OR NOT EXISTS (SELECT FROM site_data.site_publications WHERE site_id=bob AND state='unpublished' AND snapshot_id IS NULL AND publication_revision=0)
   OR (SELECT count(*) FROM site_data.site_domains)<>2
 THEN RAISE EXCEPTION 'S36_PUBLIC_BOUNDARY_FIXTURE'; END IF;
 UPDATE site_data.site_domains SET state='active',verified_at=clock_timestamp()
 WHERE site_id=alice AND kind='test' AND is_primary AND state='reserved' AND verified_at IS NULL
 RETURNING hostname_normalized INTO STRICT a;
 UPDATE site_data.site_domains SET state='active',verified_at=clock_timestamp()
 WHERE site_id=bob AND kind='test' AND is_primary AND state='reserved' AND verified_at IS NULL
 RETURNING hostname_normalized INTO STRICT b;
 PERFORM set_config('s36_test.a_host',a,true);
 PERFORM set_config('s36_test.b_host',b,true);
 UPDATE site_private.text_publication_runtime SET public_read_enabled=true WHERE singleton AND NOT public_read_enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'S36_PUBLIC_BOUNDARY_GATE'; END IF;
END;
$fixtures$;
SET LOCAL ROLE anon;
DO $public$
DECLARE a text:=current_setting('s36_test.a_host'); b text:=current_setting('s36_test.b_host'); v jsonb;
        probe record;
BEGIN
 v:=public.read_public_text(a,'en');
 IF current_user<>'anon' OR (v->>'publication_revision')::integer<>4 OR v->>'hostname'<>a
 THEN RAISE EXCEPTION 'S36_PUBLIC_BOUNDARY_POSITIVE'; END IF;
 PERFORM set_config('s36_test.public_projection',v::text,true);
 FOR probe IN SELECT * FROM (VALUES (b,'en'), ('www.sites.example.test','en'), (a,'fr')) AS p(host,locale)
 LOOP
  BEGIN
   PERFORM public.read_public_text(probe.host,probe.locale);
   RAISE EXCEPTION 'S36_PUBLIC_BOUNDARY_NEGATIVE_ACCEPTED';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN
   IF SQLERRM<>'PUBLIC_NOT_FOUND' THEN RAISE; END IF;
  END;
 END LOOP;
END;
$public$;

RESET ROLE;
SAVEPOINT domain_probe;
UPDATE site_data.site_domains SET state='disabled'
 WHERE site_id=current_setting('s36_test.alice_site')::uuid AND state='active'
 RETURNING 1 AS domain_changed
\gset
SET LOCAL ROLE anon;
\ir publication-boundaries-anon-denial.sql
ROLLBACK TO domain_probe;

SAVEPOINT site_probe;
UPDATE site_data.sites SET status='deleted',deleted_at=clock_timestamp()
 WHERE id=current_setting('s36_test.alice_site')::uuid AND status='active'
 RETURNING 1 AS site_changed
\gset
SET LOCAL ROLE anon;
\ir publication-boundaries-anon-denial.sql
ROLLBACK TO site_probe;

SAVEPOINT member_probe;
DELETE FROM site_data.site_members WHERE site_id=current_setting('s36_test.alice_site')::uuid
 AND role='owner' AND state='active' RETURNING 1 AS member_changed
\gset
SET LOCAL ROLE anon;
\ir publication-boundaries-anon-denial.sql
ROLLBACK TO member_probe;

SET LOCAL ROLE anon;
DO $restored$
BEGIN
 IF public.read_public_text(current_setting('s36_test.a_host'),'en')
    IS DISTINCT FROM current_setting('s36_test.public_projection')::jsonb
 THEN RAISE EXCEPTION 'S36_PUBLIC_BOUNDARY_RESTORATION'; END IF;
END;
$restored$;
SELECT jsonb_build_object('role',current_user,'projection',current_setting('s36_test.public_projection')::jsonb,
 'denied',jsonb_build_array('bob_host_unpublished','unbound_host','bad_locale','domain_disabled','site_deleted','owner_mirror_missing'),
 'positive_restored',true,'committed_fixture',false);
ROLLBACK;
