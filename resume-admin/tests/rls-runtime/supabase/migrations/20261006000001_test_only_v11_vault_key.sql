-- TEST ONLY. This synthetic key is confined to the isolated local RLS lab.
DO $seed_synthetic_vault_key$
BEGIN
  PERFORM vault.create_secret(
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    'activity_log_v11_hmac_v1',
    'TEST ONLY Activity Log V1.1 adapter key'
  );
END
$seed_synthetic_vault_key$;
