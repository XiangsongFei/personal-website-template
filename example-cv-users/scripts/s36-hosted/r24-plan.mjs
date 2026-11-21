import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {uuid} from '../../lib/business/protocol.mjs';
import {privateFile,publicationProject} from './target.mjs';
import {writeOnce} from './r3.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const read=x=>JSON.parse(privateFile(x));

export function bindR24(after,before,aliceSite,bobSite,requestId) {
 assert.equal(after.target,publicationProject);
 assert.deepEqual(after.acl,[false,false]);
 assert.equal(after.outbox.length,9);
 assert.equal(before.outbox.length,5);
 for(const [site,version,draft] of [[aliceSite,7,5],[bobSite,2,0]]) {
   const row=after.sites.find(x=>x.id===site);
   assert.deepEqual([row?.draft_revision,row?.publication.state,row?.publication.snapshot_id,row?.publication.publication_revision],
     [draft,'unpublished',null,version]);
 }
 for(const old of before.outbox) assert.deepEqual(after.outbox.find(x=>x.id===old.id),old);
 const fresh=after.outbox.filter(x=>!before.outbox.some(y=>x.id===y.id));
 const expected=[[aliceSite,6,'published'],[aliceSite,7,'unpublished'],[bobSite,1,'published'],[bobSite,2,'unpublished']];
 assert.equal(fresh.length,4);
 for(const [site,version,type] of expected) {
   const row=fresh.find(x=>x.site_id===site&&x.publication_revision===version);
   assert.ok(uuid(row?.id));
   assert.deepEqual([row.state,row.attempt_count,row.lease_generation,row.event_type],['pending',0,0,type]);
 }
 const event=fresh.find(x=>x.site_id===aliceSite&&x.publication_revision===7);
 const original=after.operations.find(x=>x.id===event.operation_id);
 assert.deepEqual([original?.request_id,original?.operation,original?.site_id],[requestId,'unpublish_site',aliceSite]);
 const owner=randomUUID(),token=randomUUID(),other=randomUUID(),id=event.id;
 const lease=[id,owner,token,1];
 const step=(method,values,expected,condition={})=>({method,values,expected,...condition});
 const actions=[
   step('claim',[id,owner,token,0,false,10000],{claimed:true,state:'leased',attempt:1}),
   step('current',[aliceSite],{publication_revision:7,state:'unpublished'}),
   step('start',lease,{state:'leased',dispatch_started:true},{egressAfterCommit:1}),
   step('unknown',lease,{state:'unknown',attempt:1,code:'DELIVERY_UNKNOWN'}),
   step('read',[id],{state:'unknown',attempt:1,code:'DELIVERY_UNKNOWN'}),
   step('claim',[id,owner,other,1,true,10000],{claimed:false,state:'unknown',attempt:1}),
   step('read',[id],{state:'unknown',attempt:1})
 ];
 return {mode:'reply-loss-after-durable-receive',project:publicationProject,aliceSite,worker:'ecv_s36_outbox_worker',
   requiresSeparateApproval:true,expectedPointer:{publication_revision:7,state:'unpublished'},
   sourceSha256:sha(JSON.stringify(after)),events:[{event_id:id,site_id:aliceSite,event_type:'unpublished',
     publication_revision:7,egress:1,actions}],workerCallLimit:actions.length,workerConnectionLimit:2,egressLimit:1};
}

export function bindR24Start(observed,bobSite) {
 assert.equal(observed.target,publicationProject);
 assert.deepEqual(observed.acl,[false,false]);
 assert.equal(observed.outbox.length,13);
 const subject=observed.sites.find(s=>s.id===bobSite);
 assert.deepEqual([subject?.draft_revision,subject?.publication.state,subject?.publication.snapshot_id,
   subject?.publication.publication_revision],[0,'unpublished',null,4]);
 const bound=observed.outbox.filter(row=>row.site_id===bobSite&&row.publication_revision===4);
 assert.equal(bound.length,1);
 const [row]=bound;
 assert.ok(uuid(row.id)&&uuid(row.operation_id)&&uuid(bobSite));
 assert.deepEqual([row.state,row.event_type,row.attempt_count,row.lease_generation],['pending','unpublished',0,0]);
 for(const key of ['lease_owner','lease_token','lease_until','dispatch_started_at','completed_at','last_code'])
   assert.equal(row[key],null);
 assert.ok(observed.operations.some(o=>o.id===row.operation_id&&o.site_id===bobSite&&o.operation==='unpublish_site'));
 const owner=randomUUID(), token=randomUUID(), lease=[row.id,owner,token,1];
 const actions=[
   {method:'claim',values:[row.id,owner,token,0,false,30000],expected:{claimed:true,state:'leased',attempt:1}},
   {method:'current',values:[bobSite],expected:{publication_revision:4,state:'unpublished'}},
   {method:'start',values:lease,expected:{state:'leased',attempt:1,dispatch_started:true},fault:'discard-start-reply'},
   {method:'read',values:[row.id],expected:{state:'leased',attempt:1,dispatch_started:true}},
   {method:'unknown',values:lease,expected:{state:'unknown',attempt:1,code:'DELIVERY_UNKNOWN',dispatch_started:true}},
   {method:'read',values:[row.id],expected:{state:'unknown',attempt:1,code:'DELIVERY_UNKNOWN',dispatch_started:true}}
 ];
 return {mode:'start-ack-and-cleanup-failure',project:publicationProject,aliceSite:bobSite,worker:'ecv_s36_outbox_worker',
   requiresSeparateApproval:true,expectedPointer:{publication_revision:4,state:'unpublished'},
   sourceSha256:sha(JSON.stringify(observed)),events:[{event_id:row.id,site_id:bobSite,event_type:'unpublished',
     publication_revision:4,egress:0,actions}],workerCallLimit:6,workerConnectionLimit:2,egressLimit:0};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [run,worker]=process.argv.slice(2);
 const after=read(join(run,'journal/publication-final.json')), before=read(join(run,'baseline.json'));
 const fixture=read(join(run,'private/fixture.json'));
 const scope=read(join(run,'plan.json'));
 const plan=bindR24(after,before,fixture.aliceSite,fixture.bobSite,scope.requests.aliceWithdraw);
 writeOnce(join(worker,'baseline.json'),after);
 writeOnce(join(worker,'live-plan.json'),plan);
 console.log(sha(privateFile(join(worker,'live-plan.json'))));
}
