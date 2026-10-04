-- TEST ONLY: V1.3C unified successful/rejected Activity Log read contract.
BEGIN;
SELECT extensions.plan(44);

INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type, entity_id,
  entity_snapshot, changes, payload_version, ip_network, country_code, region, city
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000a01','2026-10-11T12:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','introduction','introduction_paragraph','success-1',
   '{"position":1,"text":"snapshot-hidden"}','{"text":{"before":"before","after":"success-search-marker"}}',1,'188.253.112.0/24','HK',NULL,'Hong Kong'),
  ('aaaaaaaa-0000-4000-8000-000000000a02','2026-10-11T10:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','introduction','introduction_paragraph','collision-activity',
   '{"position":2,"text":"collision snapshot"}','{"text":{"before":"old","after":"collision activity"}}',1,NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a03','2026-10-11T09:00:00Z','10000000-0000-4000-8000-000000000002',
   'other@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','create','profile','profile_settings','success-3',
   '{"avatar_initials":"QA"}','{}',1,NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a07','2026-10-11T06:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','awards','award_list',NULL,
   '{"awards":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"name":"奖项","year":"2025"},"en":{"name":"Award","year":"2025"}}]}',
   '{"awards":{"before":[],"after":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","position":0,"zh":{"name":"奖项","year":"2025"},"en":{"name":"Award","year":"2025"}}]}}',2,NULL,NULL,NULL,NULL);

INSERT INTO cms_private.activity_log_system_events (
  event_id, occurred_at, resume_id, site_key_snapshot, actor_user_id,
  actor_email_snapshot, actor_role_snapshot, event_kind, outcome, section_key,
  operation, failure_stage, failure_code, system_event_key, request_id,
  ip_network, country_code, region, city
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000a04','2026-10-11T11:00:00Z','ea111111-1111-4111-8111-111111111111','example-cv-qa',
   '10000000-0000-4000-8000-000000000002','qa@example.test','qa','operation_failure','rejected','introduction','update',
   'idempotency','idempotency_conflict',NULL,'bbbbbbbb-0000-4000-8000-000000000a04','188.253.112.0/24','HK',NULL,'Hong Kong'),
  ('aaaaaaaa-0000-4000-8000-000000000a02','2026-10-11T10:00:00Z','ea111111-1111-4111-8111-111111111111','example-cv-qa',
   '10000000-0000-4000-8000-000000000002','qa@example.test','qa','operation_failure','rejected','introduction','update',
   'trusted_context_validation','trusted_context_rejected',NULL,'bbbbbbbb-0000-4000-8000-000000000a02',NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a05','2026-10-11T08:00:00Z','ea111111-1111-4111-8111-111111111111','example-cv-qa',
   '10000000-0000-4000-8000-000000000002','qa@example.test','qa','operation_failure','rejected','introduction','update',
   'database_validation','business_validation_rejected',NULL,'bbbbbbbb-0000-4000-8000-000000000a05',NULL,NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000a06','2026-10-11T07:00:00Z','ea111111-1111-4111-8111-111111111111','example-cv-qa',
   NULL,NULL,NULL,'system_change','applied',NULL,NULL,NULL,NULL,'resume_published',NULL,NULL,NULL,NULL,NULL);

INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('ea111111-1111-4111-8111-111111111111','activity_log_system_events',false)
ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=false;

SELECT extensions.ok(
  (SELECT p.prosecdef AND p.provolatile = 's'
      AND p.proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.read_activity_log_events_v13c(uuid,integer,timestamp with time zone,uuid,integer,text,text,text,text,timestamp with time zone,timestamp with time zone,text)'::regprocedure),
  'unified RPC is SECURITY DEFINER, STABLE, and uses empty search_path'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text)','EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p,
        LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
      WHERE p.oid = 'public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text)'::regprocedure
        AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ),
  'only authenticated may execute the unified read RPC'
);
SELECT extensions.ok(
  pg_catalog.pg_get_function_result('public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text)'::regprocedure) NOT ILIKE '%signature%'
    AND pg_catalog.pg_get_function_result('public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text)'::regprocedure) NOT ILIKE '%canonical%'
    AND pg_catalog.pg_get_function_result('public.read_activity_log_events_v13c(uuid,integer,timestamptz,uuid,integer,text,text,text,text,timestamptz,timestamptz,text)'::regprocedure) NOT ILIKE '%key material%',
  'unified RPC result exposes no signature, canonical bytes, or key material columns'
);
SELECT extensions.ok(
  NOT has_table_privilege('authenticated','cms_private.activity_log_events','SELECT')
    AND NOT has_table_privilege('anon','cms_private.activity_log_events','SELECT')
    AND NOT has_table_privilege('service_role','cms_private.activity_log_events','SELECT')
    AND NOT has_table_privilege('authenticated','cms_private.activity_log_system_events','SELECT')
    AND NOT has_table_privilege('anon','cms_private.activity_log_system_events','SELECT')
    AND NOT has_table_privilege('service_role','cms_private.activity_log_system_events','SELECT'),
  'neither private event table is directly readable by API roles'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='cms_private' AND indexname='activity_log_events_target_cursor_idx')
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='cms_private' AND indexname='activity_log_system_events_target_cursor_idx'),
  'both existing target cursor indexes remain available; no new index is required'
);
SELECT extensions.ok(
  EXISTS (SELECT 1 FROM cms_private.resume_capabilities WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log_system_events' AND enabled=false),
  'test target failure-capture capability is explicitly disabled'
);

SET LOCAL ROLE anon;
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100)$$,
  '42501',NULL,'anonymous execution is denied by function ACL'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);

SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100)),
  7, 'all includes four successful and three rejected events but excludes system_change'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'successful')
   WHERE payload_version=2 AND section_key='awards' AND entity_type='award_list' AND entity_id IS NULL),
  1, 'unified V1.3C read returns the additive V2 Awards collection variant'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'successful')),
  4, 'successful filter returns activity rows only'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected')),
  3, 'rejected filter returns rejected operation failures only'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'all') WHERE event_source='system' AND event_kind='system_change'),
  0, 'system_change/applied events are excluded even for all'
);
SELECT extensions.ok(
  (SELECT pg_catalog.bool_and(event_kind IS NULL AND outcome IS NULL AND failure_stage IS NULL AND failure_code IS NULL AND request_id IS NULL)
   FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'successful')),
  'successful rows retain their source contract and null system-only fields'
);
SELECT extensions.ok(
  (SELECT pg_catalog.bool_and(entity_type IS NULL AND entity_id IS NULL AND entity_snapshot IS NULL AND changes IS NULL AND payload_version IS NULL
      AND event_kind='operation_failure' AND outcome='rejected' AND failure_code IS NOT NULL AND request_id IS NOT NULL)
   FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected')),
  'rejected rows carry failure metadata without fabricated business diffs'
);
SELECT extensions.is(
  (SELECT event_source || ':' || source_rank::text FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100)
   WHERE occurred_at='2026-10-11T10:00:00Z' AND id='aaaaaaaa-0000-4000-8000-000000000a02' ORDER BY source_rank DESC LIMIT 1),
  'system:2', 'source rank resolves same timestamp and UUID collision deterministically'
);

SELECT extensions.is(
  (SELECT pg_catalog.array_agg(event_source || ':' || id::text ORDER BY occurred_at DESC,id DESC,source_rank DESC)
   FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',3)),
  ARRAY[
    'activity:aaaaaaaa-0000-4000-8000-000000000a01',
    'system:aaaaaaaa-0000-4000-8000-000000000a04',
    'system:aaaaaaaa-0000-4000-8000-000000000a02'
  ]::text[], 'first page follows timestamp, UUID, then descending source-rank order'
);
SELECT extensions.is(
  (WITH first_page AS MATERIALIZED (
     SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',3)
   ), cursor_row AS (
     SELECT occurred_at,id,source_rank FROM first_page ORDER BY occurred_at ASC,id ASC,source_rank ASC LIMIT 1
   )
   SELECT pg_catalog.array_agg(next_page.event_source || ':' || next_page.id::text ORDER BY next_page.occurred_at DESC,next_page.id DESC,next_page.source_rank DESC)
   FROM cursor_row
   CROSS JOIN LATERAL public.read_activity_log_events_v13c(
     'ea111111-1111-4111-8111-111111111111',3,
     cursor_row.occurred_at,cursor_row.id,cursor_row.source_rank
   ) AS next_page),
  ARRAY[
    'activity:aaaaaaaa-0000-4000-8000-000000000a02',
    'activity:aaaaaaaa-0000-4000-8000-000000000a03',
    'system:aaaaaaaa-0000-4000-8000-000000000a05'
  ]::text[], 'second keyset page has no duplicate or skipped row across the cross-source UUID collision'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,section_filter=>'introduction')),
  5, 'section filter applies to both event sources'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,operation_filter=>'CREATE')),
  1, 'operation filter normalizes case and applies to activity rows'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,actor_email_filter=>' QA@EXAMPLE.TEST ')),
  6, 'actor filter preserves trimmed, case-insensitive exact-match semantics for both sources'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,date_from=>'2026-10-11T10:00:00Z',date_to_exclusive=>'2026-10-11T11:00:00Z')),
  2, 'date range is inclusive at the start and exclusive at the end across sources'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'successful',search_query=>'success-search-marker')),
  1, 'successful search preserves V1.2 changes-text search behavior'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'successful',search_query=>'qa@example.test')),
  0, 'successful general search still excludes actor email snapshots'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected',search_query=>'idempotency')),
  1, 'rejected search includes bounded failure-stage fields'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected',search_query=>'introduction')),
  3, 'rejected search includes bounded section fields'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected',search_query=>'update')),
  3, 'rejected search includes bounded operation fields'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected',search_query=>'idempotency_conflict')),
  1, 'rejected search includes bounded failure-code fields'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected',search_query=>'bbbbbbbb-0000-4000-8000-000000000a04')),
  1, 'rejected search includes request ID text'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected',search_query=>'snapshot-hidden')),
  0, 'rejected search does not search business payload or successful snapshot data'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'all',section_filter=>' ',operation_filter=>'   ')),
  7, 'blank section and operation filters retain V1.2 normalization'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'all',operation_filter=>'update',date_from=>'2026-10-11T10:00:00Z',date_to_exclusive=>'2026-10-11T11:00:00Z',search_query=>'trusted_context_rejected')),
  1, 'filters combine with AND semantics over unified rows'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,'2026-10-11T10:00:00Z')$$,
  '22023','All cursor fields must be provided together','partial cursor is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,'2026-10-11T10:00:00Z','aaaaaaaa-0000-4000-8000-000000000a02',99)$$,
  '22023','Invalid Activity Log cursor source rank','unknown source rank is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'system_change')$$,
  '22023','Invalid Activity Log event filter','unsupported event category is rejected'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,section_filter=>'unknown-section')$$,
  '22023','Invalid Activity Log section filter','invalid section filter remains rejected'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,date_from=>'2026-10-12T00:00:00Z',date_to_exclusive=>'2026-10-11T00:00:00Z')$$,
  '22023','Invalid Activity Log date range','invalid date range remains rejected'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,search_query=>pg_catalog.repeat('x',129))$$,
  '22023','Activity Log search query is too long','search length remains bounded'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',101)$$,
  '22023','page_limit must be between 1 and 100','page limit remains bounded'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('10000000-0000-4000-8000-000000000001',100)$$,
  '42501','Activity Log target is outside the caller scope','QA cannot read Official target events'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected')),
  3, 'unified reads do not depend on the independent system-event capture capability'
);

RESET ROLE;
UPDATE public.resume_sites SET is_published=true WHERE id='ea111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100)$$,
  '42501','Activity Log target is not authorized','published QA target remains outside QA read authorization'
);
RESET ROLE;
UPDATE public.resume_sites SET is_published=false WHERE id='ea111111-1111-4111-8111-111111111111';

INSERT INTO public.cms_admins(user_id,role,resume_id)
VALUES ('10000000-0000-4000-8000-000000000004','owner',NULL);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100)),
  7, 'global owner can read QA only because the existing target helper explicitly authorizes owner scope'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100)$$,
  '42501','Admin authorization required','non-admin authenticated identity cannot read events'
);
RESET ROLE;

UPDATE cms_private.resume_capabilities SET enabled=false
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v13c('ea111111-1111-4111-8111-111111111111',100,event_filter=>'rejected')$$,
  '42501','Activity Log is disabled for this target','disabled Activity Log capability blocks unified reads'
);
SELECT * FROM extensions.finish();
ROLLBACK;
