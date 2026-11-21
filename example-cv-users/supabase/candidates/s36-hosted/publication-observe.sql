-- psql variables: alice_site, bob_site, alice_sid, bob_sid, unqualified_sid.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir publication-target.sql
WITH scoped AS (
 SELECT s.id,s.owner_auth_user_id AS uid,s.draft_revision,q.revision AS section_revision,
   jsonb_build_object('site_id',p.site_id,'state',p.state,'snapshot_id',p.snapshot_id,
     'publication_revision',p.publication_revision,
     'changed_at',CASE WHEN p.publication_revision=0 THEN NULL ELSE floor(extract(epoch FROM p.changed_at)*1000)::bigint END,
     'changed_by',CASE WHEN p.publication_revision=0 THEN NULL ELSE p.changed_by END) AS publication,
   h.payload,h.digest,(SELECT digest FROM site_data.draft_revisions WHERE site_id=s.id AND site_revision=0) AS initial_digest
 FROM site_data.sites s
 JOIN site_data.section_state q ON q.site_id=s.id AND q.section_key='introduction'
 JOIN site_data.site_publications p ON p.site_id=s.id
 JOIN site_data.draft_revisions h ON h.site_id=s.id AND h.site_revision=s.draft_revision
 WHERE s.id IN (:'alice_site'::uuid,:'bob_site'::uuid)
), entitled AS (
 SELECT s.id,s.uid,a.id sid,g.id grant_id
 FROM scoped s
 JOIN site_data.site_members m ON m.site_id=s.id AND m.auth_user_id=s.uid AND m.role='owner' AND m.state='active'
 JOIN auth.users u ON u.id=s.uid AND NOT u.is_anonymous AND u.email_confirmed_at IS NOT NULL
   AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
 JOIN auth.sessions a ON a.user_id=s.uid AND (a.not_after IS NULL OR a.not_after>clock_timestamp())
 JOIN site_private.business_session_grants g ON g.auth_user_id=s.uid AND g.auth_session_id=a.id
   AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND g.absolute_expires_at>clock_timestamp()
 JOIN site_private.user_security_state q ON q.auth_user_id=s.uid AND q.security_epoch=g.security_epoch
   AND q.business_enabled AND NOT q.security_hold
 WHERE (s.id,a.id) IN ((:'alice_site'::uuid,:'alice_sid'::uuid),(:'bob_site'::uuid,:'bob_sid'::uuid))
)
SELECT jsonb_build_object(
 'target','vellypyadcxkvqftsbrg',
 'ready',to_regrole('ecv_s36_outbox_worker') IS NOT NULL
   AND has_function_privilege('authenticated','site_api.publish_site(uuid,jsonb,text)','EXECUTE')
   AND has_function_privilege('authenticated','site_api.unpublish_site(uuid,jsonb,text)','EXECUTE')
   AND (SELECT count(*) FROM site_data.sites)=2 AND (SELECT count(*) FROM auth.users)=2
   AND NOT EXISTS(SELECT FROM site_data.site_domains WHERE kind<>'test' OR state<>'reserved' OR verified_at IS NOT NULL),
 'missing_grant',EXISTS(SELECT FROM auth.sessions h JOIN scoped s ON s.uid=h.user_id
   WHERE h.id=:'unqualified_sid'::uuid AND s.id=:'alice_site'::uuid AND h.id<>:'alice_sid'::uuid
     AND (h.not_after IS NULL OR h.not_after>clock_timestamp()))
   AND NOT EXISTS(SELECT FROM site_private.business_session_grants WHERE auth_session_id=:'unqualified_sid'::uuid
      AND revoked_at IS NULL AND expires_at>clock_timestamp()),
 'sites',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoped r),
 'entitled',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM entitled r),
 'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM site_private.operation_requests o),
 'audits',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM site_private.text_publication_audit a),
 'snapshots',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id),'[]') FROM site_data.published_snapshots n),
 'history',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.site_id,p.publication_revision),'[]') FROM site_private.publication_revisions p),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id),'[]') FROM site_private.publication_outbox o));
ROLLBACK;
