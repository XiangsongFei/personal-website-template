import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{randomUUID}from'node:crypto';
import{dispatchOuterRead,readRequest,OUTER_ORIGIN,authControlRequest}from'./driver/requests.mjs';
import{loadContract,ALICE,CHARLIE,ISSUER,PROJECT}from'./driver/contract.mjs';import{hash}from'./driver/state.mjs';
import{binding,PRIVATE_ORIGIN}from'./clean-candidate/service.mjs';import{createIdentityAdapter}from'../../lib/business/identity.mjs';
import{createRpcRepository}from'../../lib/business/repository.mjs';import{checkRpc}from'../../lib/business/private-rpc.mjs';
import{createCandidateHandler,createSiteService}from'../../lib/business/service.mjs';import{parseCreate,createBytes}from'../../lib/business/protocol.mjs';
globalThis.fetch=()=>{throw Error('OFFLINE_NETWORK_FORBIDDEN');};
const fixture=loadContract().fixture,input={schema_version:1,request_id:fixture.alice_receipt_read.request_id,slug:fixture.alice_receipt_read.slug,default_locale:fixture.alice_receipt_read.default_locale};
async function setup({recovery=false,status=200,code,wrongUser=false}={}){
 const now=1800000000,sid=randomUUID(),token='offline-original-credential',seen=[],claims={iss:ISSUER,aud:'authenticated',role:'authenticated',sub:ALICE,session_id:sid,exp:now+3600,is_anonymous:false,amr:[{method:recovery?'otp':'password'}]},user={id:wrongUser?CHARLIE:ALICE,email:'offline@example.test',is_anonymous:false,email_confirmed_at:'2026-01-01'};
 const authCalls=[],identity=createIdentityAdapter({issuer:ISSUER,clock:()=>now,auth:{verifyTokenAndUser:async t=>{assert.equal(t,token);authCalls.push(t);return{data:{claims,user}};},signInWithPassword:async body=>{assert.deepEqual(Object.keys(body).sort(),['email','password']);return{data:{session:{access_token:token,user},user}};}}});
 const result={schema_version:1,request_id:input.request_id,site_id:fixture.actors.Alice.site,persisted:true,publication:{state:'unpublished',snapshot_id:null,publication_revision:0}};
 const repository=createRpcRepository({binding,enabled:true,project:PROJECT,endpoint:PRIVATE_ORIGIN,identity,mtls:{fetch:async(url,init)=>{
  const rpc=new URL(url).pathname.slice(5),args=JSON.parse(init.body);assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers['Content-Type'],'application/json');assert.equal(init.headers.Authorization,'Bearer '+token);checkRpc(rpc,args,binding);seen.push({rpc,args});
  if(status!==200)return Response.json({code},{status});
  return Response.json(rpc==='read_create_operation'?{status:'succeeded',result}:rpc==='get_my_site'?{schema_version:1,site:{id:fixture.actors.Alice.site,draft_revision:0},capabilities:{read:true,edit:false,publish:false}}:rpc==='read_introduction'?{schema_version:1,site_id:fixture.actors.Alice.site,section_revision:0,draft_revision:0,entries:[]}:{grant_id:randomUUID(),status:'active',expires_at:'2027-01-01T00:00:00Z'});
 }}});
 return{identity,repository,token,sid,seen,authCalls,result};
}
for(const rpc of ['get_my_site','read_introduction','read_create_operation'])test('actual LiveHost outer composition -> official parser/service/repository/private RPC: '+rpc,async()=>{
 const f=await setup(),request=readRequest(rpc,fixture);assert.equal(request.method,rpc==='read_create_operation'?'POST':'GET');
 const r=await dispatchOuterRead({...f,rpc,fixture});assert.equal(r.status,200,await r.text());assert.equal(f.seen.length,1);assert.equal(f.seen[0].rpc,rpc);
 assert.deepEqual(f.seen[0].args,rpc==='read_create_operation'?{input}:rpc==='read_introduction'?{target:fixture.actors.Alice.site}:{});assert.equal(f.authCalls.length,1);
});
test('receipt request payload matches independently observed historical DB digest',()=>{assert.equal(hash(createBytes(input)),'f486c38dd42ed9fed77163d93bb1684084ff46eed8fe60036a4fcf88123e55b0');assert.deepEqual(parseCreate(JSON.stringify(input)),input);});
for(const[name,change,status]of [['method',r=>({method:'PUT',path:r.path,headers:r.headers}),404],['path',r=>({...r,path:'/api/sites/operations/read?extra=1'}),404],['contentType',r=>({...r,headers:{...r.headers,'Content-Type':'text/plain'}}),403],['origin',r=>({...r,headers:{...r.headers,Origin:'https://wrong.invalid'}}),403],['crossSite',r=>({...r,headers:{...r.headers,'Sec-Fetch-Site':'cross-site'}}),403]])test('official HTTP contract rejects '+name+' without private dispatch',async()=>{
 const f=await setup(),h=createCandidateHandler({origin:OUTER_ORIGIN,resolveAccount:()=>f.identity.verifyAccount(f.token),service:createSiteService(f)}),spec=change({method:'POST',path:'/api/sites/operations/read',headers:{Origin:OUTER_ORIGIN,'Content-Type':'application/json'}}),r=await h(new Request(OUTER_ORIGIN+spec.path,{method:spec.method,headers:spec.headers,body:JSON.stringify(input)}));assert.equal(r.status,status);assert.equal(f.seen.length,0);
});
const invalids={legacy:{request_id:input.request_id,slug:input.slug,locale:'en'},missingVersion:{request_id:input.request_id,slug:input.slug,default_locale:'en'},stringVersion:{...input,schema_version:'1'},version2:{...input,schema_version:2},wrongLocale:{...input,default_locale:'fr'},extra:{...input,locale:'en'},wrongUuid:{...input,request_id:'invalid'},reserved:{...input,slug:'admin'},invalidSlug:{...input,slug:'../site'},missingId:{schema_version:1,slug:input.slug,default_locale:'en'}};
for(const[name,value]of Object.entries(invalids))test('official HTTP parser rejects '+name+' with zero private dispatch',async()=>{
 const f=await setup(),handler=createCandidateHandler({origin:OUTER_ORIGIN,resolveAccount:()=>f.identity.verifyAccount(f.token),service:createSiteService(f)}),r=await handler(new Request(OUTER_ORIGIN+'/api/sites/operations/read',{method:'POST',headers:{Origin:OUTER_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(value)}));assert.equal(r.status,400);assert.deepEqual(await r.json(),{code:'INVALID_INPUT'});assert.equal(f.seen.length,0);
});
for(const[name,body]of Object.entries({duplicate:JSON.stringify(input).replace('"schema_version":1','"schema_version":1,"schema_version":1'),trailing:JSON.stringify(input)+'{}',oversize:' '.repeat(2050),badJson:'{',array:'[]'}))test('official parser encoding guard: '+name,async()=>{
 const f=await setup(),handler=createCandidateHandler({origin:OUTER_ORIGIN,resolveAccount:()=>f.identity.verifyAccount(f.token),service:createSiteService(f)}),r=await handler(new Request(OUTER_ORIGIN+'/api/sites/operations/read',{method:'POST',headers:{Origin:OUTER_ORIGIN,'Content-Type':'application/json'},body}));assert.equal(r.status,400);assert.equal(f.seen.length,0);
});
for(const[code,status,outer,expected]of [['42501',403,403,'BUSINESS_DENIED'],['22023',400,400,'INVALID_INPUT'],['PT409',409,409,'REQUEST_CONFLICT'],['PT503',503,503,'NOT_CONFIGURED'],['unrecognized',403,503,'COMMIT_UNKNOWN']])test('PostgREST error mapping preserves source distinction '+code,async()=>{
 const f=await setup({status,code}),r=await dispatchOuterRead({...f,rpc:'read_create_operation',fixture});assert.equal(r.status,outer);assert.equal((await r.json()).code,expected);assert.equal(f.seen.length,1);
});
test('outer Recovery and wrong-UID handles never dispatch to private database',async()=>{for(const options of [{recovery:true},{wrongUser:true}]){const f=await setup(options),r=await dispatchOuterRead({...f,rpc:'read_create_operation',fixture});assert.equal(r.status,options.recovery?403:401);assert.equal(f.seen.length,0);}});
test('Proof envelope and original UID/SID bound by official repository',async()=>{
 const f=await setup(),handle=await f.identity.verifyAccount(f.token),proof={version:1,project:PROJECT,action:'issue',purpose:'business',uid:ALICE,session_id:f.sid,epoch:0,proof_id:randomUUID(),issued_at:1800000000,expires_at:1800000060,payload_digest:'a'.repeat(64),key_id:'offline-key',event:'password-login'};
 await f.repository.grant(handle,{proof});assert.deepEqual(f.seen[0],{rpc:'apply_business_grant',args:{envelope:{proof}}});
 for(const mutation of [{uid:CHARLIE},{session_id:randomUUID()},{schema_version:1}])await assert.rejects(f.repository.grant(handle,{proof:{...proof,...mutation}}));assert.equal(f.seen.length,1);
});
test('all Auth control builders used by LiveHost keep frozen methods/routes/body fields',()=>{
 const password='OFFLINE_ONLY_PASSWORD',email='s34-charlie-20261112@example.test';
 assert.deepEqual(authControlRequest('resetAlice',{password}),{method:'PUT',path:'/auth/v1/admin/users/'+ALICE,body:{password}});
 assert.deepEqual(authControlRequest('createCharlie',{password,email}),{method:'POST',path:'/auth/v1/admin/users',body:{id:CHARLIE,email,password,email_confirm:true}});
 assert.deepEqual(authControlRequest('recover',{email}),{method:'POST',path:'/auth/v1/recover',body:{email}});
 assert.deepEqual(authControlRequest('verifyRecovery',{tokenHash:'OFFLINE_OTP'}),{method:'POST',path:'/auth/v1/verify',body:{token_hash:'OFFLINE_OTP',type:'recovery'}});
 assert.throws(()=>authControlRequest('resetBob',{password}));assert.throws(()=>authControlRequest('createCharlie',{password,email:'bob@example.test'}));
 const live=readFileSync(new URL('./driver/live-host.mjs',import.meta.url),'utf8');assert(live.includes('await dispatchOuterRead({rpc:action.rpc,fixture:ctx.fixture,identity,token:actor.token,repository})'));assert.equal((live.match(/authControlRequest\(a.action/g)||[]).length,4);
});
test('formal SQL RPC signatures, DTO fields and receipt digest remain source-anchored',()=>{
 const m4=readFileSync(new URL('../../supabase/migrations/20261109104802_s3_create_site_commands.sql',import.meta.url),'utf8'),m6=readFileSync(new URL('../../supabase/migrations/20261110183047_s3_registered_business_proofs.sql',import.meta.url),'utf8');
 for(const sig of ['site_api.get_my_site()','site_api.read_introduction(target uuid)','site_api.read_create_operation(input jsonb)'])assert(m4.includes(sig),sig);
 assert(m6.includes('site_api.apply_business_grant(envelope jsonb)'));assert(m4.includes("ARRAY['schema_version','request_id','slug','default_locale']"));
 for(const rpc of ['create_site','unknown_rpc','apply_business_grant'])assert.throws(()=>readRequest(rpc,fixture));
});
