import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {configuration} from '../../scripts/s36-hosted/target.mjs';
import {firstAcceptance} from '../../scripts/s36-hosted/acceptance.mjs';
import {projectBridge} from '../../scripts/s36-hosted/stage.mjs';
import {createHostedBinding} from '../../scripts/s36-hosted/compat/binding.mjs';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';
import {createRpcRepository} from '../../scripts/s36-hosted/compat/repository.mjs';
import {createSiteService} from '../../scripts/s36-hosted/compat/service.mjs';
import {checkRpc} from '../../scripts/s36-hosted/compat/private-rpc.mjs';

const id = n => '00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const plan={project:'abcdefghijklmnopqrst',publishableKey:'sb_publishable_fixture',privateOrigin:'https://127.0.0.1:9443',
  alice:id(1),bob:id(2),aliceSite:id(3),bobSite:id(4),entry:id(5),requestId:id(6),expectedDraftRevision:0};

test('hosted acceptance config rejects production and non-loopback business ingress',()=>{
  for(const project of ['tkehttvppaqkybqehjbn','makwjnbubmrmopjhzror'])
    assert.throws(()=>configuration({...plan,project}),/ISOLATED_PROJECT_REQUIRED/);
  assert.throws(()=>configuration({...plan,privateOrigin:'https://other.invalid:9443'}));
  assert.throws(()=>configuration({...plan,publishableKey:'sb_secret_fixture'}));
  assert.throws(()=>configuration({...plan,expectedDraftRevision:1}));
});

test('native macOS socket is restricted to the loopback hosted test binding',()=>{
  const socket='/private/var/tmp/s36-hosted-12345678/postgrest.sock';
  assert.ok(createHostedBinding(plan,socket));
  for (const path of ['/tmp/postgrest.sock','/run/postgrest.sock','/private/var/tmp/s36-hosted-12345678/other.sock'])
    assert.throws(()=>createHostedBinding(plan,path),/PRIVATE_TEST_SOCKET_REQUIRED/);
});

test('closed forward SQL retains native current-session and registrar predicates',()=>{
  const root=new URL('../../supabase/migrations/',import.meta.url);
  const source=needle=>readFileSync(new URL(readdirSync(root).find(x=>x.includes(needle)),root),'utf8');
  const m7=source('private_service_identity');
  const sql=projectBridge(plan.project,source('registered_business_proofs'),m7);
  assert.match(sql,/session_user<>'ecv_s3_internal_api_login'/);
  assert.match(sql,/SELECT FROM auth.sessions a WHERE a.id=s AND a.user_id=u/);
  assert.match(sql,/k.revoked_at IS NULL/);
  assert.match(sql,/REVOKE EXECUTE ON FUNCTION site_api.publish_site/);
  assert.doesNotMatch(sql,/SET (enabled|write_enabled|proof_verifier_ready)\s*=/);
  assert.throws(()=>projectBridge(plan.project,source('registered_business_proofs'),m7.replace('password','otp')),/FROZEN_FUNCTION_DRIFT/);
});

test('first acceptance uses exact read, save, owner isolation and same-key readback contract (synthetic)',async()=>{
  const cfg=configuration(plan);
  const binding=createHostedBinding(plan);
  const uid=token=>token==='alice'?cfg.alice:cfg.bob;
  const identity=createIdentityAdapter({issuer:binding.authIssuer,clock:()=>10,
    auth:{getClaims:async token=>({data:{claims:{iss:binding.authIssuer,sub:uid(token),session_id:id(7),
      exp:20,aud:'authenticated',role:'authenticated',is_anonymous:false,amr:[{method:'password'}]}}}),
    getUser:async token=>({data:{user:{id:uid(token),is_anonymous:false,email_confirmed_at:'2026-01-01'}}})}});
  const seed=[{id:cfg.entry,position:0,translations:{zh:'请填写个人介绍。',en:'Add your introduction.'}}];
  let saved,entries=seed,allowedWrites=0,denied=0,started=false;
  const service=createSiteService({repository:createRpcRepository({binding,enabled:true,identity,
    project:cfg.project,endpoint:cfg.privateOrigin,mtls:{fetch:async (url,opts)=>{
      const name=url.split('/').at(-1),args=JSON.parse(opts.body);
      checkRpc(name,args,binding);
      const owner=opts.headers.Authorization==='Bearer alice'?cfg.aliceSite:cfg.bobSite;
      if (args.target!==owner) {denied++; return Response.json({code:'42501'},{status:403});}
      if (name==='read_introduction') {
        const revision=owner===cfg.aliceSite && saved ? 1 : 0;
        return Response.json({schema_version:1,site_id:owner,draft_revision:revision,section_revision:revision,
          entries:owner===cfg.aliceSite?entries:seed});
      }
      if (name==='save_text_draft') {
        assert.equal(started,true);
        allowedWrites++;
        entries=args.input.payload.entries;
        saved={schema_version:1,request_id:args.input.request_id,site_id:owner,draft_revision:1,changed:true,
          publication:{site_id:owner,state:'unpublished',snapshot_id:null,publication_revision:0,changed_at:null,changed_by:null}};
        return Response.json(saved);
      }
      assert.equal(name,'read_text_publication_operation');
      return Response.json({status:'succeeded',result:saved});
    }}})});
  const handles={alice:await identity.verifyAccount('alice'),bob:await identity.verifyAccount('bob')};
  const result=await firstAcceptance(cfg,service,handles,()=>{ started=true; });
  assert.equal(result.status,'APPLICATION_CHECKS_PASS_AUDIT_PENDING');
  assert.equal(allowedWrites,1);
  assert.equal(denied,4);
  assert.throws(()=>checkRpc('save_text_draft',{},{}),{code:'NOT_CONFIGURED'});
  assert.throws(()=>checkRpc('publish_site',{},binding),{code:'INVALID_INPUT'});
  assert.throws(()=>checkRpc('read_text_publication_operation',
    {target:cfg.aliceSite,input:{},canonical_request:'',operation:'publish_site'},binding),{code:'INVALID_INPUT'});
});
