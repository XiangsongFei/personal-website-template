-- Separate approval required, before generating R3 proofs for the two admitted users.
-- psql variables: key_id, alice_uid, bob_uid, not_before, sign_until, verify_until (UTC seconds).
BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.alice_uid',:'alice_uid',true) AS alice,
       set_config('s36_test.bob_uid',:'bob_uid',true) AS bob,
       set_config('s36_test.key_id',:'key_id',true) AS key_id,
       set_config('s36_test.not_before',:'not_before',true) AS not_before,
       set_config('s36_test.sign_until',:'sign_until',true) AS sign_until,
       set_config('s36_test.verify_until',:'verify_until',true) AS verify_until
\gset
SELECT pg_advisory_xact_lock(3303,5) AS qualification_lock
\gset
DO $accounts$
BEGIN
  IF current_setting('s36_test.alice_uid')::uuid=current_setting('s36_test.bob_uid')::uuid
    OR (SELECT count(*) FROM auth.users)<>2
    OR (SELECT count(*) FROM auth.users u JOIN site_data.sites s ON s.owner_auth_user_id=u.id
      JOIN site_private.user_security_state q ON q.auth_user_id=u.id
      WHERE u.id IN (current_setting('s36_test.alice_uid')::uuid,current_setting('s36_test.bob_uid')::uuid)
        AND email_confirmed_at IS NOT NULL AND NOT is_anonymous
        AND (banned_until IS NULL OR banned_until<=clock_timestamp())
        AND security_epoch=0 AND business_enabled AND NOT security_hold AND s.status='active')<>2
  THEN RAISE EXCEPTION 'S36_PUBLICATION_GRANT_SUBJECTS'; END IF;
END;
$accounts$;
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
DO $insert$
DECLARE chosen_key text:=current_setting('s36_test.key_id');
        starts bigint:=current_setting('s36_test.not_before')::bigint;
        signs bigint:=current_setting('s36_test.sign_until')::bigint;
        verifies bigint:=current_setting('s36_test.verify_until')::bigint;
        inserted integer;
BEGIN
  INSERT INTO site_private.proof_generations(key_id,not_before,sign_until,verify_until)
  SELECT chosen_key,to_timestamp(starts),to_timestamp(signs),to_timestamp(verifies)
  WHERE chosen_key ~ '^[a-zA-Z0-9_-]{1,40}$'
    AND starts<=extract(epoch FROM clock_timestamp())
    AND signs>extract(epoch FROM clock_timestamp())
    AND starts<signs AND signs<=verifies AND verifies-starts<=1800;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted<>1 THEN RAISE EXCEPTION 'S36_PUBLICATION_GENERATION_NOT_INSERTED'; END IF;
END;
$insert$;
REVOKE ecv_s3_owner FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;
