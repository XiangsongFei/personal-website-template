import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { servicePrefix } from './hba-prefix.mjs';

const roles=['ecv_s3_internal_api_login','ecv_s3_registration_login'];
const sources={api:'172.20.50.9',registration:'172.20.50.10'}; // invented fixtures
// Accept only the tiny grammar emitted by this candidate. This is never a parser
// for live PostgreSQL configuration, which may include lists, regex and includes.
function match(policy,connection) {
  for (const line of policy.trim().split('\n')) {
    const [kind,databases,users, ...rest] = line.split(' ');
    if (kind==='local' && connection.link!=='local' || kind.startsWith('host') && connection.link==='local' ||
        kind==='hostssl' && connection.link!=='tls') continue;
    const db=databases.split(',');
    if (!db.includes(connection.db) && !(db.includes('all') && connection.db!=='replication')) continue;
    if (users!=='all' && !users.split(',').includes(connection.role)) continue;
    if (kind!=='local') {
      const addr=rest[0];
      if (addr!==connection.src+'/32' && !(addr==='::/0' && connection.src.includes(':')) &&
          !(addr==='0.0.0.0/0' && !connection.src.includes(':'))) continue;
    }
    return rest.at(-1);
  }
  return 'NOT_COVERED';
}
for (const mode of ['peer','tls']) {
  test(mode+' prefix isolates both service principals across address families, databases and transports',()=>{
    const policy=servicePrefix(mode,mode==='peer'?undefined:sources);
    for(const [idx,role] of roles.entries()) {
      const own=idx===0?sources.api:sources.registration;
      for(const link of ['local','tls','plain']) for(const src of [sources.api,sources.registration,'10.99.77.1','::1']) {
        for(const db of ['postgres','template1','_supabase','replication']) {
          const allowed = db==='postgres' && (mode==='peer'?link==='local':link==='tls' && src===own);
          assert.equal(match(policy,{role,src,db,link}),allowed?(mode==='peer'?'peer':'cert'):'reject');
        }
      }
    }
    // Reverse impersonation from a dedicated TCP source is denied even when the client changes user.
    if(mode==='tls') for (const role of ['postgres','another_user','service_role']) {
      for(const db of ['postgres','replication','template1']) for (const src of Object.values(sources))
        for(const link of ['tls','plain']) assert.equal(match(policy,{role,src,db,link}),'reject');
    }
    assert.equal(match(policy,{role:'postgres',db:'postgres',link:'local',src:''}),'NOT_COVERED');
  });
}
test('undefined or shared source cannot generate a TCP plan',()=>{
  for(const s of [undefined,{}, {api:sources.api,registration:sources.api},
    {...sources,api:'127.0.0.1'}, {...sources,api:'203.0.113.2'}, {...sources,api:sources.api+'\ntrust'}])
    assert.throws(()=>servicePrefix('tls',s));
  assert.throws(()=>servicePrefix('peer',sources));
  for(const mode of ['disable','require','any']) assert.throws(()=>servicePrefix(mode,sources));
});
test('guarded SQL activation has exactly two role mutations; cluster guards and prior M7 defenses remain prerequisites',()=>{
  const sql=readFileSync(new URL('service-logins.sql.candidate',import.meta.url),'utf8').replace(/^--.*$/gm,'');
  assert.deepEqual(sql.match(/^ALTER ROLE .*;$/gm),roles.map(r=>'ALTER ROLE '+r+' LOGIN;'));
  assert.match(sql,/^\s*BEGIN;/); assert.match(sql,/COMMIT;\s*$/);
  assert.doesNotMatch(sql,/\b(GRANT|REVOKE|INSERT|UPDATE|DELETE|CREATE|DROP|EXECUTE)\b/i);
  for(const s of ['rolpassword IS NULL', 'pg_shdepend','pg_db_role_setting','pg_auth_members',
      "pg_has_role(s.id,t.oid,'SET')","pg_has_role(s.id,t.oid,'USAGE')","pg_has_role(s.id,t.oid,'MEMBER')",
      "session_user <> current_user","'170011'","'business_runtime_proof_verifier_ready_check'"])
    assert.ok(sql.includes(s),s);
});
