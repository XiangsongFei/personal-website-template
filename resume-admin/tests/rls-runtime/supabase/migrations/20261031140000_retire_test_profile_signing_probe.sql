-- Remove only the temporary Test Profile signing compatibility verifier.
-- This migration does not alter shared signing providers or Profile saves.
BEGIN;

DO $retire_probe$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'probe retirement must run as postgres';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS probe
    WHERE probe.oid = pg_catalog.to_regprocedure('public.verify_test_profile_signing_probe_v1(text,text)')
      AND probe.proowner = 'postgres'::pg_catalog.regrole
      AND probe.prosecdef IS TRUE
      AND probe.provolatile = 's'
      AND probe.proconfig = ARRAY['search_path=""']::text[]
      AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(probe.oid), 'f6000000-0000-4000-8000-000000000001') > 0
      AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(probe.oid), 'example-cv-qa-activity-log') > 0
      AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(probe.oid), 'test_profile_signing_probe_v1') > 0
  ) THEN
    RAISE EXCEPTION 'installed function is not the reviewed Test-only signing probe';
  END IF;
END;
$retire_probe$;

REVOKE ALL ON FUNCTION public.verify_test_profile_signing_probe_v1(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.verify_test_profile_signing_probe_v1(text, text);

COMMIT;
