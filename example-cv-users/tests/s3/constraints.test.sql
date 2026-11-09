-- NOT RUN. Only after separate isolated target/SQL approval. Never production.
\set ON_ERROR_STOP on
BEGIN;
\ir fixtures.sql
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM site_data.sites),'positive fixtures');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM site_data.site_members m JOIN site_data.sites s ON s.id=m.site_id AND s.owner_auth_user_id=m.auth_user_id),'owner mirrors');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM site_data.site_publications WHERE state='unpublished' AND snapshot_id IS NULL AND publication_revision=0),'publication initial');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.sites(owner_auth_user_id) VALUES('a3300000-0000-4000-8000-000000000001')$q$,'23505');
SELECT pg_temp.expect_error($q$DO $b$ BEGIN
 INSERT INTO site_data.sites(owner_auth_user_id) VALUES('a3300000-0000-4000-8000-000000000003');
 SET CONSTRAINTS ALL IMMEDIATE;
 END; $b$$q$,'23514');
-- F2: valid authoritative Owner + exact active mirror, ONLY publication absent.
-- Preconditions use P0001 assertions, distinct from expected invariant 23514.
SELECT pg_temp.expect_error($q$DO $b$
DECLARE sid uuid := 'a3300000-0000-4000-8000-000000000004';
        uid uuid := 'a3300000-0000-4000-8000-000000000003';
BEGIN
 INSERT INTO site_data.sites(id,owner_auth_user_id) VALUES(sid,uid);
 INSERT INTO site_data.site_members(site_id,auth_user_id,role,state)
 VALUES(sid,uid,'owner','active');
 PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM site_data.site_members m
  JOIN site_data.sites s ON s.id=m.site_id AND s.owner_auth_user_id=m.auth_user_id
  WHERE s.id=sid AND m.auth_user_id=uid AND m.role='owner' AND m.state='active'),
  'F2 matching active Owner must exist');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM site_data.site_publications p
  WHERE p.site_id=sid),'F2 publication must be absent');
 -- Exercise the named site trigger only after asserting the valid Owner above.
 SET CONSTRAINTS site_data.sites_integrity IMMEDIATE;
END; $b$$q$,'23514');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM site_data.sites
 WHERE id='a3300000-0000-4000-8000-000000000004'
 OR owner_auth_user_id='a3300000-0000-4000-8000-000000000003'),'F2 no residual site');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM site_data.site_members
 WHERE site_id='a3300000-0000-4000-8000-000000000004'
 OR auth_user_id='a3300000-0000-4000-8000-000000000003'),'F2 no residual mirror');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM site_data.site_publications
 WHERE site_id='a3300000-0000-4000-8000-000000000004'),'F2 no residual publication');
SELECT pg_temp.expect_error($q$DO $b$ BEGIN
 DELETE FROM site_data.site_members WHERE auth_user_id='a3300000-0000-4000-8000-000000000001';
 SET CONSTRAINTS ALL IMMEDIATE;
 END; $b$$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE site_data.sites SET owner_auth_user_id='a3300000-0000-4000-8000-000000000003' WHERE owner_auth_user_id='a3300000-0000-4000-8000-000000000001'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE site_data.site_members SET role='admin'$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.site_domains(site_id,slug,hostname_normalized) SELECT id,'admin','admin.sites.example.test' FROM fixture_sites WHERE label='alice'$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.site_domains(site_id,slug,hostname_normalized,is_primary) SELECT id,'alice','alice.sites.example.test',false FROM fixture_sites WHERE label='bob'$q$,'23505');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.site_domains(site_id,slug,hostname_normalized,is_primary) SELECT id,'Alice','Alice.sites.example.test',false FROM fixture_sites WHERE label='bob'$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.intro_translations(site_id,parent_id,locale,text) SELECT a.id,e.id,'en','cross site' FROM fixture_sites a JOIN site_data.intro_entries e ON e.site_id=(SELECT id FROM fixture_sites WHERE label='bob') WHERE a.label='alice'$q$,'23503');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.site_locales(site_id,locale) SELECT id,'fr' FROM fixture_sites WHERE label='alice'$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE site_data.intro_entries SET site_id=(SELECT id FROM fixture_sites WHERE label='bob') WHERE site_id=(SELECT id FROM fixture_sites WHERE label='alice')$q$,'23514');
-- INSERT checks avoid masking the publication CHECK behind the UPDATE guard.
SELECT pg_temp.expect_error($q$INSERT INTO site_data.site_publications(site_id,state) VALUES(gen_random_uuid(),'published')$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.site_publications(site_id,snapshot_id) VALUES(gen_random_uuid(),gen_random_uuid())$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO site_data.site_publications(site_id,publication_revision) VALUES(gen_random_uuid(),1)$q$,'23514');
SELECT pg_temp.expect_error($q$DELETE FROM site_data.site_publications$q$,'23514');
SELECT pg_temp.expect_error($q$UPDATE site_data.site_publications SET state='published'$q$,'23514');
CREATE FUNCTION pg_temp.expect_receipt_conflict(statement text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE actual_state text; actual_schema text; actual_table text; actual_key text;
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE,
   actual_schema = SCHEMA_NAME, actual_table = TABLE_NAME, actual_key = CONSTRAINT_NAME;
  IF actual_schema = 'site_private' AND actual_table = 'operation_requests'
     AND actual_key IN ('create_site_request_key', 'operation_requests_site_id_actor_auth_user_id_operation_req_key') THEN
   RETURN format('%s %s.%s %s', actual_state, actual_schema, actual_table, actual_key);
  END IF;
  RAISE EXCEPTION 'unexpected receipt uniqueness source: %.% %', actual_schema, actual_table, actual_key
   USING ERRCODE = 'P3301';
 END;
 RAISE EXCEPTION 'duplicate receipt unexpectedly succeeded';
END;
$fn$;
SELECT pg_temp.expect_receipt_conflict($q$INSERT INTO site_private.operation_requests(site_id,actor_auth_user_id,actor_session_id,operation,request_id,payload_digest,state,result_schema_version,result,expires_at)
 SELECT site_id,actor_auth_user_id,actor_session_id,operation,request_id,payload_digest,state,result_schema_version,result,expires_at FROM site_private.operation_requests LIMIT 1$q$);
SELECT pg_temp.expect_receipt_conflict($q$INSERT INTO site_private.operation_requests(site_id,actor_auth_user_id,actor_session_id,operation,request_id,payload_digest,state,result_schema_version,result,expires_at)
 SELECT site_id,actor_auth_user_id,actor_session_id,operation,request_id,repeat('c',64),state,result_schema_version,result,expires_at FROM site_private.operation_requests LIMIT 1$q$);
-- A primary-key collision with a fresh request key is not an idempotency conflict.
SELECT pg_temp.expect_error($q$SELECT pg_temp.expect_receipt_conflict($s$
 INSERT INTO site_private.operation_requests(id,site_id,actor_auth_user_id,actor_session_id,operation,request_id,payload_digest,state,result_schema_version,result,expires_at)
 SELECT id,site_id,actor_auth_user_id,actor_session_id,operation,gen_random_uuid(),payload_digest,state,result_schema_version,result,expires_at FROM site_private.operation_requests LIMIT 1
$s$)$q$,'P3301');
SELECT pg_temp.expect_error($q$UPDATE site_private.operation_requests SET payload_digest=repeat('c',64)$q$,'23514');
SELECT pg_temp.expect_error($q$INSERT INTO site_private.operation_requests(site_id,actor_auth_user_id,actor_session_id,operation,request_id,payload_digest,state,result_schema_version,result,expires_at)
 SELECT site_id,actor_auth_user_id,actor_session_id,operation,gen_random_uuid(),payload_digest,state,result_schema_version,'{"site_id":null}'::jsonb,expires_at FROM site_private.operation_requests LIMIT 1$q$,'23514');
SELECT pg_temp.expect_error($q$DELETE FROM site_private.site_audit_events$q$,'23514');
SELECT pg_temp.expect_error($q$DO $b$ BEGIN
 PERFORM pg_temp.make_site('a3300000-0000-4000-8000-000000000003','charlie');
 RAISE EXCEPTION 'injected failure' USING ERRCODE='P0001'; END; $b$$q$,'P0001');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM site_data.sites),'failure leaves no site');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM site_private.operation_requests),'failure leaves no receipt');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM site_private.site_audit_events),'failure leaves no audit');
INSERT INTO site_private.user_security_state(auth_user_id) VALUES('a3300000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_true((SELECT NOT business_enabled AND security_hold FROM site_private.user_security_state),'security closed defaults');
UPDATE site_private.user_security_state SET security_epoch=2;
SELECT pg_temp.expect_error($q$UPDATE site_private.user_security_state SET security_epoch=1$q$,'23514');
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
