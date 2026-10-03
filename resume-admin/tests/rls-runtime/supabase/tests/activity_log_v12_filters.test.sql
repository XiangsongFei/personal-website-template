-- TEST ONLY: Activity Log V1.2 filter/RPC security coverage.
BEGIN;
SELECT extensions.plan(37);

INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type, entity_id,
  entity_snapshot, changes, ip_network, country_code, city
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000801','2026-10-02T10:02:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','introduction','introduction_paragraph','literal_\\% \\_ %% __ %_ needle',
   '{"text":"snapshot-only-marker"}','{"text":{"before":"before","after":"50%_\\\\literal quote''s 管理员搜索"}}','188.253.112.0/24','HK','Hong Kong'),
  ('aaaaaaaa-0000-4000-8000-000000000802','2026-10-02T10:01:00Z','10000000-0000-4000-8000-000000000002',
   'QA@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','upload','files','resume_file','resume.pdf',
   '{"file_name":"resume.pdf","content_type":"application/pdf","size_bytes":10}','{}',NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000803','2026-10-02T10:00:00Z','10000000-0000-4000-8000-000000000002',
   NULL,'qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','delete','introduction','introduction_paragraph','intro-old',
   '{"text":"old"}','{}',NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000804','2026-10-02T10:03:00Z','10000000-0000-4000-8000-000000000002',
   'cursor@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','create','projects','project_entry','cursor-low',
   '{}','{}',NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000805','2026-10-02T10:03:00Z','10000000-0000-4000-8000-000000000002',
   'cursor@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','create','projects','project_entry','cursor-high',
   '{}','{}',NULL,NULL,NULL),
  ('aaaaaaaa-0000-4000-8000-000000000806','2026-10-02T09:59:00Z','10000000-0000-4000-8000-000000000002',
   'decoy@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','profile','profile_settings','literalX-decoy\\X',
   '{}','{}',NULL,NULL,NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100)),
  6, 'unfiltered V1.2 returns the target scoped events');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,section_filter=>'files')),
  1, 'section filter exact match');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,operation_filter=>'UPLOAD')),
  1, 'operation filter normalizes case and matches stored operation');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,actor_email_filter=>' QA@EXAMPLE.TEST ')),
  2, 'actor filter trims and compares case insensitively; NULL snapshot does not match');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,date_from=>'2026-10-02T10:01:00Z',date_to_exclusive=>'2026-10-02T10:02:00Z')),
  1, 'date interval includes its lower bound and excludes its upper bound');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'50%_\\\\literal')),
  1, 'search treats percent, underscore, and backslash literally');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'%')),1,'percent is searched literally rather than as a wildcard');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'literal_')),1,'underscore is searched literally rather than as a wildcard');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>E'\\')),2,'a literal backslash is searchable');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>E'\\%')),1,'backslash-percent sequence is literal');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>E'\\_')),1,'backslash-underscore sequence is literal');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'%%')),1,'double percent is searched literally');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'__')),1,'double underscore is searched literally');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'%_')),1,'percent-underscore sequence is searched literally');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'quote''s')),1,'single quotes remain data in the bound search value');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'管理员搜索')),1,'Unicode and Chinese substring search works');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>''' OR true --')),0,'SQL-looking quoted input remains a literal bound value');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'snapshot-only-marker')),
  0, 'search excludes entity_snapshot');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'qa@example.test')),
  0, 'search excludes actor email snapshots');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'Hong Kong')),
  0, 'search excludes approximate location metadata');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'resume.pdf')),
  1, 'search includes entity id');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>'resume_file')),
  1, 'search includes entity type');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,section_filter=>' ',operation_filter=>'   ')),
  6, 'blank textual filters normalize to NULL');
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,section_filter=>'introduction',operation_filter=>'update',actor_email_filter=>'qa@example.test',date_from=>'2026-10-02T10:02:00Z',date_to_exclusive=>'2026-10-02T10:03:00Z',search_query=>'50%_\\\\literal')),
  1, 'all filters combine with AND semantics');
SELECT extensions.is(
  (SELECT event.id::text FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',1) AS event),
  'aaaaaaaa-0000-4000-8000-000000000805', 'descending occurred_at then id order is retained');
SELECT extensions.is(
  (SELECT event.id::text FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',1,'2026-10-02T10:03:00Z','aaaaaaaa-0000-4000-8000-000000000805') AS event),
  'aaaaaaaa-0000-4000-8000-000000000804', 'strict tuple cursor returns equal-time lower UUID without duplication or skipping');
SELECT extensions.is(
  (SELECT event.id::text FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',1,'2026-10-02T10:03:00Z','aaaaaaaa-0000-4000-8000-000000000804') AS event),
  'aaaaaaaa-0000-4000-8000-000000000801', 'cursor after equal-time pair continues to next older timestamp');
SELECT extensions.ok(
  (SELECT event.ip_network = '188.253.112.0/24'::cidr AND event.country_code='HK' AND event.city='Hong Kong'
   FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',1,'2026-10-02T10:03:00Z','aaaaaaaa-0000-4000-8000-000000000804') AS event),
  'V1.1 event-time network and location projection remains available');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,NULL,'aaaaaaaa-0000-4000-8000-000000000801')$$,
  '22023', 'Both cursor fields must be provided together', 'half cursor rejected');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,section_filter=>'not-a-domain')$$,
  '22023', 'Invalid Activity Log section filter', 'invalid section rejected');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,operation_filter=>'publish')$$,
  '22023', 'Invalid Activity Log operation filter', 'invalid operation rejected');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,date_from=>'2026-10-03',date_to_exclusive=>'2026-10-02')$$,
  '22023', 'Invalid Activity Log date range', 'invalid date range rejected');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,search_query=>pg_catalog.repeat('x',129))$$,
  '22023', 'Activity Log search query is too long', 'search length is bounded');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',101)$$,
  '22023', 'page_limit must be between 1 and 100', 'page limits validated');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('10000000-0000-4000-8000-000000000001',100,search_query=>'anything')$$,
  '42501', 'Activity Log target is outside the caller scope', 'unauthorized target cannot be searched');
RESET ROLE;
UPDATE cms_private.resume_capabilities
SET enabled=false
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log';
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events_v12('ea111111-1111-4111-8111-111111111111',100,section_filter=>'introduction',search_query=>'50%')$$,
  '42501', 'Activity Log is disabled for this target', 'filters and search do not bypass disabled Activity Log capability');
RESET ROLE;
UPDATE cms_private.resume_capabilities
SET enabled=true
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log';
SELECT extensions.ok(
  has_function_privilege('authenticated','public.read_activity_log_events_v12(uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.read_activity_log_events_v12(uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz,text)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.read_activity_log_events_v12(uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz,text)','EXECUTE')
    AND NOT has_table_privilege('authenticated','cms_private.activity_log_events','SELECT')
    AND NOT has_table_privilege('anon','cms_private.activity_log_events','SELECT')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p,
        LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
      WHERE p.oid = 'public.read_activity_log_events_v12(uuid,integer,timestamptz,uuid,text,text,text,timestamptz,timestamptz,text)'::regprocedure
        AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ),
  'authenticated uses scoped RPC; no anon execution or direct table SELECT');

SELECT * FROM extensions.finish();
ROLLBACK;
