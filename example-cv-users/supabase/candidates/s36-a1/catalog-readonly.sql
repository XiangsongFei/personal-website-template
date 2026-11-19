-- Replacement projection candidate for A07 and reserved A50. Historical drivers
-- pin different SQL bytes and must be reviewed before consuming this projection.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

DO $observer$
DECLARE expected text := current_setting('ecv_s36_a1.expected_system_identifier', true);
BEGIN
  IF current_user <> 'supabase_admin' OR session_user <> current_user
    OR NOT EXISTS (SELECT FROM pg_roles WHERE oid = 10 AND rolname = current_user AND rolsuper)
    OR current_database() <> 'postgres' OR inet_client_addr() IS NOT NULL
    OR current_setting('server_version_num') <> '170011'
    OR current_setting('transaction_read_only') <> 'on'
    OR expected IS NULL OR expected !~ '^[1-9][0-9]{9,19}$'
    OR expected <> (SELECT system_identifier::text FROM pg_control_system())
    OR (SELECT count(*) FROM site_private.business_runtime) <> 1
    OR NOT EXISTS (SELECT FROM site_private.business_runtime WHERE singleton
      AND NOT enabled AND NOT proof_verifier_ready AND project_ref = 'ecv-s33a-20261109-7dd22a81'
      AND auth_issuer = 'http://127.0.0.1:56321/auth/v1')
    OR (SELECT count(*) FROM site_private.text_publication_runtime) <> 1
    OR NOT EXISTS (SELECT FROM site_private.text_publication_runtime WHERE singleton
      AND NOT write_enabled AND NOT public_read_enabled AND NOT outbox_enabled)
  THEN RAISE EXCEPTION 'S36_A1_CLOSED_CATALOG_UNPROVEN' USING ERRCODE = '42501'; END IF;
END;
$observer$;

WITH namespaces AS (
  SELECT * FROM pg_namespace WHERE nspname IN ('site_api','site_data','site_private','auth','extensions','public')
), relations AS (
  SELECT c.*, n.nspname || '.' || c.relname AS identity
  FROM pg_class c JOIN namespaces n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('site_data','site_private','site_api','auth') AND c.relkind IN ('r','p','v','m','f','S')
), functions AS (
  SELECT p.*, n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS identity
  FROM pg_proc p JOIN namespaces n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('site_data','site_private','site_api','auth')
     OR (n.nspname = 'public' AND p.proname = 'read_public_text')
     OR (n.nspname = 'extensions' AND p.proname IN ('digest','hmac'))
), roles AS (
  SELECT * FROM pg_roles
  WHERE rolname IN ('anon','authenticated','authenticator','service_role','postgres','supabase_admin',
    'supabase_auth_admin','supabase_storage_admin')
    OR left(rolname,7) = 'ecv_s3_' OR left(rolname,8) = 'ecv_s36_'
), entries(kind, identity, value) AS (
  SELECT 'schema', nspname::text, to_jsonb(pg_get_userbyid(nspowner)) FROM namespaces
  UNION ALL
  SELECT 'relation', identity, jsonb_build_array(relkind,pg_get_userbyid(relowner),relrowsecurity,relforcerowsecurity) FROM relations
  UNION ALL
  SELECT 'column', r.identity || '.' || a.attname, jsonb_build_array(format_type(a.atttypid,a.atttypmod),
    a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))
  FROM relations r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  UNION ALL
  SELECT 'function', identity, jsonb_build_array(pg_get_userbyid(proowner),prosecdef,provolatile,proleakproof,
    l.lanname,pg_get_function_result(f.oid),to_jsonb(proconfig),encode(sha256(convert_to(prosrc,'UTF8')),'hex'))
  FROM functions f JOIN pg_language l ON l.oid = f.prolang
  UNION ALL
  SELECT 'constraint', r.identity || '.' || c.conname,
    jsonb_build_array(contype,convalidated,condeferrable,condeferred,pg_get_constraintdef(c.oid))
  FROM pg_constraint c JOIN relations r ON r.oid = c.conrelid
  UNION ALL
  SELECT 'index', r.identity || '.' || c.relname,
    jsonb_build_array(i.indisvalid,i.indisready,i.indisunique,pg_get_indexdef(c.oid))
  FROM pg_index i JOIN relations r ON r.oid = i.indrelid JOIN pg_class c ON c.oid = i.indexrelid
  UNION ALL
  SELECT 'trigger', r.identity || '.' || t.tgname, jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN relations r ON r.oid = t.tgrelid WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'policy', r.identity || '.' || p.polname, jsonb_build_array(p.polpermissive,p.polcmd,
    (SELECT jsonb_agg(name ORDER BY name COLLATE "C") FROM (
      SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'::text ELSE pg_get_userbyid(role_oid)::text END AS name
      FROM unnest(p.polroles) role_oid
    ) names), pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
  FROM pg_policy p JOIN relations r ON r.oid = p.polrelid
  UNION ALL
  SELECT 'role', rolname, jsonb_build_array(rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolreplication,rolconnlimit)
  FROM roles
  UNION ALL
  SELECT 'membership', format('%s/%s/%s',pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),
    jsonb_build_array(admin_option,inherit_option,set_option)
  FROM pg_auth_members WHERE roleid IN (SELECT oid FROM roles) OR member IN (SELECT oid FROM roles)
  UNION ALL
  SELECT 'default_acl', pg_get_userbyid(d.defaclrole) || '/' || coalesce(n.nspname,'<global>') || '/' || d.defaclobjtype,
    to_jsonb(d.defaclobjtype)
  FROM pg_default_acl d LEFT JOIN namespaces n ON n.oid = d.defaclnamespace
  WHERE d.defaclrole IN (SELECT oid FROM roles) AND (n.oid IS NOT NULL OR d.defaclnamespace = 0)
), acl_inputs(kind, identity, acl) AS (
  SELECT 'schema', nspname::text, coalesce(nspacl,acldefault('n',nspowner)) FROM namespaces
  UNION ALL
  SELECT 'relation', identity, coalesce(relacl,acldefault((CASE WHEN relkind='S' THEN 's' ELSE 'r' END)::"char",relowner))
  FROM relations
  UNION ALL
  SELECT 'column', r.identity || '.' || a.attname, a.attacl
  FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'function', identity, coalesce(proacl,acldefault('f',proowner)) FROM functions
  UNION ALL
  SELECT 'default_acl', pg_get_userbyid(d.defaclrole) || '/' || coalesce(n.nspname,'<global>') || '/' || d.defaclobjtype,
    d.defaclacl
  FROM pg_default_acl d LEFT JOIN namespaces n ON n.oid = d.defaclnamespace
  WHERE d.defaclrole IN (SELECT oid FROM roles) AND (n.oid IS NOT NULL OR d.defaclnamespace = 0)
), acl_rows AS (
  SELECT 'acl' AS kind, format('%s/%s/%s/%s/%s',a.kind,a.identity,pg_get_userbyid(x.grantor),
    CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type) AS identity,
    to_jsonb(x.is_grantable) AS value
  FROM acl_inputs a CROSS JOIN LATERAL aclexplode(a.acl) x
)
SELECT jsonb_build_object('format','s36-a1-catalog-v1','items',jsonb_agg(jsonb_build_array(kind,identity,value)))
FROM (SELECT * FROM entries UNION ALL SELECT * FROM acl_rows) inventory;
ROLLBACK;
