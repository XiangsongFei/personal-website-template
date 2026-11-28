// Runs real browsers and the built Users Worker against in-memory fixtures only.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {introductionRuntime} from '../fixtures/introduction-rpc.mjs';
import {TEST_PASSWORD} from '../auth-fixture.mjs';
import {assertBudgetHeadroom} from '../../scripts/s47/budget.mjs';
import {runTargeted} from '../../scripts/s47/targeted.mjs';

assert.ok(process.env.S47_PLAYWRIGHT_MODULE,'Set S47_PLAYWRIGHT_MODULE to the local Playwright module');
const limits={textHTTP:180,allSaveEntrances:16,lookups:12,sqlObservation:22,passwordLogins:4,grants:4,nativeSaves:16,workerSaves:16};
const counts={textHTTP:7,allSaveEntrances:0,lookups:4,sqlObservation:11,passwordLogins:0,grants:2,nativeSaves:0,workerSaves:0};
let phase='setup';
const ledger={};
function take(...kinds){
  const allocation={};
  for(const kind of kinds)allocation[kind]=(allocation[kind]??0)+1;
  assertBudgetHeadroom(counts,limits,allocation);
  const stage=ledger[phase]??={};
  for(const [kind,n] of Object.entries(allocation)){counts[kind]+=n;stage[kind]=(stage[kind]??0)+n;}
}
const onRpc=name=>take('textHTTP',
  ...(['save_resume_text','save_text_draft'].includes(name)?['allSaveEntrances','nativeSaves']:[]),
  ...(['read_resume_text_operation','read_introduction_receipt','read_text_publication_operation'].includes(name)?['lookups']:[]));
const socket=createServer().listen(0,'127.0.0.1');
await once(socket,'listening');
const port=socket.address().port;
await new Promise((resolve,reject)=>socket.close(error=>error?reject(error):resolve()));
const origin='https://localhost:'+port;
const passwordReplies=new Map(), browserSessions=[];
const fixture=await introductionRuntime({port,origin,receiptRecovery:true,combinedText:true,
  onRpc,passwordSession:(email,reply)=>{take('passwordLogins');passwordReplies.set(email,reply);}});
const {mf,auth,textFixture}=fixture;
const principal=token=>auth.principal({headers:new Headers({authorization:'Bearer '+token})});
function identity(email,site){
  const response=passwordReplies.get(email);
  assert.ok(response);
  passwordReplies.delete(email);
  const token=response.access_token;
  const {id:uid,sid}=principal(token);
  const scope=createHash('sha256').update(JSON.stringify(['workspace-draft',uid,sid])).digest('hex');
  return {email,password:TEST_PASSWORD,site,token,uid,sid,scope};
}
async function signIn(index){
  const email='user-'+['a','b'][index]+'@example.invalid';
  const response=await mf.dispatchFetch(origin+'/api/account/login',{method:'POST',
    headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password:TEST_PASSWORD})});
  assert.equal(response.status,200);
  return {...identity(email,fixture.siteIds[index]),
    cookie:response.headers.getSetCookie().map(line=>line.split(';',1)[0]).join('; ')};
}
async function rest(name,args,token){
  assert.match(name,/^(read|save)_resume_text$/);
  const response=await textFixture.rpc(new Request('https://users.resume.example.invalid/rpc/'+name,
    {method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(args)}));
  return {status:response.status,value:await response.json()};
}

try{
  await mf.ready;
  const a=await signIn(0), b=await signIn(1);
  const simulated={cases:[]},journal=[];
  let isFrozen=false;
  const result=await runTargeted({
    a,b,origin,mf,rest,witness:simulated,remainingOnly:true,
    phase:name=>{phase=name;console.log('SYNTHETIC PHASE',name);},
    mark:(name,data)=>{simulated.cases.push({name,...data});console.log('SYNTHETIC CHECK',name);},
    take,ensureBudget:(allocation,label)=>assertBudgetHeadroom(counts,limits,allocation,label),
    journal:event=>journal.push({requestId:event.requestId,outcome:event.outcome}),
    freeze:()=>{assert.equal(isFrozen,false);isFrozen=true;},
    resumeAfterProof:()=>{assert.equal(isFrozen,true);isFrozen=false;},
    adoptBrowserSession:owner=>{
      take('grants');
      const actor=identity(owner.email,owner.site);
      browserSessions.push(actor);
      return actor;
    },
    sql:query=>{
      assert.match(query,/business_session_grants[\s\S]*auth\.sessions/);
      for(const actor of [a,b])textFixture.controls.denied.add(actor.uid);
    },
    obs:query=>{
      take('sqlObservation');
      if(query.includes("'revokedGrant'"))return {revokedGrant:true,revokedOwnerSessionValid:true,expiredSession:true,expiredOwnerGrantValid:true};
      if(query.includes("'oldSessionGone'")){
        const [oldSession,newSession]=browserSessions;
        return {oldSessionGone:!principal(oldSession.token),oldRefreshUsable:!!principal(oldSession.token),
          newSessionPresent:principal(newSession.token)?.id===a.uid};
      }
      assert.match(query,/resume_text_revisions[\s\S]*resume_text_receipts/);
      const receipts=[...textFixture.receipts.values()];
      return {rows:receipts.filter(row=>row.value.snapshot.siteId===a.site).map(({value:{snapshot},basis})=>({
        section:snapshot.section,revision:snapshot.revision,content:snapshot.content,hasReceipt:basis===snapshot.revision-1,audited:true,
      })).sort((left,right)=>left.section.localeCompare(right.section)||left.revision-right.revision),
      records:new Set(receipts.flatMap(row=>(row.value.snapshot.content.entries??[]).map(item=>item.id))).size,receipts:receipts.length,
      bob:receipts.filter(row=>row.value.snapshot.siteId===b.site).length,outbox:0};
    },
  });
  assert.deepEqual(result,{gRead:'LOCAL_PASS',gSave:'LOCAL_PASS'});
  assert.equal(isFrozen,false);
  assert.equal(textFixture.writes,4);
  assert.deepEqual(journal.filter(entry=>entry.outcome==='reconciled').map(entry=>entry.requestId).sort(),
    journal.filter(entry=>entry.outcome==='confirmed_reply_held').map(entry=>entry.requestId).sort());
  assert.equal(simulated.cases.some(entry=>/^C2\.[13] /.test(entry.name)),false);
  for(const required of ['C2.2','C2.4','C2.5','C2.6','C2.7 Firefox','C2.7 Playwright WebKit'])
    assert.ok(simulated.cases.some(entry=>entry.name.startsWith(required+' ')),required);
  assert.ok(simulated.cases.some(entry=>entry.name.startsWith('C2.7 native Safari ')));
  console.log('SYNTHETIC COUNTS',JSON.stringify({counts,ledger}));
  console.log('PASS synthetic rehearsal of remaining C2 browser and driver steps');
} finally {await mf.dispose();}
