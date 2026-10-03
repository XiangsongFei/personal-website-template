-- TEST ONLY: production Vault adapter behavior with synthetic local secrets.
BEGIN;
SELECT extensions.plan(8);

SELECT extensions.ok(
  cms_private.activity_log_v11_key('activity_log_v11_hmac_v1') =
    pg_catalog.decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex'),
  'returns the expected 32 bytes for the named synthetic Vault key'
);
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v11_key('wrong-key-id')$$,
  '22023', 'Invalid signed context', 'wrong key id is rejected generically'
);
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v11_key(NULL)$$,
  '22023', 'Invalid signed context', 'NULL key id is rejected generically'
);

DO $remove_test_key$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'activity_log_v11_hmac_v1';
END
$remove_test_key$;
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v11_key('activity_log_v11_hmac_v1')$$,
  '22023', 'Invalid signed context', 'missing Vault key is rejected generically'
);

DO $restore_test_key$
BEGIN
  PERFORM vault.create_secret(
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    'activity_log_v11_hmac_v1', 'TEST ONLY Activity Log V1.1 adapter key'
  );
END
$restore_test_key$;

DO $malformed_length$
DECLARE secret_id uuid;
BEGIN
  SELECT id INTO STRICT secret_id FROM vault.secrets WHERE name = 'activity_log_v11_hmac_v1';
  PERFORM vault.update_secret(secret_id, '1234', NULL, NULL);
END
$malformed_length$;
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v11_key('activity_log_v11_hmac_v1')$$,
  '22023', 'Invalid signed context', 'wrong length is rejected generically'
);

DO $uppercase_hex$
DECLARE secret_id uuid;
BEGIN
  SELECT id INTO STRICT secret_id FROM vault.secrets WHERE name = 'activity_log_v11_hmac_v1';
  PERFORM vault.update_secret(secret_id, '00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF', NULL, NULL);
END
$uppercase_hex$;
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v11_key('activity_log_v11_hmac_v1')$$,
  '22023', 'Invalid signed context', 'uppercase hex is rejected generically'
);

DO $non_hex$
DECLARE secret_id uuid;
BEGIN
  SELECT id INTO STRICT secret_id FROM vault.secrets WHERE name = 'activity_log_v11_hmac_v1';
  PERFORM vault.update_secret(secret_id, 'zz112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', NULL, NULL);
END
$non_hex$;
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v11_key('activity_log_v11_hmac_v1')$$,
  '22023', 'Invalid signed context', 'non-hex content is rejected generically'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'vault' AND tablename = 'secrets'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX% (name)%'
  ),
  'Vault uniquely constrains non-null names, so duplicate-name rows are not constructible in this local schema'
);

SELECT * FROM extensions.finish();
ROLLBACK;
