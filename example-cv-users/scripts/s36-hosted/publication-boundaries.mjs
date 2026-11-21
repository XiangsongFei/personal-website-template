import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountContext,withCredential} from '../../lib/business/identity.mjs';
import {exact,uuid} from '../../lib/business/protocol.mjs';
import {createRpcRepository} from './compat/repository.mjs';
import {createSiteService} from './compat/service.mjs';
import {textCommand} from './compat/command.mjs';
import {createRegistrar} from './database.mjs';
import {hostedScope} from './identity.mjs';
import {generation,issueGrant,writeOnce} from './r3.mjs';
import {configuration,connectionScope,privateFile,publicationProject} from './target.mjs';
import {privateTransport} from './transport.mjs';
import {transition} from './publication-acceptance.mjs';

const read=path=>JSON.parse(privateFile(path));
const sha=text=>createHash('sha256').update(text).digest('hex');
const pub='publish_site', unpub='unpublish_site';
const arrays=['sites','operations','audits','snapshots','history','outbox','domains','members','drafts'];
const requestLabels=['draftCas','publicationCas','racingA','racingB','sameSnapshot','oldSnapshot','withdraw','repeatWithdraw','cleanupAt3','cleanupAt4'];
const conflict={code:'REQUEST_CONFLICT',status:409};
const denied={code:'BUSINESS_DENIED',status:403};

export function boundaryPlan(fixture,plan,baseline) {
  exact(plan,['project','requests','replays','oldSnapshot','alice','bob','aliceSite','bobSite','proofs']);
  assert.equal(plan.project,publicationProject);
  for(const key of ['alice','bob','aliceSite','bobSite']) assert.equal(plan[key],fixture[key]);
  exact(plan.requests,requestLabels);
  exact(plan.proofs,['alice','bob','generationProbe']);
  exact(plan.replays,['publish','withdraw']);
  const fresh=[...Object.values(plan.requests),...Object.values(plan.proofs)];
  assert.ok(fresh.every(uuid) && new Set(fresh).size===fresh.length);
  assert.ok(baseline.operations.every(row=>!fresh.includes(row.request_id)));
  for(const [name,operation,version] of [['publish',pub,1],['withdraw',unpub,2]]) {
    const input=textCommand(operation,plan.replays[name]);
    const original=baseline.operations.find(row=>row.request_id===input.request_id&&row.operation===operation
      &&row.site_id===fixture.aliceSite&&row.actor_auth_user_id===fixture.alice);
    const canonical=JSON.stringify({operation,...input});
    assert.equal(original?.canonical_request,canonical);
    assert.equal(original.payload_digest,sha(canonical));
    assert.equal(original.result.publication.publication_revision,version);
  }
  assert.equal(baseline.snapshots.length,1);
  assert.equal(baseline.snapshots[0].id,plan.oldSnapshot);
  assert.equal(baseline.snapshots[0].source_draft_revision,4);
  assert.equal(baseline.snapshots[0].site_id,fixture.aliceSite);
  return plan;
}

export function publicationNoop(site,before,after,operation,input,result,actor) {
  const original=before.sites.find(row=>row.id===site);
  assert.equal(result.changed,false);
  assert.equal(result.draft_revision,original.draft_revision);
  assert.deepEqual(result.publication,original.publication);
  for(const key of arrays.filter(name=>name!=='operations')) assert.deepEqual(after[key],before[key],key);
  const oldIds=new Set(before.operations.map(o=>o.id));
  assert.deepEqual(after.operations.filter(o=>oldIds.has(o.id)),before.operations);
  const added=after.operations.filter(o=>!oldIds.has(o.id));
  assert.equal(added.length,1);
  const [row]=added;
  const canonical=JSON.stringify({operation,...input});
  assert.equal(row.operation,operation);
  assert.equal(row.site_id,site);
  assert.equal(row.state,'succeeded');
  assert.equal(row.actor_auth_user_id,actor.uid);
  assert.equal(row.actor_session_id,actor.session_id);
  assert.equal(row.request_id,input.request_id);
  assert.equal(row.basis_draft_revision,original.draft_revision);
  assert.equal(row.basis_publication_revision,original.publication.publication_revision);
  assert.equal(row.canonical_request,canonical);
  assert.equal(row.payload_digest,sha(canonical));
  assert.deepEqual(row.result,result);
}

function publicationInput(request,version,draft=5,snapshot=null) {
  return textCommand(pub,{schema_version:1,request_id:request,expected_draft_revision:draft,
    expected_publication_revision:version,snapshot_id:snapshot});
}
const withdrawInput=(request,version)=>textCommand(unpub,{schema_version:1,request_id:request,expected_publication_revision:version});

function baseState(snapshot,fixture) {
  assert.equal(snapshot.target,publicationProject);
  assert.deepEqual(snapshot.acl,[false,false]);
  assert.equal(snapshot.site_total,2);
  assert.equal(snapshot.user_total,2);
  assert.deepEqual(['operations','audits','snapshots','history','outbox'].map(k=>snapshot[k].length),[9,7,1,2,2]);
  for(const [site,owner,draft,revision] of [[fixture.aliceSite,fixture.alice,5,2],[fixture.bobSite,fixture.bob,0,0]]) {
    const row=snapshot.sites.find(s=>s.id===site);
    assert.deepEqual([row?.uid,row?.draft_revision,row?.section_revision,row?.publication.publication_revision,
      row?.publication.state,row?.publication.snapshot_id],[owner,draft,draft,revision,'unpublished',null]);
  }
}

async function run(dir,psql) {
  const stage=join(dir,'stage'), privateDir=join(dir,'private'), journal=join(dir,'journal');
  const record=(name,value)=>writeOnce(join(journal,name+'.json'),value);
  const fixture=configuration(read(join(privateDir,'fixture.json')));
  assert.equal(fixture.project,publicationProject);
  const {aliceSite,bobSite}=fixture;
  const vars={alice_site:aliceSite,bob_site:bobSite};
  function sql(label,file,parameters={},write=false,json=true) {
    const result=spawnSync(psql,['-X','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',write?'-At':'-qAt',
      ...Object.entries(parameters).flatMap(([k,v])=>['-v',k+'='+v]),'-f',join(stage,file+'.sql')],
      {encoding:'utf8',timeout:23000,maxBuffer:512*1024});
    const committed=write&&result.status===0&&result.stdout.trimEnd().endsWith('\nCOMMIT');
    record(label+'-sql',{code:result.status,committed,sqlstates:[...(result.stderr??'').matchAll(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/g)].map(x=>x[1])});
    if (result.status!==0 || (write&&!committed)) throw new Error(label+'-sql');
    return !write&&json ? JSON.parse(result.stdout.trim()) : undefined;
  }
  function observe(name) {
    const row=sql(name,'publication-boundaries-observe',vars);
    record(name,row);
    return row;
  }
  const baseline=observe('baseline');
  baseState(baseline,fixture);
  const previous=read(join(privateDir,'previous-business.json'));
  for(const [name,value] of Object.entries(previous)) assert.deepEqual(baseline[name],value);
  const plan=boundaryPlan(fixture,read(join(privateDir,'boundary-plan.json')),baseline);
  assert.deepEqual(sql('closed-before','publication-catalog',{expected_02:true}),{project:publicationProject,closed_02_check:true});
  assert.ok(Object.values(sql('fault-clean-before','save-fault-status')).every(v=>v===true));
  const scope=connectionScope({...fixture,publicationSite:aliceSite});
  const {binding,identity}=await hostedScope(scope);
  const {Client}=await import('pg');
  const registrar=createRegistrar(scope.project,read(join(privateDir,'registrar-database.json')),Client);
  const repository=createRpcRepository({binding,enabled:true,project:scope.project,endpoint:scope.privateOrigin,identity,
    mtls:privateTransport(scope.privateOrigin,read(join(privateDir,'mtls-client.json')))});
  const service=createSiteService({repository,publicationSite:aliceSite});
  const credentials=read(join(privateDir,'account-material.json'));
  const actors={};

  async function newGeneration(single) {
    const time=Math.floor(Date.now()/1000);
    const id='s36-boundaries-'+(single?'single-':'shared-')+randomBytes(6).toString('hex');
    const key=await generation(scope.project,{project:scope.project,id,keyHex:randomBytes(32).toString('hex'),
      notBefore:time-5,signUntil:time+1500,verifyUntil:time+1700});
    record(id+'-dispatch',{id,alice:fixture.alice,bob:fixture.bob,signUntil:key.signUntil});
    sql(id,'publication-generation',{key_id:id,alice_uid:fixture.alice,bob_uid:fixture.bob,not_before:key.notBefore,
      sign_until:key.signUntil,verify_until:key.verifyUntil},true);
    return key;
  }
  async function prepareActor(label,name,key) {
    record(label+'-login-dispatch',{uid:fixture[name]});
    const login=await identity.passwordLogin(credentials[name]);
    const who=accountContext(login.handle);
    assert.equal(who.uid,fixture[name]);
    record(label+'-session',who);
    const grant=await issueGrant({binding,identity,login,key,registrar,repository,journalDir:journal,
      approval:{uid:who.uid,proofId:plan.proofs[label],epoch:0,validFrom:key.notBefore,expiresAt:key.verifyUntil}});
    const actor={...who,handle:login.handle,token:withCredential(login.handle,value=>value),site:fixture[name+'Site'],
      bound:{uid:who.uid,sid:who.session_id,grant_id:grant.grant_id,key_id:key.id,site:fixture[name+'Site']}};
    record(label+'-grant',grant);
    actors[label]=actor;
    return actor;
  }
  const activeKey=await newGeneration(false);
  const alice=await prepareActor('alice','alice',activeKey);
  const bob=await prepareActor('bob','bob',activeKey);
  const otherAlice=await prepareActor('generationProbe','alice',await newGeneration(true));
  assert.equal(new Set(Object.values(actors).map(a=>a.session_id)).size,3);
  const act=(operation,handle,input)=>service[operation===pub?'publish':'unpublish'](handle,aliceSite,input);
  const reconcile=(operation,input)=>service.readPublicationOperation(operation,alice.handle,aliceSite,input);
  const subject=(label,actor)=>sql(label,'publication-boundaries-subject',actor.bound);
  const aliceRow=s=>s.sites.find(r=>r.id===aliceSite);
  let aclAttempted=false, unknown=false, known=baseline, normalWithdrawSent=false;
  const req=plan.requests;

  async function transmit(label,operation,input,actor=alice) {
    record(label+'-dispatch',{operation,input,uid:actor.uid,sid:actor.session_id,site:aliceSite});
    try {
      const result=await act(operation,actor.handle,input);
      record(label+'-response',result);
      return result;
    } catch(error) {
      record(label+'-rejection',{code:error?.code??null,status:error?.status??null});
      if (![403,409].includes(error?.status)) {
        unknown=true;
        try { record(label+'-same-key',await reconcile(operation,input)); }
        catch { record(label+'-same-key-unresolved',{request_id:input.request_id}); }
      }
      throw error;
    }
  }
  async function assertWrite(label,before,operation,input,{noop=false}={}) {
    const result=await transmit(label,operation,input);
    assert.deepEqual(await reconcile(operation,input),{status:'succeeded',result});
    const after=observe(label+'-readback');
    if(noop) publicationNoop(aliceSite,before,after,operation,input,result,alice);
    else transition(fixture,before,after,operation,input,result,alice.session_id);
    for(const name of ['domains','members','drafts','acl','site_total','user_total']) assert.deepEqual(after[name],before[name]);
    known=after;
    return result;
  }
  const own=(actor)=>service.introduction(actor.handle,actor.site);
  const authLive=async actor=>assert.deepEqual(accountContext(await identity.verifyAccount(actor.token)),
    {uid:actor.uid,session_id:actor.session_id});
  function healthy(row,actor) {
    assert.equal(row.uid,actor.uid);
    assert.equal(row.sid,actor.session_id);
    assert.equal(row.grant,actor.bound.grant_id);
    for(const k of ['session','enabled','grant_unexpired','mirror','read_execute']) assert.equal(row[k],true,k);
    for(const k of ['hold','grant_revoked','generation_revoked']) assert.equal(row[k],false,k);
    assert.deepEqual([row.epoch,row.grant_epoch,row.hold_reason,row.site_status,row.site_deleted_at],[0,0,'none','active',null]);
  }
  async function readyForDenial(label,actor) {
    assert.equal((await own(actor)).draft_revision,actor.uid===alice.uid?5:0);
    const before=subject(label+'-before',actor);
    healthy(before,actor);
    record(label+'-before',before);
    return before;
  }
  function change(label,actor,mode) {
    record(label+'-dispatch',{...actor.bound,mode});
    sql(label,'publication-boundaries-qualification',{...actor.bound,mode},true);
  }
  async function temporary(label,mode,restore,delta) {
    const before=await readyForDenial(label,alice);
    try {
      change(label,alice,mode);
      const after=subject(label+'-invalid',alice);
      assert.deepEqual(mode==='disable_site'?{...after,site_deleted_at:null}:after,{...before,...delta});
      if (mode==='disable_site') assert.ok(Number.isFinite(Date.parse(after.site_deleted_at)));
      await authLive(alice);
      await assert.rejects(()=>own(alice),denied);
      record(label+'-denied',{status:403,...after});
    } finally {
      const actual=subject(label+'-pre-restore',alice);
      if(actual.hold===true&&actual.hold_reason==='administrative'&&mode==='hold' ||
         actual.site_status==='deleted'&&mode==='disable_site') change(label+'-restore',alice,restore);
      assert.deepEqual(subject(label+'-restored',alice),before);
    }
    assert.equal((await own(alice)).draft_revision,5);
    record(label+'-restoration-pass',{status:200});
  }
  async function permanent(label,actor,mode,delta) {
    const before=await readyForDenial(label,actor);
    change(label,actor,mode);
    const after=subject(label+'-invalid',actor);
    assert.deepEqual(after,{...before,...delta});
    await authLive(actor);
    await assert.rejects(()=>own(actor),denied);
    assert.equal((await own(alice)).draft_revision,5);
    record(label+'-denied',{status:403,...after});
  }
  let aliceExpiry;
  try {
    aclAttempted=true;
    record('acl-enable-dispatch',{...vars});
    sql('acl-enable','publication-boundaries-acl',{...vars,action:'enable'},true);
    known=observe('acl-open');
    assert.deepEqual(known,{...baseline,acl:[true,true]});
    assert.equal((await own(alice)).draft_revision,5);
    assert.equal((await own(bob)).draft_revision,0);
    for(const [name,operation] of [['publish',pub],['withdraw',unpub]]) {
      const input=plan.replays[name];
      const original=baseline.operations.find(o=>o.request_id===input.request_id&&o.operation===operation);
      assert.deepEqual(await transmit('historical-'+name,operation,input),original.result);
      assert.deepEqual(await reconcile(operation,input),{status:'succeeded',result:original.result});
      await assert.rejects(()=>transmit('conflicting-'+name,operation,
        textCommand(operation,{...input,expected_publication_revision:2})),conflict);
    }
    await assert.rejects(()=>transmit('unauthorized-historical-replay',pub,plan.replays.publish,bob),denied);
    await assert.rejects(()=>transmit('stale-draft-only',pub,publicationInput(req.draftCas,2,4)),conflict);
    await assert.rejects(()=>transmit('stale-publication-only',pub,publicationInput(req.publicationCas,1)),conflict);
    assert.deepEqual(observe('after-negative-replays-and-cas'),known);
    const race=[publicationInput(req.racingA,2),publicationInput(req.racingB,2)];
    const pair=await Promise.allSettled(race.map((input,index)=>transmit('distinct-race-'+index,pub,input)));
    const winner=pair.findIndex(x=>x.status==='fulfilled');
    assert.notEqual(winner,-1);
    assert.equal(pair[1-winner].status,'rejected');
    assert.equal(pair[1-winner].reason?.code,'REQUEST_CONFLICT');
    assert.equal(pair[1-winner].reason?.status,409);
    const won=pair[winner].value;
    assert.deepEqual(await reconcile(pub,race[winner]),{status:'succeeded',result:won});
    const published=observe('after-distinct-race');
    transition(fixture,known,published,pub,race[winner],won,alice.session_id);
    assert.ok(published.operations.every(o=>o.request_id!==race[1-winner].request_id));
    known=published;

    const same=publicationInput(req.sameSnapshot,3,5,won.publication.snapshot_id);
    const twice=await Promise.allSettled([transmit('same-key-race-0',pub,same),transmit('same-key-race-1',pub,same)]);
    assert.ok(twice.every(item=>item.status==='fulfilled'));
    assert.deepEqual(twice[0].value,twice[1].value);
    assert.deepEqual(await reconcile(pub,same),{status:'succeeded',result:twice[0].value});
    const afterNoop=observe('after-same-key-race');
    publicationNoop(aliceSite,known,afterNoop,pub,same,twice[0].value,alice);
    known=afterNoop;
    await assertWrite('old-snapshot',known,pub,publicationInput(req.oldSnapshot,3,5,plan.oldSnapshot));
    const projection=sql('anonymous-boundary','publication-boundaries-public',{...vars,old_snapshot:plan.oldSnapshot});
    assert.equal(projection.role,'anon');
    assert.equal(projection.projection.publication_revision,4);
    const old=known.snapshots.find(s=>s.id===plan.oldSnapshot);
    assert.deepEqual(projection.projection.entries,old.payload.entries.filter(e=>Object.hasOwn(e.translations,'en'))
      .map(e=>({position:e.position,text:e.translations.en})));
    assert.equal(projection.positive_restored,true);
    assert.equal(projection.committed_fixture,false);
    assert.deepEqual(projection.denied,['bob_host_unpublished','unbound_host','bad_locale','domain_disabled','site_deleted','owner_mirror_missing']);
    record('anonymous-boundary',projection);
    assert.deepEqual(observe('public-fixtures-rolled-back'),known);

    normalWithdrawSent=true;
    await assertWrite('withdraw',known,unpub,withdrawInput(req.withdraw,4));
    await assertWrite('repeat-withdraw',known,unpub,withdrawInput(req.repeatWithdraw,5),{noop:true});
    assert.deepEqual(['operations','audits','snapshots','history','outbox'].map(k=>known[k].length),[14,10,2,5,5]);
    assert.equal(aliceRow(known).publication.state,'unpublished');

    await temporary('security-hold','hold','release',{hold:true,hold_reason:'administrative'});
    await temporary('site-status','disable_site','restore_site',{site_status:'deleted'});
    await permanent('generation-revoke',otherAlice,'revoke_generation',{generation_revoked:true});
    await permanent('epoch-advance',bob,'advance_epoch',{epoch:1});
    aliceExpiry=await readyForDenial('natural-grant-expiry',alice);
    assert.deepEqual(observe('post-qualification-business'),known);
    record('publication-and-boundaries-pass',{drafts:[5,0],publications:[5,0],history:5,events:5});
  } finally {
    if(aclAttempted) {
      try {
        const latest=observe('safe-close-readback');
        const revision=aliceRow(latest).publication.publication_revision;
        if(!unknown && !normalWithdrawSent && [3,4].includes(revision) &&
           aliceRow(latest).publication.state==='published' && JSON.stringify(latest)===JSON.stringify(known))
          await assertWrite('authorized-fallback-withdrawal',latest,unpub,withdrawInput(req['cleanupAt'+revision],revision));
      } finally {
        const acl=observe('acl-before-close').acl;
        if(acl.some(Boolean)) {
          record('acl-close-dispatch',{...vars});
          sql('acl-close','publication-boundaries-acl',{...vars,action:'close'},true);
        }
        assert.deepEqual(sql('acl-independently-closed','publication-catalog',{expected_02:true}),
          {project:publicationProject,closed_02_check:true});
      }
    }
  }
  const closed=observe('final-business');
  assert.deepEqual(closed,{...known,acl:[false,false]});
  assert.equal((await own(alice)).draft_revision,5);
  assert.deepEqual(subject('natural-expiry-read-control',alice),aliceExpiry);
  const {exp,session_id}=JSON.parse(Buffer.from(alice.token.split('.')[1],'base64url'));
  assert.equal(session_id,alice.session_id);
  assert.ok(exp*1000>aliceExpiry.expires+60000);
  const wait=Math.max(0,aliceExpiry.expires-Date.now()+1250);
  assert.ok(wait<=1810000);
  record('natural-grant-expiry-window',{sid:session_id,expires:aliceExpiry.expires,readRpcEnabled:true});
  await sleep(wait);
  const expired=subject('natural-grant-expired',alice);
  assert.deepEqual(expired,{...aliceExpiry,grant_unexpired:false});
  await authLive(alice);
  await assert.rejects(()=>own(alice),denied);
  assert.deepEqual(observe('after-natural-expiry'),closed);
  record('natural-grant-expiry-denied',{status:403,...expired});
  console.log(JSON.stringify({status:'PUBLICATION_BOUNDARIES_REAL_PASS',publicationRevision:5,naturalGrantExpiry:'PASS'}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [mode,dir,psql]=process.argv.slice(2);
  if(mode!=='--execute-approved'||!isAbsolute(dir)||!isAbsolute(psql)) throw new Error('HOSTED_BOUNDARIES_ARGUMENTS');
  run(dir,psql).catch(error=>{
    console.error(error?.code??(error?.message?.match(/^[a-z0-9-]+-sql$/)?.[0])??'HOSTED_BOUNDARIES_STOP');
    process.exitCode=1;
  });
}
