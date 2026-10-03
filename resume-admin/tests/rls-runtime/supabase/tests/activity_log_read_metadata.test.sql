-- TEST ONLY: verify the additive location projection through the authorized read RPC.
BEGIN;
SELECT extensions.plan(5);

INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type,
  entity_id, entity_snapshot, changes, ip_network, country_code, region, city
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000701','2026-01-02T00:00:02Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa',
   'update','introduction','introduction_paragraph','intro-1','{"position":0,"text":"Updated"}',
   '{"text":{"before":"Before","after":"After"}}','188.253.112.0/24','HK',NULL,'Hong Kong'),
  ('aaaaaaaa-0000-4000-8000-000000000702','2026-01-02T00:00:01Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa',
   'update','introduction','introduction_paragraph','intro-1','{"position":0,"text":"Historical"}',
   '{}',NULL,NULL,NULL,NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);

SELECT extensions.ok(
  (SELECT event.ip_network = '188.253.112.0/24'::cidr
      AND event.country_code = 'HK' AND event.region IS NULL AND event.city = 'Hong Kong'
   FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111', 1) AS event),
  'authorized read RPC returns the event-time IP network and location snapshot'
);
SELECT extensions.ok(
  (SELECT event.ip_network IS NULL AND event.country_code IS NULL
      AND event.region IS NULL AND event.city IS NULL
   FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111', 1,
     '2026-01-02T00:00:02Z', 'aaaaaaaa-0000-4000-8000-000000000701') AS event),
  'historical events retain NULL location metadata'
);
SELECT extensions.is(
  (SELECT event.id::text FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111', 1) AS event),
  'aaaaaaaa-0000-4000-8000-000000000701',
  'descending event ordering and page limit remain unchanged'
);
SELECT extensions.ok(
  has_function_privilege('authenticated','public.read_activity_log_events(uuid,integer,timestamptz,uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.read_activity_log_events(uuid,integer,timestamptz,uuid)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.read_activity_log_events(uuid,integer,timestamptz,uuid)','EXECUTE'),
  'read RPC remains executable only by authenticated clients among API roles'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_activity_log_events('20000000-0000-4000-8000-000000000001', 1)$$,
  '42501', 'Activity Log is disabled for this target', 'disabled official target remains inaccessible'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
