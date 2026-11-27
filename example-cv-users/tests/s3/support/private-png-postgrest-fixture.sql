-- Disposable local fixture. No installation or hosted grants.
CREATE ROLE fixture_png_writer LOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE fixture_png_reader LOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE fixture_png_seal NOLOGIN NOBYPASSRLS;
CREATE ROLE fixture_png_complete NOLOGIN NOBYPASSRLS;
CREATE ROLE fixture_png_close NOLOGIN NOBYPASSRLS;
CREATE ROLE fixture_png_observe NOLOGIN NOBYPASSRLS;
GRANT fixture_png_seal, fixture_png_complete, fixture_png_close TO fixture_png_writer;
GRANT fixture_png_observe TO fixture_png_reader;

CREATE SCHEMA IF NOT EXISTS site_api;
CREATE SCHEMA fixture_png;
REVOKE ALL ON SCHEMA site_api, fixture_png FROM PUBLIC;
GRANT USAGE ON SCHEMA site_api, fixture_png TO
  fixture_png_seal, fixture_png_complete, fixture_png_close, fixture_png_observe;

CREATE TABLE fixture_png.pin (
  run_id uuid PRIMARY KEY, project text NOT NULL, keys jsonb NOT NULL, intents jsonb NOT NULL,
  receipt jsonb, verifier_sha256 text, lifecycle_open boolean NOT NULL DEFAULT true,
  CHECK ((receipt IS NULL) = (verifier_sha256 IS NULL))
);
CREATE TABLE fixture_png.effects (
  run_id uuid NOT NULL REFERENCES fixture_png.pin, request_id uuid PRIMARY KEY, step text NOT NULL,
  intent_sha256 text NOT NULL, txid xid8 NOT NULL DEFAULT pg_current_xact_id(), execution_role name NOT NULL DEFAULT current_user,
  seal_request_id uuid, seal_xid xid8, UNIQUE (run_id,step)
);
GRANT SELECT ON fixture_png.pin, fixture_png.effects TO
  fixture_png_seal, fixture_png_complete, fixture_png_close, fixture_png_observe;
GRANT UPDATE (lifecycle_open) ON fixture_png.pin TO fixture_png_close;
GRANT INSERT ON fixture_png.effects TO fixture_png_seal, fixture_png_complete, fixture_png_close;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO
  fixture_png_seal, fixture_png_complete, fixture_png_close, fixture_png_observe;

CREATE FUNCTION site_api.observe_identity() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('connection_role',session_user,'execution_role',current_user,'target_fingerprint',
    encode(sha256(convert_to((SELECT system_identifier::text FROM pg_control_system()) || '/' ||
      (SELECT oid::text FROM pg_database WHERE datname=current_database()),'UTF8')),'hex'));
$$;

CREATE FUNCTION site_api.s35_png_seal(p_project text,p_run uuid,p_request uuid,p_intent text,p_receipt jsonb,p_receipt_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text,35));
  PERFORM FROM fixture_png.pin f WHERE f.run_id=p_run AND f.project=p_project AND f.lifecycle_open
    AND f.keys->>'seal'=p_request::text AND f.intents->>'seal'=p_intent
    AND f.receipt=p_receipt AND f.verifier_sha256=p_receipt_sha;
  IF NOT FOUND OR current_user<>'fixture_png_seal' THEN RAISE EXCEPTION 'fixture seal denied' USING ERRCODE='42501'; END IF;
  INSERT INTO fixture_png.effects(run_id,request_id,step,intent_sha256) VALUES (p_run,p_request,'seal',p_intent);
  RETURN jsonb_build_object('request_id',p_request,'accepted',true,'execution_role',current_user,'connection_role',session_user);
END $$;

CREATE FUNCTION site_api.s35_png_complete(p_project text,p_run uuid,p_request uuid,p_intent text,p_receipt jsonb,p_receipt_sha text,
  p_seal_request uuid,p_seal_xid text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text,35));
  PERFORM FROM fixture_png.pin f JOIN fixture_png.effects e ON e.run_id=f.run_id AND e.step='seal'
  WHERE f.run_id=p_run AND f.project=p_project AND f.lifecycle_open
    AND f.keys->>'complete'=p_request::text AND f.intents->>'complete'=p_intent
    AND f.receipt=p_receipt AND f.verifier_sha256=p_receipt_sha AND e.request_id=p_seal_request
    AND e.txid::text=p_seal_xid AND pg_xact_status(e.txid)='committed';
  IF NOT FOUND OR current_user<>'fixture_png_complete' THEN RAISE EXCEPTION 'fixture complete denied' USING ERRCODE='42501'; END IF;
  INSERT INTO fixture_png.effects(run_id,request_id,step,intent_sha256,seal_request_id,seal_xid)
  VALUES (p_run,p_request,'complete',p_intent,p_seal_request,p_seal_xid::xid8);
  RETURN jsonb_build_object('request_id',p_request,'accepted',true,'execution_role',current_user,'connection_role',session_user);
END $$;

CREATE FUNCTION site_api.s35_png_close(p_project text,p_run uuid,p_request uuid,p_intent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text,35));
  UPDATE fixture_png.pin f SET lifecycle_open=false WHERE f.run_id=p_run AND f.project=p_project AND f.lifecycle_open
    AND f.keys->>'close'=p_request::text AND f.intents->>'close'=p_intent;
  IF NOT FOUND OR current_user<>'fixture_png_close' THEN RAISE EXCEPTION 'fixture close denied' USING ERRCODE='42501'; END IF;
  INSERT INTO fixture_png.effects(run_id,request_id,step,intent_sha256) VALUES (p_run,p_request,'close',p_intent);
  RETURN jsonb_build_object('request_id',p_request,'accepted',true,'execution_role',current_user,'connection_role',session_user);
END $$;

CREATE FUNCTION site_api.s35_png_observe(p_project text,p_run uuid,p_request uuid,p_intent text,p_step text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('reader',current_user,'connection_role',session_user,'readonly',current_setting('transaction_read_only'),
    'project',f.project,'run_id',f.run_id,'request_id',p_request,'intent_sha256',p_intent,'step',p_step,
    'settled',COALESCE(pg_xact_status(e.txid)='committed',false) OR (e.request_id IS NULL AND c.request_id IS NOT NULL),
    'late_write_possible',e.request_id IS NULL AND c.request_id IS NULL,
    'disposition',CASE WHEN pg_xact_status(e.txid)='committed' THEN 'committed'
      WHEN e.request_id IS NULL AND c.request_id IS NOT NULL THEN 'absent' END,'xid',e.txid::text,
    'execution_role',e.execution_role,'verifier_sha256',f.verifier_sha256,
    'seal_request_id',e.seal_request_id,'seal_xid',e.seal_xid::text,
    'state',CASE e.step WHEN 'seal' THEN 'sealed' WHEN 'complete' THEN 'ready' END,
    'asset',f.receipt-'post_xid'-'storage_request_id'-'verify_request_id'-'validator_sha256')
  FROM fixture_png.pin f LEFT JOIN fixture_png.effects e ON e.run_id=f.run_id AND e.request_id=p_request AND e.step=p_step
    AND e.intent_sha256=p_intent
  LEFT JOIN fixture_png.effects c ON c.run_id=f.run_id AND c.step='close' AND NOT f.lifecycle_open
    AND c.request_id::text=f.keys->>'close' AND c.intent_sha256=f.intents->>'close' AND pg_xact_status(c.txid)='committed'
  WHERE f.run_id=p_run AND f.project=p_project AND f.keys->>p_step=p_request::text AND f.intents->>p_step=p_intent;
$$;

CREATE FUNCTION site_api.s35_png_closed(p_project text,p_run uuid,p_request uuid,p_intent text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('reader',current_user,'connection_role',session_user,'readonly',current_setting('transaction_read_only'),
    'project',f.project,'run_id',f.run_id,'request_id',p_request,'intent_sha256',p_intent,
    'closed',NOT f.lifecycle_open AND pg_xact_status(e.txid)='committed','late_write_possible',f.lifecycle_open,
    'retained_png',f.receipt-'post_xid'-'storage_request_id'-'verify_request_id'-'validator_sha256',
    'retained_post_xid',f.receipt->>'post_xid',
    'retained_ready',CASE WHEN c.txid IS NOT NULL THEN jsonb_build_object(
      'complete_xid',c.txid::text,'seal_xid',c.seal_xid::text,'verifier_sha256',f.verifier_sha256) END)
  FROM fixture_png.pin f LEFT JOIN fixture_png.effects e ON e.run_id=f.run_id AND e.request_id=p_request
    AND e.step='close' AND e.intent_sha256=p_intent
  LEFT JOIN fixture_png.effects c ON c.run_id=f.run_id AND c.step='complete' AND pg_xact_status(c.txid)='committed'
  WHERE f.run_id=p_run AND f.project=p_project AND f.keys->>'close'=p_request::text AND f.intents->>'close'=p_intent;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA site_api FROM PUBLIC;
GRANT EXECUTE ON FUNCTION site_api.observe_identity() TO
  fixture_png_seal, fixture_png_complete, fixture_png_close, fixture_png_observe;
GRANT EXECUTE ON FUNCTION site_api.s35_png_seal(text,uuid,uuid,text,jsonb,text) TO fixture_png_seal;
GRANT EXECUTE ON FUNCTION site_api.s35_png_complete(text,uuid,uuid,text,jsonb,text,uuid,text) TO fixture_png_complete;
GRANT EXECUTE ON FUNCTION site_api.s35_png_close(text,uuid,uuid,text) TO fixture_png_close;
GRANT EXECUTE ON FUNCTION site_api.s35_png_observe(text,uuid,uuid,text,text) TO fixture_png_observe;
GRANT EXECUTE ON FUNCTION site_api.s35_png_closed(text,uuid,uuid,text) TO fixture_png_observe;
