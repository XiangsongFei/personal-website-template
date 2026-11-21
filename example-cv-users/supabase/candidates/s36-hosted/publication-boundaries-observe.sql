-- psql variables: alice_site, bob_site.
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
   AND EXISTS(SELECT FROM site_private.business_runtime b WHERE b.singleton AND b.project_ref='vellypyadcxkvqftsbrg')
), operations AS (
 SELECT o.* FROM site_private.operation_requests o JOIN scoped s ON s.id=o.site_id ORDER BY o.id
), audits AS (
 SELECT a.* FROM site_private.text_publication_audit a JOIN scoped s ON s.id=a.site_id ORDER BY a.id
), snapshots AS (
 SELECT n.* FROM site_data.published_snapshots n JOIN scoped s ON s.id=n.site_id ORDER BY n.id
), history AS (
 SELECT h.* FROM site_private.publication_revisions h JOIN scoped s ON s.id=h.site_id ORDER BY h.site_id,h.publication_revision
), outbox AS (
 SELECT o.* FROM site_private.publication_outbox o JOIN scoped s ON s.id=o.site_id ORDER BY o.id
)
SELECT jsonb_build_object(
 'target','vellypyadcxkvqftsbrg',
 'acl',jsonb_build_array(
   has_function_privilege('authenticated','site_api.publish_site(uuid,jsonb,text)','EXECUTE'),
   has_function_privilege('authenticated','site_api.unpublish_site(uuid,jsonb,text)','EXECUTE')),
 'site_total',(SELECT count(*) FROM site_data.sites),
 'user_total',(SELECT count(*) FROM auth.users),
 'sites',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoped r),
 'domains',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM site_data.site_domains d),
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.site_id,m.auth_user_id) FROM site_data.site_members m),
 'drafts',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM site_data.draft_revisions h),
 'operations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]') FROM operations o),
 'audits',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]') FROM audits a),
 'snapshots',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.id), '[]') FROM snapshots n),
 'history',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.site_id,p.publication_revision), '[]') FROM history p),
 'outbox',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]') FROM outbox o));
ROLLBACK;
