// Explicit trust-boundary MODEL. No JWTs, Auth calls, SQL or key material.
// Only the simulated trusted gateway may mint a request context. This does NOT
// prove PostgREST's actual SET ROLE/current_setting behavior inside definers.
import test from 'node:test';
import assert from 'node:assert/strict';
function fixture() {
  const verified=new WeakMap();
  const users=new Map([['alice',{confirmed:true,anonymous:false,banned:false}],['bob',{confirmed:true,anonymous:false,banned:false}]]);
  const sessions=new Map([['alice-session',{uid:'alice',expires:200}],['bob-session',{uid:'bob',expires:200}]]);
  function gateway(claims,{sessionUser='authenticator',role='authenticated'}={}) {
    const context=Object.freeze({});verified.set(context,{claims,sessionUser,role});return context;
  }
  function query(context,...args) {
    if(args.length)throw Error('DENY');
    const x=verified.get(context);if(!x||x.sessionUser!=='authenticator'||x.role!=='authenticated')throw Error('DENY');
    const c=x.claims,u=users.get(c.uid),s=sessions.get(c.sid);
    if(c.issuer!=='local'||c.purpose!=='password'||c.expires<=100||!u?.confirmed||u.anonymous||u.banned||!s||s.uid!==c.uid||s.expires<=100)throw Error('DENY');
    return {uid:c.uid,sid:c.sid};
  }
  const claims={uid:'alice',sid:'alice-session',issuer:'local',purpose:'password',expires:200};
  return {gateway,query,users,sessions,claims};
}
test('bridge model: own positive returns only validated UID/session',()=>{
  const f=fixture();assert.deepEqual(f.query(f.gateway(f.claims)),{uid:'alice',sid:'alice-session'});
});
test('bridge model: client-supplied GUC/context shape is not trusted gateway evidence',()=>{
  const f=fixture();assert.throws(()=>f.query({claims:f.claims,sessionUser:'authenticator',role:'authenticated'}),/DENY/);
});
test('bridge model: SQL administrator/login cannot simulate verified JWT by setting claims',()=>{
  const f=fixture();for(const sessionUser of ['postgres','authenticated','anon'])assert.throws(()=>f.query(f.gateway(f.claims,{sessionUser})),/DENY/);
});
test('bridge model: caller-selected UID/session parameters rejected',()=>{
  const f=fixture();assert.throws(()=>f.query(f.gateway(f.claims),'bob','bob-session'),/DENY/);
});
test('bridge model: Alice cannot borrow Bob session',()=>{
  const f=fixture();assert.throws(()=>f.query(f.gateway({...f.claims,sid:'bob-session'})),/DENY/);
});
test('bridge model: deleted/revoked session is rechecked',()=>{
  const f=fixture(),c=f.gateway(f.claims);f.sessions.delete('alice-session');assert.throws(()=>f.query(c),/DENY/);
});
test('bridge model: expired/unknown session rejects',()=>{
  for(const kind of ['expired','unknown']){const f=fixture();if(kind==='expired')f.sessions.get('alice-session').expires=100;else f.sessions.delete('alice-session');assert.throws(()=>f.query(f.gateway(f.claims)),/DENY/);}
});
test('bridge model: Recovery/OTP, wrong issuer, anonymous/banned/unconfirmed user deny',()=>{
  for(const kind of ['recovery','otp','issuer','anonymous','banned','unconfirmed']){
    const f=fixture();if(['recovery','otp'].includes(kind))f.claims.purpose=kind;if(kind==='issuer')f.claims.issuer='other';
    if(kind==='anonymous')f.users.get('alice').anonymous=true;if(kind==='banned')f.users.get('alice').banned=true;if(kind==='unconfirmed')f.users.get('alice').confirmed=false;
    assert.throws(()=>f.query(f.gateway(f.claims)),/DENY/);
  }
});
