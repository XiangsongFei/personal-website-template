-- TEST ONLY: synthetic V1.3 Vault secret and independent local signing helper.
-- This file belongs only to the isolated RLS runtime project.
DO $seed_v13_synthetic_key$
BEGIN
  PERFORM vault.create_secret(
    'a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7',
    'activity_log_v13_failure_v1',
    'TEST ONLY synthetic Activity Log V1.3 failure key'
  );
END
$seed_v13_synthetic_key$;

-- TEST ONLY signer. It does not call cms_private.activity_log_v13_key; this
-- keeps signer and Vault-backed verifier key lookup independent in the lab.
CREATE FUNCTION public.test_only_sign_activity_log_v13_failure(
  target_resume_id uuid,
  target_event_id uuid,
  target_request_id uuid,
  target_actor_user_id uuid,
  target_protocol_version integer DEFAULT 1,
  target_purpose text DEFAULT 'activity_log_system_event_v13',
  target_key_id text DEFAULT 'activity_log_v13_failure_v1',
  target_event_kind text DEFAULT 'operation_failure',
  target_outcome text DEFAULT 'rejected',
  target_section_key text DEFAULT 'introduction',
  target_operation text DEFAULT 'update',
  target_failure_stage text DEFAULT 'database_validation',
  target_failure_code text DEFAULT 'business_validation_rejected',
  target_issued_at_epoch bigint DEFAULT NULL,
  target_ip_network cidr DEFAULT '188.253.112.0/24',
  target_country_code text DEFAULT 'HK',
  target_region text DEFAULT NULL,
  target_city text DEFAULT 'Hong Kong'
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
  SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(extensions.hmac(
    cms_private.activity_log_v13_canonical_bytes(
      target_protocol_version, target_purpose, target_key_id, target_event_id,
      target_request_id, target_actor_user_id, target_resume_id, target_event_kind,
      target_outcome, target_section_key, target_operation, target_failure_stage,
      target_failure_code, COALESCE(target_issued_at_epoch,
        pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint),
      target_ip_network, target_country_code, target_region, target_city
    ),
    pg_catalog.decode(
      'a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7',
      'hex'
    ), 'sha256'
  ), 'hex')
$function$;
REVOKE ALL ON FUNCTION public.test_only_sign_activity_log_v13_failure(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, text,
  text, text, text, bigint, cidr, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.test_only_sign_activity_log_v13_failure(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, text,
  text, text, text, bigint, cidr, text, text, text
) TO authenticated;
