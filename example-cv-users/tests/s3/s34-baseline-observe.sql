-- R3 clean pre-test observation only. No business RPC or writes.
-- Hash complete rows inside PostgreSQL; never export password/token/key bytes.
-- Fingerprint: SHA256(sorted concatenation of fixed-width SHA256(jsonb row text));
-- row_count is recorded separately, preserving duplicates. Compare within PG17.
-- Collector MUST check exact physical-table inventories, maintenance bypassrls,
-- read-only setting, physical identity, exit=0 and final ROLLBACK command tag.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
WITH fingerprints AS (
 SELECT 'site_data.draft_revisions'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.draft_revisions t ) rows
 UNION ALL
 SELECT 'site_data.intro_entries'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.intro_entries t ) rows
 UNION ALL
 SELECT 'site_data.intro_translations'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.intro_translations t ) rows
 UNION ALL
 SELECT 'site_data.section_state'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.section_state t ) rows
 UNION ALL
 SELECT 'site_data.site_domains'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.site_domains t ) rows
 UNION ALL
 SELECT 'site_data.site_locales'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.site_locales t ) rows
 UNION ALL
 SELECT 'site_data.site_members'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.site_members t ) rows
 UNION ALL
 SELECT 'site_data.site_publications'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.site_publications t ) rows
 UNION ALL
 SELECT 'site_data.site_settings'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.site_settings t ) rows
 UNION ALL
 SELECT 'site_data.sites'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_data.sites t ) rows
 UNION ALL
 SELECT 'site_private.business_proof_keys'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.business_proof_keys t ) rows
 UNION ALL
 SELECT 'site_private.business_runtime'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.business_runtime t ) rows
 UNION ALL
 SELECT 'site_private.business_session_grants'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.business_session_grants t ) rows
 UNION ALL
 SELECT 'site_private.grant_proofs'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.grant_proofs t ) rows
 UNION ALL
 SELECT 'site_private.operation_requests'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.operation_requests t ) rows
 UNION ALL
 SELECT 'site_private.proof_generations'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.proof_generations t ) rows
 UNION ALL
 SELECT 'site_private.registered_business_tickets'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.registered_business_tickets t ) rows
 UNION ALL
 SELECT 'site_private.site_audit_events'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.site_audit_events t ) rows
 UNION ALL
 SELECT 'site_private.user_security_state'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM site_private.user_security_state t ) rows
 UNION ALL
 SELECT 'auth.audit_log_entries'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.audit_log_entries t ) rows
 UNION ALL
 SELECT 'auth.custom_oauth_providers'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.custom_oauth_providers t ) rows
 UNION ALL
 SELECT 'auth.flow_state'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.flow_state t ) rows
 UNION ALL
 SELECT 'auth.identities'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.identities t ) rows
 UNION ALL
 SELECT 'auth.instances'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.instances t ) rows
 UNION ALL
 SELECT 'auth.mfa_amr_claims'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.mfa_amr_claims t ) rows
 UNION ALL
 SELECT 'auth.mfa_challenges'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.mfa_challenges t ) rows
 UNION ALL
 SELECT 'auth.mfa_factors'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.mfa_factors t ) rows
 UNION ALL
 SELECT 'auth.mfa_recovery_code_sets'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.mfa_recovery_code_sets t ) rows
 UNION ALL
 SELECT 'auth.mfa_recovery_codes'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.mfa_recovery_codes t ) rows
 UNION ALL
 SELECT 'auth.oauth_authorizations'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.oauth_authorizations t ) rows
 UNION ALL
 SELECT 'auth.oauth_client_states'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.oauth_client_states t ) rows
 UNION ALL
 SELECT 'auth.oauth_clients'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.oauth_clients t ) rows
 UNION ALL
 SELECT 'auth.oauth_consents'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.oauth_consents t ) rows
 UNION ALL
 SELECT 'auth.one_time_tokens'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.one_time_tokens t ) rows
 UNION ALL
 SELECT 'auth.refresh_tokens'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.refresh_tokens t ) rows
 UNION ALL
 SELECT 'auth.saml_providers'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.saml_providers t ) rows
 UNION ALL
 SELECT 'auth.saml_relay_states'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.saml_relay_states t ) rows
 UNION ALL
 SELECT 'auth.schema_migrations'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.schema_migrations t ) rows
 UNION ALL
 SELECT 'auth.scim_tokens'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.scim_tokens t ) rows
 UNION ALL
 SELECT 'auth.scim_users'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.scim_users t ) rows
 UNION ALL
 SELECT 'auth.sessions'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.sessions t ) rows
 UNION ALL
 SELECT 'auth.sso_domains'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.sso_domains t ) rows
 UNION ALL
 SELECT 'auth.sso_providers'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.sso_providers t ) rows
 UNION ALL
 SELECT 'auth.users'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.users t ) rows
 UNION ALL
 SELECT 'auth.webauthn_challenges'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.webauthn_challenges t ) rows
 UNION ALL
 SELECT 'auth.webauthn_credentials'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.webauthn_credentials t ) rows
), protected_auth AS (
 SELECT 'Alice' AS actor,f.* FROM (SELECT 'auth.users'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.users t WHERE t.id='a33c0000-0000-4000-8000-000000000001'::uuid) rows) f
 UNION ALL
 SELECT 'Alice' AS actor,f.* FROM (SELECT 'auth.identities'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.identities t WHERE t.user_id='a33c0000-0000-4000-8000-000000000001'::uuid) rows) f
 UNION ALL
 SELECT 'Alice' AS actor,f.* FROM (SELECT 'auth.sessions'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.sessions t WHERE t.user_id='a33c0000-0000-4000-8000-000000000001'::uuid) rows) f
 UNION ALL
 SELECT 'Alice' AS actor,f.* FROM (SELECT 'auth.refresh_tokens'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.refresh_tokens t WHERE t.user_id='a33c0000-0000-4000-8000-000000000001') rows) f
 UNION ALL
 SELECT 'Alice' AS actor,f.* FROM (SELECT 'auth.mfa_amr_claims'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.mfa_amr_claims t WHERE t.session_id IN (SELECT id FROM auth.sessions WHERE user_id='a33c0000-0000-4000-8000-000000000001'::uuid)) rows) f
 UNION ALL
 SELECT 'Alice' AS actor,f.* FROM (SELECT 'auth.one_time_tokens'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.one_time_tokens t WHERE t.user_id='a33c0000-0000-4000-8000-000000000001'::uuid) rows) f
 UNION ALL
 SELECT 'Bob' AS actor,f.* FROM (SELECT 'auth.users'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.users t WHERE t.id='a33c0000-0000-4000-8000-000000000002'::uuid) rows) f
 UNION ALL
 SELECT 'Bob' AS actor,f.* FROM (SELECT 'auth.identities'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.identities t WHERE t.user_id='a33c0000-0000-4000-8000-000000000002'::uuid) rows) f
 UNION ALL
 SELECT 'Bob' AS actor,f.* FROM (SELECT 'auth.sessions'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.sessions t WHERE t.user_id='a33c0000-0000-4000-8000-000000000002'::uuid) rows) f
 UNION ALL
 SELECT 'Bob' AS actor,f.* FROM (SELECT 'auth.refresh_tokens'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.refresh_tokens t WHERE t.user_id='a33c0000-0000-4000-8000-000000000002') rows) f
 UNION ALL
 SELECT 'Bob' AS actor,f.* FROM (SELECT 'auth.mfa_amr_claims'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.mfa_amr_claims t WHERE t.session_id IN (SELECT id FROM auth.sessions WHERE user_id='a33c0000-0000-4000-8000-000000000002'::uuid)) rows) f
 UNION ALL
 SELECT 'Bob' AS actor,f.* FROM (SELECT 'auth.one_time_tokens'::text AS name,count(*) AS row_count,encode(sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha),''),'UTF8')),'hex') AS data_sha256 FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM auth.one_time_tokens t WHERE t.user_id='a33c0000-0000-4000-8000-000000000002'::uuid) rows) f
)
SELECT jsonb_build_object(
 'meta',jsonb_build_object('system_identifier',(SELECT system_identifier::text FROM pg_control_system()),
  'database',current_database(),'server_version_num',current_setting('server_version_num'),
  'current_user',current_user,'session_user',session_user,
  'superuser',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
  'bypassrls',(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),
  'read_only',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),
  'snapshot_time',statement_timestamp(),'backend_pid',pg_backend_pid()),
 'inventories',(SELECT jsonb_object_agg(schema_name,names) FROM (
  SELECT n.nspname AS schema_name,jsonb_agg(n.nspname||'.'||c.relname ORDER BY c.relname) AS names
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('site_data','site_private','auth') AND c.relkind IN ('r','p') GROUP BY n.nspname) inventory),
 'fingerprints',(SELECT jsonb_agg(to_jsonb(f) ORDER BY name) FROM fingerprints f),
 'protected_auth',(SELECT jsonb_agg(to_jsonb(p) ORDER BY actor,name) FROM protected_auth p),
 'users',(SELECT jsonb_agg(jsonb_build_object('uid',id,'email',email,'confirmed',email_confirmed_at IS NOT NULL,
  'anonymous',is_anonymous,'banned_until',banned_until,'deleted_at',deleted_at) ORDER BY id) FROM auth.users),
 'sessions',(SELECT jsonb_agg(jsonb_build_object('sid',id,'uid',user_id,'created_at',created_at,'not_after',not_after,'aal',aal,
  'refresh_count',(SELECT count(*) FROM auth.refresh_tokens r WHERE r.session_id=s.id),
  'amr_count',(SELECT count(*) FROM auth.mfa_amr_claims a WHERE a.session_id=s.id),
  'password_amr_count',(SELECT count(*) FROM auth.mfa_amr_claims a WHERE a.session_id=s.id AND a.authentication_method='password')) ORDER BY id) FROM auth.sessions s),
 'gates',(SELECT to_jsonb(r) FROM site_private.business_runtime r WHERE singleton),
 'security_state',(SELECT jsonb_agg(to_jsonb(s) ORDER BY auth_user_id) FROM site_private.user_security_state s),
 'grants',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM site_private.business_session_grants g),
 'generations',(SELECT jsonb_agg(to_jsonb(g) ORDER BY key_id) FROM site_private.proof_generations g),
 'tickets',(SELECT jsonb_agg(jsonb_build_object('proof_id',proof_id,'uid',auth_user_id,'sid',auth_session_id,'key_id',key_id) ORDER BY proof_id) FROM site_private.registered_business_tickets),
 'proof_receipts',(SELECT jsonb_agg(jsonb_build_object('proof_id',proof_id,'uid',auth_user_id,'sid',auth_session_id,'action',action,
  'epoch',security_epoch,'key_id',key_id,'consumed_at',consumed_at) ORDER BY proof_id) FROM site_private.grant_proofs),
 'operation_receipts',(SELECT jsonb_agg(jsonb_build_object('request_id',request_id,'uid',actor_auth_user_id,'sid',actor_session_id,
  'site_id',site_id,'operation',operation,'state',state,'payload_digest',payload_digest) ORDER BY request_id) FROM site_private.operation_requests),
 'absences',jsonb_build_object('charlie_user',NOT EXISTS(SELECT FROM auth.users WHERE id='a33c0000-0000-4000-8000-000000000003'::uuid OR email='s34-charlie-20261112@example.test'),
  'charlie_state',NOT EXISTS(SELECT FROM site_private.user_security_state WHERE auth_user_id='a33c0000-0000-4000-8000-000000000003'::uuid),
  'new_generation',NOT EXISTS(SELECT FROM site_private.proof_generations WHERE key_id='s34-r3-clean-20261112-k5'),
  'new_proofs_and_tickets',NOT EXISTS(SELECT FROM site_private.grant_proofs WHERE proof_id IN ('1084ab57-f716-4a2f-90db-c5aa315da34f'::uuid,'2822a7a9-e098-44c0-8e11-a4117152b5b1'::uuid,'d0d65720-4d52-4ee7-9aa4-2ed7776f445a'::uuid)) AND NOT EXISTS(SELECT FROM site_private.registered_business_tickets WHERE proof_id IN ('1084ab57-f716-4a2f-90db-c5aa315da34f'::uuid,'2822a7a9-e098-44c0-8e11-a4117152b5b1'::uuid,'d0d65720-4d52-4ee7-9aa4-2ed7776f445a'::uuid))),
 'connections',jsonb_build_object('max',current_setting('max_connections'),'active',(SELECT count(*) FROM pg_stat_activity),
  'roles',(SELECT jsonb_object_agg(rolname,rolconnlimit) FROM pg_roles WHERE rolname IN ('ecv_s3_internal_api_login','ecv_s3_registration_login'))),
 'postgres_settings',(SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN
  ('ssl','ssl_ca_file','ssl_cert_file','ssl_min_protocol_version','log_error_verbosity','log_min_error_statement','log_line_prefix','log_statement'))
);
ROLLBACK;
