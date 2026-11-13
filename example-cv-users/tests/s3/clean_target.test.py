"""Sealed R3 sidecar positive control and privilege-escalation mutants."""
from copy import deepcopy
import unittest
from clean_target import (TARGET, LOGIN, REBIND, preparation_errors, sealed_profile,
                          target_errors, target_catalog, PROFILE)
from m7_contract import strict_json


class CleanTarget(unittest.TestCase):
    def setUp(self):
        self.profile = strict_json(PROFILE.read_text())
        self.envelope = {'identity': deepcopy(TARGET), 'catalog': target_catalog()}

    def test_actual_cli_stdin_preserves_exact_contract_and_rejects_escalation(self):
        import subprocess, sys, json
        from pathlib import Path
        cli = str(Path(__file__).with_name('clean_target.py'))
        def invoke(envelope):
            return subprocess.run([sys.executable, '-B', cli, '--observation-stdin'], input=json.dumps(envelope), text=True, capture_output=True)
        def raw_expression(ast):
            if ast is None:
                return None
            if ast[0] in ['name', 'literal']:
                return ast[1]
            if ast[0] == 'call':
                return ast[1] + '(' + ','.join(raw_expression(x) for x in ast[2]) + ')'
            return '(' + raw_expression(ast[1]) + ' ' + ast[0] + ' ' + raw_expression(ast[2]) + ')'
        raw = deepcopy(self.envelope)
        for policy in raw['catalog']['policies'].values():
            policy['using'], policy['check'] = raw_expression(policy['using']), raw_expression(policy['check'])
        good = invoke(raw)
        self.assertEqual(good.returncode, 0, good.stderr)
        self.assertEqual(json.loads(good.stdout)['errors'], [])
        bad = deepcopy(raw)
        bad['catalog']['acl'].append(['table', 'site_data.sites', '', 'PUBLIC', 'SELECT', 'postgres', False])
        result = invoke(bad)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CATALOG_ACL', json.loads(result.stdout)['errors'])

    def test_actual_cli_stdin_rejects_duplicate_unknown_and_oversize_inputs(self):
        import subprocess, sys
        from pathlib import Path
        cli = str(Path(__file__).with_name('clean_target.py'))
        for raw in ['{"identity":{},"identity":{},"catalog":{}}', '{}', 'x' * (4 * 1024 * 1024 + 1)]:
            result = subprocess.run([sys.executable, '-B', cli, '--observation-stdin'], input=raw, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_exact_profile_and_synthetic_catalog(self):
        self.assertEqual(preparation_errors(self.profile), [])
        self.assertEqual(self.profile, sealed_profile())
        self.assertEqual(target_errors(self.envelope, self.profile), [])
        self.assertEqual(len(self.profile['postgres_global_defaults']), 17)

    def test_only_two_functions_and_two_login_flags_change(self):
        from m7_contract import expected_catalog, load_contract
        before = expected_catalog(load_contract())
        after = self.envelope['catalog']
        for kind in before:
            if kind not in ['functions', 'roles', 'creator_global_defaults']:
                self.assertEqual(before[kind], after[kind], kind)
        for name in before['functions']:
            changed = [k for k in before['functions'][name] if before['functions'][name][k] != after['functions'][name][k]]
            self.assertEqual(changed, ['body_sha256'] if name in REBIND else [])
        for name in before['roles']:
            changed = [k for k in before['roles'][name] if before['roles'][name][k] != after['roles'][name][k]]
            self.assertEqual(changed, ['canlogin'] if name in LOGIN else [])

    def test_profile_cannot_expand_any_baseline(self):
        for field, value in [('permission_overrides', ['PUBLIC EXECUTE']),
                             ('postgres_global_defaults', []), ('login_only', LOGIN + ['authenticated']),
                             ('function_body_delta', {}), ('target', {}), ('version', True)]:
            p = deepcopy(self.profile); p[field] = value
            self.assertIn('TARGET_PROFILE_NOT_SEALED', target_errors(self.envelope, p))

    def test_catalog_escalations_fail(self):
        for key, row in [
            ('acl', ['function','site_private.auth_source_identity()','','PUBLIC','EXECUTE','postgres',False]),
            ('acl', ['table','site_data.sites','','authenticated','SELECT','ecv_s3_owner',False]),
            ('memberships', ['ecv_s3_owner','authenticated','postgres',False,True,True]),
            ('paths', ['ecv_s3_internal_api_login','pg_read_all_data','USAGE']),
            ('defaults', ['ecv_s3_owner','','f','PUBLIC','EXECUTE','ecv_s3_owner',False]),
            ('creator_global_defaults', ['postgres','r','PUBLIC','SELECT','postgres',False]),
            ('auth_access', ['ecv_s3_registration_login','auth.users','UPDATE',False,True]),
            ('effective', ['table','site_data.sites','authenticated','SELECT',False])]:
            e = deepcopy(self.envelope); e['catalog'][key].append(row)
            self.assertIn('CATALOG_' + key.upper(), target_errors(e, self.profile))
        for role in self.envelope['catalog']['roles']:
            if role not in LOGIN:
                e=deepcopy(self.envelope);e['catalog']['roles'][role]['canlogin']=True
                self.assertIn('CATALOG_ROLES',target_errors(e,self.profile))
            e=deepcopy(self.envelope);e['catalog']['roles'][role]['connlimit']+=1
            self.assertIn('CATALOG_ROLES',target_errors(e,self.profile))
            for field in ['inherit', 'super', 'createdb', 'createrole', 'replication', 'bypassrls']:
                e=deepcopy(self.envelope);e['catalog']['roles'][role][field]=True
                self.assertIn('CATALOG_ROLES', target_errors(e, self.profile))
        for name in self.envelope['catalog']['functions']:
            e=deepcopy(self.envelope);e['catalog']['functions'][name]['body_sha256']='0'*64
            self.assertIn('CATALOG_FUNCTIONS',target_errors(e,self.profile))
        for name in self.envelope['catalog']['tables']:
            for field in ['rls','force']:
                e=deepcopy(self.envelope);e['catalog']['tables'][name][field]=False
                self.assertIn('CATALOG_TABLES',target_errors(e,self.profile))

    def test_wrong_physical_target_unknown_fields_duplicates_rejected(self):
        for key in TARGET:
            e=deepcopy(self.envelope);e['identity'][key]='different'
            self.assertIn('TARGET_IDENTITY',target_errors(e,self.profile))
        e=deepcopy(self.envelope);e['extra']=True
        self.assertIn('TARGET_ENVELOPE_SHAPE',target_errors(e,self.profile))
        e=deepcopy(self.envelope);e['catalog']['acl'].append(e['catalog']['acl'][0])
        self.assertIn('CATALOG_ACL',target_errors(e,self.profile))


if __name__ == '__main__':
    unittest.main(verbosity=2)
