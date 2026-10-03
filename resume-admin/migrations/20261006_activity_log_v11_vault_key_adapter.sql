-- Activity Log V1.1 production key provider backed by Supabase Vault.
-- This replaces only the fail-closed provider; it does not enable a requirement.
BEGIN;

CREATE OR REPLACE FUNCTION cms_private.activity_log_v11_key(target_key_id text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  decrypted_value text;
  decoded_value bytea;
BEGIN
  IF target_key_id IS DISTINCT FROM 'activity_log_v11_hmac_v1' THEN
    RAISE EXCEPTION 'Invalid signed context' USING ERRCODE = '22023';
  END IF;

  SELECT secret.decrypted_secret
    INTO STRICT decrypted_value
    FROM vault.decrypted_secrets AS secret
    WHERE secret.name = 'activity_log_v11_hmac_v1';

  IF decrypted_value IS NULL
    OR pg_catalog.char_length(decrypted_value) <> 64
    OR (decrypted_value COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid signed context' USING ERRCODE = '22023';
  END IF;

  decoded_value := pg_catalog.decode(decrypted_value, 'hex');
  IF pg_catalog.octet_length(decoded_value) <> 32 THEN
    RAISE EXCEPTION 'Invalid signed context' USING ERRCODE = '22023';
  END IF;

  RETURN decoded_value;
EXCEPTION
  WHEN OTHERS THEN
    -- Keep missing/duplicate rows, Vault errors, decode failures, and all
    -- unexpected provider failures indistinguishable from invalid contexts.
    RAISE EXCEPTION 'Invalid signed context' USING ERRCODE = '22023';
END
$function$;

REVOKE ALL ON FUNCTION cms_private.activity_log_v11_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
