"""Offline mutants of the M7 source and synthetic catalog, not a PG execution."""
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from m7_contract import (HERE, catalog_errors as raw_catalog_errors, expected_catalog, expression,
                         load_contract, read_sources, source_errors, strict_json)


# Synthetic expected platform ACL only; never a captured/reviewed target baseline.
def catalog_errors(observed, contract):
    return raw_catalog_errors(observed, contract, creator_global_defaults=[])


class M7Permissions(unittest.TestCase):
    def setUp(self):
        self.contract = load_contract()
        self.catalog = deepcopy(expected_catalog(self.contract))

    def test_final_source_and_inventory(self):
        self.assertEqual(source_errors(read_sources(), self.contract), [])
        self.assertEqual([len(self.contract[k]) for k in ['tables','functions','policies','roles']], [19,23,37,8])
        self.assertEqual(len(self.contract['memberships']), 10)
        self.assertEqual(len(self.contract['defaults']), 5)

    def test_synthetic_catalog_is_a_positive_control_only(self):
        self.assertEqual(catalog_errors(self.catalog, self.contract), [])

    def test_unreviewed_platform_defaults_block_catalog_acceptance(self):
        self.assertIn('PLATFORM_GLOBAL_DEFAULT_BASELINE_REQUIRED',raw_catalog_errors(self.catalog,self.contract))
        c=deepcopy(self.catalog);c['creator_global_defaults'].append(['postgres','f','PUBLIC','EXECUTE','postgres',False])
        self.assertIn('CATALOG_CREATOR_GLOBAL_DEFAULTS',catalog_errors(c,self.contract))

    def test_every_table_rls_owner_and_inventory_mutant_fails(self):
        for table in self.catalog['tables']:
            for field, value in [('rls',False),('force',False),('owner','postgres'),('kind','v')]:
                with self.subTest(table=table,field=field):
                    c=deepcopy(self.catalog);c['tables'][table][field]=value
                    self.assertIn('CATALOG_TABLES',catalog_errors(c,self.contract))
        for kind in ['tables','functions','policies','roles','schemas']:
            with self.subTest(kind=kind):
                c=deepcopy(self.catalog);c[kind]['unexpected']=None
                self.assertTrue(catalog_errors(c,self.contract))
                c=deepcopy(self.catalog);del c[kind][next(iter(c[kind]))]
                self.assertTrue(catalog_errors(c,self.contract))

    def test_every_function_security_dimension_mutant_fails(self):
        for name in self.catalog['functions']:
            for field,value in [('owner','authenticated'),('returns','text'),('language','c'),
                                ('config',['search_path=public']),('body_sha256','0'*64),
                                ('volatility','i'),('parallel','s'),('leakproof',True),('strict',True),('kind','p')]:
                with self.subTest(name=name,field=field):
                    if value==self.catalog['functions'][name][field]:
                        value='invalid_return_type'
                    c=deepcopy(self.catalog);c['functions'][name][field]=value
                    self.assertIn('CATALOG_FUNCTIONS',catalog_errors(c,self.contract))
            c=deepcopy(self.catalog);c['functions'][name]['definer']=not c['functions'][name]['definer']
            self.assertTrue(catalog_errors(c,self.contract))

    def test_all_policy_predicate_command_role_mutants_fail(self):
        for name,p in self.catalog['policies'].items():
            for field,value in [('roles',['PUBLIC']),('command','*'),('permissive',False),
                                ('using',['name','true']),('check',['name','true'])]:
                if value==p[field]:continue
                with self.subTest(name=name,field=field):
                    c=deepcopy(self.catalog);c['policies'][name][field]=value
                    self.assertIn('CATALOG_POLICIES',catalog_errors(c,self.contract))

    def test_acl_escalations_are_rejected_including_unknown_grantee(self):
        cases=[
            ['table','site_data.sites','','authenticated','UPDATE','ecv_s3_owner',False],
            ['table','site_private.business_proof_keys','','ecv_s3_grant_writer','SELECT','ecv_s3_owner',False],
            ['table','site_private.user_security_state','','ecv_s3_grant_writer','INSERT','ecv_s3_owner',False],
            ['column','site_data.sites','owner_auth_user_id','authenticated','UPDATE','ecv_s3_owner',False],
            ['function','site_private.auth_source_identity()','','PUBLIC','EXECUTE','postgres',False],
            ['function','site_private.register_business_ticket(jsonb)','','service_role','EXECUTE','ecv_s3_grant_writer',False],
            ['schema','site_private','','unexpected_role','USAGE','ecv_s3_owner',False],
            ['schema','site_api','','authenticated','CREATE','ecv_s3_owner',False],
        ]
        for row in cases:
            with self.subTest(row=row):
                c=deepcopy(self.catalog);c['acl'].append(row)
                self.assertIn('CATALOG_ACL',catalog_errors(c,self.contract))
        for index in [5,6]:
            c=deepcopy(self.catalog);c['acl'][0][index]='postgres' if index==5 else True
            self.assertTrue(catalog_errors(c,self.contract))

    def test_defaults_memberships_and_effective_privileges_fail_closed(self):
        for kind,row in [
            ('defaults',['ecv_s3_owner','','f','PUBLIC','EXECUTE','ecv_s3_owner',False]),
            ('memberships',['ecv_s3_command_writer','authenticated','postgres',False,True,True]),
            ('paths',['authenticated','ecv_s3_owner','USAGE']),
            ('paths',['ecv_s3_internal_api_login','pg_read_all_data','USAGE']),
            ('effective',['table','site_data.sites','authenticated','SELECT',False]),
            ('effective',['any_column','site_data.sites','ecv_s3_internal_api_login','UPDATE',False]),
            ('auth_access',['ecv_s3_proof_registrar','auth.users','SELECT',False,True]),
        ]:
            with self.subTest(kind=kind):
                c=deepcopy(self.catalog);c[kind].append(row)
                self.assertIn('CATALOG_'+kind.upper(),catalog_errors(c,self.contract))
        for flag in ['canlogin','inherit','super','createdb','createrole','replication','bypassrls','connlimit']:
            c=deepcopy(self.catalog);c['roles']['ecv_s3_registration_login'][flag]=True if flag!='connlimit' else -1
            self.assertTrue(catalog_errors(c,self.contract))
        for key in ['defaults','memberships','acl','effective']:
            c=deepcopy(self.catalog);c[key].append(deepcopy(c[key][0]))
            self.assertTrue(catalog_errors(c,self.contract))

    def test_missing_unknown_fields_and_wrong_environment_fail(self):
        for key in self.catalog:
            c=deepcopy(self.catalog);del c[key]
            self.assertEqual(catalog_errors(c,self.contract),['CATALOG_SHAPE'])
        for key in ['preflight','closed_constraints']:
            for field in self.catalog[key]:
                c=deepcopy(self.catalog);c[key][field]=False
                self.assertTrue(catalog_errors(c,self.contract))
        c=deepcopy(self.catalog);c['secret']='forbidden'
        self.assertEqual(catalog_errors(c,self.contract),['CATALOG_SHAPE'])

    def test_source_mutants_fail_beyond_file_hash(self):
        cases=[('CREATE ROLE ecv_s3_registration_login NOLOGIN','CREATE ROLE ecv_s3_registration_login LOGIN','SOURCE_ROLES'),
               ("session_user<>'ecv_s3_internal_api_login'","session_user<>'authenticator'",'SOURCE_FUNCTIONS'),
               ("session_user='ecv_s3_registration_login'","session_user='authenticator'",'SOURCE_POLICIES'),
               ('FORCE ROW LEVEL SECURITY','NO FORCE ROW LEVEL SECURITY','SOURCE_TABLES'),
               ('REVOKE SELECT ON site_private.business_proof_keys','GRANT SELECT ON site_private.business_proof_keys','SOURCE_SECURITY_DDL')]
        for before,after,expected in cases:
            with self.subTest(before=before):
                sources=read_sources();found=False
                for name in sources:
                    if before in sources[name]:sources[name]=sources[name].replace(before,after);found=True
                self.assertTrue(found)
                self.assertIn(expected,source_errors(sources,self.contract))
        sources=read_sources();name=next(iter(sources));sources[name]+='\nGRANT ecv_s3_owner TO authenticated;\n'
        self.assertIn('SOURCE_SECURITY_DDL',source_errors(sources,self.contract))

    def test_raw_line_endings_duplicate_json_and_numeric_booleans_rejected(self):
        sources=read_sources();name=next(iter(sources));sources[name]=sources[name].replace('\n','\r\n')
        self.assertIn('MIGRATION_SHA:'+name,source_errors(sources,self.contract))
        from unittest.mock import patch
        from m7_contract import ROOT
        original=Path.read_bytes
        def crlf(path):
            raw=original(path)
            return raw.replace(b'\n',b'\r\n') if path.name==name and path.parent==ROOT/'supabase/migrations' else raw
        with patch.object(Path,'read_bytes',crlf):
            self.assertIn('MIGRATION_SHA:'+name,source_errors(read_sources(),self.contract))
        with self.assertRaises(ValueError):strict_json('{"rls":false,"rls":true}')
        c=deepcopy(self.catalog);c['preflight']['pg17_11']=1
        self.assertTrue(catalog_errors(c,self.contract))

    def test_cli_catalog_protocol_requires_explicit_platform_baseline(self):
        def render(node):
            if node is None:return None
            if node[0] in ['name','literal']:return node[1]
            if node[0]=='call':return node[1]+'('+','.join(render(x) for x in node[2])+')'
            if node[0]=='not':return '(NOT '+render(node[1])+')'
            return '('+render(node[1])+' '+node[0]+' '+render(node[2])+')'
        catalog=deepcopy(self.catalog)
        for p in catalog['policies'].values():
            p['using'],p['check']=render(p['using']),render(p['check'])
        with tempfile.TemporaryDirectory(prefix='s34-offline-catalog-') as directory:
            observed=Path(directory)/'synthetic.json';observed.write_text(json.dumps(catalog))
            command=[sys.executable,'-B',str(HERE/'m7_contract.py'),'--catalog',str(observed)]
            result=subprocess.run(command,text=True,capture_output=True,timeout=10)
            self.assertEqual(result.returncode,1,result.stderr)
            self.assertIn('PLATFORM_GLOBAL_DEFAULT_BASELINE_REQUIRED',result.stdout)
            baseline=Path(directory)/'synthetic-platform.json'
            baseline.write_text(json.dumps({'contract_baseline':self.contract['baseline'],'target_id':'OFFLINE_FIXTURE',
                'reviewed':True,'acl':[]}))
            result=subprocess.run(command+['--creator-defaults',str(baseline),'--target-id','OFFLINE_FIXTURE'],text=True,capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['live_jwt_auth_tls'],'NOT RUN')
            result=subprocess.run(command+['--creator-defaults',str(baseline),'--target-id','OTHER'],text=True,capture_output=True,timeout=10)
            self.assertNotEqual(result.returncode,0)

    def test_policy_ast_preserves_boolean_grouping_and_literal_case(self):
        self.assertEqual(expression("(SESSION_USER = 'ecv_s3_registration_login'::name) AND (current_setting('role'::text) = 'none'::text)"),
                         expression("session_user='ecv_s3_registration_login' AND pg_catalog.current_setting('role')='none'"))
        self.assertNotEqual(expression('(a OR b) AND c'),expression('a OR (b AND c)'))
        self.assertNotEqual(expression("x='Alice'"),expression("x='alice'"))
        for bad in ["a; GRANT",'a::integer',"x='a'::uuid",'a IN (b)', 'a (', '']:
            with self.subTest(bad=bad),self.assertRaises((ValueError,IndexError)):
                expression(bad)

    def test_collector_has_no_business_or_mutating_statements(self):
        from static_check import top_level_statements
        source=(HERE/'m7-catalog-observe.sql').read_text()
        source=source.replace('\\set ON_ERROR_STOP on','')
        statements=top_level_statements(source)
        self.assertEqual([s.split()[0] for s in statements],['BEGIN','SET','SET','WITH','ROLLBACK'])
        self.assertIn('BEGIN READ ONLY',statements[0])
        self.assertNotIn('site_api.',source)
        self.assertNotIn('FROM auth.users',source)
        self.assertNotIn('FROM auth.sessions',source)
        self.assertIn("CASE WHEN k.kind='S' THEN 's'::\"char\" ELSE k.kind END",source)
        self.assertIn('FROM defaults d LEFT JOIN LATERAL aclexplode',source)


if __name__=='__main__':
    unittest.main(verbosity=2)
