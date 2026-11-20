import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {mkdtempSync,realpathSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {databaseOptions,createRegistrar} from '../../scripts/s36-hosted/database.mjs';
import {generation,issueGrant} from '../../scripts/s36-hosted/r3.mjs';
import {createHostedBinding} from '../../scripts/s36-hosted/compat/binding.mjs';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';

const project='abcdefghijklmnopqrst', role='ecv_s3_registration_login';
const direct={project,mode:'direct',host:'db.'+project+'.supabase.co',ca:rootCertificates[0],password:'offline-fixture-password'};
const shared={...direct,mode:'session',host:'aws-1-ap-southeast-1.pooler.supabase.com'};
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

test('direct and Session Pooler lock database account, project, hostname and TLS (no connections)',()=>{
  for(const [config,user] of [[direct,role],[shared,role+'.'+project]]) {
    const options=databaseOptions(project,config,role);
    assert.equal(options.user,user);
    assert.equal(options.ssl.rejectUnauthorized,true);
    assert.equal(options.ssl.servername,config.host);
    assert.equal(options.port,5432);
  }
  for(const override of [{host:'db.foreign.supabase.co'},{mode:'transaction'},{project:'xxxxxxxxxxxxxxxxxxxx'},
    {host:'aws-1-ap-southeast-1.pooler.supabase.com.example.org'},{port:6543}])
    assert.throws(()=>databaseOptions(project,{...direct,...override},role));
  assert.throws(()=>databaseOptions('makwjnbubmrmopjhzror',direct,role),/ISOLATED_PROJECT_REQUIRED/);
});

test('registrar dispatches only the scoped fixed function and preserves a lost reply as UNKNOWN (synthetic)',async()=>{
  const proof={project,expires_at:200};
  let calls=0;
  const Base=class{
    async connect(){}
    async end(){}
    async query(sql,values) {
      calls++;
      assert.match(sql,/session_user='ecv_s3_registration_login'/);
      assert.match(sql,/register_business_ticket\(\$1::jsonb\)/);
      assert.deepEqual(values,[JSON.stringify(proof)]);
      return {command:'SELECT',rowCount:1,rows:[{registered:true}]};
    }
  };
  await createRegistrar(project,direct,Base,()=>100)(proof);
  await assert.rejects(createRegistrar(project,direct,Base,()=>200)(proof),{code:'INVALID_PROOF'});
  assert.equal(calls,1);
  const Lost=class extends Base{async query(){calls++;throw Error('lost reply');}};
  await assert.rejects(createRegistrar(project,direct,Lost,()=>100)(proof),{code:'REGISTRATION_UNKNOWN'});
  assert.equal(calls,2);
});

test('real R3 protocol code checks a fresh receipt and consumes a proof ID before registrar/apply (synthetic Auth/DB)',async()=>{
  const binding=createHostedBinding({project,publishableKey:'sb_publishable_fixture',privateOrigin:'https://127.0.0.1:9443'});
  const clock=()=>100;
  const uid=id(1),sid=id(2);
  const user={id:uid,is_anonymous:false,email_confirmed_at:'2025-01-01',email:'a@example.test'};
  const identity=createIdentityAdapter({issuer:binding.authIssuer,clock,auth:{
    signInWithPassword:async()=>({data:{user,session:{access_token:'synthetic',user}}}),
    getClaims:async()=>({data:{claims:{iss:binding.authIssuer,aud:'authenticated',role:'authenticated',sub:uid,
      session_id:sid,exp:180,is_anonymous:false,amr:[{method:'password'}]}}}),
    getUser:async()=>({data:{user}})
  }});
  const login=()=>identity.passwordLogin({email:user.email,password:'offline'});
  const key=await generation(project,{project,id:'test-key',keyHex:'11'.repeat(32),notBefore:90,signUntil:120,verifyUntil:160});
  const journalDir=realpathSync(mkdtempSync(join(tmpdir(),'ecv-hosted-proof-')));
  const seen=[];
  try {
    const options={binding,identity,key,journalDir,clock,login:await login(),
      approval:{uid,proofId:id(3),epoch:0,validFrom:95,expiresAt:105},
      registrar:async proof=>{assert.equal(readdirSync(journalDir).length,1);seen.push(proof);},
      repository:{grant:async (handle,{proof})=>{
        assert.equal(proof,seen[0]); assert.equal(proof.session_id,sid); assert.equal(proof.expires_at,105);
        return {grant_id:id(4),status:'active',expires_at:'2026-12-01T00:00:00Z'};
      }}};
    assert.equal((await issueGrant(options)).status,'active');
    await assert.rejects(issueGrant({...options,approval:{...options.approval,proofId:id(8)}}),{code:'FRESH_PASSWORD_LOGIN_REQUIRED'});
    await assert.rejects(issueGrant({...options,login:await login()}),{code:'EEXIST'});
    await assert.rejects(issueGrant({...options,login:await login(),approval:{...options.approval,uid:id(9)}}),{code:'INVALID_INTENT'});
    assert.equal(seen.length,1);
  } finally {rmSync(journalDir,{recursive:true,force:true});}
});
