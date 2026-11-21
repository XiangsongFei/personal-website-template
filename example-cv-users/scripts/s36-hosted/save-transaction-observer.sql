BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='8s';
WITH scoped AS (
 SELECT s.id,s.owner_auth_user_id uid,s.draft_revision,q.revision section_revision,p.state,p.publication_revision,p.snapshot_id,
    h.payload,h.digest
 FROM site_data.sites s
 JOIN site_data.section_state q ON q.site_id=s.id AND q.section_key='introduction'
 JOIN site_data.site_publications p ON p.site_id=s.id
 JOIN site_data.draft_revisions h ON h.site_id=s.id AND h.site_revision=s.draft_revision
 WHERE s.id IN (:'alice_site'::uuid,:'bob_site'::uuid)
), authz AS (
 SELECT s.id,g.id grant_id,g.auth_session_id sid,g.security_epoch,
    (g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND g.absolute_expires_at>clock_timestamp()) live
 FROM scoped s
 JOIN site_data.site_members m ON m.site_id=s.id AND m.auth_user_id=s.uid AND m.role='owner' AND m.state='active'
 JOIN auth.users u ON u.id=s.uid AND NOT u.is_anonymous AND u.email_confirmed_at IS NOT NULL
   AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
 JOIN auth.sessions a ON a.user_id=s.uid AND (a.not_after IS NULL OR a.not_after>clock_timestamp())
 JOIN site_private.business_session_grants g ON g.auth_user_id=s.uid AND g.auth_session_id=a.id AND g.purpose='business'
 JOIN site_private.user_security_state us ON us.auth_user_id=s.uid AND us.security_epoch=g.security_epoch
   AND us.business_enabled AND NOT us.security_hold
 WHERE a.id IN (:'alice_sid'::uuid,:'bob_sid'::uuid)
), effects AS (
 SELECT o.request_id,o.site_id,o.actor_auth_user_id uid,o.actor_session_id sid,o.basis_draft_revision basis,
    o.state,o.result,o.payload_digest,o.canonical_request,h.site_revision revision,h.payload,h.digest,
    t.actor_auth_user_id audit_uid,t.actor_session_id audit_sid,t.draft_revision audit_revision,t.publication_revision audit_publication
 FROM site_private.operation_requests o
 LEFT JOIN site_data.draft_revisions h ON h.operation_id=o.id AND h.site_id=o.site_id
 LEFT JOIN site_private.text_publication_audit t ON t.operation_id=o.id AND t.site_id=o.site_id AND t.action='save_text_draft'
 WHERE o.operation='save_text_draft'
)
SELECT jsonb_build_object(
 'target_ok',session_user='postgres' AND current_user=session_user AND current_database()='postgres'
   AND current_setting('server_version_num')='170012'
   AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl AND version='TLSv1.3')
   AND EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND project_ref='vellypyadcxkvqftsbrg'
     AND enabled AND proof_verifier_ready),
 'gates_ok',EXISTS(SELECT FROM site_private.text_publication_runtime WHERE singleton AND write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
   AND NOT has_function_privilege('authenticated','site_api.publish_site(uuid,jsonb,text)','EXECUTE')
   AND NOT has_function_privilege('authenticated','site_api.unpublish_site(uuid,jsonb,text)','EXECUTE'),
 'site_count',(SELECT count(*) FROM site_data.sites),'user_count',(SELECT count(*) FROM auth.users),
 'scoped',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM scoped s),
 'authz',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM authz a),
 'effects',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.revision,e.request_id) FROM effects e),
 'draft_count',(SELECT count(*) FROM site_data.draft_revisions),
 'audit_count',(SELECT count(*) FROM site_private.text_publication_audit),
 'outbox_count',(SELECT count(*) FROM site_private.publication_outbox),
 'snapshot_count',(SELECT count(*) FROM site_data.published_snapshots));
ROLLBACK;
