-- Run independently of the app using the approved project's read-only observer.
-- Required psql -v variables: alice, alice_sid, alice_site, bob_site, request_id.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '8s';
WITH receipt AS (
  SELECT o.* FROM site_private.operation_requests o
  WHERE o.site_id=:'alice_site'::uuid AND o.actor_auth_user_id=:'alice'::uuid
        AND o.operation='save_text_draft' AND o.request_id=:'request_id'::uuid
),
linked AS (
  SELECT o.id, o.result, r.digest, r.payload, r.draft_matches, a.actor_session_id, a.draft_revision
  FROM receipt o
  JOIN LATERAL (
    SELECT h.digest,h.payload,h.digest = encode(sha256(convert_to(
      left(substr(o.canonical_request,length('{"operation":"save_text_draft","schema_version":1,"request_id":"'
        || :'request_id' || '","expected_draft_revision":0,"payload":')+1),-1),'UTF8')),'hex') AS draft_matches
    FROM site_data.draft_revisions h
    WHERE h.site_id=o.site_id AND h.operation_id=o.id
      AND h.site_revision=1 AND h.section_revision=1 AND h.previous_revision=0
      AND h.actor_auth_user_id=:'alice'::uuid AND h.digest_encoding='js-json-stringify-v1'
  ) r ON true
  JOIN site_private.text_publication_audit a ON a.site_id=o.site_id AND a.operation_id=o.id
  WHERE o.state='succeeded' AND o.actor_session_id=:'alice_sid'::uuid
    AND o.basis_draft_revision=0 AND o.basis_publication_revision=0
    AND o.digest_encoding='js-json-stringify-v1'
    AND o.payload_digest=encode(sha256(convert_to(o.canonical_request,'UTF8')),'hex')
    AND (o.canonical_request::jsonb)->'payload'=r.payload
    AND r.payload->'entries'->0->'translations'->>'en' = 'S3 synthetic acceptance ' || :'request_id'
    AND (o.result->>'draft_revision')::bigint=1 AND o.result->'changed'='true'::jsonb
    AND a.action='save_text_draft' AND a.actor_auth_user_id=o.actor_auth_user_id
    AND a.actor_session_id=o.actor_session_id AND a.draft_revision=1 AND a.publication_revision=0
    AND r.draft_matches
)
SELECT ((SELECT count(*) FROM receipt)=1 AND (SELECT count(*) FROM linked)=1
   AND EXISTS(SELECT FROM site_data.sites WHERE id=:'alice_site'::uuid AND draft_revision=1)
   AND EXISTS(SELECT FROM site_data.section_state WHERE site_id=:'alice_site'::uuid AND section_key='introduction' AND revision=1)
   AND EXISTS(SELECT FROM site_data.sites WHERE id=:'bob_site'::uuid AND draft_revision=0)
   AND NOT EXISTS(SELECT FROM site_private.operation_requests
       WHERE site_id IN (:'alice_site'::uuid,:'bob_site'::uuid) AND request_id=:'request_id'::uuid
         AND operation='save_text_draft' AND id NOT IN (SELECT id FROM linked))
   AND (SELECT count(*) FROM site_data.site_publications
       WHERE site_id IN (:'alice_site'::uuid,:'bob_site'::uuid) AND state='unpublished'
         AND publication_revision=0 AND snapshot_id IS NULL)=2
   AND NOT EXISTS(SELECT FROM site_data.published_snapshots WHERE site_id IN (:'alice_site'::uuid,:'bob_site'::uuid))
   AND NOT EXISTS(SELECT FROM site_private.publication_outbox WHERE site_id IN (:'alice_site'::uuid,:'bob_site'::uuid))
) AS s36_observation_pass
\gset
ROLLBACK;
\if :s36_observation_pass
  \echo FIRST_SAVE_AUDIT_AND_REVISION_VERIFIED
\else
  \echo FIRST_SAVE_INDEPENDENT_READBACK_FAILED
  -- Preserve a nonzero exit under ON_ERROR_STOP.
  SELECT 1/0;
\endif
