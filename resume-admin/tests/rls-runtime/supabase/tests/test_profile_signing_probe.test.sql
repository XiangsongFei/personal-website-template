-- TEST ONLY. Exercise the read-only signing probe with the disposable Vault key.
BEGIN;
SELECT extensions.plan(15);

-- The local seed already uses the approved site key with a different UUID.
-- Move that synthetic row aside inside this rollback-only test transaction.
UPDATE public.resume_sites
   SET site_key = 'example-cv-qa-existing-fixture'
 WHERE id = 'ea111111-1111-4111-8111-111111111111'
   AND site_key = 'example-cv-qa-activity-log'
   AND is_published IS FALSE;
DO $local_fixture_guard$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.resume_sites
      WHERE id = 'ea111111-1111-4111-8111-111111111111'
        AND site_key = 'example-cv-qa-existing-fixture' AND is_published IS FALSE) <> 1 THEN
    RAISE EXCEPTION 'Expected the disposable QA seed target before probe test';
  END IF;
END
$local_fixture_guard$;
INSERT INTO public.resume_sites(id, site_key, is_published)
VALUES ('f6000000-0000-4000-8000-000000000001', 'example-cv-qa-activity-log', false);
DO $legacy_fixture_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resume_sites
                 WHERE id = 'ea555555-5555-4555-8555-555555555555'
                   AND site_key = 'example-cv-qa' AND is_published IS FALSE) THEN
    RAISE EXCEPTION 'Expected the disposable legacy QA fixture target';
  END IF;
END
$legacy_fixture_guard$;
INSERT INTO public.cms_admins(user_id, role, resume_id)
VALUES ('f6000000-0000-4000-8000-000000000002', 'qa', 'f6000000-0000-4000-8000-000000000001'),
       ('f6000000-0000-4000-8000-000000000003', 'qa', 'ea555555-5555-4555-8555-555555555555');

CREATE FUNCTION public.test_only_sign_profile_probe(
  target_actor uuid,
  target_resume uuid DEFAULT 'f6000000-0000-4000-8000-000000000001',
  target_issued bigint DEFAULT NULL,
  target_expires bigint DEFAULT NULL,
  target_key_id text DEFAULT 'activity_log_v11_hmac_v1',
  target_purpose text DEFAULT 'test_profile_signing_probe_v1',
  target_key_hex text DEFAULT '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
)
RETURNS TABLE(signed_context text, signature_hex text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH stamp AS (
    SELECT COALESCE(target_issued, pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint) AS issued
  ), context AS (
    SELECT pg_catalog.jsonb_build_object(
      'context_version', 1,
      'purpose', target_purpose,
      'key_id', target_key_id,
      'actor_user_id', target_actor::text,
      'resume_id', target_resume::text,
      'nonce', pg_catalog.gen_random_uuid()::text,
      'issued_at', stamp.issued,
      'expires_at', COALESCE(target_expires, stamp.issued + 30)
    )::text AS value
    FROM stamp
  )
  SELECT context.value,
    pg_catalog.encode(extensions.hmac(
      pg_catalog.convert_to('example-cv:test-profile-signing-probe:v1' || pg_catalog.chr(10) || context.value, 'UTF8'),
      pg_catalog.decode(target_key_hex, 'hex'), 'sha256'
    ), 'hex')
  FROM context
$function$;

CREATE FUNCTION public.test_only_probe_signature_is_not_profile_signature(target_context text, target_signature text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM * FROM cms_private.verify_resume_profile_v1_context(
    'f6000000-0000-4000-8000-000000000001', '{}', target_context, target_signature
  );
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END
$function$;

CREATE FUNCTION public.test_only_probe_is_read_only(target_context text, target_signature text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE events_before bigint; idempotency_before bigint; profile_before bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO events_before FROM cms_private.activity_log_events;
  SELECT pg_catalog.count(*) INTO idempotency_before FROM cms_private.activity_log_idempotency;
  SELECT pg_catalog.count(*) INTO profile_before FROM public.resume_profile
    WHERE resume_id = 'f6000000-0000-4000-8000-000000000001';
  PERFORM public.verify_test_profile_signing_probe_v1(target_context, target_signature);
  RETURN events_before = (SELECT pg_catalog.count(*) FROM cms_private.activity_log_events)
    AND idempotency_before = (SELECT pg_catalog.count(*) FROM cms_private.activity_log_idempotency)
    AND profile_before = (SELECT pg_catalog.count(*) FROM public.resume_profile
      WHERE resume_id = 'f6000000-0000-4000-8000-000000000001');
END
$function$;

REVOKE ALL ON FUNCTION public.test_only_sign_profile_probe(uuid,uuid,bigint,bigint,text,text,text),
  public.test_only_probe_signature_is_not_profile_signature(text,text),
  public.test_only_probe_is_read_only(text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.test_only_sign_profile_probe(uuid,uuid,bigint,bigint,text,text,text),
  public.test_only_probe_signature_is_not_profile_signature(text,text),
  public.test_only_probe_is_read_only(text,text)
  TO authenticated;

SELECT extensions.ok(
  has_function_privilege('authenticated', 'public.verify_test_profile_signing_probe_v1(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.verify_test_profile_signing_probe_v1(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.verify_test_profile_signing_probe_v1(text,text)', 'EXECUTE')
  AND (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig @> ARRAY['search_path=""']
       AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
       FROM pg_catalog.pg_proc AS p
       WHERE p.oid = 'public.verify_test_profile_signing_probe_v1(text,text)'::regprocedure),
  'probe is SECURITY DEFINER with empty search_path, postgres ownership, and authenticated-only execution'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid()))
SELECT extensions.ok((SELECT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'approved Test identity passes with the matching synthetic Vault key');
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid()))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, repeat('0', 64)) FROM probe),
  'a different HMAC signature fails');
WITH stamp AS (SELECT pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint AS now_seconds),
probe AS (SELECT signed.* FROM stamp CROSS JOIN LATERAL public.test_only_sign_profile_probe(
  auth.uid(), target_issued => stamp.now_seconds - 60, target_expires => stamp.now_seconds - 30
) AS signed)
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'expired challenge fails');
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid(), target_key_id => 'wrong_key_id'))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'incorrect key ID fails');
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe('f6000000-0000-4000-8000-000000000005'))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'wrong signed actor fails');
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(
  auth.uid(), target_resume => 'ea555555-5555-4555-8555-555555555555'
))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'wrong signed target fails');
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(
  auth.uid(), target_key_hex => 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'different signing key fails');
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid()))
SELECT extensions.ok((SELECT public.test_only_probe_signature_is_not_profile_signature(signed_context, signature_hex) FROM probe),
  'probe signature cannot authorize the existing Profile-save verifier');
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid()))
SELECT extensions.ok((SELECT public.test_only_probe_is_read_only(signed_context, signature_hex) FROM probe),
  'probe leaves Activity Log, idempotency, and Profile rows unchanged');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid()))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'Owner identity is denied even with a valid probe signature');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid()))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'legacy QA identity bound to legacy target is denied');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"f6000000-0000-4000-8000-000000000005","role":"authenticated"}', true);
WITH probe AS (SELECT * FROM public.test_only_sign_profile_probe(auth.uid()))
SELECT extensions.ok((SELECT NOT public.verify_test_profile_signing_probe_v1(signed_context, signature_hex) FROM probe),
  'non-admin identity is denied');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT extensions.ok(
  NOT public.verify_test_profile_signing_probe_v1('', ''),
  'missing authentication fails closed'
);

SELECT extensions.ok(
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc
   WHERE oid = 'public.verify_test_profile_signing_probe_v1(text,text)'::regprocedure) = 1
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    WHERE p.oid = 'public.verify_test_profile_signing_probe_v1(text,text)'::regprocedure
      AND p.prosrc ~* '\m(insert|update|delete|merge|truncate)\M'
  ),
  'probe function definition contains no write statement'
);

RESET ROLE;
DROP FUNCTION public.test_only_sign_profile_probe(uuid,uuid,bigint,bigint,text,text,text);
DROP FUNCTION public.test_only_probe_signature_is_not_profile_signature(text,text);
DROP FUNCTION public.test_only_probe_is_read_only(text,text);
SELECT * FROM extensions.finish();
ROLLBACK;
