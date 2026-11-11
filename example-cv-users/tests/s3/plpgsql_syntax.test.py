"""Offline delimiter/fingerprint regressions; zero PostgreSQL compilation.

The old 42601 is established by the preserved PG17 failure and upstream
grammar, not by this Python guard. Boolean/NULL examples below are models.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import unittest
from plpgsql_syntax_check import audit, condition_findings, errors
from business_static_check import SQL3, SQL4, errors as source_errors
from business_acl_check import CONTRACT, embedded_contract_errors

HERE = Path(__file__).resolve().parent
BEFORE = HERE / 'fixtures'
OLD3 = (BEFORE / 'historical-20261109104800_s3_business_grants.sql').read_text()
OLD4 = (BEFORE / 'historical-20261109104802_s3_create_site_commands.sql').read_text()
OLD_A = "CASE WHEN k IN ('version','epoch','issued_at','expires_at') THEN 'number' ELSE 'string' END"
OLD_B = "CASE WHEN p->>'action'='issue' THEN 'password-login' ELSE 'account-session' END"
SIGNATURE = 'site_private.verify_business_proof(jsonb,uuid,uuid)'


class DelimiterRegression(unittest.TestCase):
    def issues(self, value):
        return [code for _, code in condition_findings(value)[0]]

    def test_original_failed_m3_is_preserved(self):
        self.assertEqual(hashlib.sha256(OLD3.encode()).hexdigest(),
                         '820fa9ac385dc88273c030bf61a04ce139e08e1e4f3fd91b573642d4d5d0b399')

    def test_original_has_exactly_two_delimiter_findings(self):
        found = errors(OLD3)
        self.assertEqual(len(found), 2)
        self.assertTrue(all('IF_CASE_NEEDS_PARENTHESES' in x for x in found))
        self.assertTrue(found[0].endswith('line=220'))
        self.assertTrue(found[1].endswith('line=227'))

    def test_fixed_source_guard_passes(self):
        self.assertEqual(errors(SQL3) + errors(SQL4), [])
        self.assertEqual(source_errors(SQL3, SQL4), [])

    def test_exactly_two_parenthesis_pairs_changed(self):
        expected = OLD3.replace(OLD_A, '(' + OLD_A + ')').replace(OLD_B, '(' + OLD_B + ')')
        self.assertEqual(SQL3, expected)
        self.assertEqual(sum(a != b for a, b in zip(OLD3.splitlines(), SQL3.splitlines())), 2)

    def test_either_unfixed_case_is_rejected(self):
        for text in (OLD_A, OLD_B):
            with self.subTest(case=text):
                mutant = SQL3.replace('(' + text + ')', text)
                self.assertEqual(len(errors(mutant)), 1)
                self.assertTrue(source_errors(mutant, SQL4))

    def test_comments_cannot_hide_real_case(self):
        self.assertIn('IF_CASE_NEEDS_PARENTHESES', self.issues(
            "IF x IS DISTINCT FROM /* THEN /* nested */ */ CASE WHEN y THEN 1 ELSE 0 END THEN NULL; END IF;"))

    def test_comment_and_string_decoys_are_masked(self):
        self.assertEqual(self.issues("-- IF CASE WHEN THEN\nIF x='IF CASE THEN' THEN NULL; END IF;"), [])

    def test_escaped_and_dollar_literals_are_masked(self):
        self.assertEqual(self.issues(r"IF x=E'can\'t THEN CASE IF' OR x=$tag$IF CASE THEN$tag$ THEN NULL; END IF;"), [])

    def test_quoted_identifiers_are_masked(self):
        self.assertEqual(self.issues('IF "THEN" = "CASE" THEN NULL; END IF;'), [])

    def test_elsif_condition_also_requires_parentheses(self):
        s = 'IF a THEN NULL; ELSIF x=CASE WHEN y THEN 1 ELSE 0 END THEN NULL; END IF;'
        self.assertIn('IF_CASE_NEEDS_PARENTHESES', self.issues(s))
        self.assertEqual(self.issues(s.replace('=CASE', '=(CASE').replace('END THEN', 'END) THEN')), [])

    def test_nested_parenthesized_cases_are_accepted(self):
        self.assertEqual(self.issues('IF x=(CASE WHEN y THEN CASE WHEN z THEN 1 ELSE 2 END ELSE 0 END) THEN NULL; END IF;'), [])

    def test_case_inside_function_argument_is_accepted(self):
        self.assertEqual(self.issues('IF f(CASE WHEN x THEN 1 ELSE 0 END) THEN NULL; END IF;'), [])

    def test_assignment_case_is_not_if_case(self):
        self.assertEqual(self.issues('x:=CASE WHEN y THEN 1 ELSE 0 END; IF x>0 THEN NULL; END IF;'), [])

    def test_missing_then_is_rejected(self):
        self.assertIn('IF_THEN_NOT_FOUND', self.issues('IF x; END IF;'))

    def test_unclosed_and_mismatched_parentheses_are_rejected(self):
        for s in ['IF (x THEN NULL; END IF;', 'IF (x] THEN NULL; END IF;']:
            with self.subTest(source=s): self.assertTrue(self.issues(s))

    def test_unclosed_or_extra_end_if_is_rejected(self):
        self.assertIn('IF_END_IF_IMBALANCE', self.issues('IF x THEN NULL;'))
        self.assertIn('END_IF_WITHOUT_IF', self.issues('END IF;'))

    def test_unterminated_quote_fails_closed(self):
        with self.assertRaises(ValueError): self.issues("IF x='broken THEN NULL; END IF;")

    def test_all_fifteen_function_bodies_and_eight_do_blocks_inventoried(self):
        rows = audit(SQL3) + audit(SQL4)
        functions = [r for r in rows if not r['name'].startswith('DO ')]
        self.assertEqual(len(functions), 15)
        self.assertEqual(len(rows) - len(functions), 8)
        self.assertEqual(sum(r['language'] == 'plpgsql' for r in functions), 12)
        self.assertEqual(sum(r['language'] == 'sql' for r in functions), 3)
        self.assertTrue(all(not r['issues'] for r in rows))

    def test_repeated_do_body_reports_correct_line(self):
        source = 'DO $a$\nBEGIN IF x THEN NULL; END IF; END;\n$a$;\n' * 2
        rows = audit(source)
        self.assertEqual([r['line'] for r in rows], [1, 4])

    def test_unsupported_declaration_does_not_silently_pass(self):
        self.assertTrue(errors('CREATE FUNCTION x() RETURNS void LANGUAGE plpgsql AS \'bad\';'))

    def test_original_m4_is_byte_identical(self):
        self.assertEqual(SQL4, OLD4)
        self.assertEqual(hashlib.sha256(SQL4.encode()).hexdigest(),
                         '90750c451b2051bd457c29d950e774f9fa324fc385c4d73368a1701e56231704')

    def test_acl_contract_only_changes_one_body_hash(self):
        old = json.loads((BEFORE / 'historical-business-acl-contract.json').read_text())
        changed = copy.deepcopy(old)
        changed['functions'][SIGNATURE]['body_sha256'] = CONTRACT['functions'][SIGNATURE]['body_sha256']
        self.assertEqual(changed, CONTRACT)
        self.assertNotEqual(old['functions'][SIGNATURE]['body_sha256'], CONTRACT['functions'][SIGNATURE]['body_sha256'])
        self.assertEqual(embedded_contract_errors((HERE / 'business-permissions.test.sql').read_text()), [])

    def test_null_and_rejection_branches_are_byte_identical(self):
        def statements(s):
            body = re.search(r'CREATE FUNCTION site_private.verify_business_proof\(.*?AS \$fn\$(.*?)\$fn\$;', s, re.S)[1]
            return re.findall(r'RAISE EXCEPTION.*?;|RETURN p;', body)
        self.assertEqual(statements(OLD3), statements(SQL3))
        self.assertIn("IS DISTINCT FROM (" + OLD_A + ')', SQL3)
        self.assertIn("IS DISTINCT FROM (" + OLD_B + ')', SQL3)
        # A model of IS DISTINCT FROM: unlike <>, NULL is rejected against a
        # non-NULL expected CASE result. No assertion of SQL execution here.
        for key in ['version', 'epoch', 'issued_at', 'expires_at', 'uid', None]:
            expected = 'number' if key in ('version','epoch','issued_at','expires_at') else 'string'
            self.assertNotEqual(None, expected)
            self.assertEqual(expected, expected)

    def test_security_and_proof_gate_are_byte_identical_outside_repair(self):
        restored = SQL3.replace('(' + OLD_A + ')', OLD_A).replace('(' + OLD_B + ')', OLD_B)
        self.assertEqual(restored, OLD3)
        self.assertIn('CHECK (NOT proof_verifier_ready)', SQL3)
        self.assertIn('WHERE singleton AND enabled AND proof_verifier_ready', SQL3)
        self.assertNotRegex(SQL3, r'INSERT INTO site_private\.business_proof_keys')


if __name__ == '__main__': unittest.main(verbosity=2)
