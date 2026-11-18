// Offline transaction planner only. No route, repository, authentication or Storage adapter.
// Actor attribution/Owner comparison below is NOT a live Session/Grant/revocation check.
import {exact, uuid, deny, sha256} from './protocol.mjs';

const encoder=new TextEncoder();
const operations=new Set(['save_text_draft','publish_site','unpublish_site']);
const revision=n=>Number.isSafeInteger(n)&&n>=0;
const conflict=()=>deny('REQUEST_CONFLICT',409);
const invariant=()=>deny('PUBLICATION_STATE_INVALID',503);
const freeze=value=>{
  if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};
const bytes=value=>encoder.encode(JSON.stringify(value));
const digest=value=>sha256(bytes(value));

// Narrow S3.2 Introduction aggregate. Extra fields, including ready/assets/URLs,
// are rejected rather than projected away. Text itself remains literal text.
export function textPayload(value){
  exact(value,['schema_version','entries']);
  if(value.schema_version!==1||!Array.isArray(value.entries)||value.entries.length>100)deny('INVALID_INPUT',400);
  const ids=new Set(),positions=new Set();
  const entries=Array.from(value.entries,entry=>{
    exact(entry,['id','position','translations']);
    if(!uuid(entry.id)||ids.has(entry.id)||!revision(entry.position)||positions.has(entry.position))deny('INVALID_INPUT',400);
    ids.add(entry.id);positions.add(entry.position);
    const t=entry.translations;
    if(!t||![Object.prototype,null].includes(Object.getPrototypeOf(t))||
      Object.keys(t).some(k=>!['zh','en'].includes(k)))deny('INVALID_INPUT',400);
    const translations={};
    for(const locale of ['zh','en'])if(Object.hasOwn(t,locale)){
      if(typeof t[locale]!=='string'||t[locale].length>20000)deny('INVALID_INPUT',400);
      translations[locale]=t[locale];
    }
    return {id:entry.id,position:entry.position,translations};
  }).sort((a,b)=>a.position-b.position);
  const payload={schema_version:1,entries};
  if(bytes(payload).length>65536)deny('INVALID_INPUT',400);
  return freeze(payload);
}

function command(operation,value){
  if(!operations.has(operation))deny('INVALID_INPUT',400);
  const fields=operation==='save_text_draft'?['expected_draft_revision','payload']:
    operation==='publish_site'?['expected_draft_revision','expected_publication_revision','snapshot_id']:
      ['expected_publication_revision'];
  exact(value,['schema_version','request_id',...fields]);
  if(value.schema_version!==1||!uuid(value.request_id)||
    fields.filter(k=>k.startsWith('expected_')).some(k=>!revision(value[k])))deny('INVALID_INPUT',400);
  if(operation==='publish_site'&&value.snapshot_id!==null&&!uuid(value.snapshot_id))deny('INVALID_INPUT',400);
  const input={schema_version:1,request_id:value.request_id};
  for(const k of fields)input[k]=k==='payload'?textPayload(value[k]):value[k];
  return freeze(input);
}

// In-memory projection of a pre-existing site's permanent state and revision-zero
// history. This function creates no site/user and makes no persistence claim.
export async function initialTextPublication({site_id,owner_uid,payload}){
  if(!uuid(site_id)||!uuid(owner_uid))deny('INVALID_INPUT',400);
  const content=textPayload(payload);
  return freeze({site_id,owner_uid,draft_revision:0,
    draft_revisions:[{site_id,site_revision:0,payload:content,digest:await digest(content)}],
    snapshots:[],publication:{site_id,state:'unpublished',snapshot_id:null,publication_revision:0,
      changed_at:null,changed_by:null},operations:[],audits:[],outbox:[]});
}

async function checkedState(value){
  // Detach before the first await, so external mutation cannot change this plan.
  const s=structuredClone(value);
  exact(s,['site_id','owner_uid','draft_revision','draft_revisions','snapshots','publication','operations','audits','outbox']);
  if(!uuid(s.site_id)||!uuid(s.owner_uid)||!revision(s.draft_revision)||
    !['draft_revisions','snapshots','operations','audits','outbox'].every(k=>Array.isArray(s[k]))||
    s.draft_revisions.length!==s.draft_revision+1)invariant();
  for(const [i,r]of s.draft_revisions.entries()){
    exact(r,['site_id','site_revision','payload','digest']);
    if(r.site_id!==s.site_id||r.site_revision!==i||r.digest!==await digest(textPayload(r.payload)))invariant();
  }
  const seen=new Set();
  for(const snap of s.snapshots){
    exact(snap,['id','site_id','source_draft_revision','schema_version','payload','digest','published_by','created_at']);
    if(!uuid(snap.id)||seen.has(snap.id)||snap.site_id!==s.site_id||snap.schema_version!==1||
      !revision(snap.source_draft_revision)||snap.published_by!==s.owner_uid||!revision(snap.created_at))invariant();
    seen.add(snap.id);
    const source=s.draft_revisions[snap.source_draft_revision];
    if(!source||snap.digest!==source.digest||snap.digest!==await digest(textPayload(snap.payload)))invariant();
  }
  const p=s.publication;
  exact(p,['site_id','state','snapshot_id','publication_revision','changed_at','changed_by']);
  if(p.site_id!==s.site_id||!revision(p.publication_revision)||
    !['published','unpublished'].includes(p.state)||
    (p.state==='published'?(!uuid(p.snapshot_id)||!seen.has(p.snapshot_id)):p.snapshot_id!==null))invariant();
  // The permanent row cannot be reset/recreated independently of its append-only
  // transition history. Delivery status is separate from publication revision.
  if(s.outbox.length!==p.publication_revision)invariant();
  for(const [i,event]of s.outbox.entries()){
    exact(event,['site_id','publication_revision','event_type','state','attempt_count','next_attempt_at','created_at']);
    if(event.site_id!==s.site_id||event.publication_revision!==i+1||
      !['published','unpublished'].includes(event.event_type)||!['pending','delivered','failed'].includes(event.state)||
      !revision(event.attempt_count)||!revision(event.next_attempt_at)||!revision(event.created_at))invariant();
  }
  if(p.publication_revision===0){
    if(p.state!=='unpublished'||p.changed_at!==null||p.changed_by!==null)invariant();
  }else if(p.changed_by!==s.owner_uid||!revision(p.changed_at)||
    p.state!==s.outbox.at(-1).event_type||p.changed_at!==s.outbox.at(-1).created_at)invariant();
  if(s.operations.some(o=>o.site_id!==s.site_id||!uuid(o.actor_uid)||!uuid(o.actor_sid)||
    !operations.has(o.operation)||!uuid(o.request_id)||!/^[0-9a-f]{64}$/.test(o.payload_digest)||
    !['succeeded','pending','unknown'].includes(o.state)))invariant();
  for(const o of s.operations){
    exact(o,['site_id','actor_uid','actor_sid','operation','request_id','payload_digest','basis','state','result']);
    exact(o.basis,['site_id','draft_revision','publication_revision']);
    if(o.basis.site_id!==s.site_id||!revision(o.basis.draft_revision)||!revision(o.basis.publication_revision)||
      o.basis.draft_revision>s.draft_revision||o.basis.publication_revision>p.publication_revision)invariant();
    if(o.state!=='succeeded')continue;
    exact(o.result,['schema_version','request_id','site_id','draft_revision','publication','changed']);
    const r=o.result,pr=r.publication;
    exact(pr,['site_id','state','snapshot_id','publication_revision','changed_at','changed_by']);
    if(r.schema_version!==1||r.request_id!==o.request_id||r.site_id!==s.site_id||
      !revision(r.draft_revision)||r.draft_revision>s.draft_revision||typeof r.changed!=='boolean'||
      pr.site_id!==s.site_id||!revision(pr.publication_revision)||pr.publication_revision>p.publication_revision||
      !['published','unpublished'].includes(pr.state)||
      (pr.state==='published'?(!uuid(pr.snapshot_id)||!seen.has(pr.snapshot_id)):pr.snapshot_id!==null)||
      r.draft_revision!==o.basis.draft_revision+(o.operation==='save_text_draft'&&r.changed?1:0)||
      pr.publication_revision!==o.basis.publication_revision+(o.operation!=='save_text_draft'&&r.changed?1:0)||
      o.operation==='publish_site'&&pr.state!=='published'||
      o.operation==='unpublish_site'&&pr.state!=='unpublished')invariant();
  }
  const auditKey=(uid,op,request)=>JSON.stringify([uid,op,request]);
  const samePublication=(a,b)=>Object.keys(p).every(k=>a?.[k]===b?.[k]);
  const audits=new Map();
  for(const event of s.audits){
    exact(event,['site_id','actor_uid','actor_sid','action','request_id','draft_revision','publication_revision','result','publication']);
    exact(event.publication,Object.keys(p));
    const key=auditKey(event.actor_uid,event.action,event.request_id);
    const op=s.operations.find(o=>auditKey(o.actor_uid,o.operation,o.request_id)===key);
    if(audits.has(key)||!op||event.site_id!==s.site_id||event.actor_sid!==op.actor_sid||
      event.actor_uid!==s.owner_uid||event.result!=='succeeded'||
      !revision(event.draft_revision)||event.draft_revision>s.draft_revision||
      !revision(event.publication_revision)||event.publication_revision>p.publication_revision||
      event.publication.site_id!==s.site_id||event.publication.publication_revision!==event.publication_revision)invariant();
    audits.set(key,event);
  }
  const changes=[...audits.values()].filter(a=>a.action!=='save_text_draft')
    .sort((a,b)=>a.publication_revision-b.publication_revision);
  const history=new Map([[0,{site_id:s.site_id,state:'unpublished',snapshot_id:null,
    publication_revision:0,changed_at:null,changed_by:null}]]);
  if(changes.length!==p.publication_revision)invariant();
  for(const [i,event]of changes.entries()){
    const row=event.publication,out=s.outbox[i],published=event.action==='publish_site';
    if(event.publication_revision!==i+1||row.state!==(published?'published':'unpublished')||
      (published?(!uuid(row.snapshot_id)||!seen.has(row.snapshot_id)):row.snapshot_id!==null)||
      row.changed_by!==event.actor_uid||row.changed_at!==out.created_at||row.state!==out.event_type)invariant();
    history.set(i+1,row);
  }
  if(!samePublication(p,history.get(p.publication_revision)))invariant();
  for(const snap of s.snapshots){
    if(!changes.some(a=>a.publication.snapshot_id===snap.id&&
      a.publication.changed_at===snap.created_at&&a.draft_revision>=snap.source_draft_revision))invariant();
  }
  const saves=[...audits.values()].filter(a=>a.action==='save_text_draft').sort((a,b)=>a.draft_revision-b.draft_revision);
  if(saves.length!==s.draft_revision||saves.some((a,i)=>a.draft_revision!==i+1))invariant();
  for(const event of audits.values()){
    if(!samePublication(event.publication,history.get(event.publication_revision)))invariant();
  }
  for(const o of s.operations){
    if(o.state!=='succeeded')continue; // Never promote pending/unknown from matching audit evidence.
    const r=o.result,aud=audits.get(auditKey(o.actor_uid,o.operation,o.request_id));
    if(!samePublication(r.publication,history.get(r.publication.publication_revision))||
      (r.changed?(!aud||aud.draft_revision!==r.draft_revision||!samePublication(aud.publication,r.publication)):!!aud))invariant();
  }
  const keys=s.operations.map(o=>JSON.stringify([o.site_id,o.actor_uid,o.operation,o.request_id]));
  if(new Set(keys).size!==keys.length)invariant();
  return s;
}
function actorFor(s,value){
  exact(value,['uid','sid']);
  if(!uuid(value.uid)||!uuid(value.sid)||value.uid!==s.owner_uid)deny();
  return {...value}; // Requires a separately authorized server-owned context at integration.
}
const priorFor=(s,a,op,input)=>s.operations.find(o=>
  o.site_id===s.site_id&&o.actor_uid===a.uid&&o.operation===op&&o.request_id===input.request_id);
const requestDigest=(op,input)=>digest({operation:op,...input});
const unknown=input=>freeze({mode:'OFFLINE_RECONCILIATION',status:'UNKNOWN',request_id:input.request_id,retry_with_new_id:false});
const increment=n=>{if(n===Number.MAX_SAFE_INTEGER)invariant();return n+1;};
const rowResult=(s,input,changed)=>({schema_version:1,request_id:input.request_id,site_id:s.site_id,
  draft_revision:s.draft_revision,publication:structuredClone(s.publication),changed});
function checkReceiptInput(s,operation,input,prior){
  if(Object.hasOwn(input,'expected_draft_revision')&&input.expected_draft_revision!==prior.basis.draft_revision||
    Object.hasOwn(input,'expected_publication_revision')&&input.expected_publication_revision!==prior.basis.publication_revision)invariant();
  if(operation==='publish_site'){
    const snap=s.snapshots.find(x=>x.id===prior.result.publication.snapshot_id);
    if(!snap||(input.snapshot_id===null?snap.source_draft_revision!==input.expected_draft_revision:
      snap.id!==input.snapshot_id))invariant();
  }
}

export async function readTextPublicationOperation(state,actor,operation,value){
  const input=command(operation,value),who={...actor},s=await checkedState(state),a=actorFor(s,who);
  const prior=priorFor(s,a,operation,input);
  if(!prior)return unknown(input); // Absence never proves an earlier write failed.
  if(prior.payload_digest!==await requestDigest(operation,input))conflict();
  if(prior.state==='succeeded')checkReceiptInput(s,operation,input,prior);
  return prior.state==='succeeded'?freeze({mode:'OFFLINE_RECONCILIATION',status:'succeeded',result:structuredClone(prior.result)}):unknown(input);
}

// Returned next/effects are ONE proposed transaction, never a DB COMMIT receipt.
// A future adapter must revalidate live qualification under the required locks,
// CAS the expected revisions, and commit all effects together. No such adapter
// is enabled here. Failure before this function returns leaves state untouched.
export async function planTextPublication(state,actor,operation,value,{now,snapshot_id=null}={}){
  const input=command(operation,value),who={...actor},s=await checkedState(state),a=actorFor(s,who);
  if(!revision(now))deny('INVALID_INPUT',400);
  const hash=await requestDigest(operation,input),prior=priorFor(s,a,operation,input);
  if(prior){
    if(prior.payload_digest!==hash)conflict();
    if(prior.state!=='succeeded')deny('COMMIT_UNKNOWN',503);
    checkReceiptInput(s,operation,input,prior);
    return freeze({mode:'OFFLINE_PLAN',replayed:true,expected:null,next:s,
      result:structuredClone(prior.result),effects:{draft_revisions:[],snapshots:[],publication:null,operations:[],audits:[],outbox:[]}});
  }
  if(s.operations.some(o=>o.state!=='succeeded'))deny('COMMIT_UNKNOWN',503);
  const expected={site_id:s.site_id,draft_revision:s.draft_revision,publication_revision:s.publication.publication_revision};
  const effects={draft_revisions:[],snapshots:[],publication:null,operations:[],audits:[],outbox:[]};
  let changed=false;
  if(operation==='save_text_draft'){
    if(input.expected_draft_revision!==s.draft_revision)conflict();
    const hash=await digest(input.payload);
    if(hash!==s.draft_revisions.at(-1).digest){
      s.draft_revision=increment(s.draft_revision);changed=true;
      const row={site_id:s.site_id,site_revision:s.draft_revision,payload:input.payload,digest:hash};
      s.draft_revisions.push(row);effects.draft_revisions.push(row);
    }
  }else{
    if(input.expected_publication_revision!==s.publication.publication_revision)conflict();
    let target=null;
    if(operation==='publish_site'){
      if(input.expected_draft_revision!==s.draft_revision)conflict();
      target=input.snapshot_id!==null?s.snapshots.find(x=>x.id===input.snapshot_id):
        s.snapshots.find(x=>x.source_draft_revision===s.draft_revision);
      if(input.snapshot_id!==null&&!target)deny(); // No cross-site/historical-ID enumeration.
      if(!target){
        if(!uuid(snapshot_id)||s.snapshots.some(x=>x.id===snapshot_id))deny('INVALID_INPUT',400);
        const source=s.draft_revisions.at(-1);
        target={id:snapshot_id,site_id:s.site_id,source_draft_revision:s.draft_revision,schema_version:1,
          payload:structuredClone(source.payload),digest:source.digest,published_by:a.uid,created_at:now};
        s.snapshots.push(target);effects.snapshots.push(target);
      }
    }
    const pointer=target?.id??null,nextState=target?'published':'unpublished';
    changed=s.publication.state!==nextState||s.publication.snapshot_id!==pointer;
    if(changed){
      s.publication={site_id:s.site_id,state:nextState,snapshot_id:pointer,
        publication_revision:increment(s.publication.publication_revision),changed_at:now,changed_by:a.uid};
      effects.publication=s.publication;
      const event={site_id:s.site_id,publication_revision:s.publication.publication_revision,
        event_type:nextState==='published'?'published':'unpublished',state:'pending',attempt_count:0,next_attempt_at:now,created_at:now};
      s.outbox.push(event);effects.outbox.push(event);
    }
  }
  if(changed){
    const event={site_id:s.site_id,actor_uid:a.uid,actor_sid:a.sid,action:operation,request_id:input.request_id,
      draft_revision:s.draft_revision,publication_revision:s.publication.publication_revision,result:'succeeded',
      publication:structuredClone(s.publication)};
    s.audits.push(event);effects.audits.push(event);
  }
  const result=rowResult(s,input,changed);
  const receipt={site_id:s.site_id,actor_uid:a.uid,actor_sid:a.sid,operation,request_id:input.request_id,
    payload_digest:hash,basis:expected,state:'succeeded',result};
  s.operations.push(receipt);effects.operations.push(receipt);
  return freeze({mode:'OFFLINE_PLAN',replayed:false,expected,next:s,result,effects});
}
