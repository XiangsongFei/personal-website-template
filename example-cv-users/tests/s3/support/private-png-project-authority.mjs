// Disposable Unix-only PG replay of the merged S3 business authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createBusinessBinding } from '../../../lib/business/binding.mjs';
import { id, originalAccount } from './private-png-authorization-fixture.mjs';

const read = name => readFileSync(new URL('../../../' + name, import.meta.url), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const json = value => literal(JSON.stringify(value)) + '::jsonb';
const migrations = JSON.parse(read('tests/s3/migration-source-contract.json'));
const { m7Adaptation: m7 } = JSON.parse(read('docs/s3/S3.6-HOSTED-TARGET-MANIFEST.PG17.12.json'));
const project = 'ecv-s33a-20261109-7dd22a81';
const issuer = 'http://127.0.0.1:56321/auth/v1';
const generation = 'png-project-authority';
const worker = { uid: id(30), session_id: id(31) };
const other = { uid: id(80), session_id: id(81) };
const scope = createBusinessBinding({ project, authIssuer: issuer, privateOrigin: 'https://rpc.internal.test',
  registrarHost: 'db.internal.test', testOnly: true });
const { uid, session_id: sid } = originalAccount;

export function installProjectAuthority(sql) {
  assert.equal(sql('supabase_admin', `SELECT current_setting('server_version_num')='170012'
    AND inet_server_addr() IS NULL AND current_setting('listen_addresses')=''
    AND current_setting('s35.png_authority',true) ~ '^[a-f0-9-]{36}$'
    AND current_user='supabase_admin' AND current_database()='postgres'
    AND EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname='supabase_admin');`), 't');
  sql('supabase_admin', `
    CREATE ROLE postgres LOGIN INHERIT CREATEROLE NOSUPERUSER BYPASSRLS;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE authenticator NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE supabase_auth_admin NOLOGIN;
    GRANT authenticated TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE GRANTED BY supabase_admin;
    GRANT CREATE ON DATABASE postgres TO postgres;
    ALTER SCHEMA public OWNER TO postgres;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    GRANT USAGE ON SCHEMA extensions TO postgres WITH GRANT OPTION;
    CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
    SET ROLE supabase_auth_admin;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,is_anonymous boolean);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),not_after timestamptz);
    ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth TO postgres;
    GRANT SELECT(id,email_confirmed_at,banned_until,is_anonymous), REFERENCES(id) ON auth.users TO postgres;
    GRANT SELECT(id,user_id,not_after) ON auth.sessions TO postgres;
    RESET ROLE;`);
  for (const [file, digest] of Object.entries(migrations)) {
    let source = read('supabase/migrations/' + file);
    assert.equal(sha(source), digest, file);
    if (file === m7.file) {
      assert.equal(source.split(m7.before).length, 2);
      source = source.replace(m7.before, m7.after);
      assert.equal(sha(source), m7.newSha256);
    }
    sql('postgres', source);
    if (file === '20261107180504_s3_security_foundation.sql')
      sql('supabase_admin', 'GRANT USAGE ON SCHEMA site_data,site_private,site_api TO postgres;');
    if (file === '20261109104800_s3_business_grants.sql')
      sql('supabase_admin', 'GRANT SELECT ON site_private.business_runtime TO postgres;');
  }
}

function withOwner(sql, actor, statement, recovery = false) {
  const claims = { iss: issuer, aud: 'authenticated', role: 'authenticated', is_anonymous: false,
    sub: actor.uid, session_id: actor.session_id, exp: Math.floor(Date.now() / 1000) + 300,
    amr: [{ method: recovery ? 'recovery' : 'password' }] };
  return sql('ecv_s3_internal_api_login', `BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claims',${json(claims)}::text,true) IS NOT NULL;
    ${statement}
    COMMIT;`).split('\n').at(-1);
}

function applyProof(sql, actor, action, index) {
  const issued = Math.floor(Date.now() / 1000) - 1;
  const proof = { version: 1, project, action, purpose: 'business', uid: actor.uid, session_id: actor.session_id,
    epoch: 4, proof_id: id(index), issued_at: issued, expires_at: issued + 60,
    payload_digest: sha(['ecv.business_grant.v1', action, 'business', actor.uid, actor.session_id, 4, ''].join('\n')),
    key_id: generation, event: action === 'issue' ? 'password-login' : 'account-session' };
  assert.equal(sql('ecv_s3_registration_login', `SELECT site_private.register_business_ticket(${json(proof)});`), 't');
  return JSON.parse(withOwner(sql, actor, `SELECT site_api.apply_business_grant(${json({ proof })});`));
}

export function seedProjectAuthority(sql, state) {
  const admin = command => sql('supabase_admin', command);
  const owner = state === 'expired' || state === 'no-grant' ? { uid, session_id: id(87) } : originalAccount;
  for (const actor of [owner, other, worker]) {
    admin(`INSERT INTO auth.users VALUES (${literal(actor.uid)},NULL,clock_timestamp(),NULL,false);
      INSERT INTO auth.sessions VALUES (${literal(actor.session_id)},${literal(actor.uid)},NULL);`);
  }
  if (owner !== originalAccount) admin(`INSERT INTO auth.sessions VALUES (${literal(sid)},${literal(uid)},NULL);`);
  admin(`INSERT INTO site_private.user_security_state(auth_user_id,security_epoch,business_enabled,security_hold,hold_reason)
    VALUES (${literal(uid)},4,true,false,'none'),(${literal(other.uid)},4,true,false,'none');
    INSERT INTO site_private.proof_generations(key_id,not_before,sign_until,verify_until)
      VALUES (${literal(generation)},clock_timestamp()-interval '1 minute',clock_timestamp()+interval '9 minutes',
        clock_timestamp()+interval '10 minutes');
    ALTER TABLE site_private.business_runtime DROP CONSTRAINT business_runtime_proof_verifier_ready_check;
    UPDATE site_private.business_runtime SET enabled=true,proof_verifier_ready=true;
    ALTER ROLE ecv_s3_internal_api_login LOGIN;
    ALTER ROLE ecv_s3_registration_login LOGIN;`);
  for (const [index, actor] of [owner, other].entries()) {
    const created = applyProof(sql, actor, 'issue', 82 + index);
    assert.equal(created.status, 'active');
    const create = { schema_version: 1, request_id: id(84 + index), slug: 'png-owner-' + index, default_locale: 'en' };
    const site = JSON.parse(withOwner(sql, actor, `SELECT site_api.create_site(${json(create)});`));
    assert.equal(site.persisted, true);
  }
  // Exercise the real M7 Recovery predicate with an otherwise legitimate Owner.
  assert.throws(() => withOwner(sql, owner, 'SELECT site_api.get_my_site();', true), /BUSINESS_DENIED/);
  if (state === 'expired') {
    // Seed an already-expired grant in the real model. This is not a clock
    // simulation or a shortened issued grant.
    admin(`INSERT INTO site_private.business_session_grants
      (id,auth_user_id,auth_session_id,security_epoch,purpose,issued_at,last_renewed_at,expires_at,absolute_expires_at,issuer_version)
      VALUES (${literal(id(88))},${literal(uid)},${literal(sid)},4,'business',clock_timestamp()-interval '40 minutes',
        clock_timestamp()-interval '40 minutes',clock_timestamp()-interval '10 minutes',
        clock_timestamp()+interval '11 hours',${literal('r3-ticket-v1:' + generation)});
      INSERT INTO site_private.grant_proofs(proof_id,project_ref,auth_user_id,auth_session_id,action,security_epoch,
        request_digest,issued_at,expires_at,consumed_at,key_id,proof_fingerprint,grant_result)
      VALUES (${literal(id(89))},${literal(project)},${literal(uid)},${literal(sid)},'issue',4,repeat('a',64),
        clock_timestamp()-interval '41 minutes',clock_timestamp()-interval '40 minutes',
        clock_timestamp()-interval '40 minutes 30 seconds',${literal(generation)},repeat('b',64),
        jsonb_build_object('grant_id',${literal(id(88))}));`);
  }
  return readProjectAuthority(sql);
}

export function readProjectAuthority(sql) {
  const row = JSON.parse(sql('supabase_admin', `SELECT json_build_object('grantId',coalesce(g.id,${literal(id(88))}::uuid),
    'siteId',s.id,'otherSite',o.id)
    FROM site_data.sites s
    LEFT JOIN site_private.business_session_grants g ON s.owner_auth_user_id=g.auth_user_id AND g.auth_session_id=${literal(sid)}
    JOIN site_data.sites o ON o.owner_auth_user_id=${literal(other.uid)}
    WHERE s.owner_auth_user_id=${literal(uid)};`));
  return Object.freeze({ binding: scope, generation, ...row });
}

export function revokeProjectGrant(sql) {
  assert.equal(applyProof(sql, originalAccount, 'revoke', 86).status, 'revoked');
}

export function closeProjectAuthority(sql) {
  sql('supabase_admin', `BEGIN;
    UPDATE site_private.business_runtime SET enabled=false,proof_verifier_ready=false;
    ALTER TABLE site_private.business_runtime ADD CONSTRAINT business_runtime_proof_verifier_ready_check
      CHECK(NOT proof_verifier_ready);
    UPDATE site_private.business_session_grants SET revoked_at=clock_timestamp(),reason='user_logout'
      WHERE auth_user_id IN (${literal(uid)},${literal(other.uid)}) AND revoked_at IS NULL;
    DELETE FROM auth.sessions WHERE user_id IN (${literal(uid)},${literal(other.uid)},${literal(worker.uid)});
    ALTER ROLE ecv_s3_internal_api_login NOLOGIN PASSWORD NULL;
    ALTER ROLE ecv_s3_registration_login NOLOGIN PASSWORD NULL;
    COMMIT;`);
  const witness = sql('supabase_admin', `BEGIN READ ONLY;
    SELECT NOT enabled AND NOT proof_verifier_ready
      AND (SELECT count(*) FROM auth.sessions)=0
      AND (SELECT count(*) FROM site_private.business_session_grants WHERE revoked_at IS NULL)=0
      AND (SELECT count(*) FROM pg_authid WHERE rolname IN ('ecv_s3_internal_api_login','ecv_s3_registration_login')
        AND NOT rolcanlogin AND rolpassword IS NULL)=2
      AND NOT EXISTS (SELECT FROM pg_stat_activity WHERE usename IN ('ecv_s3_internal_api_login','ecv_s3_registration_login'))
      AND NOT EXISTS (SELECT FROM fixture_png.lease)
      AND NOT EXISTS (SELECT FROM fixture_png.pin WHERE lifecycle_open)
      FROM site_private.business_runtime;
    COMMIT;`);
  assert.equal(witness, 't');
}
