-- TEST ONLY: Awards writer installation, ACL, routing state, and direct-write boundaries.
BEGIN;
SELECT extensions.plan(13);
SELECT extensions.ok(to_regprocedure('public.save_resume_awards_v1(uuid,text,text,text)') IS NOT NULL,
  'typed Awards save RPC is installed');
SELECT extensions.ok(to_regprocedure('public.load_admin_awards_write_state(uuid)') IS NOT NULL,
  'target-scoped Awards write-state reader is installed');
SELECT extensions.ok(to_regprocedure('cms_private.verify_resume_awards_v1_context(uuid,text,text,text)') IS NOT NULL,
  'private Awards signed-context verifier is installed');
SELECT extensions.ok(has_function_privilege('authenticated','public.save_resume_awards_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_resume_awards_v1(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.save_resume_awards_v1(uuid,text,text,text)','EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p,
    LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) AS acl
    WHERE p.oid='public.save_resume_awards_v1(uuid,text,text,text)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'),
  'only authenticated can execute the public Awards writer');
SELECT extensions.ok(NOT has_function_privilege('authenticated','cms_private.verify_resume_awards_v1_context(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','cms_private.verify_resume_awards_v1_context(uuid,text,text,text)','EXECUTE'),
  'the private Awards verifier is not executable by API roles');
SELECT extensions.ok((SELECT prosecdef AND provolatile='v' AND proconfig @> ARRAY['search_path=""']
  FROM pg_catalog.pg_proc WHERE oid='public.save_resume_awards_v1(uuid,text,text,text)'::regprocedure),
  'Awards writer is SECURITY DEFINER with an empty search_path');
SELECT extensions.ok((SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=""']
  FROM pg_catalog.pg_proc WHERE oid='public.load_admin_awards_write_state(uuid)'::regprocedure),
  'Awards state reader is SECURITY DEFINER, STABLE, and uses an empty search_path');
SELECT extensions.ok(NOT has_table_privilege('authenticated','cms_private.activity_log_events','INSERT')
  AND NOT has_table_privilege('authenticated','cms_private.activity_log_idempotency','INSERT'),
  'Awards success events and idempotency remain behind the typed RPC');
SELECT extensions.ok(EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public'
  AND tablename='resume_award_entries' AND policyname='cms_admin_scoped_select' AND cmd='SELECT')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public'
  AND tablename='resume_award_translations' AND policyname='cms_admin_scoped_select' AND cmd='SELECT'),
  'existing authorized Awards reads remain available');
SELECT extensions.ok(NOT EXISTS (SELECT 1 FROM cms_private.resume_domain_requirements WHERE domain_key='awards'
    AND requirement_key='trusted_network_context_v11'), 'migration installs no Awards trusted-context activation row');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT extensions.ok(public.can_direct_write_awards('20000000-0000-4000-8000-000000000001'),
  'Official-like Awards remain in direct mode after installation');
SELECT extensions.ok(public.can_direct_write_awards('ea111111-1111-4111-8111-111111111111'),
  'QA Awards remain in direct mode after installation');
WITH boundary_values AS (
  SELECT ('[' || '"' || repeat('x',8188) || '"' || ']')::jsonb AS within_limit,
    ('[' || '"' || repeat('x',8189) || '"' || ']')::jsonb AS over_limit
)
SELECT extensions.ok(
  octet_length(convert_to(within_limit::text,'UTF8'))=8192
  AND octet_length(convert_to(within_limit::text,'UTF8')) <= 8192
  AND octet_length(convert_to(over_limit::text,'UTF8'))=8193
  AND octet_length(convert_to(over_limit::text,'UTF8')) > 8192
  AND pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.save_resume_awards_v1(uuid,text,text,text)'::regprocedure),'result_value::text') > 0
  AND pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.save_resume_awards_v1(uuid,text,text,text)'::regprocedure),'> 8192') > 0,
  'UTF-8 idempotency result boundary is 8192 bytes and the installed writer rejects larger results')
FROM boundary_values;
SELECT * FROM extensions.finish();
ROLLBACK;
