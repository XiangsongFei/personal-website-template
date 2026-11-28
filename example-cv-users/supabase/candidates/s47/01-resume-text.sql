-- Forward candidate. Install only after M1–M7 and S3.6 01 on an approved isolated target.
-- The text gate and new RPC EXECUTE privileges stay closed on installation.
BEGIN;
SET LOCAL search_path = pg_catalog;
DO $guard$
BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR
     NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolcreaterole)
  THEN RAISE EXCEPTION 'S47_CLOSED_DEPLOYER_REQUIRED'; END IF;
END;
$guard$;
GRANT ecv_s3_owner,ecv_s3_command_writer TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND NOT enabled AND NOT proof_verifier_ready) OR
     NOT EXISTS(SELECT FROM site_private.text_publication_runtime WHERE singleton AND NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
  THEN RAISE EXCEPTION 'S47_CLOSED_DEPLOYER_REQUIRED'; END IF;
END;
$guard$;
GRANT CREATE ON SCHEMA site_private,site_api TO ecv_s3_command_writer;

CREATE TABLE site_private.resume_text_runtime (
  singleton boolean PRIMARY KEY CHECK (singleton), enabled boolean NOT NULL CHECK (NOT enabled)
);
INSERT INTO site_private.resume_text_runtime VALUES (true,false);

CREATE TABLE site_private.resume_text_revisions (
  site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
  section text NOT NULL CHECK (section IN ('profile','contact','links','site-text')),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  content jsonb NOT NULL CHECK (jsonb_typeof(content)='object' AND octet_length(content::text)<=400000),
  actor_uid uuid NOT NULL,
  request_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (site_id,section,revision),
  UNIQUE (site_id,section,request_id),
  UNIQUE (site_id,section,revision,request_id),
  FOREIGN KEY (site_id,actor_uid) REFERENCES site_data.sites(id,owner_auth_user_id)
);
CREATE TABLE site_private.resume_text_receipts (
  site_id uuid NOT NULL,
  section text NOT NULL,
  request_id uuid NOT NULL,
  actor_uid uuid NOT NULL,
  actor_sid uuid NOT NULL,
  basis_revision bigint NOT NULL CHECK (basis_revision>=0),
  revision bigint NOT NULL CHECK (revision=basis_revision+1),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (site_id,section,request_id),
  FOREIGN KEY (site_id,section,revision,request_id) REFERENCES site_private.resume_text_revisions(site_id,section,revision,request_id),
  FOREIGN KEY (site_id,actor_uid) REFERENCES site_data.sites(id,owner_auth_user_id)
);
-- Keep the ID's original owner even after deleting the row in a new revision.
CREATE TABLE site_private.resume_text_record_ids (
  record_id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES site_data.sites(id) ON DELETE RESTRICT,
  section text NOT NULL,
  record_scope text NOT NULL
);
ALTER TABLE site_private.resume_text_record_ids OWNER TO ecv_s3_owner;
ALTER TABLE site_private.resume_text_record_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.resume_text_record_ids FORCE ROW LEVEL SECURITY;
REVOKE ALL ON site_private.resume_text_record_ids FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT SELECT,INSERT ON site_private.resume_text_record_ids TO ecv_s3_command_writer;
CREATE POLICY resume_text_record_read ON site_private.resume_text_record_ids FOR SELECT TO ecv_s3_command_writer
  USING (site_private.business_site_complete(site_id) AND site_private.business_qualified());
CREATE POLICY resume_text_record_append ON site_private.resume_text_record_ids FOR INSERT TO ecv_s3_command_writer
  WITH CHECK (site_private.business_site_complete(site_id) AND site_private.business_qualified());

ALTER TABLE site_private.resume_text_runtime OWNER TO ecv_s3_owner;
ALTER TABLE site_private.resume_text_revisions OWNER TO ecv_s3_owner;
ALTER TABLE site_private.resume_text_receipts OWNER TO ecv_s3_owner;

ALTER TABLE site_private.resume_text_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.resume_text_runtime FORCE ROW LEVEL SECURITY;
ALTER TABLE site_private.resume_text_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.resume_text_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE site_private.resume_text_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_private.resume_text_receipts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON site_private.resume_text_runtime,site_private.resume_text_revisions,site_private.resume_text_receipts
  FROM PUBLIC,anon,authenticated,authenticator,service_role;
GRANT SELECT ON site_private.resume_text_runtime TO ecv_s3_command_writer;
GRANT SELECT,INSERT ON site_private.resume_text_revisions,site_private.resume_text_receipts TO ecv_s3_command_writer;
CREATE POLICY resume_text_runtime_read ON site_private.resume_text_runtime FOR SELECT TO ecv_s3_command_writer USING (true);
CREATE POLICY resume_text_revision_read ON site_private.resume_text_revisions FOR SELECT TO ecv_s3_command_writer
  USING (site_private.business_site_complete(site_id) AND site_private.business_qualified());
CREATE POLICY resume_text_receipt_read ON site_private.resume_text_receipts FOR SELECT TO ecv_s3_command_writer
  USING (site_private.business_site_complete(site_id) AND site_private.business_qualified());
CREATE POLICY resume_text_revision_append ON site_private.resume_text_revisions FOR INSERT TO ecv_s3_command_writer
  WITH CHECK (actor_uid=site_private.request_uid() AND site_private.business_site_complete(site_id) AND site_private.business_qualified());
CREATE POLICY resume_text_receipt_append ON site_private.resume_text_receipts FOR INSERT TO ecv_s3_command_writer
  WITH CHECK (actor_uid=site_private.request_uid() AND site_private.business_site_complete(site_id) AND site_private.business_qualified());

CREATE FUNCTION site_private.resume_text_authorize(target uuid, section_key text) RETURNS record
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE who record;
BEGIN
  SELECT * INTO STRICT who FROM site_private.lock_business_qualification();
  IF NOT EXISTS (SELECT FROM site_private.resume_text_runtime WHERE singleton AND enabled)
     OR NOT EXISTS (SELECT FROM site_private.text_publication_runtime WHERE singleton AND write_enabled)
  THEN RAISE EXCEPTION 'RESUME_TEXT_DISABLED' USING ERRCODE='PT503'; END IF;
  IF section_key IS NULL OR section_key NOT IN ('profile','contact','links','site-text')
  THEN RAISE EXCEPTION 'SECTION_INVALID' USING ERRCODE='22023'; END IF;
  IF target IS NULL OR NOT site_private.business_site_complete(target)
  THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
  RETURN who;
END;
$fn$;

CREATE FUNCTION site_api.read_resume_text(target uuid, section_key text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE snapshot site_private.resume_text_revisions%ROWTYPE;
BEGIN
  PERFORM site_private.resume_text_authorize(target,section_key);
  SELECT * INTO snapshot FROM site_private.resume_text_revisions v
    WHERE (v.site_id,v.section)=(target,section_key) ORDER BY v.revision DESC LIMIT 1;
  RETURN jsonb_build_object('siteId',target,'section',section_key,'revision',coalesce(snapshot.revision,0),
    'content',snapshot.content);
END;
$fn$;

CREATE FUNCTION site_api.read_resume_text_operation(target uuid, section_key text, operation_id uuid,
  request_digest text, basis bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; receipt site_private.resume_text_receipts%ROWTYPE; stored jsonb;
BEGIN
  SELECT * INTO STRICT who FROM site_private.resume_text_authorize(target,section_key) AS w(uid uuid,sid uuid);
  SELECT * INTO receipt FROM site_private.resume_text_receipts r WHERE
    (r.site_id,r.section,r.request_id,r.actor_uid,r.actor_sid)=(target,section_key,operation_id,who.uid,who.sid);
  IF NOT FOUND THEN RETURN jsonb_build_object('state','unknown'); END IF;
  IF receipt.digest IS DISTINCT FROM request_digest OR receipt.basis_revision IS DISTINCT FROM basis
  THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='PT409'; END IF;
  SELECT v.content INTO STRICT stored FROM site_private.resume_text_revisions v
    WHERE (v.site_id,v.section,v.revision)=(target,section_key,receipt.revision);
  RETURN jsonb_build_object('state','saved','requestId',operation_id,'digest',request_digest,
    'snapshot',jsonb_build_object('siteId',target,'section',section_key,'revision',receipt.revision,'content',stored));
END;
$fn$;

CREATE FUNCTION site_private.resume_text_ids(section_key text, payload jsonb)
RETURNS TABLE(record_id uuid,record_scope text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
  SELECT (row.value->>'id')::uuid, group_name
  FROM (VALUES ('focus'),('status')) AS groups(group_name)
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN section_key='contact'
    THEN payload->groups.group_name ELSE '[]'::jsonb END) AS row(value);
$fn$;

CREATE FUNCTION site_api.save_resume_text(input jsonb, canonical text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE target uuid; section_key text; operation_id uuid; basis bigint; previous bigint; request_digest text;
        who record; prior site_private.resume_text_receipts%ROWTYPE;
BEGIN
  IF input IS NULL OR jsonb_typeof(input)<>'object' OR canonical IS NULL OR octet_length(canonical)>161000
     OR NOT input ?& ARRAY['siteId','section','requestId','expectedRevision','content']
     OR (SELECT count(*) FROM jsonb_object_keys(input))<>5 OR canonical::jsonb IS DISTINCT FROM input
     OR input->>'expectedRevision' IS NULL OR input->>'expectedRevision' !~ '^[0-9]{1,16}$'
     OR jsonb_typeof(input->'expectedRevision')<>'number'
     OR jsonb_typeof(input->'content')<>'object' THEN RAISE EXCEPTION 'COMMAND_INVALID' USING ERRCODE='22023'; END IF;
  target:=(input->>'siteId')::uuid;
  section_key:=input->>'section';
  operation_id:=(input->>'requestId')::uuid;
  basis:=(input->>'expectedRevision')::bigint;
  IF operation_id IS NULL OR basis>=9007199254740991 THEN RAISE EXCEPTION 'COMMAND_INVALID' USING ERRCODE='22023'; END IF;
  request_digest:=encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex');

  SELECT * INTO STRICT who FROM site_private.resume_text_authorize(target,section_key) AS w(uid uuid,sid uuid);
  PERFORM 1 FROM site_data.sites WHERE id=target FOR UPDATE;
  -- Recheck live Session, Owner and Grant after waiting for the site lock.
  PERFORM site_private.s36_assert_authority(target,who.uid,who.sid);

  SELECT * INTO prior FROM site_private.resume_text_receipts r
    WHERE (r.site_id,r.section,r.request_id)=(target,section_key,operation_id);
  IF FOUND THEN
    IF (prior.actor_uid,prior.actor_sid) IS DISTINCT FROM (who.uid,who.sid)
    THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;
    RETURN site_api.read_resume_text_operation(target,section_key,operation_id,request_digest,basis);
  END IF;

  SELECT coalesce(max(v.revision),0) INTO previous FROM site_private.resume_text_revisions v
    WHERE (v.site_id,v.section)=(target,section_key);
  IF previous<>basis THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM site_private.resume_text_ids(section_key,input->'content') i
    GROUP BY i.record_id HAVING i.record_id IS NULL OR count(*)<>1)
  THEN RAISE EXCEPTION 'RECORD_ID_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO site_private.resume_text_record_ids(record_id,site_id,section,record_scope)
    SELECT i.record_id,target,section_key,i.record_scope FROM site_private.resume_text_ids(section_key,input->'content') i
    ORDER BY i.record_id ON CONFLICT(record_id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM site_private.resume_text_ids(section_key,input->'content') i
    WHERE NOT EXISTS (SELECT 1 FROM site_private.resume_text_record_ids p WHERE
      (p.record_id,p.site_id,p.section,p.record_scope)=(i.record_id,target,section_key,i.record_scope)))
  THEN RAISE EXCEPTION 'BUSINESS_DENIED' USING ERRCODE='42501'; END IF;

  INSERT INTO site_private.resume_text_revisions(site_id,section,revision,content,actor_uid,request_id)
    VALUES(target,section_key,basis+1,input->'content',who.uid,operation_id);
  INSERT INTO site_private.resume_text_receipts(site_id,section,request_id,actor_uid,actor_sid,basis_revision,revision,digest)
    VALUES(target,section_key,operation_id,who.uid,who.sid,basis,basis+1,request_digest);
  RETURN site_api.read_resume_text_operation(target,section_key,operation_id,request_digest,basis);
END;
$fn$;

ALTER FUNCTION site_private.resume_text_authorize(uuid,text) OWNER TO ecv_s3_command_writer;
ALTER FUNCTION site_private.resume_text_ids(text,jsonb) OWNER TO ecv_s3_command_writer;
ALTER FUNCTION site_api.read_resume_text(uuid,text) OWNER TO ecv_s3_command_writer;
ALTER FUNCTION site_api.save_resume_text(jsonb,text) OWNER TO ecv_s3_command_writer;
ALTER FUNCTION site_api.read_resume_text_operation(uuid,text,uuid,text,bigint) OWNER TO ecv_s3_command_writer;
REVOKE ALL ON FUNCTION site_private.resume_text_ids(text,jsonb),site_private.resume_text_authorize(uuid,text),site_api.read_resume_text(uuid,text),
  site_api.save_resume_text(jsonb,text),site_api.read_resume_text_operation(uuid,text,uuid,text,bigint)
  FROM PUBLIC,anon,authenticated,authenticator,service_role;
REVOKE CREATE ON SCHEMA site_private,site_api FROM ecv_s3_command_writer;
REVOKE ecv_s3_owner,ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;
