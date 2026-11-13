// OFFLINE composition of final production modules. Auth, TLS peer and SQL
// results below are synthetic. No JWT signature, OS socket, or RLS is proven.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createBusinessBinding} from '../../lib/business/binding.mjs';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';
import {createRpcRepository} from '../../lib/business/repository.mjs';
import {handlePrivateRpc} from '../../lib/business/private-ingress.node.mjs';
import {createCandidateHandler,createSiteService} from '../../lib/business/service.mjs';
import {authorizationCases,prepareAuthorizationPlan,prepareDatabaseRecoveryPlan,evaluateAuthorizationObservation} from './authorization-plan.mjs';

const uid='00000000-0000-4000-8000-000000000001',sid='00000000-0000-4000-8000-000000000002';
const site='00000000-0000-4000-8000-000000000003',entry='00000000-0000-4000-8000-000000000004';
const otherSite='00000000-0000-4000-8000-000000000005';
const token='offline.original.bearer',pin=Array(32).fill('AB').join(':');
const binding=createBusinessBinding({project:'s34-offline-composition',authIssuer:'https://auth.s34.invalid/auth/v1',
  privateOrigin:'https://private.s34.invalid:9443',registrarHost:'pg.s34.invalid',socketPath:'/run/s34-test/postgrest.sock'});
const input={schema_version:1,request_id:entry,slug:'s34-existing',default_locale:'zh'};

function composition(scenario='owner'){
  const observations={mtls:0,unix:0,auth:0,seenTokens:[]};
  const claims={iss:binding.authIssuer,aud:'authenticated',role:'authenticated',sub:uid,session_id:sid,
    exp:2000,is_anonymous:false,amr:[{method:scenario==='recovery'?'recovery':'password'}]};
  // Separate adapters verify the SAME bearer at the two server boundaries.
  const adapter=()=>createIdentityAdapter({issuer:binding.authIssuer,clock:()=>1000,auth:{
    async getClaims(t){observations.auth++;assert.equal(t,token);return {data:{claims}};},
    async getUser(t){observations.auth++;assert.equal(t,token);return {data:{user:{id:uid,is_anonymous:false,email_confirmed_at:'2026-01-01'}}};}
  }});
  const identity=adapter(),ingressIdentity=adapter();
  // An explicit DATABASE ORACLE, not PostgreSQL. These server-side outcomes are
  // tested as projections only; their actual predicates are pinned by M7 hashes.
  const open=(options,receive)=>{
    observations.unix++;
    assert.equal(options.socketPath,binding.socketPath);
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.headers['Content-Profile'],'site_api');
    assert.equal(options.headers['Accept-Profile'],'site_api');
    assert.equal(options.agent,false);
    const outgoing=new EventEmitter();
    outgoing.end=raw=>{
      const args=JSON.parse(raw),rpc=options.path.slice('/rpc/'.length);
      assert.ok(['get_my_site','read_introduction','read_create_operation'].includes(rpc));
      let status=200,result;
      if(!['owner','qualified-no-site','cross-site'].includes(scenario)){
        status=403;result={code:'42501',details:'private diagnostic must be stripped'};
      }else if(rpc==='get_my_site'){
        result=scenario==='qualified-no-site'?{schema_version:1,site:null}:{schema_version:1,site:{id:site,draft_revision:0},capabilities:{read:true,edit:false,publish:false}};
      }else if(rpc==='read_introduction'){
        if(args.target!==site){status=403;result={code:'42501'};}
        else result={schema_version:1,site_id:site,section_revision:0,draft_revision:0,entries:[{id:entry,position:0,translations:{zh:'虚构内容',en:'Fictional content'}}]};
      }else if(scenario==='cross-site')result={status:'not_observed'};
      else result={status:'succeeded',result:{schema_version:1,request_id:input.request_id,site_id:site,persisted:true,
        publication:{state:'unpublished',snapshot_id:null,publication_revision:0}}};
      receive(Object.assign(Readable.from([Buffer.from(JSON.stringify(result))]),{
        statusCode:status,headers:{'content-type':'application/json'},complete:true}));
    };
    return outgoing;
  };
  const mtls={async fetch(url,init){
    observations.mtls++;assert.equal(new URL(url).origin,binding.privateOrigin);
    assert.deepEqual(Object.keys(init.headers).sort(),['Authorization','Content-Type']);
    observations.seenTokens.push(init.headers.Authorization);
    const req=Object.assign(Readable.from([Buffer.from(init.body)]),{complete:true,method:init.method,
      url:new URL(url).pathname,rawHeaders:['Host',binding.privateAuthority,...Object.entries(init.headers).flat()]});
    const r=await handlePrivateRpc(req,{binding,peerFingerprint:pin,trustedFingerprint:pin,identity:ingressIdentity,
      signal:init.signal,openUnixRequest:open});
    return Response.json(r.json,{status:r.status});
  }};
  const repository=createRpcRepository({binding,enabled:true,project:binding.project,endpoint:binding.privateOrigin,identity,mtls});
  const service=createSiteService({repository});
  const handler=createCandidateHandler({origin:'https://users.s34.invalid',resolveAccount:()=>identity.verifyAccount(token),service});
  return {handler,observations};
}

for(const c of authorizationCases){
  test('final generic composition projection / '+c.id+' (OFFLINE only)',async()=>{
    // The Owner control uses exactly the same modules, binding and mock peer.
    const positive=composition(),control=await positive.handler(new Request('https://users.s34.invalid/api/sites/mine'));
    assert.equal(control.status,200);assert.equal((await control.json()).site.id,site);
    const f=composition(c.scenario),target=c.scenario==='cross-site'?otherSite:site;
    const path=c.scenario==='qualified-no-site'?'/api/sites/mine':'/api/sites/'+target+'/introduction';
    const response=await f.handler(new Request('https://users.s34.invalid'+path));
    const data=await response.json();assert.equal(response.status,c.status);
    if(c.status===403){assert.equal(data.code,'BUSINESS_DENIED');assert.equal(JSON.stringify(data).includes('Fictional'),false);}
    if(c.scenario==='qualified-no-site')assert.equal(data.site,null);
    assert.equal(f.observations.unix,c.layer==='identity'?0:1);
    assert(f.observations.seenTokens.every(v=>v==='Bearer '+token));
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    assert.equal(evaluateAuthorizationObservation(c.id,{mode:'OFFLINE',complete:true,ownerPositive:true,
      status:response.status,layer:c.layer,businessChanges:0,privateData:c.status===403?false:true,site:data.site}),'OFFLINE_PASS');
  });
}

test('all three read surfaces preserve DB qualification refusal, no retry',async()=>{
  for(const scenario of ['recovery','no-grant','cross-sid','session-gone','session-expired','hold','state-missing','stale-epoch','business-disabled']){
    for(const [path,body] of [['/api/sites/mine'],['/api/sites/'+site+'/introduction'],['/api/sites/operations/read',input]]){
      const f=composition(scenario);
      const r=await f.handler(new Request('https://users.s34.invalid'+path,body?{method:'POST',headers:{Origin:'https://users.s34.invalid','Content-Type':'application/json'},body:JSON.stringify(body)}:{}));
      assert.equal(r.status,403);assert.deepEqual(await r.json(),{code:'BUSINESS_DENIED'});
      assert.equal(f.observations.unix,scenario==='recovery'?0:1);assert.equal(f.observations.mtls,scenario==='recovery'?0:1);
    }
  }
});
test('foreign receipt projection stays UNKNOWN and never yields a site',async()=>{
  const f=composition('cross-site');
  const r=await f.handler(new Request('https://users.s34.invalid/api/sites/operations/read',{method:'POST',
    headers:{Origin:'https://users.s34.invalid','Content-Type':'application/json'},body:JSON.stringify(input)}));
  assert.deepEqual(await r.json(),{status:'UNKNOWN',request_id:input.request_id,retry_with_new_id:false});
  assert.equal(f.observations.unix,1);
});
test('plans cannot create, sign, grant, select identity, or authorize execution',()=>{
  for(const c of authorizationCases){
    const p=prepareAuthorizationPlan({binding,caseId:c.id,targetSite:site,operationInput:input});
    assert.equal(p.status,'PREPARED_NOT_AUTHORIZED');assert.equal(p.currentLive,'NOT RUN');
    assert(c.fixtureFacts.length>=2);assert(Object.isFrozen(c.fixtureFacts));
    assert.equal(Object.values(p.effects).reduce((a,b)=>a+b),0);
    assert(p.calls.every(x=>!['create_site','apply_business_grant'].includes(x.name)));
    assert(Object.isFrozen(p.calls[0].args));
  }
  assert.throws(()=>prepareAuthorizationPlan({binding:{...binding},caseId:'AUTH-OWNER',targetSite:site}));
  assert.throws(()=>prepareAuthorizationPlan({binding,caseId:'AUTH-OWNER',targetSite:site,operationInput:{...input,uid}}));
});
test('no fake live PASS, no negative-only PASS, and missing receipt remains UNKNOWN',()=>{
  const sample={mode:'OFFLINE',complete:true,ownerPositive:true,status:403,layer:'database',businessChanges:0,privateData:false};
  assert.throws(()=>evaluateAuthorizationObservation('AUTH-HOLD',{...sample,mode:'LIVE'}),/LIVE_ADAPTER_REQUIRED/);
  for(const patch of [{ownerPositive:false},{status:200},{layer:'gateway'},{businessChanges:1},{privateData:true}])
    assert.equal(evaluateAuthorizationObservation('AUTH-HOLD',{...sample,...patch}),'FAIL');
  assert.equal(evaluateAuthorizationObservation('AUTH-HOLD',{...sample,complete:false}),'UNKNOWN');
  assert.equal(evaluateAuthorizationObservation('AUTH-HOLD',{...sample,unknown:true}),'UNKNOWN');
});
test('Recovery database coverage has a distinct unexecuted original-JWT descriptor',()=>{
  const plan=prepareDatabaseRecoveryPlan({binding,targetSite:site});
  assert.equal(plan.caseId,'AUTH-RECOVERY-DB');assert.equal(plan.currentLive,'NOT RUN');
  assert.equal(plan.channel,'approved-private-postgrest-original-jwt');assert.equal(plan.expected.layer,'database');
  assert.equal(plan.path,'/rpc/read_introduction');assert.equal(Object.values(plan.effects).reduce((a,b)=>a+b),0);
  assert.equal('token' in plan,false);assert.equal('fetch' in plan,false);assert(Object.isFrozen(plan.args));
  assert.throws(()=>prepareDatabaseRecoveryPlan({binding:{...binding},targetSite:site}));
});
