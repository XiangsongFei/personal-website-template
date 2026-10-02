-- TEST ONLY: Phase 0B foundation contract against the isolated local RLS lab.
BEGIN;
SELECT extensions.plan(11);

DO $modes$
DECLARE denied boolean;
BEGIN
  PERFORM public.rls_test_assert(
    (SELECT count(*) = 20 AND count(*) FILTER (WHERE write_mode='rpc') = 1
       AND count(*) FILTER (WHERE write_mode='direct') = 19
     FROM cms_private.resume_write_modes),
    'Phase 1 changes only the QA Introduction write mode'
  );
  PERFORM public.rls_test_assert(
    cms_private.get_resume_write_mode('ea111111-1111-4111-8111-111111111111','introduction')='rpc'
      AND cms_private.get_resume_write_mode('20000000-0000-4000-8000-000000000001','introduction')='direct',
    'QA Introduction is RPC while official Introduction remains direct'
  );

  DELETE FROM cms_private.resume_write_modes
  WHERE resume_id='20000000-0000-4000-8000-000000000001' AND domain_key='introduction';
  PERFORM public.rls_test_assert(
    cms_private.get_resume_write_mode('20000000-0000-4000-8000-000000000001','introduction') = 'direct',
    'missing write-mode configuration safely defaults to direct'
  );

  denied := false;
  BEGIN
    INSERT INTO cms_private.resume_write_modes(resume_id,domain_key,write_mode)
    VALUES ('20000000-0000-4000-8000-000000000001','introduction','unexpected');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'invalid write mode is rejected');

  denied := false;
  BEGIN
    PERFORM cms_private.get_resume_write_mode('20000000-0000-4000-8000-000000000001','unknown');
  EXCEPTION WHEN SQLSTATE '22023' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'unknown write domain is rejected');
END
$modes$;
SELECT extensions.pass('write mode is target/domain scoped and safely remains direct');

DO $capability_defaults$
BEGIN
  PERFORM public.rls_test_assert(
    (SELECT count(*)=1 FROM cms_private.resume_capabilities WHERE capability_key='activity_log' AND enabled
      AND resume_id='ea111111-1111-4111-8111-111111111111')
      AND NOT EXISTS(SELECT 1 FROM cms_private.resume_capabilities WHERE enabled AND resume_id <> 'ea111111-1111-4111-8111-111111111111'),
    'only the unpublished QA target has Activity Log enabled'
  );
  PERFORM public.rls_test_assert(
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='cms_private.activity_log_events'::regclass AND contype='f'),
    'historical events have no source-target foreign key'
  );
END
$capability_defaults$;
SELECT extensions.pass('capability absence is disabled and event history is independent');

DO $acl$
BEGIN
  PERFORM public.rls_test_assert(NOT has_schema_privilege('authenticated','cms_private','USAGE'), 'authenticated cannot enter private schema');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.activity_log_events','SELECT'), 'authenticated cannot read event table directly');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT'), 'authenticated cannot insert events directly');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.activity_log_events','UPDATE'), 'authenticated cannot update events directly');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.activity_log_events','DELETE'), 'authenticated cannot delete events directly');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.activity_log_events','TRUNCATE'), 'authenticated cannot truncate event history');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.resume_capabilities','SELECT'), 'authenticated cannot read capability configuration');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.resume_capabilities','UPDATE'), 'authenticated cannot change capability configuration');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.resume_write_modes','SELECT'), 'authenticated cannot read write-mode configuration');
  PERFORM public.rls_test_assert(NOT has_table_privilege('authenticated','cms_private.resume_write_modes','UPDATE'), 'authenticated cannot change write-mode configuration');
  PERFORM public.rls_test_assert(NOT has_table_privilege('service_role','cms_private.activity_log_events','SELECT'), 'service_role has no direct event-table access');
  PERFORM public.rls_test_assert(NOT has_table_privilege('service_role','cms_private.activity_log_events','INSERT') AND NOT has_table_privilege('service_role','cms_private.activity_log_events','UPDATE') AND NOT has_table_privilege('service_role','cms_private.activity_log_events','DELETE') AND NOT has_table_privilege('service_role','cms_private.activity_log_events','TRUNCATE'), 'service_role has no event-table mutation privileges');
  PERFORM public.rls_test_assert(NOT has_function_privilege('anon','public.activity_log_authorized_targets()','EXECUTE'), 'anon cannot execute target-list RPC');
  PERFORM public.rls_test_assert(NOT has_function_privilege('service_role','public.read_activity_log_events(uuid,integer,timestamptz,uuid)','EXECUTE'), 'service_role cannot execute read RPC');
  PERFORM public.rls_test_assert(has_function_privilege('authenticated','public.activity_log_authorized_targets()','EXECUTE'), 'authenticated can execute intended target-list RPC');
  PERFORM public.rls_test_assert(NOT has_function_privilege('authenticated','cms_private.assert_activity_log_target(uuid)','EXECUTE'), 'authenticated cannot execute internal authorization helper');
  PERFORM public.rls_test_assert(has_table_privilege('authenticated','public.resume_intro_paragraphs','INSERT'), 'existing authenticated CMS direct DML grant remains intact');
  PERFORM public.rls_test_assert(has_table_privilege('authenticated','public.resume_intro_paragraphs','UPDATE'), 'existing authenticated CMS update grant remains intact');
  PERFORM public.rls_test_assert(has_table_privilege('authenticated','public.resume_intro_paragraphs','DELETE'), 'existing authenticated CMS delete grant remains intact');
END
$acl$;
SELECT extensions.pass('new ACLs are private while existing direct CMS grants remain unchanged');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $direct_denials$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN PERFORM * FROM cms_private.activity_log_events; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'authenticated cannot SELECT event history directly');
  denied := false;
  BEGIN INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type) VALUES (auth.uid(),'owner','20000000-0000-4000-8000-000000000001','example-cv','create','awards','award_entry'); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'authenticated cannot INSERT audit events directly');
  denied := false;
  BEGIN UPDATE cms_private.activity_log_events SET occurred_at=now(); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'authenticated cannot UPDATE audit events directly');
  denied := false;
  BEGIN DELETE FROM cms_private.activity_log_events; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'authenticated cannot DELETE audit events directly');
  denied := false;
  BEGIN TRUNCATE cms_private.activity_log_events; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'authenticated cannot TRUNCATE audit events directly');
  denied := false;
  BEGIN INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled) VALUES ('ea111111-1111-4111-8111-111111111111','activity_log',true); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'QA cannot enable its own capability');
  denied := false;
  BEGIN UPDATE cms_private.resume_write_modes SET write_mode='rpc'; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  PERFORM public.rls_test_assert(denied, 'client cannot change write-mode configuration');
END
$direct_denials$;
RESET ROLE;
SELECT extensions.pass('authenticated direct access and client configuration changes are denied');

DO $event_constraints$
DECLARE denied boolean;
BEGIN
  INSERT INTO cms_private.activity_log_events(
    id, occurred_at, actor_user_id, actor_role_snapshot, resume_id,
    site_key_snapshot, operation, section_key, entity_type, entity_id,
    entity_snapshot, changes
  ) VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001','2026-01-01T00:00:01Z','10000000-0000-4000-8000-000000000001','owner','ea111111-1111-4111-8111-111111111111','example-cv-qa','create','awards','award_entry','award-1','{"name":"Research Award","year":"2025","position":0}','{}'),
    ('aaaaaaaa-0000-4000-8000-000000000002','2026-01-01T00:00:02Z','10000000-0000-4000-8000-000000000001','owner','ea111111-1111-4111-8111-111111111111','example-cv-qa','update','awards','award_entry','award-1','{"name":"Research Award","year":"2026","position":0}','{"year":{"before":"2025","after":"2026"}}'),
    ('aaaaaaaa-0000-4000-8000-000000000003','2026-01-01T00:00:03Z','10000000-0000-4000-8000-000000000001','owner','ffffffff-1111-4111-8111-111111111111','example-cv','delete','awards','award_entry','orphaned-source-id','{"name":"Historical Award","year":"2020","position":1}','{}');

  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001','example-cv','execute','awards','award_entry');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'operation allowlist rejects unknown events');

  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_snapshot)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001','example-cv','create','awards','award_entry','{"source_key":"unapproved raw row field"}');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'entity payload allowlist rejects arbitrary row fields');

  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,entity_snapshot)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001','example-cv','create','projects','award_entry','{"name":{"nested":"not a scalar field value"}}');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'entity and section type mismatch is rejected');

  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,changes)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001','example-cv','update','awards','award_entry','{"year":{"before":{"raw":"row"},"after":"2026"}}');
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'nested arbitrary change values are rejected');

  denied := false;
  BEGIN
    INSERT INTO cms_private.activity_log_events(actor_user_id,actor_role_snapshot,resume_id,site_key_snapshot,operation,section_key,entity_type,payload_version)
    VALUES ('10000000-0000-4000-8000-000000000001','owner','20000000-0000-4000-8000-000000000001','example-cv','create','awards','award_entry',2);
  EXCEPTION WHEN check_violation THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'unsupported payload version is rejected');

  denied := false;
  BEGIN
    UPDATE cms_private.activity_log_events SET entity_snapshot='{}'
    WHERE id='aaaaaaaa-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '55000' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'event updates are rejected by immutable trigger');

  denied := false;
  BEGIN
    DELETE FROM cms_private.activity_log_events WHERE id='aaaaaaaa-0000-4000-8000-000000000001';
  EXCEPTION WHEN SQLSTATE '55000' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'event deletes are rejected by immutable trigger');

  denied := false;
  BEGIN
    TRUNCATE cms_private.activity_log_events;
  EXCEPTION WHEN SQLSTATE '55000' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'event truncation is rejected by immutable trigger');
END
$event_constraints$;
SELECT extensions.pass('event allowlists, versioning, no-FK history, and immutability');

INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('ea111111-1111-4111-8111-111111111111','activity_log',true)
ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=EXCLUDED.enabled;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $owner_reads$
DECLARE first_id uuid; first_time timestamptz; second_id uuid; second_time timestamptz; denied boolean;
BEGIN
  PERFORM public.rls_test_assert((SELECT count(*)=1 AND min(site_key)='example-cv-qa' FROM public.activity_log_authorized_targets()), 'Owner sees only the enabled, authorized QA target');
  SELECT event.id,event.occurred_at INTO first_id,first_time
  FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',1) AS event;
  PERFORM public.rls_test_assert(first_id='aaaaaaaa-0000-4000-8000-000000000002', 'read RPC returns newest event first');
  SELECT event.id,event.occurred_at INTO second_id,second_time
  FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',1,first_time,first_id) AS event;
  PERFORM public.rls_test_assert(second_id='aaaaaaaa-0000-4000-8000-000000000001', 'keyset cursor returns the stable next event');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',50,second_time,second_id)), 'empty page is returned when history is exhausted');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events('20000000-0000-4000-8000-000000000001',50);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'Owner cannot read the disabled official target');
END
$owner_reads$;
RESET ROLE;
INSERT INTO cms_private.resume_capabilities(resume_id,capability_key,enabled)
VALUES ('20000000-0000-4000-8000-000000000001','activity_log',true)
ON CONFLICT (resume_id,capability_key) DO UPDATE SET enabled=EXCLUDED.enabled;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $owner_enabled_official$
BEGIN
  PERFORM public.rls_test_assert((SELECT count(*)=2 FROM public.activity_log_authorized_targets()), 'Owner target list includes each independently authorized enabled target');
  PERFORM public.rls_test_assert((SELECT count(*)=0 FROM public.read_activity_log_events('20000000-0000-4000-8000-000000000001',50)), 'Owner can read enabled official history');
END
$owner_enabled_official$;
RESET ROLE;
SELECT extensions.pass('Owner log target scope, inactive official capability, and stable pagination');

UPDATE cms_private.resume_capabilities
SET enabled=true
WHERE resume_id='20000000-0000-4000-8000-000000000001' AND capability_key='activity_log';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $qa_reads$
DECLARE denied boolean;
BEGIN
  PERFORM public.rls_test_assert((SELECT count(*)=1 AND min(site_key)='example-cv-qa' FROM public.activity_log_authorized_targets()), 'QA lists only its bound enabled unpublished QA target');
  PERFORM public.rls_test_assert((SELECT count(*)=2 FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',50)), 'QA reads its own authorized QA history');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events('20000000-0000-4000-8000-000000000001',50);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'QA cannot read official even when official capability is enabled');
END
$qa_reads$;
SELECT extensions.pass('QA cannot enumerate or read the official target');
RESET ROLE;

UPDATE cms_private.resume_capabilities
SET enabled=false
WHERE resume_id='ea111111-1111-4111-8111-111111111111' AND capability_key='activity_log';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $disabled_qa$
DECLARE denied boolean;
BEGIN
  PERFORM public.rls_test_assert(NOT EXISTS (SELECT 1 FROM public.activity_log_authorized_targets()), 'disabled QA capability removes QA from target list');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',50);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'disabled QA capability denies direct read RPC');
END
$disabled_qa$;
SELECT extensions.pass('disabled target capability denies target listing and event reads');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $anon_denied$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN
    PERFORM * FROM public.activity_log_authorized_targets();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'anon cannot execute Activity Log target-list RPC');
END
$anon_denied$;
SELECT extensions.pass('anonymous Activity Log access rejected');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $non_admin_denied$
DECLARE denied boolean;
BEGIN
  denied := false;
  BEGIN
    PERFORM * FROM public.activity_log_authorized_targets();
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'non-admin authenticated user cannot list Activity Log targets');
  denied := false;
  BEGIN
    PERFORM * FROM public.read_activity_log_events('ea111111-1111-4111-8111-111111111111',50);
  EXCEPTION WHEN SQLSTATE '42501' THEN denied := true;
  END;
  PERFORM public.rls_test_assert(denied, 'caller-supplied target ID does not authorize an event read');
END
$non_admin_denied$;
SELECT extensions.pass('non-admin rejected and caller-supplied target ID is not authority');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $regression$
BEGIN
  PERFORM public.rls_test_assert(public.is_resume_admin(), 'existing Admin gate remains unchanged');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.get_admin_resume_target() WHERE site_key='example-cv' AND role='owner'), 'existing Owner target resolution remains official');
  PERFORM public.rls_test_assert(public.can_manage_resume('20000000-0000-4000-8000-000000000001'), 'existing Owner authorization still covers official target');
  PERFORM public.rls_test_assert(public.can_manage_resume('ea111111-1111-4111-8111-111111111111'), 'existing Owner authorization still covers QA target');
  PERFORM public.rls_test_assert((SELECT count(*)=1 FROM public.resume_profile WHERE resume_id='20000000-0000-4000-8000-000000000001'), 'published content read path remains intact');
  PERFORM public.rls_test_assert(has_table_privilege('authenticated','public.resume_intro_paragraphs','INSERT') AND has_table_privilege('authenticated','public.resume_intro_paragraphs','UPDATE') AND has_table_privilege('authenticated','public.resume_intro_paragraphs','DELETE'), 'current direct CMS DML grants remain intact');
END
$regression$;
SELECT extensions.pass('existing Admin authorization, published reads, and direct DML contract preserved');

SELECT * FROM extensions.finish();
ROLLBACK;
