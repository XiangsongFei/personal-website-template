-- Individual current qualifications, observed independently of the business client.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir publication-target.sql
SELECT jsonb_build_object(
 'session',EXISTS(SELECT FROM auth.sessions a WHERE a.id=g.auth_session_id AND a.user_id=q.auth_user_id
     AND (a.not_after IS NULL OR a.not_after>clock_timestamp())),
 'uid',q.auth_user_id,'sid',g.auth_session_id,'grant',g.id,'grant_epoch',g.security_epoch,'epoch',q.security_epoch,
 'enabled',q.business_enabled,'hold',q.security_hold,'hold_reason',q.hold_reason,
 'grant_revoked',g.revoked_at IS NOT NULL,'expires',floor(extract(epoch FROM g.expires_at)*1000)::bigint,
 'grant_unexpired',g.issued_at<=clock_timestamp() AND g.last_renewed_at<=clock_timestamp()
      AND g.expires_at>clock_timestamp() AND g.absolute_expires_at>clock_timestamp(),
 'generation',k.key_id,'generation_revoked',k.revoked_at IS NOT NULL,
 'site_status',s.status,'site_deleted_at',s.deleted_at,
 'mirror',EXISTS(SELECT FROM site_data.site_members m WHERE m.site_id=s.id AND m.auth_user_id=q.auth_user_id
      AND m.role='owner' AND m.state='active'),
 'read_execute',has_function_privilege('authenticated','site_api.read_introduction(uuid)','EXECUTE'))
FROM site_private.user_security_state q JOIN site_private.business_session_grants g ON g.auth_user_id=q.auth_user_id
 JOIN site_private.proof_generations k ON g.issuer_version='r3-ticket-v1:'||k.key_id
 JOIN site_data.sites s ON s.owner_auth_user_id=q.auth_user_id
WHERE q.auth_user_id=:'uid'::uuid AND g.auth_session_id=:'sid'::uuid AND g.id=:'grant_id'::uuid
 AND k.key_id=:'key_id' AND s.id=:'site'::uuid;
ROLLBACK;
