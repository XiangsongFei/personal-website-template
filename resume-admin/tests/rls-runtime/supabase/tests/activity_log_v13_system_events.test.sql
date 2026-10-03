-- TEST ONLY: V1.3A failed/system-event recorder security contract.
BEGIN;
SELECT extensions.plan(80);

CREATE FUNCTION pg_temp.submit_v13(
  call_resume_id uuid,
  call_event_id uuid,
  call_request_id uuid,
  call_actor_user_id uuid,
  call_protocol_version integer DEFAULT 1,
  call_purpose text DEFAULT 'activity_log_system_event_v13',
  call_key_id text DEFAULT 'activity_log_v13_failure_v1',
  call_event_kind text DEFAULT 'operation_failure',
  call_outcome text DEFAULT 'rejected',
  call_section_key text DEFAULT 'introduction',
  call_operation text DEFAULT 'update',
  call_failure_stage text DEFAULT 'database_validation',
  call_failure_code text DEFAULT 'business_validation_rejected',
  call_issued_at_epoch bigint DEFAULT NULL,
  call_ip_network cidr DEFAULT '188.253.112.0/24',
  call_country_code text DEFAULT 'HK',
  call_region text DEFAULT NULL,
  call_city text DEFAULT 'Hong Kong',
  signed_resume_id uuid DEFAULT NULL,
  signed_event_id uuid DEFAULT NULL,
  signed_request_id uuid DEFAULT NULL,
  signed_actor_user_id uuid DEFAULT NULL,
  signed_failure_stage text DEFAULT NULL,
  signed_failure_code text DEFAULT NULL,
  signature_override text DEFAULT NULL,
  signed_protocol_version integer DEFAULT NULL,
  signed_purpose text DEFAULT NULL,
  signed_key_id text DEFAULT NULL,
  signed_event_kind text DEFAULT NULL,
  signed_outcome text DEFAULT NULL,
  signed_section_key text DEFAULT NULL,
  signed_operation text DEFAULT NULL,
  signed_issued_at_epoch bigint DEFAULT NULL,
  signed_ip_network cidr DEFAULT NULL,
  signed_country_code text DEFAULT NULL,
  signed_region text DEFAULT NULL,
  signed_city text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  issued_value bigint := COALESCE(call_issued_at_epoch,
    pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint);
  signature_value text;
BEGIN
  signature_value := COALESCE(signature_override,
    public.test_only_sign_activity_log_v13_failure(
      COALESCE(signed_resume_id, call_resume_id),
      COALESCE(signed_event_id, call_event_id),
      COALESCE(signed_request_id, call_request_id),
      COALESCE(signed_actor_user_id, call_actor_user_id),
      COALESCE(signed_protocol_version, call_protocol_version),
      COALESCE(signed_purpose, call_purpose), COALESCE(signed_key_id, call_key_id),
      COALESCE(signed_event_kind, call_event_kind),
      COALESCE(signed_outcome, call_outcome),
      COALESCE(signed_section_key, call_section_key), COALESCE(signed_operation, call_operation),
      COALESCE(signed_failure_stage, call_failure_stage),
      COALESCE(signed_failure_code, call_failure_code),
      COALESCE(signed_issued_at_epoch, issued_value),
      COALESCE(signed_ip_network, call_ip_network),
      COALESCE(signed_country_code, call_country_code),
      COALESCE(signed_region, call_region), COALESCE(signed_city, call_city)
    ));
  RETURN public.record_activity_log_system_failure(
    call_resume_id, call_event_id, call_request_id, call_actor_user_id,
    call_protocol_version, call_purpose, call_key_id, call_event_kind,
    call_outcome, call_section_key, call_operation, call_failure_stage,
    call_failure_code, issued_value, call_ip_network, call_country_code,
    call_region, call_city, signature_value
  );
END
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.submit_v13(
  uuid, uuid, uuid, uuid, integer, text, text, text, text, text,
  text, text, text, bigint, cidr, text, text, text, uuid, uuid,
  uuid, uuid, text, text, text, integer, text, text, text, text,
  text, text, bigint, cidr, text, text, text
) TO authenticated;

-- TEST ONLY golden vector inputs. The expected byte and HMAC strings below
-- are fixed constants produced independently of either runtime implementation.
CREATE FUNCTION pg_temp.v13_golden_bytes(target_vector integer)
RETURNS bytea
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF target_vector = 1 THEN
    RETURN cms_private.activity_log_v13_canonical_bytes(
      1,'activity_log_system_event_v13','activity_log_v13_failure_v1',
      'aaaaaaaa-0000-4000-8000-000000000903','bbbbbbbb-0000-4000-8000-000000000903',
      '10000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111',
      'operation_failure','rejected','introduction','update','database_validation',
      'business_validation_rejected',1791000000,'188.253.112.0/24','HK',NULL,'Hong Kong'
    );
  ELSIF target_vector = 2 THEN
    RETURN cms_private.activity_log_v13_canonical_bytes(
      1,'activity_log_system_event_v13','activity_log_v13_failure_v1',
      'aaaaaaaa-0000-4000-8000-000000000904','bbbbbbbb-0000-4000-8000-000000000904',
      '10000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111',
      'operation_failure','rejected','introduction','update','database_validation',
      'business_validation_rejected',1791000001,'203.0.113.0/24','CN','加州 é','深圳 🧭'
    );
  ELSIF target_vector = 3 THEN
    RETURN cms_private.activity_log_v13_canonical_bytes(
      1,'p:|"' || pg_catalog.chr(92) || pg_catalog.chr(10),'',NULL,
      'bbbbbbbb-0000-4000-8000-000000000905','10000000-0000-4000-8000-000000000002',
      'ea111111-1111-4111-8111-111111111111','operation_failure',NULL,'',NULL,
      'stage:|quote"' || pg_catalog.chr(92) || pg_catalog.chr(10),'literal null',-1,
      NULL,NULL,'','null'
    );
  ELSIF target_vector = 4 THEN
    RETURN cms_private.activity_log_v13_canonical_bytes(
      1,'activity_log_system_event_v13','activity_log_v13_failure_v1',
      'aaaaaaaa-0000-4000-8000-000000000906','bbbbbbbb-0000-4000-8000-000000000906',
      '10000000-0000-4000-8000-000000000002','ea111111-1111-4111-8111-111111111111',
      'operation_failure','rejected','introduction','update','trusted_context_validation',
      'trusted_context_rejected',1791000002,'2001:db8:1::/48','US','California','San Francisco'
    );
  END IF;
  RAISE EXCEPTION 'Unknown V1.3 test vector';
END
$function$;

SELECT extensions.is(pg_catalog.encode(pg_temp.v13_golden_bytes(1), 'hex'),
  '56313a315632393a61637469766974795f6c6f675f73797374656d5f6576656e' ||
  '745f7631335632373a61637469766974795f6c6f675f7631335f6661696c7572' ||
  '655f76315633363a61616161616161612d303030302d343030302d383030302d' ||
  '3030303030303030303930335633363a62626262626262622d303030302d3430' ||
  '30302d383030302d3030303030303030303930335633363a3130303030303030' ||
  '2d303030302d343030302d383030302d3030303030303030303030325633363a' ||
  '65613131313131312d313131312d343131312d383131312d3131313131313131' ||
  '313131315631373a6f7065726174696f6e5f6661696c75726556383a72656a65' ||
  '637465645631323a696e74726f64756374696f6e56363a757064617465563139' ||
  '3a64617461626173655f76616c69646174696f6e5632383a627573696e657373' ||
  '5f76616c69646174696f6e5f72656a65637465645631303a3137393130303030' ||
  '30305631363a3138382e3235332e3131322e302f323456323a484b4e3b56393a' ||
  '486f6e67204b6f6e67', 'vector 1 canonical bytes: ASCII and IPv4 /24');
SELECT extensions.is(pg_catalog.encode(extensions.hmac(pg_temp.v13_golden_bytes(1),
    cms_private.activity_log_v13_key('activity_log_v13_failure_v1'),'sha256'),'hex'),
  '5ae790be7de26832d79d2a753060435e471943d4c2c02603095f0cb9141d251e',
  'vector 1 fixed HMAC-SHA256');

SELECT extensions.is(pg_catalog.encode(pg_temp.v13_golden_bytes(2), 'hex'),
  '56313a315632393a61637469766974795f6c6f675f73797374656d5f6576656e' ||
  '745f7631335632373a61637469766974795f6c6f675f7631335f6661696c7572' ||
  '655f76315633363a61616161616161612d303030302d343030302d383030302d' ||
  '3030303030303030303930345633363a62626262626262622d303030302d3430' ||
  '30302d383030302d3030303030303030303930345633363a3130303030303030' ||
  '2d303030302d343030302d383030302d3030303030303030303030325633363a' ||
  '65613131313131312d313131312d343131312d383131312d3131313131313131' ||
  '313131315631373a6f7065726174696f6e5f6661696c75726556383a72656a65' ||
  '637465645631323a696e74726f64756374696f6e56363a757064617465563139' ||
  '3a64617461626173655f76616c69646174696f6e5632383a627573696e657373' ||
  '5f76616c69646174696f6e5f72656a65637465645631303a3137393130303030' ||
  '30315631343a3230332e302e3131332e302f323456323a434e56393ae58aa0e5' ||
  'b79e20c3a95631313ae6b7b1e59cb320f09fa7ad', 'vector 2 canonical bytes: UTF-8 byte lengths and raw Unicode');
SELECT extensions.is(pg_catalog.encode(extensions.hmac(pg_temp.v13_golden_bytes(2),
    cms_private.activity_log_v13_key('activity_log_v13_failure_v1'),'sha256'),'hex'),
  '6cf439c7ef828a536b2278caabb84ead21edd61f5e096d44da65a34a1b89f9bb',
  'vector 2 fixed HMAC-SHA256');

SELECT extensions.is(pg_catalog.encode(pg_temp.v13_golden_bytes(3), 'hex'),
  '56313a3156363a703a7c225c0a56303a4e3b5633363a62626262626262622d30' ||
  '3030302d343030302d383030302d3030303030303030303930355633363a3130' ||
  '3030303030302d303030302d343030302d383030302d30303030303030303030' ||
  '30325633363a65613131313131312d313131312d343131312d383131312d3131' ||
  '313131313131313131315631373a6f7065726174696f6e5f6661696c7572654e' ||
  '3b56303a4e3b5631353a73746167653a7c71756f7465225c0a5631323a6c6974' ||
  '6572616c206e756c6c56323a2d314e3b4e3b56303a56343a6e756c6c',
  'vector 3 canonical bytes: NULL/empty and escaping-sensitive text');
SELECT extensions.is(pg_catalog.encode(extensions.hmac(pg_temp.v13_golden_bytes(3),
    cms_private.activity_log_v13_key('activity_log_v13_failure_v1'),'sha256'),'hex'),
  '290b4614dcd2c7a5b3f516fcfd8e11d37f2fc164a60125642554a01f997cb7eb',
  'vector 3 fixed HMAC-SHA256');

SELECT extensions.is(pg_catalog.encode(pg_temp.v13_golden_bytes(4), 'hex'),
  '56313a315632393a61637469766974795f6c6f675f73797374656d5f6576656e' ||
  '745f7631335632373a61637469766974795f6c6f675f7631335f6661696c7572' ||
  '655f76315633363a61616161616161612d303030302d343030302d383030302d' ||
  '3030303030303030303930365633363a62626262626262622d303030302d3430' ||
  '30302d383030302d3030303030303030303930365633363a3130303030303030' ||
  '2d303030302d343030302d383030302d3030303030303030303030325633363a' ||
  '65613131313131312d313131312d343131312d383131312d3131313131313131' ||
  '313131315631373a6f7065726174696f6e5f6661696c75726556383a72656a65' ||
  '637465645631323a696e74726f64756374696f6e56363a757064617465563236' ||
  '3a747275737465645f636f6e746578745f76616c69646174696f6e5632343a74' ||
  '7275737465645f636f6e746578745f72656a65637465645631303a3137393130' ||
  '30303030325634323a323030313a306462383a303030313a303030303a303030' ||
  '303a303030303a303030303a303030302f343856323a55535631303a43616c69' ||
  '666f726e69615631333a53616e204672616e636973636f',
  'vector 4 canonical bytes: expanded IPv6 /48');
SELECT extensions.is(pg_catalog.encode(extensions.hmac(pg_temp.v13_golden_bytes(4),
    cms_private.activity_log_v13_key('activity_log_v13_failure_v1'),'sha256'),'hex'),
  'b31b3845c9c21a5aae480db028fa3386225227135109f537a34ce4d85350156f',
  'vector 4 fixed HMAC-SHA256');

SELECT extensions.ok(
  pg_catalog.to_regclass('cms_private.activity_log_system_events') IS NOT NULL,
  'separate private failed/system event table exists'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM pg_catalog.pg_attribute
   WHERE attrelid = 'cms_private.activity_log_system_events'::regclass AND attnum > 0 AND NOT attisdropped),
  19, 'table has only the 19 bounded typed columns and no generic payload column'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='cms_private.activity_log_system_events'::regclass AND contype='p'),
  'event_id is the database-enforced idempotency primary key'
);
SELECT extensions.ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='cms_private.activity_log_system_events'::regclass),
  'RLS is enabled on the private event table'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='cms_private' AND indexname='activity_log_system_events_target_cursor_idx'),
  'target descending cursor index exists for future authorized pagination'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='cms_private' AND indexname='activity_log_system_events_target_request_idx'),
  'target/request correlation index exists without making request_id unique'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated','cms_private.activity_log_system_events','SELECT')
  AND NOT has_table_privilege('anon','cms_private.activity_log_system_events','SELECT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_system_events','INSERT')
  AND NOT has_table_privilege('anon','cms_private.activity_log_system_events','INSERT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_system_events','UPDATE')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_system_events','DELETE')
  AND NOT has_table_privilege('anon','cms_private.activity_log_system_events','UPDATE')
  AND NOT has_table_privilege('service_role','cms_private.activity_log_system_events','SELECT')
  AND NOT has_table_privilege('service_role','cms_private.activity_log_system_events','INSERT'),
  'application roles have no direct read or write grants on the private table'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.record_activity_log_system_failure(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,bigint,cidr,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.record_activity_log_system_failure(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,bigint,cidr,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.record_activity_log_system_failure(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,bigint,cidr,text,text,text,text)','EXECUTE'),
  'recorder execute privilege is authenticated-only, without anon or service_role'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated','cms_private.activity_log_v13_key(text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','cms_private.assert_activity_log_system_event_target(uuid)','EXECUTE'),
  'key provider and target helper remain private'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) AS acl
    WHERE proc.oid='public.record_activity_log_system_failure(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,bigint,cidr,text,text,text,text)'::regprocedure
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
  ), 'PUBLIC has no direct recorder EXECUTE grant'
);
SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid='public.record_activity_log_system_failure(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,text,text,text,bigint,cidr,text,text,text,text)'::regprocedure
      AND proc.proowner='postgres'::regrole AND proc.prosecdef
      AND proc.proconfig @> ARRAY['search_path=""']::text[]
  ), 'recorder is postgres-owned SECURITY DEFINER with an empty search_path'
);
SELECT extensions.ok(
  pg_catalog.octet_length(cms_private.activity_log_v13_key('activity_log_v13_failure_v1'))=32,
  'Vault adapter accepts the local synthetic V1.3 key as exactly 32 bytes'
);
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v13_key('activity_log_v11_hmac_v1')$$,
  '22023','Invalid signed system event','V1.3 key provider rejects the V1.1 key id'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT')
  AND pg_catalog.pg_get_constraintdef((SELECT oid FROM pg_catalog.pg_constraint WHERE conrelid='cms_private.activity_log_events'::regclass AND conname='activity_log_events_operation_check'))
      LIKE '%create%update%delete%reorder%upload%remove%',
  'successful Activity Log writer privileges and frozen operation vocabulary remain unchanged'
);
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM cms_private.resume_capabilities WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log_system_events'),
  'new capture capability is absent by default in the local QA fixture'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000901','bbbbbbbb-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000002')$$,
  '42501','Activity Log access denied','absent capture capability fails closed'
);
RESET ROLE;

INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('ea111111-1111-4111-8111-111111111111','activity_log_system_events',false);
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000902','bbbbbbbb-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000002')$$,
  '42501','Activity Log access denied','explicitly disabled capture capability fails closed'
);
RESET ROLE;
UPDATE cms_private.resume_capabilities SET enabled=true
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log_system_events';
UPDATE cms_private.resume_capabilities SET enabled=false
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',NULL,true);
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000934','bbbbbbbb-0000-4000-8000-000000000934','10000000-0000-4000-8000-000000000002')$$,
  '42501','Activity Log access denied','missing auth.uid() is rejected'
);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.is(
  pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000903','bbbbbbbb-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000002',call_issued_at_epoch=>pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.transaction_timestamp()))::bigint)->>'recorded',
  'true','valid signed Introduction rejection report records even while the separate read capability is disabled'
);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"refreshed@example.test"}',true);
SELECT extensions.is(
  pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000903','bbbbbbbb-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000002',call_issued_at_epoch=>pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.transaction_timestamp()))::bigint)->>'recorded',
  'false','exact report retry returns deterministic idempotent success without a second insert'
);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000903','bbbbbbbb-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000002',call_failure_stage=>'trusted_context_validation',call_failure_code=>'trusted_context_rejected')$$,
  '22023','Invalid signed system event','conflicting reuse of event identity is rejected'
);
SELECT extensions.is(
  pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000904','bbbbbbbb-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000002')->>'recorded',
  'true','distinct event identity may share request_id correlation'
);
SELECT extensions.is(
  pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000933','bbbbbbbb-0000-4000-8000-000000000933','10000000-0000-4000-8000-000000000002',call_ip_network=>'2001:db8:1::/48')->>'recorded',
  'true','canonical IPv6 /48 network snapshot is accepted'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000905','bbbbbbbb-0000-4000-8000-000000000905','10000000-0000-4000-8000-000000000003')$$,
  '22023','Invalid signed system event','actor identity must equal auth.uid()'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000906','bbbbbbbb-0000-4000-8000-000000000906','10000000-0000-4000-8000-000000000002',signed_resume_id=>'20000000-0000-4000-8000-000000000001')$$,
  '22023','Invalid signed system event','target id is bound into the signature'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000907','bbbbbbbb-0000-4000-8000-000000000907','10000000-0000-4000-8000-000000000002',signed_event_id=>'aaaaaaaa-0000-4000-8000-000000000908')$$,
  '22023','Invalid signed system event','event identity is bound into the signature'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000909','bbbbbbbb-0000-4000-8000-000000000909','10000000-0000-4000-8000-000000000002',signed_request_id=>'bbbbbbbb-0000-4000-8000-000000000910')$$,
  '22023','Invalid signed system event','request correlation id is bound into the signature'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000911','bbbbbbbb-0000-4000-8000-000000000911','10000000-0000-4000-8000-000000000002',call_issued_at_epoch=>pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint - 181)$$,
  '22023','Invalid signed system event','stale signed timestamp is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000912','bbbbbbbb-0000-4000-8000-000000000912','10000000-0000-4000-8000-000000000002',call_issued_at_epoch=>pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint + 61)$$,
  '22023','Invalid signed system event','future signed timestamp is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000913','bbbbbbbb-0000-4000-8000-000000000913','10000000-0000-4000-8000-000000000002',call_purpose=>'wrong-purpose')$$,
  '22023','Invalid signed system event','wrong signing purpose is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000914','bbbbbbbb-0000-4000-8000-000000000914','10000000-0000-4000-8000-000000000002',call_protocol_version=>2)$$,
  '22023','Invalid signed system event','wrong protocol version is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000915','bbbbbbbb-0000-4000-8000-000000000915','10000000-0000-4000-8000-000000000002',call_key_id=>'wrong-key')$$,
  '22023','Invalid signed system event','wrong key id is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000916','bbbbbbbb-0000-4000-8000-000000000916','10000000-0000-4000-8000-000000000002',call_event_kind=>'system_change')$$,
  '22023','Invalid signed system event','system-change writing is not exposed by the V1.3A recorder'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000917','bbbbbbbb-0000-4000-8000-000000000917','10000000-0000-4000-8000-000000000002',call_outcome=>'applied')$$,
  '22023','Invalid signed system event','unsupported outcome is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000918','bbbbbbbb-0000-4000-8000-000000000918','10000000-0000-4000-8000-000000000002',call_section_key=>'education')$$,
  '22023','Invalid signed system event','failure recorder is limited to Introduction'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000919','bbbbbbbb-0000-4000-8000-000000000919','10000000-0000-4000-8000-000000000002',call_operation=>'delete')$$,
  '22023','Invalid signed system event','failure recorder is limited to Introduction update'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000920','bbbbbbbb-0000-4000-8000-000000000920','10000000-0000-4000-8000-000000000002',call_failure_stage=>'database_validation',call_failure_code=>'arbitrary-client-text')$$,
  '22023','Invalid signed system event','unsupported failure code is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000921','bbbbbbbb-0000-4000-8000-000000000921','10000000-0000-4000-8000-000000000002',call_failure_stage=>'arbitrary-stage',call_failure_code=>'business_validation_rejected')$$,
  '22023','Invalid signed system event','unsupported failure stage is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000922','bbbbbbbb-0000-4000-8000-000000000922','10000000-0000-4000-8000-000000000002',signed_failure_code=>'trusted_context_rejected')$$,
  '22023','Invalid signed system event','failure code is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000923','bbbbbbbb-0000-4000-8000-000000000923','10000000-0000-4000-8000-000000000002',signed_failure_stage=>'idempotency')$$,
  '22023','Invalid signed system event','failure stage is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000940','bbbbbbbb-0000-4000-8000-000000000940','10000000-0000-4000-8000-000000000002',signed_actor_user_id=>'10000000-0000-4000-8000-000000000003')$$,
  '22023','Invalid signed system event','actor identity is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000941','bbbbbbbb-0000-4000-8000-000000000941','10000000-0000-4000-8000-000000000002',signed_protocol_version=>2)$$,
  '22023','Invalid signed system event','protocol version is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000942','bbbbbbbb-0000-4000-8000-000000000942','10000000-0000-4000-8000-000000000002',signed_purpose=>'other-purpose')$$,
  '22023','Invalid signed system event','purpose is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000943','bbbbbbbb-0000-4000-8000-000000000943','10000000-0000-4000-8000-000000000002',signed_key_id=>'other-key')$$,
  '22023','Invalid signed system event','key id is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000944','bbbbbbbb-0000-4000-8000-000000000944','10000000-0000-4000-8000-000000000002',signed_event_kind=>'system_change')$$,
  '22023','Invalid signed system event','event kind is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000945','bbbbbbbb-0000-4000-8000-000000000945','10000000-0000-4000-8000-000000000002',signed_outcome=>'applied')$$,
  '22023','Invalid signed system event','outcome is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000946','bbbbbbbb-0000-4000-8000-000000000946','10000000-0000-4000-8000-000000000002',signed_section_key=>'education')$$,
  '22023','Invalid signed system event','section is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000947','bbbbbbbb-0000-4000-8000-000000000947','10000000-0000-4000-8000-000000000002',signed_operation=>'delete')$$,
  '22023','Invalid signed system event','operation is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000948','bbbbbbbb-0000-4000-8000-000000000948','10000000-0000-4000-8000-000000000002',call_issued_at_epoch=>pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.transaction_timestamp()))::bigint,signed_issued_at_epoch=>pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.transaction_timestamp()))::bigint + 1)$$,
  '22023','Invalid signed system event','timestamp is cryptographically bound at integer-second precision'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000949','bbbbbbbb-0000-4000-8000-000000000949','10000000-0000-4000-8000-000000000002',signed_ip_network=>'203.0.113.0/24')$$,
  '22023','Invalid signed system event','network is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000950','bbbbbbbb-0000-4000-8000-000000000950','10000000-0000-4000-8000-000000000002',signed_country_code=>'US')$$,
  '22023','Invalid signed system event','country code is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000951','bbbbbbbb-0000-4000-8000-000000000951','10000000-0000-4000-8000-000000000002',signed_region=>'California')$$,
  '22023','Invalid signed system event','region is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000952','bbbbbbbb-0000-4000-8000-000000000952','10000000-0000-4000-8000-000000000002',signed_city=>'San Francisco')$$,
  '22023','Invalid signed system event','city is cryptographically bound'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000924','bbbbbbbb-0000-4000-8000-000000000924','10000000-0000-4000-8000-000000000002',signature_override=>pg_catalog.repeat('a',64))$$,
  '22023','Invalid signed system event','tampered HMAC is rejected generically'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000925','bbbbbbbb-0000-4000-8000-000000000925','10000000-0000-4000-8000-000000000002',call_ip_network=>'203.0.113.4/32')$$,
  '22023','Invalid signed system event','full-address IPv4 prefix is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000926','bbbbbbbb-0000-4000-8000-000000000926','10000000-0000-4000-8000-000000000002',call_country_code=>'hk')$$,
  '22023','Invalid signed system event','country code must use uppercase ISO alpha-2 form'
);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000927','bbbbbbbb-0000-4000-8000-000000000927','10000000-0000-4000-8000-000000000002',call_city=>'bad'||pg_catalog.chr(1))$$,
  '22023','Invalid signed system event','control characters are rejected from location snapshots'
);
SELECT extensions.throws_ok(
  $$SELECT public.record_activity_log_system_failure('20000000-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000928','bbbbbbbb-0000-4000-8000-000000000928','10000000-0000-4000-8000-000000000002',1,'activity_log_system_event_v13','activity_log_v13_failure_v1','operation_failure','rejected','introduction','update','database_validation','business_validation_rejected',pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp()))::bigint,'188.253.112.0/24','HK',NULL,'Hong Kong',pg_catalog.repeat('z',64))$$,
  '42501',NULL,'QA member cannot write to the Official target') ;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000929','bbbbbbbb-0000-4000-8000-000000000929','10000000-0000-4000-8000-000000000002')$$,
  '42501',NULL,'non-admin authenticated identity is denied target access'
);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM cms_private.activity_log_system_events$$,
  '42501',NULL,'authenticated cannot directly select the private event table'
);
SELECT extensions.throws_ok(
  $$INSERT INTO cms_private.activity_log_system_events(event_id,occurred_at,resume_id,site_key_snapshot,event_kind,outcome,section_key,operation,failure_stage,failure_code,actor_user_id,actor_role_snapshot,request_id) VALUES ('aaaaaaaa-0000-4000-8000-000000000930',pg_catalog.now(),'ea111111-1111-4111-8111-111111111111','example-cv-qa','operation_failure','rejected','introduction','update','database_validation','business_validation_rejected','10000000-0000-4000-8000-000000000002','qa','bbbbbbbb-0000-4000-8000-000000000930')$$,
  '42501',NULL,'authenticated cannot directly insert private events'
);
RESET ROLE;

SELECT extensions.is((SELECT pg_catalog.count(*)::integer FROM cms_private.activity_log_system_events),3,
  'only valid first/retry, same-request distinct identity, and IPv6 /48 reports were inserted');
SELECT extensions.ok(
  (SELECT event.actor_user_id='10000000-0000-4000-8000-000000000002'::uuid
     AND event.actor_email_snapshot='qa@example.test' AND event.actor_role_snapshot='qa'
     AND event.site_key_snapshot='example-cv-qa' AND event.request_id='bbbbbbbb-0000-4000-8000-000000000903'
     AND event.ip_network='188.253.112.0/24'::cidr AND event.country_code='HK'
     AND event.region IS NULL AND event.city='Hong Kong'
   FROM cms_private.activity_log_system_events AS event
   WHERE event.event_id='aaaaaaaa-0000-4000-8000-000000000903'),
  'stored row derives actor/role/site snapshots and retains only coarse network/location fields');
SELECT extensions.ok(
  NOT EXISTS (SELECT 1 FROM cms_private.resume_capabilities WHERE resume_id='20000000-0000-4000-8000-000000000001' AND capability_key='activity_log_system_events')
  AND (SELECT enabled FROM cms_private.resume_capabilities WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log_system_events')
  AND NOT (SELECT enabled FROM cms_private.resume_capabilities WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log'),
  'capture capability remains target-scoped and independent of the existing read capability');
SELECT extensions.is((SELECT pg_catalog.count(*)::integer FROM cms_private.activity_log_events),0,
  'V1.3 recorder does not alter successful Activity Log events');
SELECT extensions.throws_ok(
  $$UPDATE cms_private.activity_log_system_events SET city='changed' WHERE event_id='aaaaaaaa-0000-4000-8000-000000000903'$$,
  '55000','Activity Log system events are immutable','row updates are rejected by the append-only trigger'
);
SELECT extensions.throws_ok(
  $$DELETE FROM cms_private.activity_log_system_events WHERE event_id='aaaaaaaa-0000-4000-8000-000000000903'$$,
  '55000','Activity Log system events are immutable','row deletion is rejected by the append-only trigger'
);
SELECT extensions.throws_ok(
  $$TRUNCATE cms_private.activity_log_system_events$$,
  '55000','Activity Log system events are immutable','truncate is rejected by the append-only trigger'
);

DO $remove_test_secret$
BEGIN
  DELETE FROM vault.secrets WHERE name='activity_log_v13_failure_v1';
END
$remove_test_secret$;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT pg_temp.submit_v13('ea111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000931','bbbbbbbb-0000-4000-8000-000000000931','10000000-0000-4000-8000-000000000002')$$,
  '22023','Invalid signed system event','missing Vault key fails closed with a generic error'
);
RESET ROLE;
DO $restore_test_secret$
BEGIN
  PERFORM vault.create_secret(
    'a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7',
    'activity_log_v13_failure_v1', 'TEST ONLY synthetic Activity Log V1.3 failure key'
  );
END
$restore_test_secret$;

DO $malformed_length$
DECLARE test_secret_id uuid;
BEGIN
  SELECT id INTO STRICT test_secret_id FROM vault.secrets WHERE name='activity_log_v13_failure_v1';
  PERFORM vault.update_secret(test_secret_id,'1234',NULL,NULL);
END
$malformed_length$;
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v13_key('activity_log_v13_failure_v1')$$,
  '22023','Invalid signed system event','malformed Vault key length fails generically'
);
DO $restore_after_length$
DECLARE test_secret_id uuid;
BEGIN
  SELECT id INTO STRICT test_secret_id FROM vault.secrets WHERE name='activity_log_v13_failure_v1';
  PERFORM vault.update_secret(test_secret_id,
    'a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7',NULL,NULL);
END
$restore_after_length$;
DO $malformed_uppercase$
DECLARE test_secret_id uuid;
BEGIN
  SELECT id INTO STRICT test_secret_id FROM vault.secrets WHERE name='activity_log_v13_failure_v1';
  PERFORM vault.update_secret(test_secret_id,
    'A4C8F16D2B9037E5A1C6D8F04B2E9A73C5D1F8064A2E9B7C3D5F1086A2C4E9B7',NULL,NULL);
END
$malformed_uppercase$;
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v13_key('activity_log_v13_failure_v1')$$,
  '22023','Invalid signed system event','uppercase hex Vault value fails generically'
);
DO $restore_after_uppercase$
DECLARE test_secret_id uuid;
BEGIN
  SELECT id INTO STRICT test_secret_id FROM vault.secrets WHERE name='activity_log_v13_failure_v1';
  PERFORM vault.update_secret(test_secret_id,
    'a4c8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7',NULL,NULL);
END
$restore_after_uppercase$;
DO $malformed_nonhex$
DECLARE test_secret_id uuid;
BEGIN
  SELECT id INTO STRICT test_secret_id FROM vault.secrets WHERE name='activity_log_v13_failure_v1';
  PERFORM vault.update_secret(test_secret_id,
    'zzc8f16d2b9037e5a1c6d8f04b2e9a73c5d1f8064a2e9b7c3d5f1086a2c4e9b7',NULL,NULL);
END
$malformed_nonhex$;
SELECT extensions.throws_ok(
  $$SELECT cms_private.activity_log_v13_key('activity_log_v13_failure_v1')$$,
  '22023','Invalid signed system event','non-hex Vault value fails generically'
);
SELECT * FROM extensions.finish();
ROLLBACK;
