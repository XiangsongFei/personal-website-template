-- Separate approval required, before generating R3 proofs for the two admitted users.
-- psql variables: key_id, alice_uid, bob_uid, not_before, sign_until, verify_until (UTC seconds).
BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.alice_uid',:'alice_uid',true) AS alice,
       set_config('s36_test.bob_uid',:'bob_uid',true) AS bob
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
INSERT INTO site_private.proof_generations(key_id,not_before,sign_until,verify_until)
SELECT :'key_id',to_timestamp(:'not_before'::bigint),to_timestamp(:'sign_until'::bigint),to_timestamp(:'verify_until'::bigint)
WHERE :'key_id' ~ '^[a-zA-Z0-9_-]{1,40}$'
  AND :'not_before'::bigint<=extract(epoch FROM clock_timestamp())
  AND :'sign_until'::bigint>extract(epoch FROM clock_timestamp())
  AND :'verify_until'::bigint-:'not_before'::bigint<=1800
RETURNING key_id AS new_generation
\gset
REVOKE ecv_s3_owner FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;
