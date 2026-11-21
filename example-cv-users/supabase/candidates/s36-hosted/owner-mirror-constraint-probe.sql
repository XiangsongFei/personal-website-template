-- This is a rollback integrity probe, not an HTTP or private business authorization test.
BEGIN;
\ir outbox-live-scope.sql
SELECT set_config('s36_test.site',:'alice_site',true),set_config('s36_test.owner',:'alice_uid',true)
\g /dev/null
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
DO $probe$
DECLARE site uuid:=current_setting('s36_test.site')::uuid; actor uuid:=current_setting('s36_test.owner')::uuid;
        affected integer;
BEGIN
 IF (SELECT count(*) FROM site_data.sites)<>2 OR (SELECT count(*) FROM auth.users)<>2
    OR NOT EXISTS(SELECT FROM site_data.sites s JOIN site_data.site_publications p ON p.site_id=s.id
      WHERE s.id=site AND s.owner_auth_user_id=actor AND s.draft_revision=5
        AND p.state='unpublished' AND p.publication_revision=5 AND p.snapshot_id IS NULL)
 THEN RAISE EXCEPTION 'OUTBOX_OWNER_MIRROR_SCOPE'; END IF;
 BEGIN
   DELETE FROM site_data.site_members WHERE site_id=site AND auth_user_id=actor AND state='active' AND role='owner';
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected<>1 THEN RAISE EXCEPTION 'OUTBOX_OWNER_MIRROR_EXPECTED_ONE'; END IF;
   SET CONSTRAINTS ALL IMMEDIATE;
   RAISE EXCEPTION 'OUTBOX_OWNER_MIRROR_INVARIANT_MISSING';
 EXCEPTION WHEN SQLSTATE '23514' THEN
   IF SQLERRM<>'owner/publication invariant' THEN RAISE; END IF;
   PERFORM set_config('s36_test.mirror_sqlstate',SQLSTATE,true);
 END;
 IF NOT EXISTS(SELECT FROM site_data.site_members WHERE site_id=site AND auth_user_id=actor
    AND state='active' AND role='owner') THEN RAISE EXCEPTION 'OUTBOX_OWNER_MIRROR_RESTORE'; END IF;
END;
$probe$;
SELECT jsonb_build_object('constraint_rejected_missing_mirror',current_setting('s36_test.mirror_sqlstate'),
 'owner_mirror_restored',true,'test_committed',false);
ROLLBACK;
