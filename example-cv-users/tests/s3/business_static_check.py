"""B candidate source guards, not a PostgreSQL parser or runtime test.

Run with python3 -B tests/s3/business_static_check.py. No SQL/network/subprocess.
The original 21 checks continue to cover immutable M1/M2 separately.
"""
from pathlib import Path
import hashlib
import re
import unittest
import ast
from static_check import sql_text, strip_comments, top_level_statements
from business_acl_check import acl_errors, embedded_contract_errors
from plpgsql_syntax_check import errors as delimiter_errors

ROOT = Path(__file__).resolve().parents[2]
M1 = '20261107180504_s3_security_foundation.sql'
M2 = '20261107180505_s3_site_foundation.sql'
M3 = '20261109104800_s3_business_grants.sql'
M4 = '20261109104802_s3_create_site_commands.sql'
SQL3 = (ROOT / 'supabase/migrations' / M3).read_text()
SQL4 = (ROOT / 'supabase/migrations' / M4).read_text()
ROLES = ['ecv_s3_authz_reader','ecv_s3_grant_writer','ecv_s3_command_writer']
OWNERS = {
 'site_private.auth_source_identity':'postgres',
 'site_private.request_uid':'ecv_s3_authz_reader',
 'site_private.business_identity':'ecv_s3_authz_reader',
 'site_private.business_qualified':'ecv_s3_authz_reader',
 'site_private.business_site_owned':'ecv_s3_authz_reader',
 'site_private.business_site_complete':'ecv_s3_authz_reader',
 'site_private.lock_business_qualification':'ecv_s3_grant_writer',
 'site_private.verify_business_proof':'ecv_s3_grant_writer',
 'site_private.guard_business_grant':'ecv_s3_owner',
 'site_api.apply_business_grant':'ecv_s3_grant_writer',
 'site_private.create_payload':'ecv_s3_command_writer',
 'site_api.create_site':'ecv_s3_command_writer',
 'site_api.read_create_operation':'ecv_s3_command_writer',
 'site_api.get_my_site':'ecv_s3_command_writer',
 'site_api.read_introduction':'ecv_s3_command_writer'}


def errors(m3, m4):
    result = []
    def clean(source):
        # Inspect SQL/PLpgSQL body comments as well as outer SQL comments.
        source = re.sub(r'(\$[A-Za-z_]*\$)(.*?)\1',
                        lambda m: m[1] + strip_comments(m[2]) + m[1], source, flags=re.S)
        return strip_comments(source)
    sources = [clean(x) for x in [m3, m4]]
    joined = '\n'.join(sources)
    for name, source in zip(['M3','M4'], sources):
        statements = [' '.join(s.split()) for s in top_level_statements(source)]
        if statements[0] != 'BEGIN' or statements[-1] != 'COMMIT':
            result.append('transaction')
        if '@' in source or re.search(r'\b(?:BYPASSRLS|SUPERUSER)\b', source):
            result.append('privilege escalation')
        if re.search(r'(?:ALTER|DROP)\s+(?:ROLE\s+(?:postgres|supabase_admin)|TABLE\s+auth\.)', source, re.I):
            result.append('platform mutation')
        if re.search(r'(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+auth\.', source, re.I):
            result.append('Auth row write')
        if re.search(r'\bEXECUTE\s+[\'\"]', source):
            result.append('dynamic SQL')
        guards = re.findall(r'DO \$role_boundary\$(.*?)\$role_boundary\$', source, re.S)
        for guard in guards:
            count = 2 if name == 'M3' and guard == guards[0] else 5
            for token in ['grantor = bootstrap AND admin_option AND NOT set_option AND NOT inherit_option',
                          'bootstrap constant oid := 10;', "rolname = 'supabase_admin' AND rolsuper",
                          'OR member = ANY(internal_roles)', "pg_has_role(r.oid, i.roleid, 'MEMBER')",
                          "pg_has_role(deployer, i.roleid, 'SET')", "pg_has_role(deployer, i.roleid, 'USAGE')"]:
                if token not in guard:
                    result.append('role boundary')
            if guard.count(f'<> {count}') != 3:
                result.append('role inventory')
        if len(guards) != 2:
            result.append('role guard count')
        if 'S3B unexpected creator/default function ACL' not in source:
            result.append('creator ACL assertion')
        if not statements[-2].startswith('DO $role_boundary$') or not statements[-3].startswith('REVOKE ecv_s3_owner'):
            result.append('temporary membership')
        granted = 'ecv_s3_owner, ecv_s3_authz_reader, ecv_s3_grant_writer, ecv_s3_command_writer' if name == 'M3' else 'ecv_s3_owner, ecv_s3_command_writer'
        membership = [s for s in statements if re.match(r'^(GRANT|REVOKE)\b', s) and ' ON ' not in s]
        expected = [f'GRANT {granted} TO postgres WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres',
                    f'REVOKE {granted} FROM postgres GRANTED BY postgres RESTRICT']
        if membership != expected:
            result.append('temporary membership')
        for statement in statements:
            if re.match(r'^GRANT .*\bTO (?:PUBLIC|anon|authenticated|service_role|authenticator)\b', statement):
                if not (statement.startswith('GRANT EXECUTE ON FUNCTION site_api.') and statement.endswith('TO authenticated')) and statement != 'GRANT USAGE ON SCHEMA site_api TO authenticated':
                    result.append('ordinary grant')
    for role in ROLES:
        if f'CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;' not in sources[0]:
            result.append('role attributes')
        if f'SET LOCAL ROLE {role};\nALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;\nRESET ROLE;' not in sources[0]:
            result.append('default ACL')
    functions = re.findall(r'CREATE FUNCTION ([\w.]+)\((.*?)\) RETURNS .*?\nLANGUAGE \w+ SECURITY (DEFINER|INVOKER) SET search_path=\'\' AS \$fn\$(.*?)\$fn\$;', joined, re.S)
    if {f[0] for f in functions} != set(OWNERS) or len(functions) != len(OWNERS):
        result.append('function inventory')
    for name, args, security, body in functions:
        signature = name + '(' + ','.join(x.strip().split()[-1] for x in args.split(',') if x.strip()) + ')'
        owner = OWNERS[name]
        if f'ALTER FUNCTION {signature} OWNER TO {owner};' not in joined:
            result.append('function owner')
        if f'REVOKE ALL ON FUNCTION {signature} FROM PUBLIC,anon,authenticated,authenticator,service_role;' not in joined:
            result.append('function execute')
        expected = 'INVOKER' if name in ['site_private.verify_business_proof','site_private.guard_business_grant','site_private.create_payload'] else 'DEFINER'
        if security != expected:
            result.append('definer boundary')
        if name.startswith('site_api.') and re.search(r'\b(actor|owner|caller|uid|sid)\b', args):
            result.append('caller argument')
    active = ' '.join(sql_text(m3, mask_literals=True).split()).upper()
    for table in ['BUSINESS_RUNTIME','BUSINESS_PROOF_KEYS']:
        for suffix in ['OWNER TO ECV_S3_OWNER','ENABLE ROW LEVEL SECURITY','FORCE ROW LEVEL SECURITY']:
            if f'ALTER TABLE SITE_PRIVATE.{table} {suffix};' not in active:
                result.append('new table boundary')
    if "VALUES(true,'ecv-s33a-20261109-7dd22a81','http://127.0.0.1:56321/auth/v1',false)" not in sources[0]:
        result.append('disabled runtime')
    if re.search(r'INSERT INTO site_private.business_proof_keys', sources[0], re.I):
        result.append('key provisioning')
    if 'S3B narrow Auth bridge capability NOT VERIFIED' not in sources[0] or 'USAGE WITH GRANT OPTION' in sources[0] or 'GRANT SELECT(id,email_confirmed_at' in sources[0]:
        result.append('Auth capability')
    for token in ["session_user<>'authenticator'", "current_setting('role',true) IS DISTINCT FROM 'authenticated'",
                  'proof_verifier_ready boolean NOT NULL DEFAULT false CHECK (NOT proof_verifier_ready)',
                  'WHERE singleton AND enabled AND proof_verifier_ready',
                  "p->>'uid' IS DISTINCT FROM caller_uid::text", "p->>'session_id' IS DISTINCT FROM caller_sid::text",
                  "(p->>'epoch')::bigint<>security.security_epoch", 'prior.proof_fingerprint IS DISTINCT FROM fingerprint',
                  'different | (get_byte(expected,i) # get_byte(provided,i))', "p->>'purpose' IS DISTINCT FROM 'business'",
                  "value->>'method' IN ('otp','recovery')",
                  "OLD.revoked_at IS NOT NULL", "OLD.expires_at<=pg_catalog.clock_timestamp()", "security.hold_reason<>'none'"]:
        if token not in sources[0]:
            result.append('proof/lifecycle')
    for token in ['FOR UPDATE','r.actor_auth_user_id=who.uid', "r.operation='create_site'", 'prior.payload_digest IS DISTINCT FROM digest',
                  "'unpublished'", 'site_data.draft_revisions', 'site_private.site_audit_events',
                  'SET CONSTRAINTS site_data.sites_integrity,site_data.members_integrity,site_data.publications_integrity IMMEDIATE']:
        if token not in joined:
            result.append('atomic create')
    for token in ["jsonb_typeof(input->'default_locale') IS DISTINCT FROM 'string'",
                  "coalesce(input->>'default_locale','') NOT IN ('zh','en')"]:
        if token not in sources[1]:
            result.append('null input')
    if sources[1].index('RETURN prior.result') > sources[1].index('IF EXISTS(SELECT FROM site_data.sites'):
        result.append('idempotency order')
    if re.search(r'UPDATE\s+site_private\.operation_requests|DELETE\s+FROM\s+site_', sources[1], re.I):
        result.append('immutable record')
    result.extend(acl_errors(m3, m4))
    result.extend(delimiter_errors(m3))
    result.extend(delimiter_errors(m4))
    return result


class BusinessSource(unittest.TestCase):
    def test_inventory_and_immutable_foundation(self):
        self.assertEqual(sorted(p.name for p in (ROOT/'supabase/migrations').glob('*.sql')), [M1,M2,M3,M4,'20261110183047_s3_registered_business_proofs.sql',
                         '20261111045534_s3_closed_service_roles.sql','20261111045535_s3_private_service_identity.sql'])
        for n, digest in [(M1,'da5815f259e5fd9d23f811f12eb6d313e7b9011a0f6afb5b51b25436b9888366'),
                          (M2,'0a2e571d435f8301297296e7c07d7db65aef450382e0a2a56e755bf8c0e32ca7'),
                          (M3,'c66ec38790f64d0164bd2e60cacae7c7ca4705bfd49089533dd7c7384ce8af08'),
                          (M4,'90750c451b2051bd457c29d950e774f9fa324fc385c4d73368a1701e56231704'),
                          ('20261110183047_s3_registered_business_proofs.sql','c7c581c7105e8644f1cbf3b8afb4b42b40a89ec3329a47e39ae1566f7833b6e5'),
                          ('20261111045534_s3_closed_service_roles.sql','8301eea2e5f3bcf4aefa7d1cfbf00fd64a86dd74284ac81f8bee235fba64ce6b')]:
            self.assertEqual(hashlib.sha256((ROOT/'supabase/migrations'/n).read_bytes()).hexdigest(),digest)

    def test_candidate_guards(self):
        self.assertEqual(errors(SQL3,SQL4),[])

    def test_mutants_reject_boundary_regressions(self):
        mutations = [
            ('AND NOT set_option','AND set_option'),('grantor = bootstrap','grantor = deployer'),
            ('OR member = ANY(internal_roles)',''),('NOBYPASSRLS','BYPASSRLS'),
            ('ecv_s3_authz_reader NOLOGIN','ecv_s3_authz_reader LOGIN'),
            ('FORCE ROW LEVEL SECURITY','NO FORCE ROW LEVEL SECURITY'),
            ("p->>'uid' IS DISTINCT FROM caller_uid::text",'false'),
            ("p->>'session_id' IS DISTINCT FROM caller_sid::text",'false'),
            ('prior.proof_fingerprint IS DISTINCT FROM fingerprint','false'),
            ("security.hold_reason<>'none'",'false'),
            ('OLD.revoked_at IS NOT NULL','false'),
            ("jsonb_typeof(input->'default_locale') IS DISTINCT FROM 'string'",'false'),
            ("coalesce(input->>'default_locale','') NOT IN ('zh','en')", "input->>'default_locale' NOT IN ('zh','en')"),
            ('SET search_path=\'\'','SET search_path=public'),
            ('OWNER TO ecv_s3_command_writer','OWNER TO postgres'),
            ('S3B narrow Auth bridge capability NOT VERIFIED',''),
            ('S3B unexpected creator/default function ACL',''),
            ("'http://127.0.0.1:56321/auth/v1',false)","'http://127.0.0.1:56321/auth/v1',true)"),
            ('FROM postgres GRANTED BY postgres RESTRICT','FROM postgres GRANTED BY supabase_admin RESTRICT')]
        for before, after in mutations:
            with self.subTest(before=before):
                a,b=SQL3.replace(before,after),SQL4.replace(before,after)
                self.assertNotEqual((a,b),(SQL3,SQL4))
                self.assertTrue(errors(a,b))

    def test_body_comment_decoys_do_not_replace_digest_check(self):
        source=SQL4.replace('IF prior.payload_digest IS DISTINCT FROM digest THEN',
                            'IF false THEN -- prior.payload_digest IS DISTINCT FROM digest')
        self.assertTrue(errors(SQL3,source))

    def test_cross_language_proof_field_order(self):
        js=(ROOT/'lib/business/protocol.mjs').read_text()
        left=ast.literal_eval('['+re.search(r'proofFields = \[(.*?)\]',js)[1]+']')
        right=ast.literal_eval('['+re.search(r'fields constant text\[\]:=ARRAY\[(.*?)\]',SQL3)[1]+']')
        self.assertEqual(left,right)

    def test_runtime_permission_suite_is_readonly_and_explicitly_unrun(self):
        source=(ROOT/'tests/s3/business-permissions.test.sql').read_text()
        self.assertEqual(embedded_contract_errors(source), [])
        self.assertIn('NOT RUN',source)
        self.assertIn('\\set ON_ERROR_STOP on',source)
        self.assertIn('BEGIN READ ONLY;',source)
        self.assertTrue(source.strip().endswith('ROLLBACK;'))
        def active(text):
            inner=re.sub(r'\$test\$(.*?)\$test\$', lambda m: sql_text(m[1], mask_literals=True),text,flags=re.S)
            return sql_text(inner, mask_literals=True)
        pattern=r'\b(?:GRANT|REVOKE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b'
        self.assertNotRegex(active(source),pattern)
        self.assertRegex(active(source.replace("IF current_user<>","UPDATE site_data.sites SET status='deleted';\n IF current_user<>")),pattern)

    def test_ordinary_table_grant_and_key_insert_rejected(self):
        for addition in ['GRANT SELECT ON site_private.business_proof_keys TO authenticated;',
                         'GRANT ecv_s3_command_writer TO anon;',
                         "INSERT INTO site_private.business_proof_keys VALUES ('fictional');"]:
            self.assertTrue(errors(SQL3.replace('COMMIT;',addition+'\nCOMMIT;'),SQL4))

    def test_lexical_delimiters_and_no_unexpanded_markers(self):
        for source in [SQL3,SQL4]:
            sql_text(source, mask_literals=True)
            self.assertNotIn('@',source)
            self.assertNotRegex(source,r'\bEND\s+\$[a-z_]+\$')


if __name__=='__main__':
    unittest.main(verbosity=2)
