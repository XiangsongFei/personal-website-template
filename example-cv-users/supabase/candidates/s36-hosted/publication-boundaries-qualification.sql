-- Operator fixture changes on exactly one admitted site, account or fresh generation.
-- Database ownership is used for setup only. Real signed business requests judge access.
BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.mode',:'mode',true),
 set_config('s36_test.uid',:'uid',true),set_config('s36_test.site',:'site',true),
 set_config('s36_test.sid',:'sid',true),set_config('s36_test.grant',:'grant_id',true),
 set_config('s36_test.key',:'key_id',true)
\g /dev/null
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
DO $mutation$
DECLARE mode text:=current_setting('s36_test.mode'); uid uuid:=current_setting('s36_test.uid')::uuid;
 sid uuid:=current_setting('s36_test.sid')::uuid; target uuid:=current_setting('s36_test.site')::uuid;
 grant_id uuid:=current_setting('s36_test.grant')::uuid; bound_key text:=current_setting('s36_test.key');
 affected integer;
BEGIN
 IF (SELECT count(*) FROM auth.users)<>2 OR (SELECT count(*) FROM site_data.sites)<>2
    OR EXISTS(SELECT FROM site_data.site_publications WHERE state<>'unpublished' OR snapshot_id IS NOT NULL)
    OR NOT EXISTS(SELECT FROM site_data.sites s JOIN site_private.user_security_state q ON q.auth_user_id=s.owner_auth_user_id
      JOIN site_private.business_session_grants g ON g.auth_user_id=q.auth_user_id
      JOIN auth.sessions a ON a.id=g.auth_session_id AND a.user_id=q.auth_user_id
      WHERE s.id=target AND q.auth_user_id=uid AND g.id=grant_id AND a.id=sid
        AND g.issuer_version='r3-ticket-v1:'||bound_key AND q.security_epoch=0 AND g.security_epoch=0
        AND q.business_enabled AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
        AND (a.not_after IS NULL OR a.not_after>clock_timestamp()))
 THEN RAISE EXCEPTION 'S36_QUALIFICATION_FIXTURE_SCOPE'; END IF;
 CASE mode
 WHEN 'hold' THEN
   UPDATE site_private.user_security_state SET security_hold=true,hold_reason='administrative'
   WHERE auth_user_id=uid AND NOT security_hold AND hold_reason='none';
 WHEN 'release' THEN
   UPDATE site_private.user_security_state SET security_hold=false,hold_reason='none'
   WHERE auth_user_id=uid AND security_hold AND hold_reason='administrative';
 WHEN 'disable_site' THEN
   UPDATE site_data.sites SET status='deleted',deleted_at=clock_timestamp()
   WHERE id=target AND owner_auth_user_id=uid AND status='active' AND deleted_at IS NULL AND draft_revision=5;
 WHEN 'restore_site' THEN
   UPDATE site_data.sites SET status='active',deleted_at=NULL
   WHERE id=target AND owner_auth_user_id=uid AND status='deleted' AND draft_revision=5;
 WHEN 'advance_epoch' THEN
   UPDATE site_private.user_security_state SET security_epoch=1
   WHERE auth_user_id=uid AND security_epoch=0 AND NOT security_hold AND hold_reason='none';
 WHEN 'revoke_generation' THEN
   IF bound_key !~ '^s36-boundaries-single-[0-9a-f]{12}$'
      OR (SELECT count(*) FROM site_private.business_session_grants WHERE issuer_version='r3-ticket-v1:'||bound_key)<>1
   THEN RAISE EXCEPTION 'S36_QUALIFICATION_GENERATION_SCOPE'; END IF;
   UPDATE site_private.proof_generations k SET revoked_at=clock_timestamp()
   WHERE k.key_id=bound_key AND k.revoked_at IS NULL AND k.verify_until>clock_timestamp();
 ELSE RAISE EXCEPTION 'S36_QUALIFICATION_ACTION';
 END CASE;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'S36_QUALIFICATION_ROW_COUNT'; END IF;
END;
$mutation$;
REVOKE ecv_s3_owner FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;
