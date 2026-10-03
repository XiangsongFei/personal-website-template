-- TEST ONLY. This local RLS lab key is synthetic and is not production key material.
CREATE OR REPLACE FUNCTION cms_private.activity_log_v11_key(target_key_id text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF target_key_id <> 'activity_log_v11_hmac_v1' THEN
    RAISE EXCEPTION 'Invalid signed context' USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.decode(
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    'hex'
  );
END
$function$;
REVOKE ALL ON FUNCTION cms_private.activity_log_v11_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- TEST ONLY signer for the isolated local database. It deliberately exposes
-- only a committed synthetic test key and is never copied to production.
CREATE FUNCTION public.test_only_sign_activity_log_v11_context(
  target_resume_id uuid,
  target_items text,
  target_actor uuid,
  target_request uuid,
  target_issued bigint DEFAULT NULL,
  target_expires bigint DEFAULT NULL,
  target_ip text DEFAULT NULL,
  target_country text DEFAULT NULL,
  target_region text DEFAULT NULL,
  target_city text DEFAULT NULL,
  target_domain text DEFAULT 'introduction',
  target_operation text DEFAULT 'update',
  target_version integer DEFAULT 1,
  target_key_id text DEFAULT 'activity_log_v11_hmac_v1',
  target_digest text DEFAULT NULL
)
RETURNS TABLE (signed_context text, signature_hex text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH values_to_sign AS (
    SELECT COALESCE(target_issued, pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint) AS issued,
      target_items,
      target_resume_id,
      target_actor,
      target_request,
      target_expires,
      target_ip,
      target_country,
      target_region,
      target_city,
      target_domain,
      target_operation,
      target_version,
      target_key_id,
      target_digest
  ), context AS (
    SELECT pg_catalog.jsonb_build_object(
      'context_version', target_version,
      'key_id', target_key_id,
      'actor_user_id', target_actor::text,
      'resume_id', target_resume_id::text,
      'domain', target_domain,
      'operation', target_operation,
      'request_id', target_request::text,
      'mutation_digest', COALESCE(target_digest,
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(target_items, 'UTF8'), 'sha256'), 'hex')),
      'issued_at', issued,
      'expires_at', COALESCE(target_expires, issued + 300),
      'ip_network', target_ip,
      'country_code', target_country,
      'region', target_region,
      'city', target_city
    )::text AS value
    FROM values_to_sign
  )
  SELECT context.value,
    pg_catalog.encode(extensions.hmac(
      pg_catalog.convert_to(context.value, 'UTF8'),
      pg_catalog.decode(
        '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        'hex'
      ),
      'sha256'
    ), 'hex')
  FROM context
$function$;
REVOKE ALL ON FUNCTION public.test_only_sign_activity_log_v11_context(
  uuid, text, uuid, uuid, bigint, bigint, text, text, text, text, text, text, integer, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.test_only_sign_activity_log_v11_context(
  uuid, text, uuid, uuid, bigint, bigint, text, text, text, text, text, text, integer, text, text
) TO authenticated;
