"""R1/R2/R4 source regressions. No DB, keys, subprocess or network.

These prove rejection by the candidate guard, NOT JWT or SQL execution.
"""
from pathlib import Path
import copy
import json
import re
import unittest
from business_static_check import SQL3, SQL4, errors
from business_acl_check import CONTRACT, acl_errors, embedded_contract_errors

class ExactAclRegression(unittest.TestCase):
    def inject(self, statement, which=3):
        a,b=SQL3,SQL4
        if which==3: a=a.replace('CREATE FUNCTION site_private.auth_source_identity()',statement+'\nCREATE FUNCTION site_private.auth_source_identity()',1)
        else: b=b.replace('CREATE FUNCTION site_private.create_payload(',statement+'\nCREATE FUNCTION site_private.create_payload(',1)
        self.assertNotEqual((a,b),(SQL3,SQL4))
        self.assertTrue(errors(a,b))
        self.assertTrue(acl_errors(a,b))

    def mutant(self,before,after,which=3):
        source=SQL3 if which==3 else SQL4
        self.assertIn(before,source)
        changed=source.replace(before,after,1)
        self.assertTrue(errors(changed,SQL4) if which==3 else errors(SQL3,changed))

    def test_original_exact_contract(self): self.assertEqual(errors(SQL3,SQL4),[])
    def test_command_delete_is_rejected(self): self.inject('GRANT DELETE ON site_data.sites TO ecv_s3_command_writer;',4)
    def test_full_auth_select_is_rejected(self): self.inject('GRANT SELECT ON auth.users TO ecv_s3_authz_reader;')
    def test_public_function_execute_is_rejected(self): self.inject('GRANT EXECUTE ON FUNCTION site_private.auth_source_identity() TO PUBLIC;')
    def test_direct_and_transitive_memberships_are_rejected(self):
        for sql in ['GRANT ecv_s3_command_writer TO authenticated;',
                    'GRANT ecv_s3_command_writer TO ecv_s3_authz_reader;',
                    'GRANT ecv_s3_authz_reader TO authenticator;',
                    'GRANT pg_read_all_data TO ecv_s3_authz_reader;',
                    'GRANT ecv_s3_command_writer TO ecv_s3_authz_reader; GRANT ecv_s3_authz_reader TO authenticated;',
                    'GRANT ecv_s3_command_writer TO postgres WITH SET TRUE, INHERIT TRUE GRANTED BY postgres;']:
            with self.subTest(sql=sql):self.inject(sql)
    def test_auth_return_expansion_is_rejected(self):
        self.mutant('RETURN QUERY SELECT u,s;','RETURN QUERY SELECT u,s,row_to_json(a) FROM auth.users a;')
        self.mutant('RETURNS TABLE(uid uuid, sid uuid)','RETURNS TABLE(uid uuid, sid uuid, email text)')
    def test_wrong_owner_and_security_are_rejected(self):
        self.mutant('ALTER FUNCTION site_private.request_uid() OWNER TO ecv_s3_authz_reader;', 'ALTER FUNCTION site_private.request_uid() OWNER TO postgres;')
        self.mutant('LANGUAGE plpgsql SECURITY DEFINER', 'LANGUAGE plpgsql SECURITY INVOKER')
    def test_column_scope_and_grant_options_are_rejected(self):
        for sql in ['GRANT SELECT(email) ON auth.users TO ecv_s3_authz_reader;',
                    'GRANT SELECT ON site_data.sites TO ecv_s3_command_writer WITH GRANT OPTION;',
                    'GRANT UPDATE(owner_auth_user_id) ON site_data.sites TO ecv_s3_command_writer;']:
            with self.subTest(sql=sql):self.inject(sql)
    def test_schema_create_and_auth_usage_are_rejected(self):
        for sql in ['GRANT CREATE ON SCHEMA site_private TO ecv_s3_command_writer;',
                    'GRANT USAGE ON SCHEMA auth TO ecv_s3_authz_reader;']:
            with self.subTest(sql=sql):self.inject(sql)
    def test_auth_has_no_caller_identity_parameters(self):
        self.mutant('CREATE FUNCTION site_private.auth_source_identity()', 'CREATE FUNCTION site_private.auth_source_identity(uid uuid,sid uuid)')
    def test_forged_transport_or_session_filters_rejected(self):
        for before,after in [("session_user<>'authenticator'",'false'),
                             ("pg_catalog.current_setting('role',true) IS DISTINCT FROM 'authenticated'",'false'),
                             ('a.id=s AND a.user_id=u','a.id=s'),
                             ('a.id=u AND a.email_confirmed_at','a.email_confirmed_at'),
                             ("value->>'method' IN ('otp','recovery')",'false'),
                             ('a.not_after>pg_catalog.clock_timestamp()','true')]:
            with self.subTest(before=before):self.mutant(before,after)
    def test_auth_bridge_exact_source_and_output_scope(self):
        body=re.search(r'CREATE FUNCTION site_private.auth_source_identity\(\).*?AS \$fn\$(.*?)\$fn\$;',SQL3,re.S)[1]
        self.assertNotRegex(body,r'\b(?:INSERT|UPDATE|DELETE|FOR UPDATE|set_config)\b')
        self.assertNotIn('user_metadata',body)
        self.assertNotIn('SELECT *',body)
        self.assertIn('RETURN QUERY SELECT u,s;',body)
        self.assertEqual(CONTRACT['auth_bridge']['execute'],['postgres','ecv_s3_authz_reader'])
        self.assertTrue(all(not c[0].startswith('auth.') for c in CONTRACT['columns']))
        for source in [SQL3,SQL4]:self.assertNotRegex(source,r'auth\.(?:uid|jwt)\(')
    def test_verifier_gate_cannot_be_silently_removed(self):
        self.mutant('CHECK (NOT proof_verifier_ready)','CHECK (true)')
        self.mutant('WHERE singleton AND enabled AND proof_verifier_ready','WHERE singleton AND enabled')
    def test_embedded_catalog_contract_matches(self):
        s=(Path(__file__).parent/'business-permissions.test.sql').read_text()
        self.assertEqual(embedded_contract_errors(s),[])
        for before,after in [('"body_sha256"','"changed_body_hash"'),('"DELETE"','"MAINTAIN"')]:
            self.assertTrue(embedded_contract_errors(s.replace(before,after)))
    def test_runtime_guards_cover_all_privilege_dimensions(self):
        s=(Path(__file__).parent/'business-permissions.test.sql').read_text()
        for marker in ['B_ACL_TABLE_EXACT','B_ACL_COLUMN_EXACT','B_ACL_EFFECTIVE_TABLE',
                       'B_ACL_EFFECTIVE_COLUMN','B_AUTH_DIRECT_TABLE','B_AUTH_DIRECT_COLUMN',
                       'B_ACL_SCHEMA_EXACT','B_DEFAULT_ACL_UNEXPECTED_SCOPE','B_ORDINARY_SCHEMA_CREATE','B_ACL_SCHEMA_USAGE','B_ACL_SCHEMA_CREATE','B_ACL_SCHEMA_GRANT_OPTION',
                       'B_FUNCTION_METADATA_OR_RETURN_SHAPE','B_FUNCTION_EXECUTE_EXACT',
                       'B_FUNCTION_EFFECTIVE_EXECUTE','B_DEFAULT_FUNCTION_ACL']:
            self.assertIn(marker,s)
        self.assertEqual(len(CONTRACT['tables']),17)
        self.assertEqual(len(CONTRACT['functions']),19)
        self.assertEqual(len(CONTRACT['internal_roles']),5)

if __name__=='__main__':unittest.main(verbosity=2)
