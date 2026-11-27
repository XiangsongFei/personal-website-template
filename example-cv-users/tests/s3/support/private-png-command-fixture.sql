-- Run only against the disposable PostgREST fixture cluster.
CREATE ROLE fixture_png_command NOLOGIN NOBYPASSRLS;
CREATE ROLE fixture_png_command_close NOLOGIN NOBYPASSRLS;
CREATE ROLE fixture_png_storage LOGIN NOINHERIT NOBYPASSRLS;
GRANT fixture_png_command, fixture_png_command_close TO fixture_png_writer;
GRANT USAGE ON SCHEMA fixture_png, site_api TO fixture_png_command, fixture_png_command_close;
GRANT USAGE ON SCHEMA fixture_png TO fixture_png_storage;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system(), site_api.observe_identity()
  TO fixture_png_command, fixture_png_command_close;

CREATE TABLE fixture_png.scope (
  run_id uuid PRIMARY KEY REFERENCES fixture_png.pin,
  asset jsonb NOT NULL, command_intents jsonb NOT NULL, issuer text NOT NULL, grant_id uuid NOT NULL, owner_epoch bigint NOT NULL,
  generation text NOT NULL, valid_from timestamptz NOT NULL, valid_to timestamptz NOT NULL,
  generation_to timestamptz NOT NULL, owner_session_live boolean NOT NULL DEFAULT true,
  worker_session_live boolean NOT NULL DEFAULT true, revoked boolean NOT NULL DEFAULT false,
  recovery boolean NOT NULL DEFAULT false
);
CREATE TABLE fixture_png.command_effect (
  run_id uuid NOT NULL REFERENCES fixture_png.scope, request_id uuid PRIMARY KEY,
  step text NOT NULL, intent_sha text NOT NULL, asset jsonb NOT NULL,
  accepted boolean NOT NULL, xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  role name NOT NULL DEFAULT current_user, UNIQUE(run_id,step)
);
CREATE TABLE fixture_png.lease (
  run_id uuid PRIMARY KEY REFERENCES fixture_png.scope, request_id uuid NOT NULL UNIQUE,
  claim_xid xid8 NOT NULL, expires timestamptz NOT NULL
);
CREATE TABLE fixture_png.prepared_asset (
  run_id uuid PRIMARY KEY REFERENCES fixture_png.scope, request_id uuid NOT NULL UNIQUE,
  prepare_xid xid8 NOT NULL, asset jsonb NOT NULL
);
CREATE TABLE fixture_png.upload (
  run_id uuid PRIMARY KEY REFERENCES fixture_png.scope, request_id uuid NOT NULL UNIQUE,
  claim_xid xid8 NOT NULL, xid xid8 NOT NULL DEFAULT pg_current_xact_id(), asset jsonb NOT NULL,
  storage_request_id uuid NOT NULL UNIQUE
);
GRANT SELECT ON fixture_png.pin, fixture_png.scope, fixture_png.command_effect, fixture_png.lease, fixture_png.upload
  TO fixture_png_command, fixture_png_command_close, fixture_png_observe, fixture_png_close;
GRANT INSERT ON fixture_png.command_effect TO fixture_png_command, fixture_png_command_close;
GRANT INSERT ON fixture_png.lease TO fixture_png_command;
GRANT SELECT, INSERT ON fixture_png.prepared_asset TO fixture_png_command;
GRANT DELETE ON fixture_png.lease TO fixture_png_close;
GRANT SELECT ON fixture_png.scope TO fixture_png_seal, fixture_png_complete;
GRANT SELECT ON fixture_png.pin, fixture_png.scope, fixture_png.lease TO fixture_png_storage;
GRANT DELETE ON fixture_png.lease TO fixture_png_storage;
GRANT INSERT ON fixture_png.upload TO fixture_png_storage;
GRANT SELECT (xid) ON fixture_png.upload TO fixture_png_storage;

CREATE FUNCTION fixture_png.live(p_run uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
  SELECT f.lifecycle_open AND s.owner_session_live AND s.worker_session_live AND NOT s.revoked AND NOT s.recovery
    AND clock_timestamp() >= s.valid_from AND clock_timestamp() < least(s.valid_to,s.generation_to)
    FROM fixture_png.scope s JOIN fixture_png.pin f USING(run_id) WHERE s.run_id=p_run;
$$;

CREATE FUNCTION fixture_png.fixture_store(p_run uuid,p_post uuid,p_claim xid8,p_asset jsonb,
  p_storage_request uuid,p_worker uuid,p_sid uuid) RETURNS xid8
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE posted xid8;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text,35));
  WITH claimed AS (DELETE FROM fixture_png.lease l USING fixture_png.scope s
    WHERE current_user='fixture_png_storage' AND l.run_id=p_run AND s.run_id=l.run_id
      AND l.request_id=p_post AND l.claim_xid=p_claim AND l.expires>clock_timestamp()
      AND fixture_png.live(l.run_id) AND s.asset->>'worker_uid'=p_worker::text
      AND s.asset->>'worker_sid'=p_sid::text AND s.asset-'native_version'=p_asset-'native_version'
      AND (p_asset->>'native_version')::uuid IS NOT NULL RETURNING l.*)
  INSERT INTO fixture_png.upload(run_id,request_id,claim_xid,asset,storage_request_id)
  SELECT run_id,request_id,claim_xid,p_asset,p_storage_request FROM claimed RETURNING xid INTO posted;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  RETURN posted;
END $$;

CREATE FUNCTION site_api.s35_png_command(p_project text,p_run uuid,p_request uuid,p_intent text,
  p_step text,p_permit jsonb,p_actor jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE f fixture_png.pin; s fixture_png.scope; a jsonb; permit jsonb; allow boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text,35));
  SELECT * INTO f FROM fixture_png.pin WHERE run_id=p_run;
  SELECT * INTO s FROM fixture_png.scope WHERE run_id=p_run;
  IF current_user<>'fixture_png_command' OR f.project IS DISTINCT FROM p_project OR f.lifecycle_open IS DISTINCT FROM true
      OR f.keys->>p_step IS DISTINCT FROM p_request::text
      OR p_step NOT IN ('prepare','claim','authorize-verify')
      OR s.command_intents->>p_step IS DISTINCT FROM p_intent THEN
    RAISE insufficient_privilege;
  END IF;
  a := s.asset;
  IF p_step='authorize-verify' THEN
    SELECT asset INTO a FROM fixture_png.upload WHERE run_id=p_run;
  END IF;
  permit := jsonb_build_object('id',a->'id','intent_id',a->'intent_id','asset_id',a->'asset_id',
    'object_version',a->'object_version','native_version',a->'native_version',
    'bucket_id',a->'bucket_id','object_key',a->'object_key');
  allow := (
    fixture_png.live(p_run)
    AND p_actor=jsonb_build_object('uid',s.asset->'owner_uid','sid',s.asset->'owner_sid',
      'site',s.asset->'site_id','issuer',s.issuer,'grant',s.grant_id,'epoch',s.owner_epoch,
      'generation',s.generation,'prepare',s.asset->'prepare_request_id','sha256',s.asset->'sha256',
      'size',s.asset->'byte_size','mime',s.asset->'mime_type')
    AND (CASE p_step WHEN 'prepare' THEN p_permit IS NULL
      WHEN 'claim' THEN p_permit=permit AND EXISTS (
        SELECT FROM fixture_png.command_effect e JOIN fixture_png.prepared_asset p USING(run_id)
        WHERE e.run_id=p_run AND e.step='prepare' AND e.accepted AND p.prepare_xid=e.xid
          AND p.request_id=e.request_id AND p.asset=s.asset)
      ELSE a IS NOT NULL AND p_permit=permit END)
  ) IS TRUE;
  INSERT INTO fixture_png.command_effect(run_id,request_id,step,intent_sha,asset,accepted)
    VALUES (p_run,p_request,p_step,p_intent,coalesce(a,s.asset),allow);
  IF allow AND p_step='prepare' THEN
    INSERT INTO fixture_png.prepared_asset(run_id,request_id,prepare_xid,asset)
      VALUES(p_run,p_request,pg_current_xact_id(),a);
  ELSIF allow AND p_step='claim' THEN
    INSERT INTO fixture_png.lease(run_id,request_id,claim_xid,expires)
      VALUES(p_run,(f.keys->>'post')::uuid,pg_current_xact_id(),
        least(s.valid_to,s.generation_to,clock_timestamp()+interval '1 minute'));
  END IF;
  RETURN jsonb_build_object('request_id',p_request,'accepted',true,'execution_role',current_user,
    'connection_role',session_user);
END $$;

CREATE FUNCTION site_api.s35_png_command_close(p_project text,p_run uuid,p_request uuid,p_intent text,
  p_step text,p_lane text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text,35));
  INSERT INTO fixture_png.command_effect(run_id,request_id,step,intent_sha,asset,accepted)
    SELECT e.run_id,p_request,p_step||'-close',p_intent,e.asset,true
    FROM fixture_png.command_effect e JOIN fixture_png.pin f USING(run_id)
    WHERE current_user='fixture_png_command_close' AND p_lane='close' AND e.run_id=p_run AND f.project=p_project AND f.lifecycle_open
      AND e.intent_sha=p_intent AND e.step=p_step AND e.accepted
      AND f.keys->>p_step=e.request_id::text AND f.keys->>(p_step||'-close')=p_request::text;
  IF NOT FOUND THEN RAISE insufficient_privilege; END IF;
  RETURN jsonb_build_object('request_id',p_request,'accepted',true,'execution_role',current_user,
    'connection_role',session_user);
END $$;

CREATE FUNCTION site_api.s35_png_command_status(p_project text,p_run uuid,p_request uuid,p_intent text,
  p_step text,p_lane text) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('reader',current_user,'connection_role',session_user,
    'readonly',current_setting('transaction_read_only'),'project',f.project,'run_id',f.run_id,
    'request_id',p_request,'intent_sha256',p_intent,'lane',p_lane,'execution_role',e.role,
    'settled',e.request_id IS NOT NULL OR NOT f.lifecycle_open OR original.accepted IS FALSE,
    'disposition',CASE WHEN e.accepted THEN 'committed'
      WHEN e.request_id IS NOT NULL OR NOT f.lifecycle_open OR original.accepted IS FALSE THEN 'absent' END,
    'xid',CASE WHEN e.accepted THEN e.xid::text END,
    'closed',c.request_id IS NOT NULL OR NOT f.lifecycle_open OR original.accepted IS FALSE,
    'active_command_leases',CASE WHEN original.accepted AND c.request_id IS NULL AND f.lifecycle_open THEN 1 ELSE 0 END,
    'late_write_possible',f.lifecycle_open AND c.request_id IS NULL AND original.accepted IS DISTINCT FROM false,
    'in_flight',0)
  FROM fixture_png.pin f JOIN fixture_png.scope s USING(run_id)
  LEFT JOIN fixture_png.command_effect original ON original.run_id=p_run AND original.step=p_step AND original.intent_sha=p_intent
  LEFT JOIN fixture_png.command_effect c ON c.run_id=p_run AND c.step=p_step||'-close' AND c.intent_sha=p_intent
  LEFT JOIN fixture_png.command_effect e ON e.run_id=p_run AND e.request_id=p_request AND e.intent_sha=p_intent
  WHERE f.run_id=p_run AND f.project=p_project AND s.command_intents->>p_step=p_intent
    AND f.keys->>(CASE p_lane WHEN 'command' THEN p_step WHEN 'close' THEN p_step||'-close' END)=p_request::text
    AND (original.request_id IS NOT NULL OR NOT EXISTS (
      SELECT FROM fixture_png.command_effect claimed WHERE claimed.run_id=p_run AND claimed.step=p_step));
$$;

CREATE FUNCTION site_api.s35_png_command_effect(p_project text,p_run uuid,p_request uuid,p_intent text,
  p_step text) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('reader',current_user,'connection_role',session_user,
    'readonly',current_setting('transaction_read_only'),'project',f.project,'run_id',f.run_id,
    'request_id',p_request,'intent_sha256',p_intent,'step',p_step,'execution_role',e.role,
    'settled',e.request_id IS NOT NULL OR NOT f.lifecycle_open,
    'late_write_possible',f.lifecycle_open AND e.request_id IS NULL,
    'disposition',CASE WHEN e.accepted THEN 'committed' WHEN e.request_id IS NOT NULL OR NOT f.lifecycle_open THEN 'absent' END,
    'xid',CASE WHEN e.accepted THEN e.xid::text END,
    'asset',e.asset,'state','pending','upload_request_id',f.keys->>'post',
    'permit_reserved',p_step='claim' AND e.accepted,
    'qualification_current',p_step='authorize-verify' AND fixture_png.live(p_run))
  FROM fixture_png.pin f JOIN fixture_png.scope s USING(run_id)
  LEFT JOIN fixture_png.command_effect e ON e.run_id=p_run AND e.request_id=p_request
    AND e.step=p_step AND e.intent_sha=s.command_intents->>p_step
  WHERE f.run_id=p_run AND f.project=p_project AND f.keys->>p_step=p_request::text
    AND f.intents->>p_step=p_intent;
$$;

CREATE FUNCTION fixture_png.close_upload_lease() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT NEW.lifecycle_open THEN DELETE FROM fixture_png.lease WHERE run_id=NEW.run_id; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_close_upload_lease AFTER UPDATE OF lifecycle_open ON fixture_png.pin
  FOR EACH ROW EXECUTE FUNCTION fixture_png.close_upload_lease();

CREATE FUNCTION fixture_png.require_tail_qualification() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF fixture_png.live(NEW.run_id) IS DISTINCT FROM true THEN RAISE insufficient_privilege; END IF;
  RETURN NEW;
END $$;
-- The tail writer owns the same per-run lock before inserting each effect.
CREATE TRIGGER fixture_require_tail_qualification BEFORE INSERT ON fixture_png.effects
  FOR EACH ROW WHEN (NEW.step IN ('seal','complete')) EXECUTE FUNCTION fixture_png.require_tail_qualification();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fixture_png FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA site_api FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fixture_png.live(uuid) TO
  fixture_png_command, fixture_png_observe, fixture_png_seal, fixture_png_complete, fixture_png_storage;
GRANT EXECUTE ON FUNCTION fixture_png.fixture_store(uuid,uuid,xid8,jsonb,uuid,uuid,uuid) TO fixture_png_storage;
GRANT EXECUTE ON FUNCTION site_api.s35_png_command(text,uuid,uuid,text,text,jsonb,jsonb) TO fixture_png_command;
GRANT EXECUTE ON FUNCTION site_api.s35_png_command_close(text,uuid,uuid,text,text,text) TO fixture_png_command_close;
GRANT EXECUTE ON FUNCTION site_api.s35_png_command_status(text,uuid,uuid,text,text,text),
  site_api.s35_png_command_effect(text,uuid,uuid,text,text) TO fixture_png_observe;
