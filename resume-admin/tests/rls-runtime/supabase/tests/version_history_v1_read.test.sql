-- TEST ONLY: Version History V1 typed read contract against the isolated local RLS lab.
BEGIN;
SELECT extensions.plan(29);

SELECT extensions.ok(
  (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.read_version_history_v1(uuid,integer,timestamp with time zone,uuid)'::regprocedure),
  'Version History RPC is stable, SECURITY DEFINER, and uses an empty search_path'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.read_version_history_v1(uuid,integer,timestamptz,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.read_version_history_v1(uuid,integer,timestamptz,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.read_version_history_v1(uuid,integer,timestamptz,uuid)','EXECUTE'),
  'only authenticated may execute the Version History RPC'
);
SELECT extensions.ok(
  (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%actor_user_id%')
    AND (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%ip_network%')
    AND (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%country_code%')
    AND (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%region%')
    AND (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%city%')
    AND (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%request_id%')
    AND (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%failure_stage%')
    AND (pg_catalog.pg_get_function_result('public.read_version_history_v1(uuid,integer,timestamptz,uuid)'::regprocedure) NOT ILIKE '%entity_snapshot%'),
  'browser-facing result has no audit-only metadata or raw snapshot column'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated','cms_private.activity_log_events','SELECT')
    AND NOT has_table_privilege('anon','cms_private.activity_log_events','SELECT'),
  'the RPC does not grant direct event-table reads'
);

SET LOCAL ROLE anon;
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',25)$$,
  '42501',NULL,'anonymous execution is denied by function ACL'
);
RESET ROLE;

INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type, entity_id,
  entity_snapshot, changes, payload_version, ip_network, country_code, region, city
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000a10','2026-10-11T10:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','awards','award_entry','award-1',
   '{"position":0,"name":"Snapshot only","year":"2025"}','{"name":{"before":"Old","after":"New"}}',1,'188.253.112.0/24','HK',NULL,'Hong Kong'),
  ('aaaaaaaa-0000-4000-8000-000000000a11','2026-10-11T10:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','awards','award_list',NULL,
   '{"awards":[]}','{"awards":{"before":[],"after":[]}}',2,NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a12','2026-10-11T09:00:00Z','10000000-0000-4000-8000-000000000002',
   NULL,'qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','upload','files','profile_image','photo-1',
   '{"object_key":"qa/profile/photo.png","file_name":"private-photo.png","content_type":"image/png","size_bytes":17}',
   '{"object_key":{"before":"old-key","after":"new-key"}}',1,NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a13','2026-10-11T08:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','files','resume_file_set',NULL,
   '{"files":{"translations":{"zh":{"portfolio_href":"new-zh"},"en":{"portfolio_href":"en-ref"}}}}',
   '{"files":{"before":{"translations":{"zh":{"portfolio_href":"old-zh"},"en":{"portfolio_href":"en-ref"}}},"after":{"translations":{"zh":{"portfolio_href":"new-zh"},"en":{"portfolio_href":"en-ref"}}}}}',2,NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a19','2026-10-11T08:30:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','upload','files','resume_file','private-file-name.pdf',
   '{"locale":"zh","object_key":"qa/resume/managed.pdf","file_name":"private-file-name.pdf","content_type":"application/pdf","size_bytes":99}',
   '{"locale":{"before":"zh","after":"zh"},"object_key":{"before":"old-ref","after":"new-ref"},"file_name":{"before":"old.pdf","after":"private-file-name.pdf"},"content_type":{"before":"application/pdf","after":"application/pdf"},"size_bytes":{"before":88,"after":99}}',1,NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a16','2026-10-11T05:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','introduction','introduction_paragraph','intro-1',
   '{"position":0,"text":"not in Version History V1"}','{"text":{"before":"a","after":"b"}}',1,NULL,NULL,NULL,NULL);

INSERT INTO cms_private.activity_log_system_events (
  event_id, occurred_at, resume_id, site_key_snapshot, actor_user_id, actor_email_snapshot,
  actor_role_snapshot, event_kind, outcome, section_key, operation, failure_stage,
  failure_code, request_id, ip_network
) VALUES (
  'aaaaaaaa-0000-4000-8000-000000000a17','2026-10-11T04:00:00Z','ea111111-1111-4111-8111-111111111111','example-cv-qa',
  '10000000-0000-4000-8000-000000000002','qa@example.test','qa','operation_failure','rejected','introduction','update',
  'idempotency','idempotency_conflict','bbbbbbbb-0000-4000-8000-000000000a17','188.253.112.0/24'
);

-- The production table currently constrains versions to 1/2 and validates known payloads.
-- Relax only inside this rollback-only test transaction to exercise defensive future/malformed paths.
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_payload_version_check;
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_payload_allowlist_check;
INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type, entity_id,
  entity_snapshot, changes, payload_version
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000a14','2026-10-11T07:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','awards','award_list',NULL,
   '{"raw":"must-not-leak"}','{"raw":"must-not-leak"}',2),
  ('aaaaaaaa-0000-4000-8000-000000000a15','2026-10-11T06:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','awards','award_list',NULL,
   '{"future":"must-not-leak"}','{"future":"must-not-leak"}',99),
  ('aaaaaaaa-0000-4000-8000-000000000a18','2026-10-11T06:30:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','awards','award_list',NULL,
   '{"awards":[]}','{"awards":{"before":[],"after":[]}}',1);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)),
  7,'successful supported events and safe generic rows are included; Introduction, rejected, and mismatched contracts are excluded'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE domain_key='introduction'),
  0,'Introduction is explicitly excluded'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a10' AND comparison_kind='entity_fields'
    AND comparison->'changes'->'name'->>'before'='Old' AND comparison->'changes'->'name'->>'after'='New'),
  1,'V1 keeps only recorded entity fields'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',25,'2026-10-10T00:00:00Z','aaaaaaaa-0000-4000-8000-000000000a00')),
  0,'an authorized target beyond its oldest cursor returns an empty page'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a11'
    AND comparison_kind='aggregate' AND comparison->'before'='[]'::jsonb AND comparison->'after'='[]'::jsonb),
  1,'V2 returns exact aggregate before/after'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a13'
    AND comparison_kind='aggregate' AND comparison->'before'->'translations'->'zh'->>'portfolio_href'='old-zh'
    AND comparison->'after'->'translations'->'zh'->>'portfolio_href'='new-zh'),
  1,'Files history returns only the recorded locale references'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a19'
    AND entity_id IS NULL AND comparison_kind='entity_fields'
    AND comparison->'changes' ? 'locale' AND comparison->'changes' ? 'object_key'
    AND NOT (comparison->'changes' ? 'file_name') AND NOT (comparison->'changes' ? 'content_type')
    AND NOT (comparison->'changes' ? 'size_bytes') AND comparison::text NOT ILIKE '%private-file-name%'),
  1,'legacy Files V1 exposes only locale and object reference, not filename or file metadata'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a12'
    AND domain_key='profile' AND comparison_kind='entity_fields' AND comparison::text NOT ILIKE '%private-photo.png%'
    AND comparison::text NOT ILIKE '%image/png%' AND comparison::text NOT ILIKE '%size_bytes%'
    AND comparison->'changes' ? 'object_key' AND entity_id IS NULL),
  1,'Profile photo history exposes recorded reference changes only'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a15'
    AND comparison_kind='unavailable' AND comparison IS NULL),
  1,'unknown payload version returns generic entry'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a14'
    AND comparison_kind='unavailable' AND comparison IS NULL),
  1,'malformed known payload returns generic entry'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a18'),
  0,'known payload version with a mismatched entity contract is excluded'
);
SELECT extensions.is(
  (SELECT actor_account_label FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a10'),
  'qa@example.test','actor account label uses the recorded email only'
);
SELECT extensions.is(
  (SELECT actor_account_label || ':' || actor_role FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100) WHERE event_id='aaaaaaaa-0000-4000-8000-000000000a12'),
  'QA account:qa','missing email uses role-based fallback'
);
SELECT extensions.is(
  (SELECT pg_catalog.array_agg(event_id::text ORDER BY occurred_at DESC,event_id DESC)
   FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',2)),
  ARRAY['aaaaaaaa-0000-4000-8000-000000000a11','aaaaaaaa-0000-4000-8000-000000000a10']::text[],
  'timestamp and event ID order is deterministic for a timestamp tie'
);
SELECT extensions.ok(
  (SELECT pg_catalog.bool_and(has_more) FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',2)),
  'first page reports more entries'
);
SELECT extensions.is(
  (WITH p1 AS MATERIALIZED (SELECT * FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',2)),
    c1 AS (SELECT occurred_at,event_id FROM p1 ORDER BY occurred_at ASC,event_id ASC LIMIT 1),
    p2 AS MATERIALIZED (SELECT next_page.* FROM c1 CROSS JOIN LATERAL public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',2,c1.occurred_at,c1.event_id) next_page),
    c2 AS (SELECT occurred_at,event_id FROM p2 ORDER BY occurred_at ASC,event_id ASC LIMIT 1),
    p3 AS MATERIALIZED (SELECT next_page.* FROM c2 CROSS JOIN LATERAL public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',2,c2.occurred_at,c2.event_id) next_page),
    c3 AS (SELECT occurred_at,event_id FROM p3 ORDER BY occurred_at ASC,event_id ASC LIMIT 1),
    p4 AS MATERIALIZED (SELECT next_page.* FROM c3 CROSS JOIN LATERAL public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',2,c3.occurred_at,c3.event_id) next_page),
    all_pages AS (SELECT event_id,occurred_at FROM p1 UNION ALL SELECT event_id,occurred_at FROM p2 UNION ALL SELECT event_id,occurred_at FROM p3 UNION ALL SELECT event_id,occurred_at FROM p4)
   SELECT pg_catalog.array_agg(event_id::text ORDER BY occurred_at DESC,event_id DESC)
     || CASE WHEN count(*)=count(DISTINCT event_id) THEN ARRAY[]::text[] ELSE ARRAY['duplicate']::text[] END
   FROM all_pages),
  ARRAY['aaaaaaaa-0000-4000-8000-000000000a11','aaaaaaaa-0000-4000-8000-000000000a10','aaaaaaaa-0000-4000-8000-000000000a12',
    'aaaaaaaa-0000-4000-8000-000000000a19','aaaaaaaa-0000-4000-8000-000000000a13','aaaaaaaa-0000-4000-8000-000000000a14','aaaaaaaa-0000-4000-8000-000000000a15']::text[],
  'keyset pages have no duplicates or skipped entries'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',25,'2026-10-11T10:00:00Z')$$,
  '22023','Both cursor fields must be provided together','partial cursor fails closed'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',101)$$,
  '22023','page_limit must be between 1 and 100','page size is bounded'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('10000000-0000-4000-8000-000000000001',25)$$,
  '42501','Activity Log target is outside the caller scope','QA cannot read Official Version History'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
    WHERE comparison::text ILIKE '%must-not-leak%'),
  0,'raw payload blobs never pass through'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
    WHERE operation IS NULL OR domain_key IS NULL OR entity_type IS NULL),
  0,'safe product context is present on returned entries'
);
RESET ROLE;
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM cms_private.activity_log_events WHERE resume_id='ea111111-1111-4111-8111-111111111111'),
  9,'Version History reads do not mutate successful event rows'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',25)$$,
  '42501','Admin authorization required','non-admin cannot read Version History'
);

RESET ROLE;
UPDATE cms_private.resume_capabilities SET enabled=false
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',25)$$,
  '42501','Activity Log is disabled for this target','disabled Activity Log capability blocks Version History'
);

SELECT * FROM extensions.finish();
ROLLBACK;
