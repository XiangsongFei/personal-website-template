import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,request,EMAIL} from './helpers.mjs';
import {TEST_ORIGIN,TEST_PASSWORD} from './auth-fixture.mjs';
const cookie=c=>[...c.jar].map(([k,v])=>k+'='+v).join('; ');
const page=(c,path='/dashboard/website',options={})=>c.mf.dispatchFetch(TEST_ORIGIN+path,{redirect:'manual',...options,headers:{Cookie:cookie(c),...options.headers}});
const login=async(c,email=EMAIL)=>assert.equal((await request(c,'login',{email,password:TEST_PASSWORD})).status,200);
function privatePage(r,status=200){assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('vary')??'',/Cookie/i);}

test('website document, descendants, encoded paths, HEAD and RSC stay under the S2 guard',async()=>{
 const c=await setup();try{
  for(const path of ['/dashboard/website','/dashboard/website/private','/%64ashboard/website','/dashboard%2fwebsite','//dashboard/website','/dashboard/website?site_id=attacker']){
   const r=await page(c,path);assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/login');assert.doesNotMatch(await r.text(),/站点服务|合成/);
  }
  for(const options of [{method:'HEAD'},{headers:{RSC:'1'}}])assert.equal((await page(c,undefined,options)).status,303);
 }finally{await c.mf.dispose()}
});
test('authenticated website renders the closed read state, never an invented empty or existing site',async()=>{
 const c=await setup();try{await login(c);const r=await page(c);privatePage(r);const html=await r.text();assert.match(html,/站点服务尚未接入/);assert.match(html,/无法确认你是否已有网站/);assert.match(html,/查看首次建站引导/);assert.doesNotMatch(html,/已确认没有网站|Synthetic portfolio|已创建成功|发布成功|user-a@example/);assert.match(html,/aria-current="page"[^>]*>我的网站/);privatePage(await page(c,undefined,{method:'HEAD'}));privatePage(await page(c,'/dashboard/website?_rsc',{headers:{RSC:'1'}}));}finally{await c.mf.dispose()}
});
test('client site_id and slug cannot select a site; all unaccepted business endpoints remain closed',async()=>{
 const c=await setup();try{await login(c);for(const query of ['?site_id=a1404a42-f2be-4d87-b863-2a79c8ff4a21','?slug=admin&state=ready&fixture=empty']){const r=await page(c,'/dashboard/website'+query);privatePage(r);const html=await r.text();assert.match(html,/站点服务尚未接入/);assert.doesNotMatch(html,/已确认没有网站|Synthetic portfolio/)}
  const before=c.auth.events.length;for(const path of ['/api/sites/mine','/api/sites','/api/sites/a1404a42-f2be-4d87-b863-2a79c8ff4a21','/api/admin/v1/profile/save'])for(const method of ['GET','POST'])assert.equal((await page(c,path,{method})).status,404);assert.equal(c.auth.events.length,before);assert.equal((await page(c,undefined,{method:'POST'})).status,405);assert.ok(c.auth.events.every(e=>e.path.startsWith('/auth/v1/')));
 }finally{await c.mf.dispose()}
});
test('expired session and post-logout old cookies cannot reopen website UI',async()=>{
 const c=await setup();try{await login(c);const stale=new Map(c.jar);assert.equal((await request(c,'logout',{})).status,200);for(const jar of [c.jar,stale])assert.equal((await page({...c,jar})).status,303)}finally{await c.mf.dispose()}
});
for(const [fault,status] of [['network',503],['limited',429]])test('identity '+fault+' cannot masquerade as no website',async()=>{
 const c=await setup();try{await login(c);c.auth.controls.user=fault;const r=await page(c);privatePage(r,status);assert.equal(r.headers.get('location'),null);const html=await r.text();assert.match(html,/重新载入/);assert.doesNotMatch(html,/已确认没有网站|查看首次建站引导|Synthetic portfolio/)}finally{await c.mf.dispose()}
});
test('concurrent accounts and anonymous website requests do not share private state',async()=>{
 const c=await setup();try{await login(c);const b={...c,jar:new Map()};await login(b,'user-b@example.invalid');const rs=await Promise.all([page(c),page(b),page({...c,jar:new Map()})]);assert.deepEqual(rs.map(r=>r.status),[200,200,303]);for(const r of rs.slice(0,2)){privatePage(r);assert.doesNotMatch(await r.text(),/user-[ab]@example\.invalid|Synthetic portfolio/)}}finally{await c.mf.dispose()}
});
