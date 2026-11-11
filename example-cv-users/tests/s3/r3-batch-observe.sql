-- Future observer only; send variables via private stdin. All psql variables use quoted
-- literals. expected_proof is signed PUBLIC claims only (JSON null before issuance).
-- Approve one fresh, isolated read-only connection per observation. Verify the command
-- tag ROLLBACK and process exit outside this query before accepting its JSON.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5s';
WITH scope AS (
  SELECT :'uid'::uuid AS uid, :'sid'::uuid AS sid, :'id'::uuid AS id,
         :'expected_proof'::jsonb AS p, :'key_id'::text AS kid
), tickets AS (
  SELECT t.* FROM site_private.registered_business_tickets t, scope s WHERE t.proof_id=s.id
), receipts AS (
  SELECT r.* FROM site_private.grant_proofs r, scope s WHERE r.proof_id=s.id
), grants AS (
  SELECT g.* FROM site_private.business_session_grants g, scope s
  WHERE g.auth_user_id=s.uid AND g.auth_session_id=s.sid
), protected_rows AS (
  SELECT 'T' AS kind,t.proof_id AS id,to_jsonb(t) AS value FROM site_private.registered_business_tickets t,scope s WHERE t.proof_id<>s.id
  UNION ALL
  SELECT 'R',r.proof_id,to_jsonb(r) FROM site_private.grant_proofs r,scope s WHERE r.proof_id<>s.id
  UNION ALL
  SELECT 'G',g.id,to_jsonb(g) FROM site_private.business_session_grants g,scope s WHERE (g.auth_user_id,g.auth_session_id)<>(s.uid,s.sid)
)
SELECT jsonb_build_object(
  'backendPid',pg_backend_pid(), 'readOnly',current_setting('transaction_read_only')='on',
  'dbNow',floor(extract(epoch FROM statement_timestamp()))::bigint,
  'gatesOpen',EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND enabled AND proof_verifier_ready
     AND project_ref='ecv-s33a-20261109-7dd22a81' AND auth_issuer='http://127.0.0.1:56321/auth/v1'),
  'generationActive',EXISTS(SELECT FROM site_private.proof_generations WHERE key_id=s.kid AND revoked_at IS NULL
     AND not_before<=statement_timestamp() AND statement_timestamp()<sign_until AND statement_timestamp()<verify_until),
  'currentEpoch',(SELECT security_epoch FROM site_private.user_security_state WHERE auth_user_id=s.uid
     AND business_enabled AND NOT security_hold AND hold_reason='none'),
  'sessionActive',EXISTS(SELECT FROM auth.sessions a JOIN auth.users u ON u.id=a.user_id WHERE a.id=s.sid AND u.id=s.uid
     AND (a.not_after IS NULL OR statement_timestamp()<a.not_after) AND u.email_confirmed_at IS NOT NULL
     AND NOT u.is_anonymous AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())),
  'grantExpired',(SELECT expires_at<=statement_timestamp() OR absolute_expires_at<=statement_timestamp() FROM grants),
  'tickets',(SELECT count(*) FROM tickets), 'receipts',(SELECT count(*) FROM receipts), 'grants',(SELECT count(*) FROM grants),
  'ticketMatches',EXISTS(SELECT FROM tickets t WHERE t.proof=s.p AND t.auth_user_id=s.uid AND t.auth_session_id=s.sid AND t.key_id=s.p->>'key_id'),
  'receiptMatches',EXISTS(SELECT FROM receipts r JOIN tickets t USING (proof_id) JOIN grants g ON g.id=(r.grant_result->>'grant_id')::uuid
      WHERE r.project_ref=s.p->>'project' AND r.auth_user_id=s.uid AND r.auth_session_id=s.sid
        AND r.action=s.p->>'action' AND r.security_epoch=(s.p->>'epoch')::bigint AND r.key_id=s.p->>'key_id'
        AND r.request_digest=s.p->>'payload_digest' AND g.purpose='business'
        AND r.issued_at=to_timestamp((s.p->>'issued_at')::bigint) AND r.expires_at=to_timestamp((s.p->>'expires_at')::bigint)
        AND r.consumed_at IS NOT NULL AND t.proof=s.p AND r.proof_fingerprint=encode(sha256(convert_to(jsonb_build_object('proof',s.p)::text,'UTF8')),'hex')
        AND g.security_epoch=r.security_epoch AND g.issuer_version='r3-ticket-v1:'||r.key_id
        AND r.grant_result->>'status'=CASE WHEN g.revoked_at IS NULL THEN 'active' ELSE 'revoked' END
        AND (r.grant_result->>'expires_at')::timestamptz=g.expires_at),
  'grantId',(SELECT id FROM grants),
  'grantSha',(SELECT encode(sha256(convert_to(to_jsonb(g)::text,'UTF8')),'hex') FROM grants g),
  'grantExpiry',(SELECT floor(extract(epoch FROM expires_at))::bigint FROM grants),
  'revoked',(SELECT revoked_at IS NOT NULL FROM grants),
  'protectedSha',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(kind,value) ORDER BY kind,id),'[]'::jsonb)::text,'UTF8')),'hex') FROM protected_rows)
) FROM scope s;
ROLLBACK;
