import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHostedBinding} from '../../scripts/s36-hosted/compat/binding.mjs';
import {checkRpc} from '../../scripts/s36-hosted/compat/private-rpc.mjs';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';
import {createSiteService} from '../../scripts/s36-hosted/compat/service.mjs';
import {createRpcRepository} from '../../scripts/s36-hosted/compat/repository.mjs';
import {publicationPlan,transition} from '../../scripts/s36-hosted/publication-acceptance.mjs';
import {textCommand} from '../../scripts/s36-hosted/compat/command.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const fixture={
  project:'vellypyadcxkvqftsbrg',publishableKey:'sb_publishable_fixture',privateOrigin:'https://127.0.0.1:9443',
  alice:id(1),bob:id(2),aliceSite:id(3),bobSite:id(4),entry:id(5),requestId:id(6),expectedDraftRevision:0,
};
const plan={project:fixture.project,negativeRequest:id(7),publishRequest:id(8),draftRequest:id(9),withdrawRequest:id(10),expiredSession:id(11),stageSha256:'a'.repeat(64)};
const config=publicationPlan(fixture,plan);
const publish={schema_version:1,request_id:plan.publishRequest,expected_draft_revision:4,expected_publication_revision:0,snapshot_id:null};
const withdraw={schema_version:1,request_id:plan.withdrawRequest,expected_publication_revision:1};
const payload={schema_version:1,entries:[{id:fixture.entry,position:0,translations:{en:'synthetic'}}]};
const draft={schema_version:1,request_id:plan.draftRequest,expected_draft_revision:4,payload};
const sid=id(12), snapshotId=id(13);
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=(operation,input)=>JSON.stringify({operation,...input});
const pointer=(state,version)=>({site_id:fixture.aliceSite,state,snapshot_id:state==='published'?snapshotId:null,
  publication_revision:version,changed_at:version===0?null:1000,changed_by:version===0?null:fixture.alice});
const dto=(input,revision,publication)=>({schema_version:1,site_id:fixture.aliceSite,request_id:input.request_id,
  draft_revision:revision,publication,changed:true});

test('publication allowlist is opt-in for the fixed test project and exactly one site',()=>{
  assert.throws(()=>publicationPlan(fixture,{...plan,draftRequest:plan.publishRequest}));
  assert.throws(()=>publicationPlan({...fixture,project:'abcdefghijklmnopqrst'},{...plan,project:'abcdefghijklmnopqrst'}));
  assert.throws(()=>createHostedBinding({...fixture,project:'abcdefghijklmnopqrst',publicationSite:fixture.aliceSite}),
    /INVALID_HOSTED_PUBLICATION_SCOPE/);
  const args={target:fixture.aliceSite,input:publish,canonical_request:canonical('publish_site',publish)};
  assert.throws(()=>checkRpc('publish_site',args,createHostedBinding(fixture)),{code:'INVALID_INPUT'});
  const binding=createHostedBinding(config);
  checkRpc('publish_site',args,binding);
  assert.throws(()=>checkRpc('publish_site',{...args,target:fixture.bobSite},binding),{code:'BUSINESS_DENIED'});
  assert.throws(()=>checkRpc('publish_site',{...args,canonical_request:'{}'},binding),{code:'INVALID_INPUT'});
  assert.throws(()=>checkRpc('claim_text_outbox',{},binding),{code:'INVALID_INPUT'});
  assert.throws(()=>checkRpc('read_public_text',{},binding),{code:'INVALID_INPUT'});
  assert.throws(()=>textCommand('unpublish_site',{...withdraw,snapshot_id:snapshotId}),{code:'INVALID_INPUT'});
});

test('publication adapters retain canonical bytes, receipt replay and published pointer on later draft save',async()=>{
  const binding=createHostedBinding(config);
  const issuer=binding.authIssuer;
  const identity=createIdentityAdapter({issuer,clock:()=>10,auth:{
    getClaims:async()=>({data:{claims:{iss:issuer,sub:fixture.alice,session_id:sid,exp:100,
      aud:'authenticated',role:'authenticated',is_anonymous:false,amr:[{method:'password'}]}}}),
    getUser:async()=>({data:{user:{id:fixture.alice,is_anonymous:false,email_confirmed_at:'2026-01-01'}}}),
  }});
  const expected=pointer('published',1);
  const published=dto(publish,4,expected), edited=dto(draft,5,expected), withdrawn=dto(withdraw,5,pointer('unpublished',2));
  const calls=[];
  let result;
  const repo=createRpcRepository({binding,project:fixture.project,endpoint:fixture.privateOrigin,enabled:true,identity,mtls:{
    fetch:async(url,opts)=>{
      const name=url.split('/').at(-1),args=JSON.parse(opts.body);
      const operation=args.operation??name;
      assert.equal(args.canonical_request,canonical(operation,args.input));
      assert.equal(opts.headers.Authorization,'Bearer test-fixture');
      assert.equal(args.target,fixture.aliceSite);
      calls.push(name);
      return Response.json(result);
    },
  }});
  const service=createSiteService({repository:repo,publicationSite:fixture.aliceSite});
  const actor=await identity.verifyAccount('test-fixture');
  await assert.rejects(()=>service.publish(undefined,fixture.aliceSite,publish),{code:'IDENTITY_REQUIRED'});
  await assert.rejects(()=>service.publish(actor,fixture.bobSite,publish),{code:'BUSINESS_DENIED'});
  assert.deepEqual(calls,[]);
  result=published;
  assert.deepEqual(await service.publish(actor,fixture.aliceSite,publish),published);
  result={status:'succeeded',result:published};
  assert.deepEqual(await service.readPublicationOperation('publish_site',actor,fixture.aliceSite,publish),result);
  result={status:'not_observed'};
  assert.deepEqual(await service.readPublicationOperation('publish_site',actor,fixture.aliceSite,publish),
    {status:'UNKNOWN',request_id:publish.request_id,retry_with_new_id:false});
  result=edited;
  assert.deepEqual(await service.saveTextDraft(actor,fixture.aliceSite,draft),edited);
  const saveOnly=createSiteService({repository:repo});
  await assert.rejects(()=>saveOnly.saveTextDraft(actor,fixture.aliceSite,draft),{code:'COMMIT_UNKNOWN'});
  result=withdrawn;
  assert.deepEqual(await service.unpublish(actor,fixture.aliceSite,withdraw),withdrawn);
  result={...withdrawn,publication:{...withdrawn.publication,publication_revision:3}};
  await assert.rejects(()=>service.unpublish(actor,fixture.aliceSite,withdraw),{code:'COMMIT_UNKNOWN'});
});

test('independent transition checks link successful request to pointer, original snapshot, audit and pending Outbox',()=>{
  const digestValue=digest(JSON.stringify(payload));
  const alice={id:fixture.aliceSite,draft_revision:4,section_revision:4,payload,digest:digestValue,
    publication:pointer('unpublished',0)};
  const bob={id:fixture.bobSite,draft_revision:0};
  const before={sites:[alice,bob],operations:[],audits:[],snapshots:[],history:[],outbox:[]};
  const publication=pointer('published',1),result=dto(publish,4,publication);
  const operation_id=id(14),created_at='2026-11-21T00:00:00Z',site_id=fixture.aliceSite;
  const after={
    sites:[{...alice,publication},bob],
    operations:[{id:operation_id,canonical_request:canonical('publish_site',publish),
      payload_digest:digest(canonical('publish_site',publish)),site_id,actor_auth_user_id:fixture.alice,actor_session_id:sid,
      state:'succeeded',operation:'publish_site',request_id:publish.request_id,basis_draft_revision:4,
      basis_publication_revision:0,result}],
    audits:[{id:id(15),operation_id,action:'publish_site',site_id,actor_auth_user_id:fixture.alice,actor_session_id:sid,
      draft_revision:4,publication_revision:1,created_at}],
    snapshots:[{id:snapshotId,site_id,source_draft_revision:4,published_by:fixture.alice,payload,digest:digestValue,created_at}],
    history:[{site_id,operation_id,state:'published',snapshot_id:snapshotId,changed_by:fixture.alice,changed_at:created_at,
      publication_revision:1,previous_revision:null}],
    outbox:[{id:id(16),site_id,operation_id,publication_revision:1,event_type:'published',state:'pending',
      attempt_count:0,lease_token:null,created_at}],
  };
  transition(config,before,after,'publish_site',publish,result,sid);
  assert.throws(()=>transition(config,before,{...after,outbox:[]},'publish_site',publish,result,sid));
  assert.throws(()=>transition(config,before,{...after,snapshots:[{...after.snapshots[0],source_draft_revision:3}]},
    'publish_site',publish,result,sid));
  assert.throws(()=>transition(config,before,{...after,sites:[after.sites[0],{...bob,draft_revision:1}]},
    'publish_site',publish,result,sid));
});
