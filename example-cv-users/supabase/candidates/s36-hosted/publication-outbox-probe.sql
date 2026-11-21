-- Separate approval required. psql variable: alice_site. No sender is called.
BEGIN;
\ir publication-target.sql
SELECT set_config('s36_test.outbox_site',:'alice_site',true) AS site
\gset
DO $baseline$
BEGIN
  IF (SELECT count(*) FROM site_private.publication_outbox)<>2
    OR (SELECT count(*) FROM site_private.publication_outbox WHERE site_id=current_setting('s36_test.outbox_site')::uuid
      AND state='pending' AND attempt_count=0 AND lease_generation=0
      AND (publication_revision,event_type) IN ((1,'published'),(2,'unpublished')))<>2
    OR NOT EXISTS(SELECT FROM site_data.site_publications WHERE site_id=current_setting('s36_test.outbox_site')::uuid
      AND state='unpublished' AND publication_revision=2 AND snapshot_id IS NULL)
    OR (SELECT count(*) FROM pg_auth_members WHERE roleid='ecv_s36_outbox_worker'::regrole)<>1
    OR EXISTS(SELECT FROM pg_auth_members WHERE roleid='ecv_s36_outbox_worker'::regrole
      AND (member<>'postgres'::regrole OR grantor<>10 OR NOT admin_option OR inherit_option OR set_option))
  THEN RAISE EXCEPTION 'S36_OUTBOX_PROBE_BASELINE'; END IF;
END;
$baseline$;
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
GRANT ecv_s36_outbox_worker TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
UPDATE site_private.text_publication_runtime SET outbox_enabled=true WHERE singleton AND NOT outbox_enabled;
SET LOCAL ROLE ecv_s36_outbox_worker;
DO $probe$
DECLARE site uuid:=current_setting('s36_test.outbox_site')::uuid;
        owner_id uuid:=gen_random_uuid(); old_event uuid; current_event uuid;
        token1 uuid:=gen_random_uuid(); token2 uuid:=gen_random_uuid(); result jsonb;
BEGIN
  SELECT id INTO STRICT old_event FROM site_private.publication_outbox WHERE site_id=site AND publication_revision=1;
  SELECT id INTO STRICT current_event FROM site_private.publication_outbox WHERE site_id=site AND publication_revision=2;
  result:=site_private.claim_text_outbox(old_event,owner_id,token1,0,false,10000);
  IF result->>'claimed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'S36_OUTBOX_CLAIM'; END IF;
  result:=site_private.finish_text_outbox(old_event,owner_id,token1,1,'superseded',2);
  IF result->>'state' IS DISTINCT FROM 'superseded' THEN RAISE EXCEPTION 'S36_OUTBOX_SUPERSEDED'; END IF;
  result:=site_private.claim_text_outbox(old_event,owner_id,token2,1,true,10000);
  IF result->>'claimed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'S36_OUTBOX_DUPLICATE_CLAIM'; END IF;

  result:=site_private.claim_text_outbox(current_event,owner_id,token1,0,false,10000);
  IF result->>'claimed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'S36_OUTBOX_CURRENT_CLAIM'; END IF;
  PERFORM site_private.start_text_outbox(current_event,owner_id,token1,1);
  BEGIN
    PERFORM site_private.start_text_outbox(current_event,owner_id,token1,1);
    RAISE EXCEPTION 'S36_OUTBOX_DUPLICATE_DISPATCH_ACCEPTED';
  EXCEPTION WHEN SQLSTATE 'PT503' THEN
    IF SQLERRM<>'DELIVERY_UNKNOWN' THEN RAISE; END IF;
  END;
  result:=site_private.fail_text_outbox(current_event,owner_id,token1,1,
    floor(extract(epoch FROM clock_timestamp())*1000)::bigint+300);
  IF result->>'state' IS DISTINCT FROM 'failed' OR result->>'last_code' IS DISTINCT FROM 'DELIVERY_REJECTED'
    THEN RAISE EXCEPTION 'S36_OUTBOX_FAILED'; END IF;
  result:=site_private.claim_text_outbox(current_event,owner_id,token2,1,false,10000);
  IF result->>'claimed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'S36_OUTBOX_UNAPPROVED_RETRY'; END IF;
  PERFORM pg_sleep(0.35);
  result:=site_private.claim_text_outbox(current_event,owner_id,token2,1,true,10000);
  IF result->>'claimed' IS DISTINCT FROM 'true' OR result#>>'{record,attempt_count}' IS DISTINCT FROM '2'
    THEN RAISE EXCEPTION 'S36_OUTBOX_EXPLICIT_RETRY'; END IF;
  PERFORM site_private.start_text_outbox(current_event,owner_id,token2,2);
  result:=site_private.unknown_text_outbox(current_event,owner_id,token2,2);
  IF result->>'state' IS DISTINCT FROM 'unknown' OR site_private.read_text_outbox(current_event) IS DISTINCT FROM result
    THEN RAISE EXCEPTION 'S36_OUTBOX_UNKNOWN_READBACK'; END IF;
  result:=site_private.claim_text_outbox(current_event,owner_id,gen_random_uuid(),2,true,10000);
  IF result->>'claimed' IS DISTINCT FROM 'false' OR result#>>'{record,state}' IS DISTINCT FROM 'unknown'
    THEN RAISE EXCEPTION 'S36_OUTBOX_UNKNOWN_RETRY'; END IF;
END;
$probe$;
SELECT jsonb_build_object('kind','rollback_probe','superseded',true,'duplicate_dispatch_denied',true,
 'retry_after_known_failure',true,'unknown_not_retried',true,'external_sends',0);
ROLLBACK;
