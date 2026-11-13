"""Offline safety/coverage checks for the read-only baseline; no DB connection."""
import json
from pathlib import Path
import re
import unittest
from static_check import top_level_statements, sql_text

HERE = Path(__file__).parent
SQL = (HERE / 's34-baseline-observe.sql').read_text()


class BaselineObserverTests(unittest.TestCase):
    def test_every_business_table_is_fingerprinted_once(self):
        expected = set(json.loads((HERE / 'm7-permissions-contract.json').read_text())['tables'])
        actual = re.findall(r"SELECT '(site_(?:data|private)\.[a-z_]+)'::text AS name", SQL)
        self.assertEqual(len(expected), 19)
        self.assertEqual(len(actual), 19)
        self.assertEqual(set(actual), expected)
        self.assertIn("n.nspname IN ('site_data','site_private','auth')", SQL)
        # Regression: table NAME prefix site_* is not the schema inventory.
        self.assertNotIn("relname LIKE 'site_%'", SQL)

    def test_read_only_repeatable_snapshot_and_explicit_rollback(self):
        sql = '\n'.join(line for line in SQL.splitlines() if not line.startswith('\\'))
        # Existing dependency-free lexer is a narrow source guard, NOT a PG
        # grammar/compiler. Actual PG17 execution has its own rollback receipts.
        statements = list(top_level_statements(sql))
        self.assertEqual(len(statements), 5)
        self.assertEqual(statements[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        self.assertEqual(statements[-1], 'ROLLBACK')
        self.assertTrue(statements[1].startswith('SET LOCAL search_path'))
        self.assertTrue(statements[2].startswith('SET LOCAL statement_timeout'))
        self.assertTrue(statements[3].startswith('WITH fingerprints AS'))
        masked = sql_text(statements[3], mask_literals=True)
        self.assertNotRegex(masked, r'(?i)\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMIT)\b')
        self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', SQL)
        self.assertTrue(SQL.rstrip().endswith('ROLLBACK;'))

    def test_auth_inventory_and_hash_output_do_not_export_tokens(self):
        # Each table gets one full-table fingerprint; protected Alice/Bob subsets
        # are additional observations, not substitutes for that full baseline.
        full_table_cte = SQL.split('), protected_auth AS (')[0]
        actual = re.findall(r"SELECT '(auth\.[a-z_]+)'::text AS name", full_table_cte)
        self.assertEqual(len(actual), 27)
        self.assertEqual(len(set(actual)), 27)
        for name in ['users', 'identities', 'sessions', 'refresh_tokens', 'mfa_amr_claims', 'one_time_tokens', 'audit_log_entries']:
            self.assertIn('auth.' + name, actual)
        self.assertIn("string_agg(row_sha,'' ORDER BY row_sha)", SQL)
        self.assertNotRegex(SQL, r"(?i)md5\(|encrypted_password|refresh_token_hmac_key|key_bytes|SELECT\s+\*")
        self.assertIn("'bypassrls'", SQL)

    def test_new_ids_are_checked_for_absence_not_inserted(self):
        fixture = json.loads((HERE / 's34-fixture-contract.json').read_text())
        self.assertIn(fixture['actors']['Charlie']['uid'], SQL)
        self.assertIn(fixture['key_id'], SQL)
        for slot in fixture['proof_slots']:
            self.assertEqual(SQL.count(slot['proof_id']), 2)
        self.assertIn("'new_proofs_and_tickets',NOT EXISTS", SQL)


if __name__ == '__main__':
    unittest.main()
