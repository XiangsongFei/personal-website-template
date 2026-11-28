import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {introductionRuntime} from '../fixtures/introduction-rpc.mjs';
import {TEST_PASSWORD} from '../auth-fixture.mjs';
import {nativeSafari,openDelegatedBrowser,runDelegated} from '../../scripts/s47/delegated.mjs';

const listener=createServer().listen(0,'127.0.0.1');
await once(listener,'listening');
const {port}=listener.address();
await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
const origin='https://localhost:'+port;
let logins=0;
const counts={};
function take(...kinds){
  for(const key of kinds)counts[key]=(counts[key]??0)+1;
}
const fixture=await introductionRuntime({port,origin,receiptRecovery:true,combinedText:true,onRpc:()=>take('textHTTP'),
  passwordSession:()=>{logins++;}});
await fixture.mf.ready;
const stageDir=mkdtempSync(join(tmpdir(),'s47-browser-rehearsal-'));
let session;
try{
  const witness={};
  session=await openDelegatedBrowser({origin,stageDir,take,witness,checkBudget:()=>assert.ok((counts.textHTTP??0)<320)});
  const [a,b]=['a','b'].map((name,index)=>({name,email:'user-'+name+'@example.invalid',password:TEST_PASSWORD,site:fixture.siteIds[index]}));
  await session.signIn(b);
  await session.signOut();
  await session.signIn(a);
  const outcome=await runDelegated({browser:session,a,b,origin,phase:name=>console.log(name),mark:name=>console.log('PASS',name),
    adoptBrowserSession:owner=>owner,observe(){},verifyLogout(){},bobIntroduction:'合成乙',
    runSafari:process.env.S47_SAFARI_DRIVER?(owner,cookies)=>nativeSafari({origin,browser:session,owner,cookies,take,
      checkBudget:count=>assert.ok((counts.textHTTP??0)+count<320),driver:process.env.S47_SAFARI_DRIVER,
      mark:name=>console.log('PASS (synthetic)',name)}):()=>{}});
  assert.deepEqual(outcome,{gRead:'LOCAL_PASS',gSave:'LOCAL_PASS'});
  assert.equal(counts.workerSaves,process.env.S47_SAFARI_DRIVER?16:15);
  assert.equal(logins,4);
  console.log('Synthetic Chrome walkthrough',JSON.stringify({counts,logins,screenshots:witness.browser.screenshots.length}));
} catch(error){
  console.log('Synthetic counts before failure',JSON.stringify({counts,logins}));
  throw error;
} finally {
  await session?.close();
  await fixture.mf.dispose();
  rmSync(stageDir,{recursive:true,force:true});
}
