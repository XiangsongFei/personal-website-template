"""Offline M7 contract tools. No SQL execution, connection, or credential provider.

The source reader handles only this sealed migration spelling, not general SQL.
The collector is a separate, NOT RUN PostgreSQL catalog input. Never generate an
expected contract from a live catalog: compare it to the reviewed JSON instead.
"""
from pathlib import Path
import hashlib
import json
import re
from static_check import top_level_statements

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CONTRACT_PATH = HERE / 'm7-permissions-contract.json'
SCHEMAS = ['site_api', 'site_data', 'site_private']
PRIVILEGES = ['DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']


def ordered(rows):
    return sorted(rows, key=lambda x: json.dumps(x, sort_keys=True))


def signature(name, args):
    return name + '(' + ','.join(a.split()[-1] for a in args.split(',') if a.strip()) + ')'


def expression(value):
    """Limited policy AST: retain grouping and literals; tolerate deparser casts.

    Only name/text casts on string literals are equivalent here. Unknown syntax
    fails closed. Parentheses are parsed, never stripped indiscriminately.
    """
    if value is None:
        return None
    tokens = []
    while value.strip():
        m = re.match(r"\s*('(?:[^']|'')*'|::|[0-9]+|[A-Za-z_][A-Za-z_0-9.]*|[(),=])", value)
        if not m:
            raise ValueError('unsupported policy expression')
        t = m[1]
        tokens.append(t if t.startswith("'") else t.lower())
        value = value[m.end():]
    pos = 0

    def take():
        nonlocal pos
        t = tokens[pos]
        pos += 1
        return t

    def atom():
        if pos >= len(tokens):
            raise ValueError('incomplete policy expression')
        t = take()
        if t == 'not':
            return ['not', binary(3)]
        if t == '(':
            node = binary(0)
            if take() != ')':
                raise ValueError('unbalanced policy expression')
            return node
        if not (t.startswith("'") or re.fullmatch(r'[a-z_][a-z_0-9.]*|[0-9]+', t)):
            raise ValueError('invalid policy atom')
        node = ['literal' if t.startswith("'") else 'name', t]
        if pos < len(tokens) and tokens[pos] == '(':
            take()
            args = []
            if tokens[pos] != ')':
                args.append(binary(0))
                while pos < len(tokens) and tokens[pos] == ',':
                    take()
                    args.append(binary(0))
            if take() != ')':
                raise ValueError('unbalanced policy call')
            node = ['call', t.removeprefix('pg_catalog.'), args]
        if pos < len(tokens) and tokens[pos] == '::':
            take()
            cast = take()
            if node[0] != 'literal' or cast not in ('text', 'name'):
                raise ValueError('unsupported policy cast')
        return node

    precedence = {'or': 1, 'and': 2, '=': 3, 'is': 3}

    def binary(level):
        left = atom()
        while pos < len(tokens) and precedence.get(tokens[pos], -1) >= level:
            op = take()
            rank = precedence[op]
            if op == 'is' and pos < len(tokens) and tokens[pos] == 'not':
                take()
                op = 'is not'
            left = [op, left, binary(rank + 1)]
        return left

    result = binary(0)
    if pos != len(tokens):
        raise ValueError('trailing policy expression')
    return result


def source_state(sources):
    tables, functions, policies, roles = {}, {}, {}, {}
    security_ddl = {}
    for filename, source in sources.items():
        creator = 'postgres'
        security_ddl[filename] = []
        for raw in top_level_statements(source):
            s = ' '.join(raw.split())
            if re.match(r'^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|ALTER POLICY|DROP POLICY)\b', s):
                security_ddl[filename].append(s)
            m = re.fullmatch(r'SET LOCAL ROLE (\w+)', s)
            if m:
                creator = m[1]
            if s in ('RESET ROLE', 'COMMIT'):
                creator = 'postgres'
            m = re.match(r'CREATE ROLE (\w+) (.*)', s)
            if m:
                flags = m[2].split()
                required = ['NOLOGIN', 'NOINHERIT', 'NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS']
                roles[m[1]] = dict(zip(['canlogin', 'inherit', 'super', 'createdb', 'createrole', 'replication', 'bypassrls'],
                                      [x not in flags for x in required]))
                roles[m[1]]['connlimit'] = int(flags[-1]) if 'LIMIT' in flags else -1
            m = re.match(r'CREATE TABLE (site_\w+\.\w+)\s*\(', s)
            if m:
                tables[m[1]] = {'owner': creator, 'rls': False, 'force': False, 'kind': 'r'}
            m = re.fullmatch(r'ALTER TABLE (site_\w+\.\w+) (OWNER TO \w+|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY)', s)
            if m:
                t = tables[m[1]]
                if m[2].startswith('OWNER'):
                    t['owner'] = m[2].split()[-1]
                else:
                    t['rls' if m[2].startswith('ENABLE') else 'force'] = True
            m = re.match(r"CREATE (?:OR REPLACE )?FUNCTION ([\w.]+)\((.*?)\) RETURNS (.*?)\s+LANGUAGE (\w+) SECURITY (DEFINER|INVOKER) SET search_path\s*=\s*'' AS \$fn\$(.*?)\$fn\$\s*$", raw, re.S)
            if m:
                name, args, returns, language, security, body = m.groups()
                sig = signature(name, args)
                owner = functions.get(sig, {}).get('owner', creator)
                functions[sig] = {'owner': owner, 'returns': re.sub(r'\s*,\s*', ', ', returns),
                                  'language': language, 'definer': security == 'DEFINER',
                                  'kind': 'f', 'volatility': 'v', 'parallel': 'u', 'leakproof': False, 'strict': False,
                                  'config': ['search_path=""'], 'body_sha256': hashlib.sha256(body.encode()).hexdigest()}
            m = re.fullmatch(r'ALTER FUNCTION ([\w.]+\(.*?\)) OWNER TO (\w+)', s)
            if m:
                functions[m[1]]['owner'] = m[2]
            policy_s = re.sub(r'\b(USING|CHECK)\(', r'\1 (', s)
            m = re.fullmatch(r'CREATE POLICY (\w+) ON ([\w.]+) FOR (SELECT|INSERT|UPDATE|DELETE) TO (.*?)( USING \(.*| WITH CHECK \(.*)', policy_s)
            if m:
                name, table, command, targets, tail = m.groups()
                using, check = None, None
                if tail.startswith(' USING '):
                    tail = tail[len(' USING '):]
                    parts = tail.split(' WITH CHECK ', 1)
                    using = expression(parts[0])
                    if len(parts) == 2:
                        check = expression(parts[1])
                else:
                    check = expression(tail[len(' WITH CHECK '):])
                policies[table + '.' + name] = {'command': {'SELECT': 'r', 'INSERT': 'a', 'UPDATE': 'w', 'DELETE': 'd'}[command],
                    'roles': sorted(x.strip() for x in targets.split(',')), 'permissive': True, 'using': using, 'check': check}
            m = re.fullmatch(r'DROP POLICY (\w+) ON ([\w.]+)', s)
            if m:
                del policies[m[2] + '.' + m[1]]
            m = re.fullmatch(r'ALTER POLICY (\w+) ON ([\w.]+) WITH CHECK (.*)', s)
            if m:
                policies[m[2] + '.' + m[1]]['check'] = expression(m[3])
    return {'tables': tables, 'functions': functions, 'policies': policies, 'roles': roles, 'security_ddl': security_ddl}


def source_errors(sources, contract):
    errors = []
    if list(sources) != list(contract['migration_sha256']):
        errors.append('MIGRATION_INVENTORY')
    for name, value in sources.items():
        if hashlib.sha256(value.encode()).hexdigest() != contract['migration_sha256'].get(name):
            errors.append('MIGRATION_SHA:' + name)
    try:
        actual = source_state(sources)
        for kind, value in actual.items():
            if value != contract[kind]:
                errors.append('SOURCE_' + kind.upper())
    except (KeyError, ValueError, IndexError):
        errors.append('SOURCE_PARSE')
    return errors


def expected_catalog(contract, creator_global_defaults=None):
    """Reviewed metadata, independent of any observed database state."""
    result = {k: contract[k] for k in ['tables', 'functions', 'policies', 'roles', 'schemas', 'acl', 'memberships', 'defaults']}
    result['effective'] = ordered(contract['effective'])
    result['paths'] = ordered(contract['paths'])
    result['auth_access'] = []
    result['preflight'] = {'postgres_session': True, 'pg17_11': True, 'bootstrap': True}
    result['closed_constraints'] = {'verifier': True, 'paired': True}
    result['creator_global_defaults'] = creator_global_defaults if creator_global_defaults is not None else []
    return result


def catalog_errors(observed, contract, creator_global_defaults=None):
    """Fail closed on missing fields, unknown objects and unexpected effective access.

    These are catalog assertions, never a real-JWT/transport acceptance claim.
    """
    expected = expected_catalog(contract, creator_global_defaults)
    if not isinstance(observed, dict) or set(observed) != set(expected):
        return ['CATALOG_SHAPE']
    errors = [] if creator_global_defaults is not None else ['PLATFORM_GLOBAL_DEFAULT_BASELINE_REQUIRED']
    for kind, value in expected.items():
        actual = observed[kind]
        if isinstance(value, list) and isinstance(actual, list):
            actual, value = ordered(actual), ordered(value)
        if json.dumps(actual,sort_keys=True) != json.dumps(value,sort_keys=True):
            errors.append('CATALOG_' + kind.upper())
    return errors


def read_sources():
    return {p.name: p.read_bytes().decode('utf-8') for p in sorted((ROOT / 'supabase/migrations').glob('*.sql'))}


def load_contract():
    return strict_json(CONTRACT_PATH.read_text())


def strict_json(value):
    def pairs(items):
        result = {}
        for key,item in items:
            if key in result:
                raise ValueError('duplicate JSON key')
            result[key] = item
        return result
    return json.loads(value, object_pairs_hook=pairs)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path)
    parser.add_argument('--creator-defaults', type=Path)
    parser.add_argument('--target-id', help='target identity independently verified by the approved host')
    args = parser.parse_args()
    contract = load_contract()
    errors = source_errors(read_sources(), contract)
    # Explicit local JSON only. No connection string, shell or DB client support.
    if args.catalog:
        observed = strict_json(args.catalog.read_text())
        for p in observed.get('policies', {}).values():
            p['using'], p['check'] = expression(p['using']), expression(p['check'])
        baseline = None
        if args.creator_defaults:
            metadata = strict_json(args.creator_defaults.read_text())
            if (set(metadata) != {'contract_baseline','target_id','reviewed','acl'}
                or metadata['contract_baseline'] != contract['baseline'] or metadata['reviewed'] is not True
                or not isinstance(metadata['target_id'],str) or not metadata['target_id']
                or not args.target_id or metadata['target_id'] != args.target_id
                or not isinstance(metadata['acl'],list)):
                raise SystemExit('reviewed target-bound creator defaults baseline required')
            baseline = metadata['acl']
        errors += catalog_errors(observed, contract, baseline)
    elif args.creator_defaults or args.target_id:
        parser.error('--creator-defaults/--target-id require --catalog')
    print(json.dumps({'status': 'FAIL' if errors else 'OFFLINE_PASS', 'errors': errors,
                      'live_jwt_auth_tls': 'NOT RUN'}))
    raise SystemExit(bool(errors))
