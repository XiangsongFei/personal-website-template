// OFFLINE MODEL ONLY: never imported by production code, no DB/network adapter.
import { createInput, createBytes, deny, sha256 } from '../../lib/business/protocol.mjs';
import { accountContext } from '../../lib/business/identity.mjs';
import { verifyTestProof } from './fixtures/test-proof.mjs';
const empty = () => ({ security:new Map(), grants:new Map(), proofs:new Map(), sites:new Map(), members:new Map(),
  publications:new Map(), domains:new Map(), locales:new Map(), settings:new Map(), sections:new Map(),
  entries:new Map(), translations:new Map(), revisions:new Map(), operations:new Map(), audits:new Map() });
export class ModelDatabase {
  #state = empty(); #tail = Promise.resolve();
  constructor({ keys, clock, sessions, users }) { Object.assign(this,{keys,clock,sessions,users}); this.events=[]; }
  snapshot() { return structuredClone(this.#state); }
  // Explicit fixture-only adversarial mutation, never a business API.
  fixture(change) { change(this.#state); }
  who(handle) {
    const who=accountContext(handle), u=this.users.get(who.uid);
    if (!u?.confirmed || u.banned || u.anonymous || this.sessions.get(who.session_id)!==who.uid) deny();
    return who;
  }
  async transaction(handle, fn) {
    const who=this.who(handle), before=this.#tail; let release;
    this.#tail=new Promise(r=>{release=r;}); this.events.push({type:'queued',uid:who.uid});
    await before;
    try {
      const confirmed=this.who(handle); // Recheck upstream identity after waiting.
      const state=structuredClone(this.#state);
      this.events.push({type:'begin',uid:who.uid});
      const result=await fn(state,confirmed);
      if(this.beforeCommit) await this.beforeCommit();
      this.#state=state; this.events.push({type:'commit',uid:who.uid});
      return structuredClone(result);
    } catch(e) { this.events.push({type:'rollback',uid:who.uid}); throw e; }
    finally { release(); }
  }
  qualified(state,who) {
    const s=state.security.get(who.uid), g=state.grants.get(who.uid+':'+who.session_id), now=this.clock();
    if (!s || !s.enabled || s.hold!==false || s.reason!=='none' || !Number.isSafeInteger(s.epoch) || !g || g.purpose!=='business' ||
        ![g.epoch,g.expires,g.absolute,g.issued,g.renewed].every(Number.isSafeInteger) ||
        g.issued>now || g.renewed>now ||
        g.epoch!==s.epoch || g.revoked!==null || g.expires<=now || g.absolute<=now) deny();
    return g;
  }
  async grant(handle,envelope) {
    return this.transaction(handle,async(state,who)=>{
      const p=await verifyTestProof(envelope,who,this), key=who.uid+':'+who.session_id;
      if(!state.security.has(who.uid) && p.action==='issue') state.security.set(who.uid,{enabled:true,hold:false,reason:'none',epoch:0});
      const security=state.security.get(who.uid);
      if(!security || p.epoch!==security.epoch || (p.action!=='revoke' &&
         (!security.enabled || security.hold!==false || security.reason!=='none'))) deny();
      const fingerprint=await sha256(new TextEncoder().encode(JSON.stringify(Object.entries(p).sort())+envelope.signature));
      const old=state.proofs.get(p.proof_id);
      if(old) {
        if(old.fingerprint!==fingerprint) deny();
        if(p.action!=='revoke') this.qualified(state,who);
        return old.result;
      }
      let g=state.grants.get(key); const now=this.clock();
      if(p.action==='issue') {
        if(g) deny();
        g={id:crypto.randomUUID(),uid:who.uid,sid:who.session_id,epoch:p.epoch,purpose:'business',
          issued:now,renewed:now,expires:now+1800,absolute:now+43200,revoked:null}; state.grants.set(key,g);
      } else if(p.action==='renew') {
        this.qualified(state,who); g.renewed=now; g.expires=Math.min(now+1800,g.absolute);
      } else {
        if(!g || g.epoch!==p.epoch) deny();
        g.revoked??=now;
      }
      if(this.clock()>=p.expires_at) deny();
      const result={grant_id:g.id,status:g.revoked===null?'active':'revoked',expires_at:g.expires};
      state.proofs.set(p.proof_id,{fingerprint,result}); return result;
    });
  }
  async create(handle,value) {
    const result=await this.transaction(handle,async(state,who)=>{
      this.qualified(state,who); const input=createInput(value), digest=await sha256(createBytes(input));
      const requestKey=who.uid+':'+input.request_id, prior=state.operations.get(requestKey);
      if(prior) { if(prior.digest!==digest) deny('REQUEST_CONFLICT',409); this.complete(state,who,prior.result.site_id); return prior.result; }
      if([...state.sites.values()].some(s=>s.owner===who.uid)) deny('REQUEST_CONFLICT',409);
      const hostname=input.slug+'.sites.example.test';
      if(state.domains.has(hostname)) deny('REQUEST_CONFLICT',409);
      const id=crypto.randomUUID();state.sites.set(id,{owner:who.uid,status:'active',revision:0});
      state.members.set(id,{uid:who.uid,role:'owner',state:'active'});
      state.publications.set(id,{state:'unpublished',snapshot_id:null,publication_revision:0});
      if(this.failAt==='publication') throw Error('SIMULATED initialization failure');
      state.domains.set(hostname,id);state.locales.set(id,['zh','en']);state.settings.set(id,{default_locale:input.default_locale});
      state.sections.set(id,{introduction:0}); const entry=crypto.randomUUID();state.entries.set(id,{id:entry,position:0});
      state.translations.set(id,{zh:'请填写个人介绍。',en:'Add your introduction.'});
      const result={schema_version:1,request_id:input.request_id,site_id:id,persisted:true,publication:state.publications.get(id)};
      state.operations.set(requestKey,{digest,result});state.revisions.set(id,{revision:0});state.audits.set(id,{action:'create_site'});
      if(this.failAt==='audit') throw Error('SIMULATED audit failure');
      this.complete(state,who,id);return result;
    });
    if(this.loseResponse) throw Error('SIMULATED committed response lost');
    return result;
  }
  complete(state,who,id) {
    const s=state.sites.get(id),m=state.members.get(id);
    if(!s || s.owner!==who.uid || s.status!=='active' || m?.uid!==who.uid || m.role!=='owner' ||
       m.state!=='active' || !state.publications.has(id)) deny();
  }
  async readOperation(handle,input) {
    const who=this.who(handle),s=this.#state;this.qualified(s,who);createInput(input);
    const prior=s.operations.get(who.uid+':'+input.request_id);
    if(!prior)return {status:'not_observed'};
    if(prior.digest!==await sha256(createBytes(input)))deny('REQUEST_CONFLICT',409);
    this.complete(s,who,prior.result.site_id);return {status:'succeeded',result:structuredClone(prior.result)};
  }
  async mine(handle) {
    const who=this.who(handle),s=this.#state;this.qualified(s,who);
    const site=[...s.sites].find(([,r])=>r.owner===who.uid && r.status==='active');
    if(!site)return {schema_version:1,site:null};this.complete(s,who,site[0]);
    return {schema_version:1,site:{id:site[0],draft_revision:0},capabilities:{read:true,edit:false,publish:false}};
  }
  async readIntroduction(handle,id) {
    const who=this.who(handle),s=this.#state;this.qualified(s,who);this.complete(s,who,id);
    return {schema_version:1,site_id:id,section_revision:0,draft_revision:0,
      entries:[{...s.entries.get(id),translations:structuredClone(s.translations.get(id))}]};
  }
}
