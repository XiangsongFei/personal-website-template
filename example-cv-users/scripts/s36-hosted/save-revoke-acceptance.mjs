import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountContext,withCredential} from '../../lib/business/identity.mjs';
import {exact,uuid} from '../../lib/business/protocol.mjs';
import {createRpcRepository} from './compat/repository.mjs';
import {createSiteService} from './compat/service.mjs';
import {createRegistrar} from './database.mjs';
import {hostedScope} from './identity.mjs';
import {generation,issueGrant,revokeGrant,writeOnce} from './r3.mjs';
import {bindSaveFault,faultCommand} from './save-fault.mjs';
import {configuration,connectionScope,privateFile,publicationProject} from './target.mjs';
import {privateTransport} from './transport.mjs';

const read=path=>JSON.parse(privateFile(path));
const now=()=>Math.floor(Date.now()/1000);
const noSession='00000000-0000-0000-0000-000000000000';
const faultPresence=['function_absent','triggers_absent','deployment_edges_clear','create_revoked','publish_closed'];

export function assertBaseline(value,fixture) {
  assert.equal(value.users,2);
  assert.equal(value.catalog_closed,true);
  assert.equal(value.request_rows,0);
  assert.equal(value.pending_unattempted,2);
  assert.equal(value.site_facts.length,2);
  assert.equal(value.effects.sites.count,2);
  for (const [name,count] of Object.entries({text_audit:7,publication_history:2,snapshot:1,outbox:2}))
    assert.equal(value.effects[name].count,count);
  for (const [name,version] of [['alice',[5,2]],['bob',[0,0]]]) {
    const row=value.site_facts.find(item=>item.id===fixture[name+'Site']);
    assert.equal(row?.owner_auth_user_id,fixture[name]);
    assert.deepEqual([row.draft_revision,row.publication_revision,row.state,row.snapshot_id],[...version,'unpublished',null]);
  }
}

export async function scopedSignOut(scope,token,fetcher=fetch) {
  assert.equal(scope.project,publicationProject);
  const response=await fetcher('https://'+publicationProject+'.supabase.co/auth/v1/logout?scope=local',{
    method:'POST',redirect:'error',headers:{apikey:scope.publishableKey,Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(8000)});
  assert.equal(response.status,204,'SCOPED_AUTH_SIGN_OUT_UNCONFIRMED');
}

function sameEffects(current,baseline) {
  for (const key of ['site_facts','catalog_closed','users','effects','request_rows','pending_unattempted'])
    assert.deepEqual(current[key],baseline[key],key);
}

function assertActive(subject,grantId) {
  assert.equal(subject.grant_id,grantId);
  for (const key of ['auth_row_present','auth_live','unexpired_grant','generation_matches','same_eligible_epoch','active_owner'])
    assert.equal(subject[key],true,key);
  assert.equal(subject.revoked,false);
}

function unexpired(token,sid) {
  const c=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  assert.equal(c.session_id,sid);
  assert.ok(Number.isSafeInteger(c.exp) && c.exp>now()+20);
  return c.exp;
}

function sqlRunner(psql,stage,log) {
  return (label,name,vars={},commit=false)=>{
    const result=spawnSync(psql,['-X','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',commit?'-At':'-qAt','-f',join(stage,name),...Object.entries(vars).flatMap(([k,v])=>['-v',k+'='+v])],
      {encoding:'utf8',timeout:23000,maxBuffer:256*1024});
    const committed=commit&&result.status===0&&result.stdout.trimEnd().endsWith('\nCOMMIT');
    log(label,{exitCode:result.status,commit:committed,error:result.error?.code??null,
      sqlstates:[...(result.stderr??'').matchAll(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/g)].map(x=>x[1])});
    if (result.status!==0 || (commit&&!committed)) throw new Error(label);
    if (commit) return;
    return JSON.parse(result.stdout.trim());
  };
}

async function main() {
  const [flag,run,psql]=process.argv.slice(2);
  assert.ok(['--readonly-baseline','--execute-approved'].includes(flag) && isAbsolute(run) && isAbsolute(psql));
  const stage=join(run,'stage'), workspace=join(run,'private'), journal=join(run,'journal');
  const log=(name,value)=>writeOnce(join(journal,name+'.json'),value);
  const fixture=configuration(read(join(workspace,'fixture.json')));
  assert.equal(fixture.project,publicationProject);
  const plan=exact(read(join(workspace,'save-revoke-plan.json')),
    ['project','generation','accounts','requestId','revokeProof','priorRequestIds']);
  const {accounts,requestId,revokeProof,priorRequestIds}=plan;
  assert.equal(plan.project,fixture.project);
  exact(accounts,['alice','bob']);
  for (const name of ['alice','bob']) {
    exact(accounts[name],['uid','proofId']);
    assert.equal(accounts[name].uid,fixture[name]);
  }
  assert.ok(Array.isArray(priorRequestIds) && priorRequestIds.length>0);
  const identifiers=[requestId,revokeProof,accounts.alice.proofId,accounts.bob.proofId,...priorRequestIds];
  assert.ok(identifiers.every(uuid) && new Set(identifiers).size===identifiers.length);
  const sql=sqlRunner(psql,stage,log);
  const vars={alice_site:fixture.aliceSite,bob_site:fixture.bobSite,alice_uid:fixture.alice,bob_uid:fixture.bob,
    alice_sid:noSession,bob_sid:noSession,request_id:requestId,key_id:plan.generation.id,revoke_proof:revokeProof};
  const observe=label=>sql(label,'save-revoke-observe.sql',vars);
  function absent(label) {
    const state=sql(label,'save-fault-status.sql');
    assert.deepEqual(state,Object.fromEntries(faultPresence.map(k=>[k,true])));
    log(label+'-verified',state);
  }
  if (flag==='--readonly-baseline') {
    absent('initial-fault-catalog');
    const baseline=observe('initial-baseline');
    assertBaseline(baseline,fixture);
    assert.equal(baseline.generation_live,false);
    assert.equal(baseline.revoke_proof_consumed,false);
    log('baseline',baseline);
    return;
  }

  assert.ok(existsSync(join(run,'local-ready.json')) && !existsSync(join(run,'local-services-exit.json')));
  const baseline=observe('dispatch-baseline');
  sameEffects(baseline,read(join(journal,'baseline.json')));
  assert.equal(baseline.generation_live,false);
  const scope=connectionScope({...fixture,publicationSite:fixture.aliceSite});
  const {binding,identity}=await hostedScope(scope);
  const tls=read(join(workspace,'mtls-client.json'));
  const mtls=privateTransport(scope.privateOrigin,tls);
  const repository=createRpcRepository({binding,enabled:true,project:scope.project,endpoint:scope.privateOrigin,identity,mtls});
  const service=createSiteService({repository,publicationSite:fixture.aliceSite});
  const {Client}=await import('pg');
  const registrar=createRegistrar(scope.project,read(join(workspace,'registrar-database.json')),Client);
  const key=await generation(scope.project,plan.generation);
  assert.ok(key.notBefore<=now() && now()+120<key.signUntil && key.verifyUntil-key.notBefore<=1800);
  const credentials=read(join(workspace,'account-material.json'));
  const state={};
  const approval=({uid,proofId})=>({uid,proofId,epoch:0,validFrom:key.notBefore,expiresAt:key.verifyUntil});
  const grantOptions={binding,identity,key,registrar,repository,journalDir:journal};
  log('generation-dispatch',{project:scope.project,keyId:key.id,alice:fixture.alice,bob:fixture.bob,requestId});
  sql('generation','publication-generation.sql',{key_id:key.id,alice_uid:fixture.alice,bob_uid:fixture.bob,
    not_before:key.notBefore,sign_until:key.signUntil,verify_until:key.verifyUntil},true);
  for (const name of ['alice','bob']) {
    log(name+'-login-dispatch',{uid:fixture[name]});
    const login=await identity.passwordLogin(credentials[name]);
    const who=accountContext(login.handle);
    assert.equal(who.uid,fixture[name]);
    vars[name+'_sid']=who.session_id;
    log(name+'-session',{...who});
    const grant=await issueGrant({...grantOptions,login,approval:approval(accounts[name])});
    log(name+'-grant',grant);
    state[name]={...who,handle:login.handle,grantId:grant.grant_id,token:withCredential(login.handle,v=>v)};
  }
  const qualified=observe('both-qualified');
  sameEffects(qualified,baseline);
  assert.equal(qualified.generation_live,true);
  assertActive(qualified.subjects.alice,state.alice.grantId);
  assertActive(qualified.subjects.bob,state.bob.grantId);
  const {alice,bob}=state;
  const input=faultCommand(fixture.entry,requestId);
  const bound=bindSaveFault({site:fixture.aliceSite,uid:alice.uid,sid:alice.session_id,input},
    readFileSync(join(stage,'save-fault-body.sql'),'utf8'));
  const {sql:boundSql,bodySha,...pin}=bound;
  const faultVars={body_sha:bodySha};
  writeFileSync(join(stage,'save-fault-bound.sql'),boundSql,{flag:'wx',mode:0o600});
  writeOnce(join(workspace,'fault-plan.json'),{project:scope.project,...pin});

  let removalNeeded=false;
  let saveDispatched=false;
  try {
    log('fault-install-dispatch',{...pin,bodySha});
    removalNeeded=true;
    sql('fault-install','save-fault-install.sql',faultVars,true);
    log('fault-dispatch',{...pin,expectedDraftRevision:5,normalCommit:true});
    saveDispatched=true;
    await assert.rejects(()=>service.saveTextDraft(alice.handle,fixture.aliceSite,input),{code:'COMMIT_UNKNOWN',status:503});
    const rolledBack=observe('fault-independent-readback');
    log('fault-same-key-readback',rolledBack);
    sameEffects(rolledBack,baseline);
    const receipt=read(join(workspace,'save-fault-upstream.json'));
    assert.ok(Number.isInteger(receipt.upstreamStatus) && receipt.upstreamStatus>=400 && receipt.upstreamStatus<=599);
    assert.deepEqual(receipt,{project:scope.project,...pin,upstreamStatus:receipt.upstreamStatus,sqlstate:'PT536',
      phase:'deferred_constraint_after_save_effects'});
    log('fault-verified',{...receipt,businessEffectsUnchanged:true});
  } finally {
    try {
      if (saveDispatched && !existsSync(join(journal,'fault-same-key-readback.json'))) {
        const uncertain=observe('fault-stop-same-key-readback');
        log('fault-same-key-readback',uncertain);
      }
    } finally {
      if (removalNeeded) {
        try {
          const found=sql('fault-before-cleanup','save-fault-status.sql');
          if (!(found.function_absent && found.triggers_absent)) {
            assert.equal(found.function_absent,false);
            assert.equal(found.triggers_absent,false);
            log('fault-remove-dispatch',{bodySha});
            sql('fault-remove','save-fault-remove.sql',faultVars,true);
          }
        } finally {
          absent('fault-cleanup');
        }
      }
    }
  }

  assert.equal((await service.introduction(alice.handle,fixture.aliceSite)).draft_revision,5);
  const aliceExpiry=unexpired(alice.token,alice.session_id);
  log('session-revoke-dispatch',{uid:alice.uid,sid:alice.session_id,scope:'local',expiresAt:aliceExpiry});
  try { await scopedSignOut(scope,alice.token); }
  catch (error) { log('session-revoke-readback-after-unconfirmed',observe('session-revoke-unknown')); throw error; }
  const raw=await mtls.fetch(scope.privateOrigin+'/rpc/read_introduction',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
    headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},
    body:JSON.stringify({target:fixture.aliceSite})});
  assert.equal(raw.status,403);
  assert.deepEqual(await raw.json(),{code:'42501'});
  assert.equal(unexpired(alice.token,alice.session_id),aliceExpiry);
  const revokedSession=observe('session-revoke-independent-readback');
  sameEffects(revokedSession,baseline);
  assert.deepEqual(revokedSession.subjects.alice,{...qualified.subjects.alice,auth_row_present:false,auth_live:false});
  assert.deepEqual(revokedSession.subjects.bob,qualified.subjects.bob);
  assert.equal(revokedSession.generation_live,true);
  log('session-revoke-verified',{sid:alice.session_id,logoutStatus:204,accessStatus:403,sqlstate:'42501',
    tokenUnexpired:true,otherSessionsUnchanged:true,grantUnchanged:true,businessEffectsUnchanged:true});

  // The Bob positive read follows Alice's denial, under the same open save/read runtime.
  assert.equal((await service.introduction(bob.handle,fixture.bobSite)).draft_revision,0);
  const bobExpiry=unexpired(bob.token,bob.session_id);
  log('grant-revoke-dispatch',{uid:bob.uid,sid:bob.session_id,grantId:bob.grantId,proofId:revokeProof});
  let result;
  try {
    result=await revokeGrant({...grantOptions,handle:bob.handle,approval:approval({uid:bob.uid,proofId:revokeProof})});
  } catch(error) { log('grant-revoke-readback-after-unconfirmed',observe('grant-revoke-unknown')); throw error; }
  assert.equal(result.grant_id,bob.grantId);
  const nativeAuth=await identity.verifyAccount(bob.token);
  assert.deepEqual(accountContext(nativeAuth),{uid:bob.uid,session_id:bob.session_id});
  await assert.rejects(()=>service.introduction(nativeAuth,fixture.bobSite),{code:'BUSINESS_DENIED',status:403});
  assert.equal(unexpired(bob.token,bob.session_id),bobExpiry);
  const revokedGrant=observe('grant-revoke-independent-readback');
  sameEffects(revokedGrant,baseline);
  assert.deepEqual(revokedGrant.subjects.alice,revokedSession.subjects.alice);
  assert.deepEqual(revokedGrant.subjects.bob,{...revokedSession.subjects.bob,revoked:true,reason:'user_logout'});
  assert.equal(revokedGrant.generation_live,true);
  assert.equal(revokedGrant.revoke_proof_consumed,true);
  log('grant-revoke-verified',{grantId:bob.grantId,proofId:revokeProof,status:'revoked',accessStatus:403,
    nativeAuthLive:true,tokenUnexpired:true,businessEffectsUnchanged:true});
  absent('final-fault-catalog');
  log('final-effects',revokedGrant);
  console.log(JSON.stringify({fault:'PASS',sessionRevocation:'PASS',grantRevocation:'PASS'}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error.code??(error.message?.match(/^[a-zA-Z0-9_-]{1,100}$/)?.[0])??'HOSTED_SAVE_REVOKE_STOP');process.exitCode=1;});
