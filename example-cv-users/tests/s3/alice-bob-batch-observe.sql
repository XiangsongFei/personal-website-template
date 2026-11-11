-- Candidate for a fresh read-only auditor after both sites commit.
-- Four UUIDs are captured from trusted session/operation receipts, never from caller UID fields.
-- Compare each returned site against its HTTP receipt, exact 14-row shape and aggregate baseline.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5s';
WITH expected(actor,uid,sid,site,rid,slug) AS (VALUES
 ('alice','a33b0000-0000-4000-8000-000000000001'::uuid,:'alice_sid'::uuid,nullif(:'alice_site','')::uuid,
  'a33b0000-0000-4000-8000-000000000101'::uuid,'s33b-alice-main-20261109'),
 ('bob','a33b0000-0000-4000-8000-000000000002'::uuid,:'bob_sid'::uuid,nullif(:'bob_site','')::uuid,
  'a33b0000-0000-4000-8000-000000000102'::uuid,'s33b-bob-main-20261109')
)
SELECT e.actor,
 (SELECT count(*) FROM site_data.sites s WHERE s.owner_auth_user_id=e.uid) AS owned_count,
 (SELECT count(*)=1 AND bool_and(s.id=e.site AND s.status='active' AND s.draft_revision=0)
  FROM site_data.sites s WHERE s.owner_auth_user_id=e.uid) AS owner_ok,
 (SELECT count(*)=1 AND bool_and(m.auth_user_id=e.uid AND m.role='owner' AND m.state='active')
  FROM site_data.site_members m WHERE m.site_id=e.site) AS mirror_ok,
 (SELECT count(*)=1 AND bool_and(p.state='unpublished' AND p.publication_revision=0 AND
      p.snapshot_id IS NULL AND p.changed_by=e.uid)
  FROM site_data.site_publications p WHERE p.site_id=e.site) AS unpublished_ok,
 (SELECT count(*)=1 AND bool_and(d.slug=e.slug AND d.hostname_normalized=e.slug||'.sites.example.test'
      AND d.kind='test' AND d.state='reserved' AND d.is_primary AND d.verified_at IS NULL)
  FROM site_data.site_domains d WHERE d.site_id=e.site) AS domain_ok,
 (SELECT array_agg(l.locale ORDER BY l.locale)=ARRAY['en','zh'] AND bool_and(l.enabled)
  FROM site_data.site_locales l WHERE l.site_id=e.site) AS locales_ok,
 (SELECT count(*)=1 AND bool_and(s.default_locale='en' AND s.theme_key='default' AND s.theme_options='{}'::jsonb)
  FROM site_data.site_settings s WHERE s.site_id=e.site) AS settings_ok,
 (SELECT count(*)=1 AND bool_and(s.section_key='introduction' AND s.revision=0)
  FROM site_data.section_state s WHERE s.site_id=e.site) AS section_ok,
 (SELECT count(*)=1 AND bool_and(t.position=0) FROM site_data.intro_entries t WHERE t.site_id=e.site) AS entry_ok,
 (SELECT count(*)=2 AND jsonb_object_agg(t.locale,t.text)='{"zh":"请填写个人介绍。","en":"Add your introduction."}'::jsonb
  FROM site_data.intro_translations t JOIN site_data.intro_entries i ON (t.site_id,t.parent_id)=(i.site_id,i.id)
  WHERE t.site_id=e.site) AS translations_ok,
 (SELECT count(*)=1 AND bool_and(r.request_id=e.rid AND r.actor_auth_user_id=e.uid AND r.actor_session_id=e.sid
   AND r.operation='create_site' AND r.state='succeeded'
   AND r.payload_digest=encode(sha256(convert_to('ecv.create_site.v1'||chr(10)||e.slug||chr(10)||'en'||chr(10),'UTF8')),'hex')
   AND r.result=jsonb_build_object('schema_version',1,'request_id',e.rid,'site_id',e.site,'persisted',true,
       'publication',jsonb_build_object('state','unpublished','snapshot_id',NULL,'publication_revision',0)))
  FROM site_private.operation_requests r WHERE r.site_id=e.site) AS receipt_ok,
 (SELECT count(*)=1 AND bool_and(d.actor_auth_user_id=e.uid AND d.site_revision=0 AND d.section_revision=0
   AND d.section_key='introduction' AND d.schema_version=1 AND r.request_id=e.rid
   AND d.digest=encode(sha256(convert_to(d.payload::text,'UTF8')),'hex')
   AND d.payload=jsonb_build_object('schema_version',1,'entries',jsonb_build_array(jsonb_build_object(
     'id',i.id,'position',0,'translations',jsonb_build_object('zh','请填写个人介绍。','en','Add your introduction.')))))
  FROM site_data.draft_revisions d JOIN site_private.operation_requests r ON (d.site_id,d.operation_id)=(r.site_id,r.id)
  JOIN site_data.intro_entries i ON d.site_id=i.site_id WHERE d.site_id=e.site) AS draft_ok,
 (SELECT count(*)=1 AND bool_and(a.actor_auth_user_id=e.uid AND a.section='introduction' AND a.action='create_site'
      AND a.result='succeeded' AND r.request_id=e.rid)
  FROM site_private.site_audit_events a JOIN site_private.operation_requests r ON (a.site_id,a.operation_id)=(r.site_id,r.id)
  WHERE a.site_id=e.site) AS audit_ok
FROM expected e ORDER BY e.actor;

-- Exactly twelve relation results even when baseline tables were empty. Capture before the
-- first create (both site variables then empty strings), again with the two observed site IDs.
-- Compare old_count and old_sha256 byte-for-byte, check added_count per relation.
WITH output_names(relation) AS (VALUES
 ('site_data.sites'),
 ('site_data.site_members'),
 ('site_data.site_publications'),
 ('site_data.site_domains'),
 ('site_data.site_locales'),
 ('site_data.site_settings'),
 ('site_data.section_state'),
 ('site_data.intro_entries'),
 ('site_data.intro_translations'),
 ('site_data.draft_revisions'),
 ('site_private.operation_requests'),
 ('site_private.site_audit_events')),
rows AS (
 SELECT 'site_data.sites' AS relation, t.id AS site, to_jsonb(t)::text AS row_text FROM site_data.sites t
 UNION ALL
 SELECT 'site_data.site_members' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.site_members t
 UNION ALL
 SELECT 'site_data.site_publications' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.site_publications t
 UNION ALL
 SELECT 'site_data.site_domains' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.site_domains t
 UNION ALL
 SELECT 'site_data.site_locales' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.site_locales t
 UNION ALL
 SELECT 'site_data.site_settings' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.site_settings t
 UNION ALL
 SELECT 'site_data.section_state' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.section_state t
 UNION ALL
 SELECT 'site_data.intro_entries' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.intro_entries t
 UNION ALL
 SELECT 'site_data.intro_translations' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.intro_translations t
 UNION ALL
 SELECT 'site_data.draft_revisions' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_data.draft_revisions t
 UNION ALL
 SELECT 'site_private.operation_requests' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_private.operation_requests t
 UNION ALL
 SELECT 'site_private.site_audit_events' AS relation, t.site_id AS site, to_jsonb(t)::text AS row_text FROM site_private.site_audit_events t
), classified AS (
 SELECT r.*, (r.site IS NOT DISTINCT FROM nullif(:'alice_site','')::uuid OR
              r.site IS NOT DISTINCT FROM nullif(:'bob_site','')::uuid) AS added FROM rows r
)
SELECT n.relation, count(c.site) FILTER (WHERE NOT c.added) AS old_count,
 encode(sha256(convert_to(coalesce(string_agg(c.row_text,E'\n' ORDER BY c.row_text COLLATE "C")
     FILTER (WHERE NOT c.added),''),'UTF8')),'hex') AS old_sha256,
 count(c.site) FILTER (WHERE c.added) AS added_count
FROM output_names n LEFT JOIN classified c USING (relation)
GROUP BY n.relation ORDER BY n.relation;
ROLLBACK;
