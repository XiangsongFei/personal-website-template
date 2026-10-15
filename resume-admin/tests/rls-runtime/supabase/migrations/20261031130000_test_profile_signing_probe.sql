-- Read-only, Test-identity-only HMAC compatibility probe.
-- This forward migration creates no content, activity, history, idempotency, or capability rows.
BEGIN;

DO $probe_migration_guard$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Test signing probe must be installed as postgres' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('public.cms_admins') IS NULL
    OR to_regclass('public.resume_sites') IS NULL
    OR to_regprocedure('public.can_manage_resume(uuid)') IS NULL
    OR to_regprocedure('cms_private.activity_log_v11_key(text)') IS NULL THEN
    RAISE EXCEPTION 'Required Test signing probe authorization or key-provider object is missing';
  END IF;
END
$probe_migration_guard$;

CREATE FUNCTION public.verify_test_profile_signing_probe_v1(
  signed_context text,
  signature_hex text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  test_target constant uuid := 'f6000000-0000-4000-8000-000000000001';
  context_value jsonb;
  key_value bytea;
  supplied bytea;
  expected bytea;
  now_seconds bigint;
  issued_seconds bigint;
  expires_seconds bigint;
BEGIN
  -- Authorization is hard-bound to the one existing, unpublished Test target.
  IF caller_id IS NULL
    OR (SELECT pg_catalog.count(*) FROM public.cms_admins AS admin
        WHERE admin.user_id = caller_id) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.cms_admins AS admin
      JOIN public.resume_sites AS site ON site.id = admin.resume_id
      WHERE admin.user_id = caller_id
        AND admin.role = 'qa'
        AND admin.resume_id = test_target
        AND site.site_key = 'example-cv-qa-activity-log'
        AND site.is_published IS FALSE
        AND public.can_manage_resume(test_target)
    ) THEN
    RETURN false;
  END IF;

  BEGIN
    IF signed_context IS NULL
      OR pg_catalog.octet_length(pg_catalog.convert_to(signed_context, 'UTF8')) > 2048
      OR signature_hex IS NULL
      OR (signature_hex COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
      RETURN false;
    END IF;

    context_value := signed_context::jsonb;
    IF pg_catalog.jsonb_typeof(context_value) IS DISTINCT FROM 'object'
      OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(context_value)) <> 8
      OR NOT (context_value ?& ARRAY['context_version','purpose','key_id','actor_user_id','resume_id','nonce','issued_at','expires_at'])
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(context_value) AS field(key_name)
        WHERE field.key_name <> ALL (ARRAY['context_version','purpose','key_id','actor_user_id','resume_id','nonce','issued_at','expires_at'])
      )
      OR pg_catalog.jsonb_typeof(context_value->'context_version') IS DISTINCT FROM 'number'
      OR context_value->>'context_version' IS DISTINCT FROM '1'
      OR pg_catalog.jsonb_typeof(context_value->'purpose') IS DISTINCT FROM 'string'
      OR context_value->>'purpose' IS DISTINCT FROM 'test_profile_signing_probe_v1'
      OR pg_catalog.jsonb_typeof(context_value->'key_id') IS DISTINCT FROM 'string'
      OR context_value->>'key_id' IS DISTINCT FROM 'activity_log_v11_hmac_v1'
      OR pg_catalog.jsonb_typeof(context_value->'actor_user_id') IS DISTINCT FROM 'string'
      OR context_value->>'actor_user_id' IS DISTINCT FROM caller_id::text
      OR pg_catalog.jsonb_typeof(context_value->'resume_id') IS DISTINCT FROM 'string'
      OR context_value->>'resume_id' IS DISTINCT FROM test_target::text
      OR pg_catalog.jsonb_typeof(context_value->'nonce') IS DISTINCT FROM 'string'
      OR (context_value->>'nonce') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR pg_catalog.jsonb_typeof(context_value->'issued_at') IS DISTINCT FROM 'number'
      OR (context_value->>'issued_at') !~ '^(0|[1-9][0-9]{0,11})$'
      OR pg_catalog.jsonb_typeof(context_value->'expires_at') IS DISTINCT FROM 'number'
      OR (context_value->>'expires_at') !~ '^(0|[1-9][0-9]{0,11})$' THEN
      RETURN false;
    END IF;

    issued_seconds := (context_value->>'issued_at')::bigint;
    expires_seconds := (context_value->>'expires_at')::bigint;
    now_seconds := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.statement_timestamp()))::bigint;
    IF issued_seconds > now_seconds + 5
      OR expires_seconds <= now_seconds
      OR expires_seconds <= issued_seconds
      OR expires_seconds - issued_seconds > 30 THEN
      RETURN false;
    END IF;

    supplied := pg_catalog.decode(signature_hex, 'hex');
    key_value := cms_private.activity_log_v11_key('activity_log_v11_hmac_v1');
    IF key_value IS NULL OR pg_catalog.octet_length(key_value) <> 32 THEN
      RETURN false;
    END IF;

    -- Domain separation ensures this proof cannot be replayed as a Profile-save signature.
    expected := extensions.hmac(
      pg_catalog.convert_to('example-cv:test-profile-signing-probe:v1' || pg_catalog.chr(10) || signed_context, 'UTF8'),
      key_value,
      'sha256'
    );
    RETURN extensions.digest(supplied, 'sha256') = extensions.digest(expected, 'sha256');
  EXCEPTION WHEN OTHERS THEN
    -- Malformed input, Vault/provider failures, and mismatches all return the same result.
    RETURN false;
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$function$;

ALTER FUNCTION public.verify_test_profile_signing_probe_v1(text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_test_profile_signing_probe_v1(text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.verify_test_profile_signing_probe_v1(text, text)
  TO authenticated;

COMMIT;
