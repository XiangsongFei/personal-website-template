BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir publication-target.sql
WITH sites AS (
 SELECT s.id,s.owner_auth_user_id,s.draft_revision,p.publication_revision,p.state,p.snapshot_id
 FROM site_data.sites s JOIN site_data.site_publications p ON p.site_id=s.id
 WHERE (s.id,s.owner_auth_user_id) IN ((:'alice_site'::uuid,:'alice_uid'::uuid),(:'bob_site'::uuid,:'bob_uid'::uuid))
), effects AS (
 SELECT 'sites' k,to_jsonb(t) AS v FROM site_data.sites t
 UNION ALL SELECT 'section',to_jsonb(t) FROM site_data.section_state t
 UNION ALL SELECT 'draft_history',to_jsonb(t) FROM site_data.draft_revisions t
 UNION ALL SELECT 'operations',to_jsonb(t) FROM site_private.operation_requests t
 UNION ALL SELECT 'text_audit',to_jsonb(t) FROM site_private.text_publication_audit t
 UNION ALL SELECT 'publication',to_jsonb(t) FROM site_data.site_publications t
 UNION ALL SELECT 'publication_history',to_jsonb(t) FROM site_private.publication_revisions t
 UNION ALL SELECT 'snapshot',to_jsonb(t) FROM site_data.published_snapshots t
 UNION ALL SELECT 'outbox',to_jsonb(t) FROM site_private.publication_outbox t
 UNION ALL SELECT 'digest_map',to_jsonb(t) FROM site_private.text_digest_mappings t
), subject AS (
 SELECT actor.uid,actor.sid,actor.site_id, actor.label,
   EXISTS(SELECT FROM auth.sessions s WHERE s.id=actor.sid AND s.user_id=actor.uid) AS auth_row_present,
   EXISTS(SELECT FROM auth.sessions s WHERE s.id=actor.sid AND s.user_id=actor.uid
     AND (s.not_after IS NULL OR s.not_after>clock_timestamp())) AS auth_live,
   (SELECT count(*) FROM auth.sessions s WHERE s.user_id=actor.uid AND s.id<>actor.sid) AS other_sessions,
   (SELECT encode(sha256(convert_to(coalesce(string_agg(s.id::text,',' ORDER BY s.id),''),'UTF8')),'hex')
    FROM auth.sessions s WHERE s.user_id=actor.uid AND s.id<>actor.sid) AS other_sessions_digest,
   g.id AS grant_id,g.reason, (g.revoked_at IS NOT NULL) AS revoked,
   coalesce(g.expires_at>clock_timestamp() AND g.absolute_expires_at>clock_timestamp(),false) AS unexpired_grant,
   coalesce(g.issuer_version='r3-ticket-v1:'|| :'key_id',false) AS generation_matches,
   coalesce(q.security_epoch=0 AND g.security_epoch=q.security_epoch AND q.business_enabled
     AND NOT q.security_hold AND q.hold_reason='none',false) AS same_eligible_epoch,
   EXISTS(SELECT FROM site_data.site_members m WHERE m.site_id=actor.site_id AND m.auth_user_id=actor.uid
     AND m.role='owner' AND m.state='active') AS active_owner
 FROM (VALUES
   ('alice',:'alice_uid'::uuid,:'alice_sid'::uuid,:'alice_site'::uuid),
   ('bob',:'bob_uid'::uuid,:'bob_sid'::uuid,:'bob_site'::uuid)) actor(label,uid,sid,site_id)
 LEFT JOIN site_private.business_session_grants g ON g.auth_user_id=actor.uid AND g.auth_session_id=actor.sid
 LEFT JOIN site_private.user_security_state q ON q.auth_user_id=actor.uid
)
SELECT jsonb_build_object(
 'site_facts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM sites s),
 'catalog_closed',NOT has_function_privilege('authenticated','site_api.publish_site(uuid,jsonb,text)','EXECUTE')
   AND NOT has_function_privilege('authenticated','site_api.unpublish_site(uuid,jsonb,text)','EXECUTE'),
 'users',(SELECT count(*) FROM auth.users),
 'effects',(SELECT jsonb_object_agg(k,jsonb_build_object('count',n,'sha256',digest)) FROM (
    SELECT k,count(*) n,encode(sha256(convert_to(string_agg(v::text,E'\n' ORDER BY v::text COLLATE "C"),'UTF8')),'hex') digest
    FROM effects GROUP BY k) e),
 'request_rows',(SELECT count(*) FROM site_private.operation_requests WHERE request_id=:'request_id'::uuid),
 'pending_unattempted',(SELECT count(*) FROM site_private.publication_outbox WHERE state='pending'
   AND attempt_count=0 AND lease_generation=0 AND dispatch_started_at IS NULL),
 'generation_live',EXISTS(SELECT FROM site_private.proof_generations WHERE key_id=:'key_id' AND revoked_at IS NULL
   AND not_before<=clock_timestamp() AND verify_until>clock_timestamp()),
 'subjects',(SELECT jsonb_object_agg(label,to_jsonb(subject)-'label') FROM subject),
 'revoke_proof_consumed',EXISTS(SELECT FROM site_private.grant_proofs g JOIN subject s
   ON g.auth_user_id=s.uid AND g.auth_session_id=s.sid AND s.label='bob' AND g.grant_result->>'grant_id'=s.grant_id::text
   WHERE g.proof_id=:'revoke_proof'::uuid AND g.action='revoke' AND g.key_id=:'key_id'));
ROLLBACK;
