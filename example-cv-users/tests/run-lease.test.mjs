import test from 'node:test';import assert from 'node:assert/strict';
import {runtimeBindings,applicationPreflight} from '../scripts/controlled-runtime.mjs';
import {runtime} from './runtime.mjs';import {TEST_KEY,TEST_PASSWORD} from './auth-fixture.mjs';
import {bindings,ORIGIN} from '../scripts/controlled-real.mjs';
const batch=()=>({id:'S2-USERS-REAL-LEASE-ISOLATED-TEST',executionBuild:'a'.repeat(64),expiresAt:Date.now()+12*3600000,currentPasswordPolicy:'ON'});
test('actual Worker configuration and login API accept the launcher 30 minute binding',async()=>{
 const b=batch(),expiresAt=Date.now()+30*60000;const result=await applicationPreflight({batch:b,expiresAt});assert.equal(result.configurationAccepted,true);assert.equal(result.syntheticLoginStatus,200);assert.equal(result.protectedStatus,200);assert.equal(result.syntheticLogoutStatus,200);assert.equal(result.realUpstreamCalls,0);
});
test('launcher rejects leases above 30 minutes; unchanged application independently rejects above 40',async()=>{
 const b=batch();assert.throws(()=>runtimeBindings(b,TEST_KEY,Date.now()+41*60000),/run_lease_duration_denied/);
 let hits=0;const mf=runtime({bindings:{...bindings(b,TEST_KEY),USERS_CONTROLLED_EXPIRES_AT:String(Date.now()+41*60000)},serviceBindings:{USERS_CONTROLLED_EGRESS:()=>{hits++;throw Error('must_not_send');}},outboundService:()=>{throw Error('external_network_denied');}});
 try{const r=await mf.dispatchFetch(ORIGIN+'/api/account/login',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({email:'user-a@example.invalid',password:TEST_PASSWORD})});await r.arrayBuffer();assert.equal(r.status,503);assert.equal(hits,0);}finally{await mf.dispose();}
});
