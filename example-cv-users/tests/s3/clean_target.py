"""R3-only catalog sidecar. File input only; never learn permissions from a DB.

Two rebound function bodies and two LOGIN flags are the complete permission
delta. Physical identity is supplied by a separately trusted read-only collector;
an offline JSON match is not proof of a live connection or JWT enforcement.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from m7_contract import (HERE, catalog_errors, expected_catalog, load_contract,
                         read_sources, source_errors, source_state, strict_json, expression)

PROFILE = HERE / 'r3-clean-target.json'
TARGET = {
    'daemon_id': 'd47715b7-0a23-49e0-a063-32f98fe1753c',
    'project': 'ecv-r3-clean-20261111-e449c25f',
    'database_container': 'cfde27517d74c30716cdd6e71d520ef2a040c13d40da60677dfe5a5ce5324e2e',
    'pg_system_identifier': '7706828727995158580',
    'database': 'postgres', 'server_version_num': '170011',
}
REBIND = {
    'site_private.auth_source_identity()': [
        'ce226469471a5b2ac60ac1af7bcdf33caf76187fd43d56c18ac5d83b0d3b385c',
        '794f8b9b8edc04e844f53bd1077f2d78758a8e795a060de8f1aa4680528e4600'],
    'site_private.check_ticket_claims(jsonb)': [
        'd02ff32f8978a8f1f50f3a1915b122e06b06aecf1c0d558d3d383deb055df897',
        'c6ff783707d2e360402236bcb4bf41fe26b8407af45d7cc9a295900274cbf014'],
}
LOGIN = ['ecv_s3_internal_api_login', 'ecv_s3_registration_login']
FIXTURE_SHA = '0950edb7abd1cdefacf3317c8f66f4592feb63df19aa979e85567c6f34f00c55'


def platform_defaults():
    # PostgreSQL 17 global creator defaults, independently reviewed. These do
    # not grant access to existing explicitly REVOKEd site_* objects. Future DDL
    # still must explicitly revoke PUBLIC function EXECUTE and type USAGE.
    privileges = {'r': 'DELETE INSERT MAINTAIN REFERENCES SELECT TRIGGER TRUNCATE UPDATE',
                  'S': 'SELECT UPDATE USAGE', 'T': 'USAGE', 'f': 'EXECUTE', 'n': 'CREATE USAGE'}
    result = [['postgres', kind, 'postgres', p, 'postgres', False]
              for kind, text in privileges.items() for p in text.split()]
    return result + [['postgres', 'T', 'PUBLIC', 'USAGE', 'postgres', False],
                     ['postgres', 'f', 'PUBLIC', 'EXECUTE', 'postgres', False]]


def sealed_profile():
    return {'version': 1, 'target': TARGET, 'migration_baseline': load_contract()['baseline'],
            'binding_fixture_sha256': FIXTURE_SHA, 'function_body_delta': REBIND,
            'login_only': LOGIN, 'postgres_global_defaults': platform_defaults(),
            'review': 'S3.4-PREPARATION-REVIEW.md', 'permission_overrides': []}


def same(a, b):
    # JSON types matter: 1 must not pass as true.
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def preparation_errors(profile):
    errors = [] if same(profile, sealed_profile()) else ['TARGET_PROFILE_NOT_SEALED']
    contract = load_contract()
    errors += source_errors(read_sources(), contract)
    fixture = (HERE / 'fixtures/clean-project-binding.sql').read_bytes()
    if hashlib.sha256(fixture).hexdigest() != FIXTURE_SHA:
        errors.append('BINDING_FIXTURE_SHA')
    functions = source_state({'fixture': fixture.decode()})['functions']
    if set(functions) != set(REBIND):
        errors.append('BINDING_FUNCTION_INVENTORY')
    for name, (before, after) in REBIND.items():
        if contract['functions'][name]['body_sha256'] != before or functions.get(name, {}).get('body_sha256') != after:
            errors.append('BINDING_FUNCTION_SHA:' + name)
    return errors


def target_contract():
    contract = deepcopy(load_contract())
    for name, (_, after) in REBIND.items():
        contract['functions'][name]['body_sha256'] = after
    for name in LOGIN:
        contract['roles'][name]['canlogin'] = True
    return contract


def target_catalog():
    return deepcopy(expected_catalog(target_contract(), platform_defaults()))


def target_errors(envelope, profile):
    errors = preparation_errors(profile)
    if not isinstance(envelope, dict) or set(envelope) != {'identity', 'catalog'}:
        return errors + ['TARGET_ENVELOPE_SHAPE']
    if not same(envelope['identity'], TARGET):
        errors.append('TARGET_IDENTITY')
    # Never accept a profile-defined expansion; constants above form the ONLY delta.
    return errors + catalog_errors(envelope['catalog'], target_contract(), platform_defaults())


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--observation', type=Path, help='trusted target identity + raw catalog JSON, no SQL connection')
    group.add_argument('--observation-stdin', action='store_true', help='same complete observation through bounded stdin; never persist raw catalog in an operation journal')
    args = parser.parse_args()
    profile = strict_json(PROFILE.read_text())
    errors = preparation_errors(profile)
    if args.observation or args.observation_stdin:
        if args.observation_stdin:
            import sys
            raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError('OBSERVATION_SIZE')
            observation = strict_json(raw.decode('utf-8', errors='strict'))
        else:
            observation = strict_json(args.observation.read_text())
        for p in observation.get('catalog', {}).get('policies', {}).values():
            p['using'], p['check'] = expression(p['using']), expression(p['check'])
        errors = target_errors(observation, profile)
    print(json.dumps({'status': 'FAIL' if errors else 'OFFLINE_PASS', 'errors': errors,
                      'live_catalog': 'NOT RUN', 'live_jwt_auth_tls': 'NOT RUN'}))
    raise SystemExit(bool(errors))
