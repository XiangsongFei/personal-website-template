-- Closed, forward candidate. Requires M1–M7, S3.6 01, and S4.7 01/02.
BEGIN;
SET LOCAL search_path=pg_catalog;
DO $guard$
BEGIN
  IF current_user<>'postgres' OR session_user<>current_user OR
     NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND NOT rolsuper AND rolcreaterole)
  THEN RAISE EXCEPTION 'S47_CLOSED_DEPLOYER_REQUIRED'; END IF;
END;
$guard$;
GRANT ecv_s3_owner,ecv_s3_command_writer TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;
DO $guard$
BEGIN
  IF NOT EXISTS(SELECT FROM site_private.resume_text_runtime WHERE singleton AND NOT enabled)
     OR NOT EXISTS(SELECT FROM site_private.text_publication_runtime WHERE singleton AND NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
     OR NOT EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND NOT enabled AND NOT proof_verifier_ready)
  THEN RAISE EXCEPTION 'S47_CLOSED_DEPLOYER_REQUIRED'; END IF;
END;
$guard$;
GRANT CREATE ON SCHEMA site_api TO ecv_s3_command_writer;

CREATE FUNCTION site_api.read_introduction_receipt(target uuid, operation_id uuid, request_digest text, basis bigint)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE who record; stored site_private.operation_requests%ROWTYPE; saved_revision bigint; snapshot jsonb;
BEGIN
  -- Use the same live owner/session qualification and closed latch as the new private text lane.
  SELECT * INTO STRICT who FROM site_private.resume_text_authorize(target,'profile') AS w(uid uuid,sid uuid);
  IF operation_id IS NULL OR request_digest IS NULL OR request_digest !~ '^[a-f0-9]{64}$'
      OR basis IS NULL OR basis<0 OR basis>=9007199254740991
  THEN RAISE EXCEPTION 'RECEIPT_LOCATOR_INVALID' USING ERRCODE='22023'; END IF;

  SELECT * INTO stored FROM site_private.operation_requests r WHERE r.site_id=target
     AND r.operation='save_text_draft' AND r.request_id=operation_id AND r.actor_auth_user_id=who.uid
     AND r.actor_session_id=who.sid AND r.state='succeeded';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','unknown'); END IF;
  IF stored.payload_digest IS DISTINCT FROM request_digest OR stored.basis_draft_revision IS DISTINCT FROM basis
  THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='PT409'; END IF;
  saved_revision:=(stored.result->>'draft_revision')::bigint;
  IF saved_revision IS NULL OR saved_revision NOT IN (basis,basis+1)
  THEN RAISE EXCEPTION 'RECEIPT_DIVERGED' USING ERRCODE='PT503'; END IF;
  SELECT h.payload INTO STRICT snapshot FROM site_data.draft_revisions h
    WHERE h.site_id=target AND h.site_revision=saved_revision AND h.section_key='introduction';
  RETURN jsonb_build_object('state','saved','requestId',operation_id,'digest',request_digest,
    'draft',jsonb_build_object('state','ready','siteId',target,'revision',saved_revision,
      'record',CASE WHEN jsonb_array_length(snapshot->'entries')=1 THEN snapshot->'entries'->0 ELSE NULL END));
END;
$fn$;
ALTER FUNCTION site_api.read_introduction_receipt(uuid,uuid,text,bigint) OWNER TO ecv_s3_command_writer;
REVOKE ALL ON FUNCTION site_api.read_introduction_receipt(uuid,uuid,text,bigint)
  FROM PUBLIC,anon,authenticated,authenticator,service_role;
REVOKE CREATE ON SCHEMA site_api FROM ecv_s3_command_writer;
REVOKE ecv_s3_owner,ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;
