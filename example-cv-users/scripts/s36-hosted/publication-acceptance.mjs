import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountContext} from '../../lib/business/identity.mjs';
import {exact,uuid} from '../../lib/business/protocol.mjs';
import {configuration,privateFile,publicationProject} from './target.mjs';
import {hostedScope} from './identity.mjs';
import {privateTransport} from './transport.mjs';
import {createSiteService} from './compat/service.mjs';
import {createRpcRepository} from './compat/repository.mjs';
import {textCommand} from './compat/command.mjs';
import {writeOnce} from './r3.mjs';
import {verifyPublicationStage} from './publication-stage.mjs';

const read = path => JSON.parse(privateFile(path));
const digest = text => createHash('sha256').update(text).digest('hex');
const successfulSave = 'save_text_draft';
const publish = 'publish_site';
const withdraw = 'unpublish_site';

export function publicationPlan(fixture, value) {
  const scope = configuration(fixture);
  if (scope.project!==publicationProject) throw new Error('PUBLICATION_PROJECT_MISMATCH');
  exact(value,['project','negativeRequest','publishRequest','draftRequest','withdrawRequest','expiredSession','stageSha256']);
  assert.equal(value.project,scope.project);
  assert.match(value.stageSha256,/^[0-9a-f]{64}$/);
  const ids=[value.negativeRequest,value.publishRequest,value.draftRequest,value.withdrawRequest,scope.requestId];
  assert.ok(ids.every(uuid) && uuid(value.expiredSession));
  assert.equal(new Set(ids).size,ids.length);
  return {...scope,...value,publicationSite:scope.aliceSite};
}

function observe(psql,stage,name,parameters) {
  const params=Object.entries(parameters).flatMap(([k,v])=>['-v',k+'='+v]);
  return JSON.parse(execFileSync(psql,['-X','-w','-qAt','-v','ON_ERROR_STOP=1',...params,'-f',join(stage,name+'.sql')],
    {encoding:'utf8',timeout:25000}));
}

function appended(before, after, key) {
  const existing=new Map(before.map(item=>[key(item),item]));
  const added=after.filter(item=>!existing.has(key(item)));
  assert.deepEqual(after.filter(item=>existing.has(key(item))),before);
  return added;
}

function unchangedBob(config, before, after) {
  const bob = snapshot=>snapshot.sites.find(site=>site.id===config.bobSite);
  assert.deepEqual(bob(after),bob(before));
}

export function transition(config,before,after,operation,input,result,sid) {
  const alice = snapshot=>snapshot.sites.find(site=>site.id===config.aliceSite);
  const oldSite=alice(before), newSite=alice(after);
  const [operations,audits,snapshots,history,outbox]=[
    'operations','audits','snapshots','history','outbox',
  ].map(collection=>appended(before[collection],after[collection],
    item=>collection==='history'?item.site_id+':'+item.publication_revision:item.id));
  assert.equal(result.changed,true);
  assert.deepEqual(newSite.publication,result.publication);
  assert.equal(newSite.draft_revision,result.draft_revision);
  assert.equal(newSite.section_revision,result.draft_revision);
  unchangedBob(config,before,after);
  assert.equal(operations.length,1);
  assert.equal(audits.length,1);
  const [o]=operations,[a]=audits;
  const canonical=JSON.stringify({operation,...input});
  assert.equal(o.canonical_request,canonical);
  assert.equal(o.payload_digest,digest(canonical));
  assert.equal(o.state,'succeeded');
  assert.equal(o.site_id,config.aliceSite);
  assert.equal(o.actor_auth_user_id,config.alice);
  assert.equal(o.actor_session_id,sid);
  assert.equal(o.operation,operation);
  assert.equal(o.request_id,input.request_id);
  assert.equal(o.basis_draft_revision,oldSite.draft_revision);
  assert.equal(o.basis_publication_revision,oldSite.publication.publication_revision);
  assert.deepEqual(o.result,result);
  assert.equal(a.action,operation);
  assert.equal(a.operation_id,o.id);
  assert.equal(a.site_id,config.aliceSite);
  assert.equal(a.actor_auth_user_id,config.alice);
  assert.equal(a.actor_session_id,sid);
  assert.equal(a.draft_revision,result.draft_revision);
  assert.equal(a.publication_revision,result.publication.publication_revision);
  if(operation===successfulSave) {
    assert.deepEqual([snapshots.length,history.length,outbox.length],[0,0,0]);
    assert.equal(newSite.draft_revision,oldSite.draft_revision+1);
    assert.deepEqual(newSite.payload,input.payload);
    assert.equal(newSite.digest,digest(JSON.stringify(input.payload)));
    assert.deepEqual(newSite.publication,oldSite.publication);
    return;
  }
  const version=result.publication.publication_revision;
  const state=operation===publish?'published':'unpublished';
  assert.equal(newSite.draft_revision,oldSite.draft_revision);
  assert.deepEqual(newSite.payload,oldSite.payload);
  assert.equal(newSite.digest,oldSite.digest);
  assert.equal(version,oldSite.publication.publication_revision+1);
  assert.equal(result.publication.state,state);
  assert.equal(result.publication.changed_by,config.alice);
  assert.equal(history.length,1);
  assert.equal(outbox.length,1);
  const [event]=outbox,[change]=history;
  for(const row of [change,event]) {
    assert.equal(row.site_id,config.aliceSite);
    assert.equal(row.operation_id,o.id);
    assert.equal(row.publication_revision,version);
  }
  assert.equal(change.state,state);
  assert.equal(change.previous_revision,version===1?null:version-1);
  assert.equal(change.snapshot_id,result.publication.snapshot_id);
  assert.equal(change.changed_by,config.alice);
  assert.equal(a.created_at,change.changed_at);
  assert.equal(event.created_at,change.changed_at);
  assert.equal(event.event_type,state);
  assert.equal(event.state,'pending');
  assert.equal(event.attempt_count,0);
  assert.equal(event.lease_token,null);
  assert.equal(snapshots.length,operation===publish?1:0);
  if(operation===publish) {
    const [snap]=snapshots;
    assert.equal(snap.site_id,config.aliceSite);
    assert.equal(snap.id,result.publication.snapshot_id);
    assert.equal(snap.published_by,config.alice);
    assert.equal(snap.source_draft_revision,oldSite.draft_revision);
    assert.deepEqual(snap.payload,oldSite.payload);
    assert.equal(snap.digest,oldSite.digest);
    assert.equal(snap.created_at,change.changed_at);
  }
}

async function run(config, credentials, stage, psql, journal) {
  const {ca,cert,key,aliceToken,bobToken,noGrantToken,expiredToken}=exact(credentials,
    ['ca','cert','key','aliceToken','bobToken','noGrantToken','expiredToken']);
  assert.ok([ca,cert,key,aliceToken,bobToken,noGrantToken,expiredToken].every(s=>typeof s==='string' && s.length>0));
  const {binding,identity}=await hostedScope(config);
  const alice=await identity.verifyAccount(aliceToken);
  const bob=await identity.verifyAccount(bobToken);
  const noGrant=await identity.verifyAccount(noGrantToken);
  const a=accountContext(alice), b=accountContext(bob), n=accountContext(noGrant);
  assert.equal(a.uid,config.alice);
  assert.equal(b.uid,config.bob);
  assert.equal(n.uid,config.alice);
  assert.equal(new Set([a.session_id,b.session_id,n.session_id,config.expiredSession]).size,4);
  const old=JSON.parse(Buffer.from(expiredToken.split('.')[1],'base64url').toString('utf8'));
  assert.equal(old.sub,config.alice);
  assert.equal(old.session_id,config.expiredSession);
  assert.ok(Number.isSafeInteger(old.exp) && old.exp<=Math.floor(Date.now()/1000));
  await assert.rejects(()=>identity.verifyAccount(expiredToken),{code:'IDENTITY_REQUIRED',status:401});
  const mtls=privateTransport(config.privateOrigin,{ca,cert,key});
  const repository=createRpcRepository({binding,enabled:true,project:config.project,
    endpoint:config.privateOrigin,identity,mtls});
  const service=createSiteService({repository,publicationSite:config.aliceSite});
  const base={alice_site:config.aliceSite};
  const args={...base,bob_site:config.bobSite,alice_sid:a.session_id,bob_sid:b.session_id,unqualified_sid:n.session_id};
  const receipt=(label,value)=>writeOnce(join(journal,label+'.json'),value);
  const snapshot=label=>{
    const row=observe(psql,stage,'publication-observe',args);
    receipt(label,row);
    assert.equal(row.target,config.project);
    assert.equal(row.ready,true);
    assert.equal(row.missing_grant,true);
    assert.equal(row.sites.length,2);
    assert.deepEqual(row.entitled.map(x=>[x.id,x.uid,x.sid]).sort(),
      [[config.aliceSite,a.uid,a.session_id],[config.bobSite,b.uid,b.session_id]].sort());
    return row;
  };
  const probe=label=>{
    const projection=observe(psql,stage,'publication-public-probe',base);
    receipt(label,projection);
    return projection;
  };
  const absent={status:'not_found',sqlstate:'PT404'};
  const baseline=snapshot('baseline');
  const aliceSite=baseline.sites.find(s=>s.id===config.aliceSite), bobSite=baseline.sites.find(s=>s.id===config.bobSite);
  assert.equal(aliceSite.draft_revision,4);
  assert.equal(bobSite.draft_revision,0);
  for (const site of baseline.sites) {
    assert.equal(site.publication.publication_revision,0);
    assert.equal(site.publication.state,'unpublished');
    assert.equal(site.publication.snapshot_id,null);
  }
  assert.deepEqual([baseline.snapshots.length,baseline.history.length,baseline.outbox.length,baseline.audits.length],[0,0,0,4]);
  const saves=baseline.operations.filter(r=>r.operation===successfulSave);
  assert.deepEqual(saves.map(r=>r.result.draft_revision).sort((x,y)=>x-y),[1,2,3,4]);
  assert.ok(saves.every(r=>r.site_id===config.aliceSite&&r.actor_auth_user_id===config.alice&&r.state==='succeeded'));
  assert.ok(saves.some(r=>r.request_id===config.requestId && r.result.draft_revision===1));
  assert.ok(baseline.operations.every(r=>![config.negativeRequest,config.publishRequest,config.draftRequest,config.withdrawRequest].includes(r.request_id)));
  assert.equal((await service.introduction(alice,config.aliceSite)).draft_revision,4);
  assert.equal((await service.introduction(bob,config.bobSite)).draft_revision,0);
  assert.deepEqual(probe('public-before'),absent);

  const params={schema_version:1,expected_draft_revision:4,expected_publication_revision:0,snapshot_id:null};
  const negative=textCommand(publish,{...params,request_id:config.negativeRequest});
  const raw={target:config.aliceSite,input:negative,canonical_request:JSON.stringify({operation:publish,...negative})};
  receipt('negative-dispatch',{request:raw,expected:[403,403,403,403]});
  try {
    for(const token of [null,expiredToken]) {
      const headers={'Content-Type':'application/json'};
      if(token) headers.Authorization='Bearer '+token;
      const response=await mtls.fetch(config.privateOrigin+'/rpc/'+publish,{method:'POST',redirect:'manual',
        headers,body:JSON.stringify(raw),signal:AbortSignal.timeout(10000)});
      assert.equal(response.status,403);
      assert.deepEqual(await response.json(),{code:'42501'});
    }
    for(const handle of [bob,noGrant])
      await assert.rejects(()=>service.publish(handle,config.aliceSite,negative),{code:'BUSINESS_DENIED',status:403});
  } catch(error) {
    receipt('negative-stop',{requestId:negative.request_id,code:error?.code??error?.name});
    receipt('negative-stop-readback',observe(psql,stage,'publication-observe',args));
    throw error;
  }
  assert.deepEqual(snapshot('negative-no-effects'),baseline);

  async function write(label,operation,values,mutate) {
    const input=textCommand(operation,values);
    const reconcile=operation===successfulSave
      ? ()=>service.readTextDraftOperation(alice,config.aliceSite,input)
      : ()=>service.readPublicationOperation(operation,alice,config.aliceSite,input);
    receipt(label+'-dispatch',{operation,input,actor:a.uid,session:a.session_id,site:config.aliceSite});
    let result;
    try {result=await mutate(alice,config.aliceSite,input);}
    catch(error) {
      receipt(label+'-client-error',{requestId:input.request_id,code:error?.code??error?.name});
      try {
        if(error?.code==='COMMIT_UNKNOWN') receipt(label+'-unknown-reconcile',await reconcile());
      } finally {
        receipt(label+'-stop-readback',observe(psql,stage,'publication-observe',args));
      }
      throw error;
    }
    receipt(label+'-response',result);
    assert.deepEqual(await reconcile(),{status:'succeeded',result});
    return {input,result};
  }

  const p=await write('publish',publish,{...params,request_id:config.publishRequest},service.publish);
  const published=snapshot('published');
  transition(config,baseline,published,publish,p.input,p.result,a.session_id);
  const publicView=probe('public-after-publish');
  assert.deepEqual(Object.keys(publicView).sort(),['entries','hostname','locale','publication_revision','schema_version']);
  assert.equal(publicView.schema_version,1);
  assert.equal(publicView.locale,'en');
  assert.equal(publicView.publication_revision,1);
  assert.match(publicView.hostname,/^[a-z][a-z0-9-]{1,46}[a-z0-9]\.sites\.example\.test$/);
  assert.deepEqual(publicView.entries,aliceSite.payload.entries.filter(e=>Object.hasOwn(e.translations,'en'))
    .map(e=>({position:e.position,text:e.translations.en})));

  const d=await write('draft',successfulSave,{schema_version:1,request_id:config.draftRequest,expected_draft_revision:4,
    payload:{schema_version:1,entries:[{id:config.entry,position:0,
      translations:{zh:'S3.6 合成未发布草稿 '+config.draftRequest,en:'S3.6 synthetic unpublished draft '+config.draftRequest}}]}},
    service.saveTextDraft);
  const draft=snapshot('draft-after-publish');
  transition(config,published,draft,successfulSave,d.input,d.result,a.session_id);
  assert.deepEqual(probe('public-after-draft'),publicView);

  const u=await write('withdraw',withdraw,{schema_version:1,request_id:config.withdrawRequest,
    expected_publication_revision:1},service.unpublish);
  const withdrawn=snapshot('withdrawn');
  transition(config,draft,withdrawn,withdraw,u.input,u.result,a.session_id);
  assert.deepEqual(probe('public-after-withdraw'),absent);
  const outbox=observe(psql,stage,'publication-outbox-probe',base);
  assert.deepEqual(outbox,{kind:'rollback_probe',superseded:true,duplicate_dispatch_denied:true,
    retry_after_known_failure:true,unknown_not_retried:true,external_sends:0});
  receipt('outbox-rollback-probe',outbox);
  assert.deepEqual(snapshot('after-rollback-probes'),withdrawn);
  receipt('publication-result',{status:'OBSERVATIONS_PASS_ACL_CLOSE_PENDING',publicationRevision:2,
    draftRevision:5,externalSends:0});
}

async function main() {
  const [mode,fixture,plan,credentials,stage,psql,journal]=process.argv.slice(2);
  if(mode==='--check'&&process.argv.length===5) {
    const config=publicationPlan(read(fixture),read(plan));
    console.log(JSON.stringify({status:'PUBLICATION_PLAN_LOCAL_OK',project:config.project}));
    return;
  }
  if(mode!=='--execute-approved'||process.argv.length!==9||!isAbsolute(stage)||!isAbsolute(psql)||!isAbsolute(journal))
    throw new Error('Usage: publication-acceptance.mjs --check <fixture> <plan> | --execute-approved <fixture> <plan> <credentials> <absolute-approved-stage> <absolute-psql> <absolute-journal-directory>');
  const config=publicationPlan(read(fixture),read(plan));
  verifyPublicationStage(stage,config.stageSha256);
  await run(config,read(credentials),stage,psql,journal);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error?.code??'HOSTED_PUBLICATION_STOP');process.exitCode=1;});
