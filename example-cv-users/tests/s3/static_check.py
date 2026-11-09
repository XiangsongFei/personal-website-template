"""Offline source checks only. No SQL parser, database, network or subprocess.

Run with python3 tests/s3/static_check.py. Database tests remain NOT RUN.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
SQL = '\n'.join(p.read_text() for p in MIGRATIONS)
TABLES = re.findall(r'CREATE TABLE (site_\w+\.\w+)\s*\(', SQL)
FUNCTIONS = re.findall(r'CREATE FUNCTION (site_\w+\.\w+)\(\)', SQL)


def sql_text(text, mask_literals=False):
    """Remove nested SQL comments without changing quoted text.

    For top-level statement checks, mask strings, quoted identifiers and dollar
    bodies with opaque markers too. Their contents cannot become executable SQL.
    Supports standard_conforming_strings=on and explicit E-string escapes.
    This is a fail-closed lexical check, NOT a PostgreSQL syntax parser.
    """
    out = []
    i = 0

    def blank(value):
        return ''.join('\n' if c == '\n' else ' ' for c in value)

    while i < len(text):
        start = i
        if text.startswith('--', i):
            end = text.find('\n', i)
            i = len(text) if end < 0 else end
            out.append(blank(text[start:i]))
        elif text.startswith('/*', i):
            depth = 1
            i += 2
            while depth and i < len(text):
                if text.startswith('/*', i):
                    depth += 1
                    i += 2
                elif text.startswith('*/', i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise ValueError('unterminated SQL block comment')
            out.append(blank(text[start:i]))
        elif text[i] in "'\"":
            quote = text[i]
            escaped = (quote == "'" and i > 0 and text[i-1] in 'eE'
                       and (i < 2 or not (text[i-2].isalnum() or text[i-2] in '_$')))
            i += 1
            while i < len(text):
                if escaped and text[i] == '\\':
                    i += 2
                elif text[i] == quote:
                    i += 1
                    if i < len(text) and text[i] == quote:
                        i += 1
                    else:
                        break
                else:
                    i += 1
            else:
                raise ValueError('unterminated SQL quoted text')
            out.append('?' + blank(text[start+1:i]) if mask_literals else text[start:i])
        elif text[i] == '$' and (i == 0 or not (text[i-1].isalnum() or text[i-1] in '_$')):
            tag = re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$', text[i:])
            if not tag:
                out.append(text[i])
                i += 1
                continue
            delimiter = tag.group()
            end = text.find(delimiter, i + len(delimiter))
            if end < 0:
                raise ValueError('unterminated SQL dollar quote')
            i = end + len(delimiter)
            out.append('?' + blank(text[start+1:i]) if mask_literals else text[start:i])
        else:
            out.append(text[i])
            i += 1
    return ''.join(out)


def strip_comments(text):
    return sql_text(text)


def sealed_table_errors(text):
    # Split only actual top-level semicolons; literals/function bodies are opaque.
    statements = [' '.join(s.split()).upper()
                  for s in sql_text(text, mask_literals=True).split(';') if s.strip()]
    tables = []
    for s in statements:
        match = re.match(r'^CREATE TABLE (SITE_\w+\.\w+)\s*\(', s)
        if match:
            tables.append(match.group(1))
    errors = []
    if len(tables) != 15 or set(tables) != {t.upper() for t in TABLES}:
        errors.append('expected exactly the 15 active foundation CREATE TABLE statements')
    active = set(statements)
    for t in tables:
        for required in [f'ALTER TABLE {t} OWNER TO ECV_S3_OWNER',
                         f'ALTER TABLE {t} ENABLE ROW LEVEL SECURITY',
                         f'ALTER TABLE {t} FORCE ROW LEVEL SECURITY',
                         f'REVOKE ALL ON TABLE {t} FROM PUBLIC, ANON, AUTHENTICATED, SERVICE_ROLE, AUTHENTICATOR']:
            if required not in active:
                errors.append(required)
    return errors


def top_level_statements(text):
    masked = sql_text(text, mask_literals=True)
    return [strip_comments(text[m.start():m.end()]).strip()
            for m in re.finditer(r'[^;]+', masked) if m.group().strip()]


def role_boundary_errors(m1, m2, permissions):
    # The guards run against real catalogs when SQL is separately approved.
    # Here check their placement, fail-closed predicates and exact agreement.
    owner = ('GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE, INHERIT TRUE, '
             'SET TRUE GRANTED BY postgres')
    integrity = ('GRANT ecv_s3_integrity TO postgres WITH ADMIN FALSE, INHERIT FALSE, '
                 'SET TRUE GRANTED BY postgres')
    revoke = 'REVOKE ecv_s3_owner, ecv_s3_integrity FROM postgres GRANTED BY postgres RESTRICT'
    errors = []
    guards = []
    for label, source, expected in [
        ('M1', m1, ['begin', 'owner', 'integrity', 'revoke', 'guard', 'commit']),
        ('M2', m2, ['begin', 'guard', 'owner', 'integrity', 'revoke', 'guard', 'commit']),
        ('permissions', permissions, ['begin', 'guard', 'rollback']),
    ]:
        actions = []
        # The only psql meta-command in this permission test is ON_ERROR_STOP.
        source = re.sub(r'(?m)^\\set ON_ERROR_STOP on\n', '', source)
        for raw in top_level_statements(source):
            statement = ' '.join(raw.split())
            if statement in ('BEGIN', 'COMMIT', 'ROLLBACK'):
                actions.append(statement.lower())
            elif statement.startswith('DO $role_boundary$ '):
                actions.append('guard')
                guards.append(' '.join(strip_comments(raw.split('$role_boundary$')[1]).split()))
            elif re.match(r'^(GRANT|REVOKE)\b', statement, re.IGNORECASE) and ' ON ' not in statement.upper():
                actions.append({owner: 'owner', integrity: 'integrity', revoke: 'revoke'}.get(statement, 'unexpected grant/revoke'))
        if actions != expected:
            errors.append(label + ' role lifecycle')
    if not guards or len(set(guards)) != 1:
        errors.append('catalog guards differ')
    required = [
        "deployer constant oid := 'postgres'::pg_catalog.regrole;",
        'bootstrap constant oid := 10;',
        "WHERE oid = bootstrap AND rolname = 'supabase_admin' AND rolsuper) THEN",
        "internal_roles constant oid[] := ARRAY['ecv_s3_owner'::pg_catalog.regrole::oid, 'ecv_s3_integrity'::pg_catalog.regrole::oid];",
        'WHERE oid = ANY(internal_roles) AND NOT rolcanlogin AND NOT rolsuper '
        'AND NOT rolbypassrls AND NOT rolinherit AND NOT rolcreaterole '
        'AND NOT rolcreatedb AND NOT rolreplication) <> 2 THEN '
        "RAISE EXCEPTION 'S3 internal role attributes mismatch'; END IF;",
        'WHERE roleid = ANY(internal_roles) OR member = ANY(internal_roles)) <> 2 '
        'OR (SELECT count(*) FROM pg_catalog.pg_auth_members '
        'WHERE roleid = ANY(internal_roles) AND member = deployer '
        'AND grantor = bootstrap AND admin_option AND NOT set_option AND NOT inherit_option) <> 2 THEN '
        "RAISE EXCEPTION 'S3 internal role membership mismatch'; END IF;",
        "WHERE r.oid <> deployer AND r.oid <> ALL(internal_roles) "
        "AND (NOT r.rolsuper OR r.rolname IN ('anon','authenticated','authenticator','service_role')) "
        "AND (pg_has_role(r.oid, i.roleid, 'MEMBER') OR pg_has_role(r.oid, i.roleid, 'SET') "
        "OR pg_has_role(r.oid, i.roleid, 'USAGE')) ) THEN "
        "RAISE EXCEPTION 'S3 non-deployer role path to internal role'; END IF;",
        "WHERE pg_has_role(deployer, i.roleid, 'SET') OR pg_has_role(deployer, i.roleid, 'USAGE') ) THEN "
        "RAISE EXCEPTION 'S3 deployer SET/INHERIT remains effective'; END IF;",
    ]
    if any(part not in body for body in guards for part in required):
        errors.append('catalog guard predicates')
    return errors


class SourceChecks(unittest.TestCase):
    def test_exact_migration_sequence(self):
        self.assertEqual([p.name for p in MIGRATIONS], [
            '20261107180504_s3_security_foundation.sql',
            '20261107180505_s3_site_foundation.sql'])
        for p in MIGRATIONS:
            s = strip_comments(p.read_text()).strip()
            self.assertTrue(s.startswith('BEGIN;'))
            self.assertTrue(s.endswith('COMMIT;'))

    def test_all_tables_sealed(self):
        self.assertEqual(len(TABLES), 15)
        self.assertEqual(sealed_table_errors(SQL), [])

    def test_function_boundaries(self):
        self.assertEqual(len(FUNCTIONS), 4)
        self.assertEqual(SQL.count('SECURITY DEFINER'), 1)
        self.assertEqual(SQL.count("SET search_path = ''"), 4)
        for f in FUNCTIONS:
            self.assertIn(f'REVOKE ALL ON FUNCTION {f}() FROM PUBLIC, anon, authenticated, service_role, authenticator;', SQL)
        self.assertIn('ALTER FUNCTION site_private.assert_site_integrity() OWNER TO ecv_s3_integrity;', SQL)
        self.assertNotRegex(strip_comments(SQL), r'\bEXECUTE\s+[\'\"]')

    def test_no_business_entry_points(self):
        s = strip_comments(SQL)
        self.assertNotRegex(s, r'CREATE (?:OR REPLACE )?FUNCTION site_api\.')
        self.assertNotRegex(s, r'GRANT .* TO (?:PUBLIC|anon|authenticated|service_role|authenticator)\b')
        self.assertNotRegex(s, r'CREATE POLICY .* TO (?:PUBLIC|anon|authenticated)\b')
        self.assertNotRegex(s, r'\b(?:INSERT|UPDATE|DELETE)\b.*auth\.(?:users|sessions)')

    def test_role_attributes(self):
        for role in ['ecv_s3_owner', 'ecv_s3_integrity']:
            self.assertIn(f'CREATE ROLE {role} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;', SQL)
        self.assertEqual(SQL.count('CREATE POLICY integrity_read'), 3)
        self.assertIn('REVOKE CREATE ON SCHEMA site_private FROM ecv_s3_integrity;', SQL)

    def test_owner_and_publication_invariants(self):
        self.assertIn('owner_auth_user_id uuid NOT NULL UNIQUE', SQL)
        self.assertIn('FOREIGN KEY (site_id, auth_user_id) REFERENCES site_data.sites(id, owner_auth_user_id)', SQL)
        for t in ['sites', 'members', 'publications']:
            self.assertIn(f'CREATE CONSTRAINT TRIGGER {t}_integrity', SQL)
        self.assertIn("CHECK (state = 'unpublished' AND snapshot_id IS NULL AND publication_revision = 0)", SQL)
        self.assertIn('CREATE TRIGGER publication_permanent BEFORE DELETE', SQL)

    def test_idempotency_and_same_site_fks(self):
        self.assertIn('CREATE UNIQUE INDEX create_site_request_key ON site_private.operation_requests(actor_auth_user_id, operation, request_id)', SQL)
        self.assertIn('FOREIGN KEY (site_id, parent_id) REFERENCES site_data.intro_entries(site_id, id)', SQL)
        self.assertEqual(SQL.count('FOREIGN KEY (site_id, operation_id) REFERENCES site_private.operation_requests(site_id, id)'), 2)
        self.assertIn('CREATE TRIGGER operation_immutable BEFORE UPDATE OR DELETE', SQL)

    def test_plpgsql_block_terminators(self):
        # Lexical guard only, explicitly NOT PostgreSQL parsing or execution.
        for p in [*MIGRATIONS, *sorted((ROOT / 'tests/s3').glob('*.sql'))]:
            s = p.read_text()
            for tag in set(re.findall(r'\$[a-zA-Z_]*\$', s)):
                self.assertEqual(s.count(tag) % 2, 0, (p.name, tag))
            self.assertNotRegex(s, r'\bEND\s+\$(?:fn|test|b|denials|deployment_identity|role_boundary)\$')

    def test_runtime_tests_are_explicitly_unexecuted(self):
        for name in ['constraints.test.sql', 'permissions.test.sql']:
            s = (ROOT / 'tests/s3' / name).read_text()
            self.assertIn('NOT RUN', s)
            self.assertIn('\\set ON_ERROR_STOP on', s)
            self.assertIn('ROLLBACK;', s)


class RoleBoundaryRegressionChecks(unittest.TestCase):
    def setUp(self):
        self.sources = [*(p.read_text() for p in MIGRATIONS),
                        (ROOT / 'tests/s3/permissions.test.sql').read_text()]

    def test_exact_role_lifecycle(self):
        self.assertEqual(role_boundary_errors(*self.sources), [])

    def test_rejects_role_boundary_regressions(self):
        for original, mutant in [
            ('member = deployer', "member = 'authenticated'::regrole"),
            ('grantor = bootstrap', 'grantor = deployer'),
            ('bootstrap constant oid := 10;', 'bootstrap constant oid := 11;'),
            ('AND NOT set_option', 'AND set_option'),
            ('AND NOT inherit_option', 'AND inherit_option'),
            ("pg_has_role(r.oid, i.roleid, 'MEMBER')\n      OR ", ''),
            ('OR member = ANY(internal_roles)', ''),
        ]:
            with self.subTest(original=original, mutant=mutant):
                changed = [source.replace(original, mutant) for source in self.sources]
                self.assertTrue(all(before != after for before, after in zip(self.sources, changed)),
                                'mutation must affect every guard source')
                self.assertIn('catalog guard predicates', role_boundary_errors(*changed))

    def test_rejects_unauthorized_or_unrevoked_membership(self):
        m1, m2, permissions = self.sources
        for statement in [
            'GRANT ecv_s3_owner TO authenticated;',
            'GRANT pg_read_all_data TO ecv_s3_integrity;',
            'GRANT postgres TO authenticator;',
            'GRANT ecv_s3_owner TO postgres WITH SET TRUE GRANTED BY postgres;',
        ]:
            with self.subTest(statement=statement):
                self.assertIn('M2 role lifecycle', role_boundary_errors(
                    m1, m2.replace('COMMIT;', statement + '\nCOMMIT;'), permissions))
        revoke = 'REVOKE ecv_s3_owner, ecv_s3_integrity FROM postgres GRANTED BY postgres RESTRICT;'
        for replacement in ['', '-- ' + revoke, revoke.replace('GRANTED BY postgres', 'GRANTED BY supabase_admin')]:
            with self.subTest(replacement=replacement):
                self.assertIn('M1 role lifecycle', role_boundary_errors(
                    m1.replace(revoke, replacement), m2, permissions))


class RlsRegressionChecks(unittest.TestCase):
    enable = 'ALTER TABLE site_data.sites ENABLE ROW LEVEL SECURITY;'
    force = 'ALTER TABLE site_data.sites FORCE ROW LEVEL SECURITY;'

    def test_original_active_sql(self):
        self.assertEqual(sealed_table_errors(SQL), [])

    def test_commented_one_enable_rejected(self):
        self.assertIn(self.enable, SQL)
        self.assertTrue(sealed_table_errors(SQL.replace(self.enable, '-- ' + self.enable, 1)))

    def test_commented_one_force_rejected(self):
        self.assertIn(self.force, SQL)
        self.assertTrue(sealed_table_errors(SQL.replace(self.force, '/* ' + self.force + ' */', 1)))

    def test_all_rls_commented_rejected(self):
        pattern = r'(?m)^(ALTER TABLE site_\w+\.\w+ (?:ENABLE|FORCE) ROW LEVEL SECURITY;)$'
        mutant, count = re.subn(pattern, r'-- \1', SQL)
        self.assertEqual(count, 30)
        self.assertEqual(len(sealed_table_errors(mutant)), 30)

    def test_comment_decoys_cannot_restore_missing_statement(self):
        missing = SQL.replace(self.enable, '', 1)
        for decoy in ['-- ' + self.enable, '/* ' + self.enable + ' */',
                      '/* outer /* ' + self.enable + ' */ end */']:
            with self.subTest(decoy=decoy):
                self.assertTrue(sealed_table_errors(missing + '\n' + decoy))

    def test_literal_and_function_body_decoys_rejected(self):
        missing = SQL.replace(self.enable, '', 1)
        for decoy in ["SELECT '" + self.enable + "';",
                      'SELECT "' + self.enable + '";',
                      'DO $body$ BEGIN ' + self.enable + ' END; $body$;']:
            with self.subTest(decoy=decoy):
                self.assertTrue(sealed_table_errors(missing + '\n' + decoy))

    def test_comments_inside_quoted_text_are_preserved(self):
        samples = ["SELECT '-- /* literal */ ; it''s quoted';",
                   r"SELECT E'escaped\' -- /* still string */';",
                   'SELECT "identifier--/*text*/";',
                   'DO $tag_1$ BEGIN -- body comment\n /* body */ END; $tag_1$;']
        for sample in samples:
            with self.subTest(sample=sample):
                self.assertEqual(strip_comments(sample), sample)
                self.assertEqual(sealed_table_errors(SQL + '\n' + sample), [])

    def test_nested_comments_preserve_statement_boundaries(self):
        active = SQL.replace(self.enable, self.enable.replace(' ENABLE', ' /* a /* b */ c */ ENABLE'), 1)
        self.assertEqual(sealed_table_errors(active), [])

    def test_unterminated_lexemes_fail_closed(self):
        for tail in ['/* open', "SELECT 'open", 'SELECT "open', 'DO $body$open']:
            with self.subTest(tail=tail), self.assertRaises(ValueError):
                sealed_table_errors(SQL + '\n' + tail)


if __name__ == '__main__':
    unittest.main(verbosity=2)
