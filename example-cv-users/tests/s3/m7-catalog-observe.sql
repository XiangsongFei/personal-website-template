-- NOT RUN. Catalog-only M7 CLOSED profile. Requires a separately approved target.
-- No business RPC, Auth row, fixture, role switch, DDL or secret is read/written.
-- Keep full BEGIN/ROLLBACK/exit receipts in the approved host; export only the
-- single JSON result for m7_contract.py --catalog. No executor is shipped here.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
WITH
ns AS (SELECT * FROM pg_namespace WHERE nspname IN ('site_api','site_data','site_private')),
objects AS (SELECT c.*,n.nspname||'.'||c.relname AS name FROM pg_class c JOIN ns n ON c.relnamespace=n.oid
            WHERE c.relkind IN ('r','p','v','m','f','S')),
funcs AS (SELECT p.*,n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')' AS name
          FROM pg_proc p JOIN ns n ON p.pronamespace=n.oid),
internal AS (SELECT * FROM pg_roles WHERE rolname LIKE 'ecv\_s3\_%' ESCAPE '\'),
actors AS (SELECT * FROM pg_roles WHERE oid IN (SELECT oid FROM internal)
           OR rolname IN ('anon','authenticated','authenticator','service_role')),
privs AS (SELECT unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS name),
acl AS (
 SELECT 'table' AS kind,o.name AS object,'' AS col,a.* FROM objects o
 CROSS JOIN LATERAL aclexplode(coalesce(o.relacl,acldefault(CASE WHEN o.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,o.relowner))) a
 UNION ALL SELECT 'column',o.name,c.attname,a.* FROM objects o JOIN pg_attribute c ON c.attrelid=o.oid
 CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE c.attnum>0 AND NOT c.attisdropped
 UNION ALL SELECT 'function',f.name,'',a.* FROM funcs f
 CROSS JOIN LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
 UNION ALL SELECT 'schema',n.nspname,'',a.* FROM ns n
 CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
),
effective AS (
 SELECT 'table' AS kind,o.name AS object,r.rolname AS actor,p.name AS priv,
 has_table_privilege(r.oid,o.oid,p.name||' WITH GRANT OPTION') AS can_grant
 FROM objects o CROSS JOIN actors r CROSS JOIN privs p
 WHERE o.relkind<>'S' AND has_table_privilege(r.oid,o.oid,p.name)
 UNION ALL SELECT 'any_column',o.name,r.rolname,p.name,has_any_column_privilege(r.oid,o.oid,p.name||' WITH GRANT OPTION')
 FROM objects o CROSS JOIN actors r CROSS JOIN privs p
 WHERE o.relkind<>'S' AND p.name IN ('SELECT','INSERT','UPDATE','REFERENCES')
 AND has_any_column_privilege(r.oid,o.oid,p.name)
 UNION ALL SELECT 'function',f.name,r.rolname,'EXECUTE',has_function_privilege(r.oid,f.oid,'EXECUTE WITH GRANT OPTION')
 FROM funcs f CROSS JOIN actors r WHERE has_function_privilege(r.oid,f.oid,'EXECUTE')
 UNION ALL SELECT 'schema',n.nspname,r.rolname,p.name,has_schema_privilege(r.oid,n.oid,p.name||' WITH GRANT OPTION')
 FROM ns n CROSS JOIN actors r CROSS JOIN (VALUES('USAGE'),('CREATE')) p(name)
 WHERE has_schema_privilege(r.oid,n.oid,p.name)
),
defaults AS (
 SELECT d.*,coalesce(n.nspname,'') AS namespace FROM pg_default_acl d
 LEFT JOIN pg_namespace n ON d.defaclnamespace=n.oid
 WHERE d.defaclrole IN (SELECT oid FROM internal)
 OR (d.defaclrole='postgres'::regrole AND d.defaclnamespace IN (SELECT oid FROM ns))
),
creator_global_defaults AS (
 SELECT k.kind,a.* FROM
 (SELECT unnest(ARRAY['r','S','f','T','n'])::"char" AS kind
  UNION SELECT defaclobjtype FROM pg_default_acl WHERE defaclrole='postgres'::regrole AND defaclnamespace=0) k
 LEFT JOIN pg_default_acl d ON d.defaclrole='postgres'::regrole AND d.defaclnamespace=0 AND d.defaclobjtype=k.kind
 -- pg_default_acl uses S for sequences; acldefault uses s (S is foreign server).
 LEFT JOIN LATERAL aclexplode(coalesce(d.defaclacl,acldefault(
   CASE WHEN k.kind='S' THEN 's'::"char" ELSE k.kind END,'postgres'::regrole))) a ON true
),
paths AS (
 SELECT s.rolname AS source,t.rolname AS target,p.name AS privilege FROM pg_roles s CROSS JOIN pg_roles t
 CROSS JOIN (VALUES('MEMBER'),('SET'),('USAGE')) p(name)
 WHERE s.oid<>t.oid AND NOT s.rolsuper
 AND (s.oid IN (SELECT oid FROM internal) OR t.oid IN (SELECT oid FROM internal))
 AND pg_has_role(s.oid,t.oid,p.name)
),
auth_access AS (
 SELECT r.rolname,c.oid::regclass::text AS name,p.name AS priv,
 has_table_privilege(r.oid,c.oid,p.name) AS tbl,
 CASE WHEN p.name IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege(r.oid,c.oid,p.name) ELSE false END AS col
 FROM internal r CROSS JOIN pg_class c CROSS JOIN privs p
 WHERE c.oid IN ('auth.users'::regclass,'auth.sessions'::regclass)
)
SELECT jsonb_build_object(
 'preflight',jsonb_build_object(
   'postgres_session',current_user='postgres' AND session_user='postgres' AND current_database()='postgres'
     AND EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND NOT rolsuper),
   'pg17_11',current_setting('server_version_num')='170011',
   'bootstrap',EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)),
 'closed_constraints',jsonb_build_object(
   'verifier',EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.business_runtime'::regclass AND contype='c'
     AND convalidated AND pg_get_expr(conbin,conrelid)='(NOT proof_verifier_ready)'),
   'paired',EXISTS(SELECT FROM pg_constraint WHERE conrelid='site_private.business_runtime'::regclass AND contype='c'
     AND convalidated AND pg_get_expr(conbin,conrelid)='(enabled = proof_verifier_ready)')),
 'tables',coalesce((SELECT jsonb_object_agg(name,jsonb_build_object('owner',pg_get_userbyid(relowner),
    'rls',relrowsecurity,'force',relforcerowsecurity,'kind',relkind)) FROM objects),'{}'),
 'functions',coalesce((SELECT jsonb_object_agg(name,jsonb_build_object('owner',pg_get_userbyid(proowner),
    'returns',pg_get_function_result(oid),'language',(SELECT lanname FROM pg_language WHERE oid=prolang),
    'kind',prokind,'volatility',provolatile,'parallel',proparallel,'leakproof',proleakproof,'strict',proisstrict,
    'definer',prosecdef,'config',to_jsonb(proconfig),'body_sha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex')))
    FROM funcs),'{}'),
 'policies',coalesce((SELECT jsonb_object_agg(o.name||'.'||p.polname,jsonb_build_object('command',p.polcmd,
    'roles',(SELECT jsonb_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY pg_get_userbyid(r)) FROM unnest(p.polroles) r),
    'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)))
    FROM pg_policy p JOIN objects o ON o.oid=p.polrelid),'{}'),
 'roles',coalesce((SELECT jsonb_object_agg(rolname,jsonb_build_object('canlogin',rolcanlogin,'inherit',rolinherit,
    'super',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,'replication',rolreplication,
    'bypassrls',rolbypassrls,'connlimit',rolconnlimit)) FROM internal),'{}'),
 'schemas',coalesce((SELECT jsonb_object_agg(nspname,pg_get_userbyid(nspowner)) FROM ns),'{}'),
 'acl',coalesce((SELECT jsonb_agg(jsonb_build_array(kind,object,col,CASE WHEN grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee) END,
    privilege_type,pg_get_userbyid(grantor),is_grantable)) FROM acl),'[]'),
 'memberships',coalesce((SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),
    admin_option,inherit_option,set_option)) FROM pg_auth_members WHERE roleid IN (SELECT oid FROM internal) OR member IN (SELECT oid FROM internal)),'[]'),
 'defaults',coalesce((SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(d.defaclrole),d.namespace,d.defaclobjtype,
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,pg_get_userbyid(a.grantor),a.is_grantable))
    FROM defaults d LEFT JOIN LATERAL aclexplode(d.defaclacl) a ON true),'[]'),
 'creator_global_defaults',coalesce((SELECT jsonb_agg(jsonb_build_array('postgres',kind,
    CASE WHEN grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(grantee) END,privilege_type,pg_get_userbyid(grantor),is_grantable))
    FROM creator_global_defaults),'[]'),
 'effective',coalesce((SELECT jsonb_agg(jsonb_build_array(kind,object,actor,priv,can_grant)) FROM effective),'[]'),
 'paths',coalesce((SELECT jsonb_agg(jsonb_build_array(source,target,privilege)) FROM paths),'[]'),
 'auth_access',coalesce((SELECT jsonb_agg(jsonb_build_array(rolname,name,priv,tbl,col)) FROM auth_access WHERE tbl OR col),'[]')
);
ROLLBACK;
