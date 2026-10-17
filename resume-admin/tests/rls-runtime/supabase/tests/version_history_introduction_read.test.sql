-- TEST ONLY: isolated Introduction history reader contract.
BEGIN;
SELECT extensions.plan(18);

DO $seeded_targets$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resume_sites
      WHERE id='20000000-0000-4000-8000-000000000001' AND site_key='example-cv')
    OR NOT EXISTS (SELECT 1 FROM public.resume_sites
      WHERE id='ea111111-1111-4111-8111-111111111111' AND site_key='example-cv-qa-activity-log') THEN
    RAISE EXCEPTION 'Seeded Owner and Test targets are required for isolation assertions';
  END IF;
END
$seeded_targets$;

INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type, entity_id,
  entity_snapshot, changes, payload_version
) VALUES (
  'aaaaaaaa-0000-4000-8000-000000000b01','2026-10-11T12:00:00Z','10000000-0000-4000-8000-000000000002',
  'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
  'update','introduction','introduction_paragraph','introduction',
  '{"paragraphs":[{"id":"bbbbbbbb-0000-4000-8000-000000000b01","position":1,"text_en":"New","text_zh":"新"}]}',
  '{"text_en":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b01","value":"Old"}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b01","value":"New"}]},"text_zh":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b01","value":"旧"}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b01","value":"新"}]},"position":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b01","value":0}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b01","value":1}]}}',1
);

-- Valid Phase 1 edge shapes: empty arrays, unrelated IDs, and fractional/negative positions.
INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type, entity_id,
  entity_snapshot, changes, payload_version
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000b04','2026-10-11T09:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','bbbbbbbb-0000-4000-8000-000000000b04',
   '{"paragraphs":[]}','{"text_en":{"before":[],"after":[]}}',1),
  ('aaaaaaaa-0000-4000-8000-000000000b05','2026-10-11T08:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction',
   '{"paragraphs":[]}',
   '{"text_en":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b05","value":"Removed"}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b06","value":"Added"}]}}',1),
  ('aaaaaaaa-0000-4000-8000-000000000b06','2026-10-11T07:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction',
   '{"paragraphs":[]}',
   '{"position":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b07","value":-1.25}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b07","value":1.5}]}}',1),
  -- The writer coalesces IDs on both sides and represents a missing row as JSON null.
  ('aaaaaaaa-0000-4000-8000-000000000b07','2026-10-11T06:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction',
   '{"paragraphs":[{"id":"bbbbbbbb-0000-4000-8000-000000000b08","position":0,"text_en":"Added","text_zh":"新增"}]}',
   '{"text_en":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b08","value":null}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b08","value":"Added"}]},"text_zh":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b08","value":null}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b08","value":"新增"}]},"position":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b08","value":null}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b08","value":0}]}}',1),
  ('aaaaaaaa-0000-4000-8000-000000000b08','2026-10-11T05:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction',
   '{"paragraphs":[]}',
   '{"text_en":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b09","value":"Removed"}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b09","value":null}]},"text_zh":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b09","value":"删除"}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b09","value":null}]},"position":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b09","value":0}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b09","value":null}]}}',1),
  ('aaaaaaaa-0000-4000-8000-000000000b09','2026-10-11T04:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction',
   '{"paragraphs":[{"id":"bbbbbbbb-0000-4000-8000-000000000b10","position":1,"text_en":"Same","text_zh":"不变"}]}',
   '{"position":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b10","value":0}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b10","value":1}]}}',1),
  ('aaaaaaaa-0000-4000-8000-000000000b10','2026-10-11T03:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction',
   '{"paragraphs":[]}',
   '{"text_en":{"before":[{"id":"bbbbbbbb-0000-4000-8000-000000000b11","value":null}],"after":[{"id":"bbbbbbbb-0000-4000-8000-000000000b11","value":null}]}}',1);

-- Defensive unknown and malformed history is tested only inside this rollback-only transaction.
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_events_payload_version_check;
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_payload_allowlist_check;
-- The unknown-version fixture also needs to bypass the section/version pairing check.
ALTER TABLE cms_private.activity_log_events DROP CONSTRAINT activity_log_entity_section_check;
INSERT INTO cms_private.activity_log_events (
  id, occurred_at, actor_user_id, actor_email_snapshot, actor_role_snapshot,
  resume_id, site_key_snapshot, operation, section_key, entity_type, entity_id,
  entity_snapshot, changes, payload_version
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000b02','2026-10-11T11:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction','{"raw":"private"}','{"raw":"private"}',1),
  ('aaaaaaaa-0000-4000-8000-000000000b03','2026-10-11T10:00:00Z','10000000-0000-4000-8000-000000000002',
   'qa@example.test','qa','ea111111-1111-4111-8111-111111111111','example-cv-qa-activity-log',
   'update','introduction','introduction_paragraph','introduction','{"raw":"private"}','{"raw":"private"}',99);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"qa@example.test"}',true);

SELECT extensions.is((SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)),
  10,'authorized Test history includes all valid, malformed, and unknown Introduction entries');
SELECT extensions.is((SELECT comparison_kind FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b01'), 'paragraph_changes','validated paragraph arrays get a distinct comparison kind');
SELECT extensions.ok((SELECT comparison->'paragraphs'->0->'fields'->'text_en'->>'before' = 'Old'
  AND comparison->'paragraphs'->0->'fields'->'text_zh'->>'after' = '新'
  AND comparison->'paragraphs'->0->'fields'->'position'->>'after' = '1'
  FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b01'),'bilingual text and position changes survive ID-free projection');
SELECT extensions.is((SELECT comparison->'paragraphs'->0->>'state' FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b01'),'updated','changed non-null text remains updated');
SELECT extensions.ok((SELECT comparison_kind='paragraph_changes' AND comparison='{"paragraphs":[]}'::jsonb
  FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b04'),'empty paragraph arrays remain visible as a generic-capable comparison');
SELECT extensions.ok((SELECT comparison->'paragraphs' @> '[{"state":"removed"},{"state":"added"}]'::jsonb
  FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b05'),'different paragraph IDs become distinct removal and addition');
SELECT extensions.ok((SELECT comparison->'paragraphs'->0->'fields'->'position'->>'before' = '-1.25'
  AND comparison->'paragraphs'->0->'fields'->'position'->>'after' = '1.5'
  FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b06'),'numeric positions retain their recorded values');
SELECT extensions.is((SELECT comparison->'paragraphs'->0->>'state' FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b07'),'added','writer-shaped null-before paragraph is added');
SELECT extensions.is((SELECT comparison->'paragraphs'->0->>'state' FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b08'),'removed','writer-shaped null-after paragraph is removed');
SELECT extensions.is((SELECT comparison->'paragraphs'->0->>'state' FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b09'),'updated','position-only change remains an update for reorder presentation');
SELECT extensions.ok((SELECT comparison_kind='paragraph_changes' AND comparison='{"paragraphs":[]}'::jsonb
  FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b10'),'null on both sides produces no invented paragraph change');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE entity_id IS NOT NULL OR comparison::text ~* 'bbbbbbbb-0000-4000-8000-000000000b(0[1-9]|1[01])'),0,
  'Introduction API rows expose no paragraph IDs, including entity_id');
SELECT extensions.is((SELECT comparison_kind FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b02'), 'unavailable','malformed known Introduction remains a generic entry');
SELECT extensions.is((SELECT comparison_kind FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE event_id='aaaaaaaa-0000-4000-8000-000000000b03'), 'unavailable','unknown Introduction format remains a generic entry');
SELECT extensions.is((SELECT count(*)::integer FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',100)
  WHERE comparison::text LIKE '%private%'),0,'raw malformed payload never passes through');
SELECT extensions.is((SELECT array_agg(event_id::text ORDER BY occurred_at DESC,event_id DESC)
  FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',2)),
  ARRAY['aaaaaaaa-0000-4000-8000-000000000b01','aaaaaaaa-0000-4000-8000-000000000b02']::text[],
  'Introduction entries preserve newest-first keyset ordering');
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('20000000-0000-4000-8000-000000000001',25)$$,
  '42501',NULL,'Test administrator cannot read the seeded Owner target');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.read_version_history_v1('ea111111-1111-4111-8111-111111111111',25)$$,
  '42501',NULL,'Owner administrator cannot read the seeded Test target');
ROLLBACK;
