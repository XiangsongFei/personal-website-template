-- Observe the two scoped fixtures in a separate TLS read-only transaction.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='8s';
WITH selected AS (SELECT id FROM site_data.sites WHERE id IN (:'alice_site'::uuid, :'bob_site'::uuid)),
state AS (
 SELECT jsonb_build_object(
   'site_count',(SELECT count(*) FROM selected),
   'draft_zero',(SELECT count(*) FROM site_data.sites WHERE id IN(SELECT id FROM selected) AND draft_revision=0),
   'unpublished',(SELECT count(*) FROM site_data.site_publications WHERE site_id IN(SELECT id FROM selected)
     AND state='unpublished' AND publication_revision=0 AND snapshot_id IS NULL),
   'request_rows',(SELECT count(*) FROM site_private.operation_requests WHERE request_id=:'request_id'::uuid),
   'bob_digest',encode(sha256(convert_to(jsonb_build_object(
      'site',(SELECT to_jsonb(r) FROM site_data.sites r WHERE id=:'bob_site'::uuid),
      'sections',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_data.section_state r WHERE site_id=:'bob_site'::uuid),
      'drafts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_data.draft_revisions r WHERE site_id=:'bob_site'::uuid),
      'publication',(SELECT to_jsonb(r) FROM site_data.site_publications r WHERE site_id=:'bob_site'::uuid)
   )::text,'UTF8')),'hex'),
   'guarded_state',jsonb_build_object(
      'sites',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_data.sites r WHERE id IN(SELECT id FROM selected)),
      'sections',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_data.section_state r WHERE site_id IN(SELECT id FROM selected)),
      'draft_history',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_data.draft_revisions r WHERE site_id IN(SELECT id FROM selected)),
      'publication',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_data.site_publications r WHERE site_id IN(SELECT id FROM selected)),
      'operations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_private.operation_requests r WHERE site_id IN(SELECT id FROM selected)),
      'audit',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_private.text_publication_audit r WHERE site_id IN(SELECT id FROM selected)),
      'snapshots',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_data.published_snapshots r WHERE site_id IN(SELECT id FROM selected)),
      'outbox',(SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)) FROM site_private.publication_outbox r WHERE site_id IN(SELECT id FROM selected))
   )
 ) AS observed
)
SELECT (observed-'guarded_state') ||
  jsonb_build_object('digest',encode(sha256(convert_to((observed->'guarded_state')::text,'UTF8')),'hex'),
   'valid_identity',session_user='postgres' AND current_user=session_user AND current_database()='postgres'
     AND current_setting('server_version_num')='170012'
     AND EXISTS(SELECT FROM site_private.business_runtime WHERE singleton AND project_ref=:'project'
       AND auth_issuer='https://'||:'project'||'.supabase.co/auth/v1')
     AND EXISTS(SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl AND version='TLSv1.3'))
FROM state;
ROLLBACK;
