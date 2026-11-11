// Versioned minimal-first sequence derived from the sealed r3-batch-program.mjs.
// Candidate orchestration only. No drivers, listener, CLI, credentials, network or key defaults.
// A future separately sealed host provides per-operation durable approval, fresh identity and
// read-only evidence adapters. The issuance/verification implementation is the actual Worker module.
import { deepStrictEqual, ok } from 'node:assert';
import { createR3Issuer, createRegisteredGrantService } from './fixtures/verifier.mjs';
import { boundAccountContext } from '../../lib/business/identity.mjs';
import {BusinessError,  grantBytes, sha256, uuid, validateProof} from '../../lib/business/protocol.mjs';
import {PROJECT} from './fixtures/binding.mjs';
import { authIssuer, registrarHost } from './fixtures/binding.mjs';

const users = {alice:'a33b0000-0000-4000-8000-000000000001', bob:'a33b0000-0000-4000-8000-000000000002'};
const sequence = Object.freeze([
  'aliceIssue','bobIssueRace','bobReplay','bobUnregistered','aliceRenew','staleEpoch',
  'expiredTicket','aliceRevoke','revokedRenew','bobExpiredGrant'
]);
export const firstGrantSequence = sequence;
const hash = v => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const version='r3-first-grant-v1';
export const firstBudget=Object.freeze({registration:1, rpc:1, physicalHttp:7, tickets:1, receipts:1, grants:1});
export const followupBudget=Object.freeze({registration:6, rpc:10, physicalHttp:70, tickets:6, receipts:3, grants:1});
const skipIssue = new Set(['bobReplay','bobUnregistered','bobExpiredGrant']);
const purpose = {bobIssueRace:'issue',aliceIssue:'issue',aliceRevoke:'revoke'};

// Frozen M5 prosrc, unchanged in M7. Lines are inside prosrc, including its initial newline.
// Source and PID come from the independent observer, never from public error text.
const apply='abe8ebce29746194320a6388ac10063de34cc8dd883dbc761958c56d5cf5c767';
const frames={
  bobIssueRace:[apply,18],bobReplay:[apply,18],staleEpoch:[apply,13],revokedRenew:[apply,31],
  bobUnregistered:['9cc69d4ca9f4d377188d5a17e93f4c1f070c753d1621b35ad82b13aa4af9f0e1',14],
  expiredTicket:['d02ff32f8978a8f1f50f3a1915b122e06b06aecf1c0d558d3d383deb055df897',43],
  bobExpiredGrant:['325f872316c35321a81ba343321dfda9143074fa035b9f4132e7937fb6aa3db3',7]
};

function checkRead(s, scope) {
  ok(s?.readOnly === true && s.rollback === true && Number.isSafeInteger(s.backendPid) && s.backendPid>0);
  ok(s.gatesOpen===true && s.sessionActive===true && s.generationActive===true && s.currentEpoch===scope.epoch && Number.isSafeInteger(s.dbNow));
  ok([s.tickets,s.receipts,s.grants].every(n => n===0 || n===1));
  ok(hash(s.protectedSha) && hash(s.retainedSha));
  ok(s.grants ? uuid(s.grantId) && /^[a-f0-9]{64}$/.test(s.grantSha) &&
    Number.isSafeInteger(s.grantExpiry) && typeof s.revoked==='boolean' :
    s.grantId===null && s.grantSha===null && s.grantExpiry===null && s.revoked===null);
}
// These are normalized receipts from separately trusted, pinned observers.
// Neither a public request, a caller-supplied JSON object nor this code can attest live transport.
function checkConnections(record) {
  ok(record?.project===PROJECT && record.m7Sha==='44cbfa6ef26f681abc1604a29bed4f3f15d884533bec5b3043fe919a397018a6');
  for(const [label,login] of [['api','ecv_s3_internal_api_login'],['registrar','ecv_s3_registration_login']]) {
    const receipt=record[label];
    ok(receipt?.sessionUser===login && receipt.project===PROJECT && receipt.database==='postgres' &&
       receipt.version===170011 && receipt.session_ok===true && receipt.database_ok===true &&
       receipt.transport_ok===true && receipt.readonly===true && receipt.rollback===true);
  }
  ok(['peer','verify-full'].includes(record.api.transport) &&
     record.registrar.transport==='verify-full' && record.registrar.host===registrarHost &&
     record.registrar.clientCertificateVerified===true);
  ok(record.publicSchemas==='public' && record.privateIngressVerified===true);
}

function checkMeters(m,scope,registration,rpc) {
  ok(m?.project===PROJECT && m.name===scope.name && m.id===scope.id && m.sid===scope.sid && m.uid===scope.uid);
  ok(m.intentClaims===registration && m.registerSql===registration && m.signatures===registration && m.userRpc===rpc);
  ok(m.retries===0 && m.authWrites===0 && m.siteWrites===0 && m.unclassifiedHops===0);
  const counts=[m.outer,m.workerAuth,m.privateIngress,m.ingressAuth,m.postgrest];
  ok(counts.every(n=>Number.isSafeInteger(n) && n>=0) && m.outer>=1 && m.outer<=rpc && m.workerAuth<=2*rpc &&
     m.privateIngress===rpc && m.ingressAuth>=rpc && m.ingressAuth<=2*rpc && m.postgrest===rpc &&
     m.physicalHttp===counts.reduce((a,b)=>a+b,0) && m.physicalHttp<=7*rpc);
}
class UnexpectedSuccess extends Error {}
function denied(e) {return e instanceof BusinessError && e.code==='BUSINESS_DENIED' && e.status===403;}
async function requireDenial(fn) {
  try {await fn();} catch(e) {if (denied(e)) return; throw e;}
  throw new UnexpectedSuccess();
}

// One instance may only perform its approved phase. A different future host
// process has to re-check the first approval and DB state before any followup.
export function prepareFirstGrant(host) { return program(host,null); }
export async function prepareGrantFollowup(host) {
  if(!host) throw new Error('NOT_READY');
  // Private verifier checks the sealed approval/CONSUMED receipt, full before
  // and after transcripts, identifiers, and first successful operation.
  const checkpoint=await host.verifiedFirstGrant();
  ok(checkpoint.version===version && checkpoint.project===PROJECT && checkpoint.name==='aliceIssue');
  const {grantId}=checkpoint;
  const proof=Object.freeze({...checkpoint.proof});
  validateProof(proof,PROJECT);
  ok(proof.project===PROJECT && proof.action==='issue' && proof.uid===users.alice && uuid(grantId));
  ok(proof.epoch>=1); // The later old-epoch control needs a valid lower epoch.
  ok(proof.payload_digest===await sha256(grantBytes(proof)));
  const scope=Object.freeze({project:PROJECT,name:'aliceIssue',actor:'alice',uid:proof.uid,
    sid:proof.session_id,id:proof.proof_id,keyId:proof.key_id,epoch:proof.epoch});
  checkConnections(await host.connectionEvidence());
  const observed=await host.observe(scope,proof);
  checkRead(observed,scope);
  ok(observed.tickets===1 && observed.receipts===1 && observed.grants===1 && observed.grantId===grantId &&
     observed.ticketMatches===true && observed.receiptMatches===true && observed.revoked===false &&
     observed.grantExpired===false && observed.grantExpiry>observed.dbNow);
  return program(host,Object.freeze({scope,grantId}));
}

function program(host, first) {
  let position=first ? 1 : 0, busy=false, stopped=false;
  let bobTicket, handoff=null;
  const seenIds=new Set(), grantIds=new Map(), scopes=new Map();
  if(first) {
    seenIds.add(first.scope.id);
    grantIds.set('alice',first.grantId);
    scopes.set('alice',[first.scope.sid,first.scope.epoch,first.scope.keyId]);
  }
  const history=[];
  const receipt = () => history.map(r=>({...r}));
  async function next(name) {
    if (!host || stopped || busy || (!first && position!==0) || name!==sequence[position]) throw new Error('NOT_READY');
    busy=true;
    let observation, before, proof, context;
    let dispatched=false, claiming=false, result='STOP', rpcCalls=0, finalRead='NOT_RUN';
    try {
      const actor = name.startsWith('bob') ? 'bob' : 'alice';
      checkConnections(await host.connectionEvidence());
      // Context comes only from the trusted process, never directly from HTTP/JSON.
      context=await host.context(name);
      const {identity,handle,clock,keyId,epoch,proofId,sessionId}=context;
      const who=boundAccountContext(handle,identity,authIssuer);
      ok(who.uid===users[actor] && who.session_id===sessionId && uuid(proofId));
      ok(Number.isSafeInteger(epoch) && epoch>=0 && /^[a-zA-Z0-9_-]{1,40}$/.test(keyId));
      if (scopes.has(actor)) deepStrictEqual(scopes.get(actor),[sessionId,epoch,keyId]);
      else scopes.set(actor,[sessionId,epoch,keyId]);
      const id=name==='bobReplay' ? bobTicket.proof_id : proofId;
      if(name==='bobReplay') ok(proofId===id);
      else {ok(!seenIds.has(id));seenIds.add(id);}
      observation=Object.freeze({version,project:PROJECT,name,actor,uid:who.uid,sid:sessionId,id,keyId,epoch});
      before=await host.observe(observation); checkRead(before,observation);
      const isReplay=name==='bobReplay';
      ok(before.tickets===Number(isReplay) && before.receipts===Number(isReplay));
      ok(before.grants===Number(grantIds.has(actor)));
      if(before.grants) ok(before.grantId===grantIds.get(actor));
      if(name==='bobExpiredGrant') {
        // The host schedules this stage at natural expiry; the original JWT still must be valid.
        ok(clock()>=before.grantExpiry && before.grantExpired===true && before.revoked===false);
      }
      if(name==='revokedRenew') ok(before.revoked===true && before.grantExpired===false);
      if (before.grants && !['revokedRenew','bobExpiredGrant'].includes(name))
        ok(before.revoked===false && before.grantExpired===false);
      if(first && actor==='alice') ok(epoch>=1); // A lower, nonnegative epoch must exist for the sealed stale-epoch case.
      if(isReplay || name==='bobUnregistered') ok(clock()<bobTicket.expires_at);
      if(name==='bobUnregistered') {
        ok(before.revoked===false && before.grantExpired===false);
        const request={...bobTicket,proof_id:id,action:'renew',event:'account-session'};
        proof=Object.freeze({...request,payload_digest:await sha256(grantBytes(request))});
      }
      else if(isReplay) proof=bobTicket;
      const action=purpose[name]??'renew';
      // claimOnce is a protected, persistent consume (including cross-process reuse) and is
      // scoped to this sealed name, id, source bundle, fixture, target, and operation budget.
      claiming=true;
      const admitted=await host.claimOnce(observation);
      if(admitted!==true && admitted!==false) throw new Error('CLAIM_UNKNOWN');
      claiming=false;
      if(!admitted) throw new Error('NOT_APPROVED');
      const nominal = ['bobIssueRace','aliceRenew','aliceRevoke','aliceIssue'].includes(name);
      const deniedAtRpc = ['bobUnregistered','bobReplay','staleEpoch','expiredTicket','revokedRenew','bobExpiredGrant'].includes(name);
      const send = async (handle,envelope) => {
        rpcCalls++;
        if(rpcCalls>(name==='bobIssueRace'?2:1)) throw new Error('RPC_BUDGET');
        return context.repository.grant(handle,envelope);
      };
      let returned, callsToApply=0;
      dispatched=true;
      if (skipIssue.has(name)) {
        if (name==='bobExpiredGrant') {rpcCalls++;await requireDenial(()=>context.repository.mine(handle));}
        else await requireDenial(()=>send(handle,{proof}));
      } else {
        const repository={grant:async(h,envelope)=>{
          ok(h===handle && ++callsToApply===1 && envelope.proof.proof_id===id);
          proof=envelope.proof;
          if(name==='expiredTicket') {
            await host.waitUntil(proof.expires_at);
            ok(clock()>=proof.expires_at);
            boundAccountContext(handle,identity,authIssuer);
          }
          if(name!=='bobIssueRace') return send(h,envelope);
          const both=await Promise.allSettled([send(h,envelope),send(h,envelope)]);
          const passed=both.filter(r=>r.status==='fulfilled');
          const rejected=both.filter(r=>r.status==='rejected');
          if(passed.length!==1 || rejected.length!==1 || !denied(rejected[0].reason))
            throw new BusinessError('COMMIT_UNKNOWN',503);
          return passed[0].value;
        }};
        const verifier=createRegisteredGrantService({enabled:true,project:PROJECT,identity,
          lookupKey:context.lookupVerificationKey,registrar:context.registrar,repository,clock});
        const issuer=createR3Issuer({enabled:true,project:PROJECT,identity,
          intent:{project:PROJECT,action,...who,epoch:name==='staleEpoch'?epoch-1:epoch,proof_id:id,key_id:keyId},
          intentNamespace:context.intents,lookupSigningKey:context.lookupSigningKey,verifier,clock});
        const invoke=()=>issuer[action](handle,context.loginReceipt);
        if(deniedAtRpc) await requireDenial(invoke);
        else returned=await invoke();
        ok(callsToApply===1 && proof?.proof_id===id);
      }
      boundAccountContext(handle,identity,authIssuer);
      ok(rpcCalls===(name==='bobIssueRace'?2:1));
      const after=await host.observe(observation,proof);checkRead(after,observation);
      ok(after.backendPid!==before.backendPid && after.protectedSha===before.protectedSha && after.retainedSha===before.retainedSha);
      ok(after.tickets===before.tickets+Number(!skipIssue.has(name)));
      ok(after.receipts===before.receipts+Number(nominal));
      ok(after.grants===before.grants+Number(action==='issue' && nominal));
      if(name==='expiredTicket') ok(after.dbNow>=proof.expires_at);
      if(['bobReplay','bobUnregistered','staleEpoch','revokedRenew'].includes(name)) ok(after.dbNow<proof.expires_at);
      if(after.tickets) ok(after.ticketMatches===true);
      if(nominal) {
        ok(after.receiptMatches===true && uuid(returned.grant_id) && after.grantId===returned.grant_id &&
          after.revoked===(action==='revoke') && returned.status===(action==='revoke'?'revoked':'active'));
        if(before.grants) ok(after.grantId===before.grantId);
        ok(Math.floor(Date.parse(returned.expires_at)/1000)===after.grantExpiry);
        if(name==='aliceRenew') ok(after.grantSha!==before.grantSha && after.grantExpiry>=before.grantExpiry);
        grantIds.set(actor,returned.grant_id);
      } else {
        ok(after.grantSha===before.grantSha);
        if(isReplay) ok(after.receiptMatches===true);
      }
      if (name==='bobIssueRace' || name==='bobReplay' || deniedAtRpc) {
        // A sanitized HTTP 403 conflates authentication, ACL, and business errors. The
        // trusted backend must correlate one bounded diagnostic to this request/fixture.
        const reason=await host.denialEvidence(observation);
        const branches={
          bobIssueRace:'already_consumed',bobReplay:'already_consumed',bobUnregistered:'ticket_absent',
          staleEpoch:'epoch_mismatch',expiredTicket:'ticket_expired',revokedRenew:'revoked_grant',
          bobExpiredGrant:'grant_expired'
        };
        ok(reason?.branch===branches[name] && reason.state==='42501' && reason.project===PROJECT &&
          reason.id===id && reason.name===name && reason.uid===who.uid && reason.sid===sessionId &&
          Number.isSafeInteger(reason.pid) && reason.pid>0);
        deepStrictEqual([reason.bodySha,reason.raiseLine],frames[name]);
        if (name==='bobIssueRace') {
          const lock=await host.raceEvidence(observation);
          const legs=lock?.legs;
          ok(Array.isArray(legs) && legs.length===2 && legs.every((leg,i)=>
            leg.id===id && leg.ordinal===i+1 && leg.uid===who.uid && leg.sid===sessionId &&
            leg.login==='ecv_s3_internal_api_login' && leg.role==='authenticated' &&
            leg.rpc==='apply_business_grant' && Number.isSafeInteger(leg.issuedMs) &&
            Number.isSafeInteger(leg.completedMs) && Number.isSafeInteger(lock.observedMs) &&
            leg.issuedMs<=lock.observedMs && lock.observedMs<=leg.completedMs));
          ok(legs.filter(leg=>leg.pid===lock.loserPid && leg.state==='42501').length===1 &&
            legs.filter(leg=>leg.pid===lock.winnerPid && leg.state==='00000').length===1);
          ok(lock?.id===id && lock.loserPid===reason.pid && lock.waitEventType==='Lock' && lock.reason==='transactionid' &&
             lock.waiter===lock.loserPid && lock.blocker===lock.winnerPid && lock.winnerPid!==lock.loserPid &&
             Number.isSafeInteger(lock.winnerPid) && lock.winnerPid>0 && lock.observedBlocked===true &&
             lock.readOnly===true && lock.rollback===true);
        }
      }
      if(name==='bobIssueRace') {
        bobTicket=proof;
      }
      checkMeters(await host.meterEvidence(observation),observation,Number(!skipIssue.has(name)),rpcCalls);
      if(name==='aliceIssue') {
        ok(after.grantExpired===false && after.grantExpiry>after.dbNow);
        // Contains only the public ticket claims and grant ID. No bearer, password, or MAC.
        handoff=Object.freeze({version,project:PROJECT,name,proof,grantId:after.grantId});
      }
      finalRead='ROLLBACK'; result='ACCEPTED';position++;
    } catch(e) {
      stopped=true;
      result=claiming || (e instanceof BusinessError && e.code.endsWith('_UNKNOWN')) ||
        (dispatched && !(e instanceof UnexpectedSuccess) && !(e instanceof BusinessError) && !(e?.code==='ERR_ASSERTION')) ? 'UNKNOWN' : 'STOP';
      // Never copy an exception message from a driver/provider to the evidence.
      if(dispatched && observation) {
        try {const final=await host.observe(observation,proof);checkRead(final,observation);finalRead='ROLLBACK';}
        catch {result='UNKNOWN';finalRead='UNKNOWN';}
      }
    } finally {busy=false;history.push(Object.freeze({name,result,rpcCalls,finalRead}));}
    return {name,result};
  }
  return Object.freeze({next,receipt,checkpoint:()=>handoff});
}
