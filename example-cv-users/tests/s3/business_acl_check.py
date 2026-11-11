"""Exact, reviewed B ACL/source guard. Offline only; no SQL/network/subprocess.

This accepts the sealed candidate's spelling, not arbitrary equivalent SQL.
Changing permissions or function bodies requires independent contract review.
A passing source guard is NOT evidence that Auth access or SQL execution works.
"""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
from static_check import top_level_statements

ROOT = Path(__file__).resolve().parent
CONTRACT = json.loads((ROOT / 'business-acl-contract.json').read_text())


def normalize(statement):
    return re.sub(r'\s+', ' ', re.sub(r'\s*([(),=])\s*', r'\1', statement.strip())).lower()


def acl_errors(m3, m4):
    errors = []
    for name, source in zip(sorted(CONTRACT['permission_ddl']), [m3, m4]):
        actual = [normalize(x) for x in top_level_statements(source)
                  if re.match(r'^(?:GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|ALTER FUNCTION)', x, re.I)]
        if Counter(actual) != Counter(CONTRACT['permission_ddl'][name]):
            errors.append('ACL_DDL_ALLOWLIST:' + name)
    # Pin all candidate declarations and bodies, including precise Auth return
    # shape. An unreviewed field, owner, search_path or security change fails.
    found = {}
    pattern = (r"CREATE FUNCTION ([\w.]+)\((.*?)\) RETURNS (.*?)\n"
               r"LANGUAGE (\w+) SECURITY (DEFINER|INVOKER) SET search_path\s*=\s*'' AS \$fn\$(.*?)\$fn\$;")
    for match in re.finditer(pattern, m3 + '\n' + m4, re.S):
        name, args, returns, language, security, body = match.groups()
        signature = name + '(' + ','.join(a.split()[-1] for a in args.split(',') if a.strip()) + ')'
        if signature in found:
            errors.append('DUPLICATE_FUNCTION')
        found[signature] = (re.sub(r'\s*,\s*', ', ', returns), language, security == 'DEFINER',
                            hashlib.sha256(body.encode()).hexdigest())
    expected = {sig: (x['returns'], x['language'], x['security_definer'], x['body_sha256'])
                for sig, x in CONTRACT['functions'].items()
                if sig not in {'site_private.guard_security_state()', 'site_private.reject_mutation()',
                               'site_private.guard_identity()', 'site_private.assert_site_integrity()'}}
    if found != expected:
        errors.append('FUNCTION_BODY_OR_RESULT_CONTRACT')
    return errors


def embedded_contract_errors(source):
    matches = re.findall(r'acl_contract constant jsonb := \$contract\$(.*?)\$contract\$;', source, re.S)
    if len(matches) != 1:
        return ['CATALOG_CONTRACT_MISSING']
    try:
        return [] if json.loads(matches[0]) == CONTRACT else ['CATALOG_CONTRACT_DRIFT']
    except ValueError:
        return ['CATALOG_CONTRACT_INVALID']
