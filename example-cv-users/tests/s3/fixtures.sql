-- CANDIDATE ONLY. Include inside an approved isolated superuser transaction.
-- Fake Auth rows have no passwords. These are NOT normal JWT/grant fixtures.
CREATE FUNCTION pg_temp.assert_true(value boolean, label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF;
END;
$fn$;
CREATE FUNCTION pg_temp.expect_error(statement text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE actual text;
BEGIN
 BEGIN
  EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE;
  IF actual <> expected_state THEN RAISE EXCEPTION 'wrong SQLSTATE: expected %, got %', expected_state, actual; END IF;
  RETURN;
 END;
 RAISE EXCEPTION 'statement unexpectedly succeeded';
END;
$fn$;
INSERT INTO auth.users(id, email) VALUES
 ('a3300000-0000-4000-8000-000000000001','alice@example.test'),
 ('a3300000-0000-4000-8000-000000000002','bob@example.test'),
 ('a3300000-0000-4000-8000-000000000003','charlie@example.test');
CREATE FUNCTION pg_temp.make_site(uid uuid, label text) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE sid uuid := gen_random_uuid(); oid uuid := gen_random_uuid(); eid uuid := gen_random_uuid();
BEGIN
 INSERT INTO site_data.sites(id,owner_auth_user_id) VALUES(sid,uid);
 INSERT INTO site_data.site_members(site_id,auth_user_id,role,state) VALUES(sid,uid,'owner','active');
 INSERT INTO site_data.site_domains(site_id,slug,hostname_normalized) VALUES(sid,label,label || '.sites.example.test');
 INSERT INTO site_data.site_locales(site_id,locale) VALUES(sid,'zh'),(sid,'en');
 INSERT INTO site_data.site_settings(site_id) VALUES(sid);
 INSERT INTO site_data.section_state(site_id,section_key) VALUES(sid,'introduction');
 INSERT INTO site_data.site_publications(site_id,changed_by) VALUES(sid,uid);
 INSERT INTO site_data.intro_entries(id,site_id,position) VALUES(eid,sid,0);
 INSERT INTO site_data.intro_translations(site_id,parent_id,locale,text) VALUES
 (sid,eid,'zh',label || ' 虚构介绍'),(sid,eid,'en',label || ' fictional introduction');
 INSERT INTO site_private.operation_requests(id,site_id,actor_auth_user_id,actor_session_id,operation,request_id,payload_digest,state,result_schema_version,result,expires_at)
 VALUES(oid,sid,uid,gen_random_uuid(),'create_site',gen_random_uuid(),repeat('a',64),'succeeded',1,jsonb_build_object('site_id',sid),now()+interval '7 days');
 INSERT INTO site_data.draft_revisions(site_id,site_revision,section_key,section_revision,schema_version,payload,digest,actor_auth_user_id,operation_id)
 VALUES(sid,0,'introduction',0,1,jsonb_build_object('fixture',label),repeat('b',64),uid,oid);
 INSERT INTO site_private.site_audit_events(site_id,actor_auth_user_id,action,section,operation_id,result)
 VALUES(sid,uid,'create_site','introduction',oid,'succeeded');
 RETURN sid;
END;
$fn$;
CREATE TEMP TABLE fixture_sites(label text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO fixture_sites VALUES
 ('alice',pg_temp.make_site('a3300000-0000-4000-8000-000000000001','alice')),
 ('bob',pg_temp.make_site('a3300000-0000-4000-8000-000000000002','bob'));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
