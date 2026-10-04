-- TEST ONLY: strict Activity Log payload-v2 validation and frozen v1 dispatch.
BEGIN;
SELECT extensions.plan(1);
DO $payload_v2$
DECLARE
  id_a constant text := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  id_b constant text := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  before_value jsonb;
  after_value jsonb;
  snapshot_value jsonb;
  change_value jsonb;
  event_payload jsonb;
  large_value jsonb;
BEGIN
  before_value := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',id_a,'position',0,
    'zh',pg_catalog.jsonb_build_object('name','旧奖项','year','2024'),
    'en',pg_catalog.jsonb_build_object('name','Old Award','year','2024')));
  after_value := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',id_a,'position',0,
    'zh',pg_catalog.jsonb_build_object('name','新奖项','year','2025'),
    'en',pg_catalog.jsonb_build_object('name','New Award','year','2025')));
  snapshot_value := pg_catalog.jsonb_build_object('awards',after_value);
  change_value := pg_catalog.jsonb_build_object('awards',pg_catalog.jsonb_build_object('before',before_value,'after',after_value));
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',snapshot_value,change_value),
    'valid Awards v2 snapshot and before/after shape is accepted');
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    '{"awards":[]}'::jsonb,'{"awards":{"before":[],"after":[]}}'::jsonb), 'empty no-op arrays remain valid payload values');
  PERFORM public.rls_test_assert(cms_private.activity_event_payload_version_is_allowed(1::smallint,'awards','award_entry','one','update',
    '{"position":0,"name":"Award"}'::jsonb,'{"name":{"before":"Old","after":"Award"}}'::jsonb),
    'frozen v1 Award-entry events retain the v1 validator');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_version_is_allowed(1::smallint,'awards','award_list',NULL,'update',snapshot_value,change_value),
    'v1 cannot claim the new award-list entity type');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_version_is_allowed(9::smallint,'awards','award_list',NULL,'update',snapshot_value,change_value),
    'unknown payload versions fail closed');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('education','award_list',NULL,'update',snapshot_value,change_value),
    'v2 payloads are restricted to the Awards section');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list','entity','update',snapshot_value,change_value),
    'collection event entity_id must be NULL');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'delete',snapshot_value,change_value),
    'collection event operation must be update');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    snapshot_value || '{"extra":true}'::jsonb,change_value), 'unknown top-level snapshot fields are rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    snapshot_value,change_value || '{"extra":true}'::jsonb), 'unknown top-level change fields are rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    pg_catalog.jsonb_build_object('awards',before_value),change_value), 'snapshot must exactly equal the canonical after collection');
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid()::text,'position',i,
    'zh',pg_catalog.jsonb_build_object('name','A','year','2025'),'en',pg_catalog.jsonb_build_object('name','A','year','2025')))
    INTO event_payload FROM pg_catalog.generate_series(0,32) AS entries(i);
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    pg_catalog.jsonb_build_object('awards',event_payload),pg_catalog.jsonb_build_object('awards',pg_catalog.jsonb_build_object('before',before_value,'after',event_payload))),
    'more than 32 Awards are rejected');
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed(NULL,'award_list',NULL,'update',snapshot_value,change_value),
    'NULL discriminator values fail closed');
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid()::text,'position',i,
    'zh',pg_catalog.jsonb_build_object('name',pg_catalog.repeat('中',200),'year','2025'),
    'en',pg_catalog.jsonb_build_object('name',pg_catalog.repeat('A',200),'year','2025')))
    INTO large_value FROM pg_catalog.generate_series(0,31) AS entries(i);
  PERFORM public.rls_test_assert(NOT cms_private.activity_event_payload_v2_is_allowed('awards','award_list',NULL,'update',
    pg_catalog.jsonb_build_object('awards',large_value),pg_catalog.jsonb_build_object('awards',pg_catalog.jsonb_build_object('before',large_value,'after',large_value))),
    'combined snapshot and changes payloads above 12000 UTF-8 bytes are rejected');
END
$payload_v2$;
SELECT extensions.pass('Activity Log v2 validation is strict and v1-compatible');
SELECT * FROM extensions.finish();
ROLLBACK;
