// Candidate orchestration only. No drivers, listener, CLI, credentials, network or key defaults.
// A future separately sealed host provides per-operation durable approval, fresh identity and
// read-only evidence adapters. The issuance/verification implementation is the actual Worker module.
import { deepStrictEqual, ok } from 'node:assert';
import { createR3Issuer, createRegisteredGrantService } from './fixtures/verifier.mjs';
import { boundAccountContext } from '../../lib/business/identity.mjs';
import {BusinessError,  grantBytes, sha256, uuid} from '../../lib/business/protocol.mjs';
import {PROJECT} from './fixtures/binding.mjs';
import { authIssuer } from './fixtures/binding.mjs';

const users = {alice:'a33b0000-0000-4000-8000-000000000001', bob:'a33b0000-0000-4000-8000-000000000002'};
const sequence = Object.freeze([
  'aliceIssueRace','aliceReplay','unregistered','bobIssue','aliceRenew','staleEpoch',
  'expiredTicket','aliceRevoke','revokedRenew','bobExpiredGrant'
]);
export const r3Sequence = sequence;
const skipIssue = new Set(['aliceReplay','unregistered','bobExpiredGrant']);
const purpose = {aliceIssueRace:'issue',bobIssue:'issue',aliceRevoke:'revoke'};

// Frozen M5 prosrc, unchanged in M7. Lines are inside prosrc, including its initial newline.
// Source and PID come from the independent observer, never from public error text.
const apply='abe8ebce29746194320a6388ac10063de34cc8dd883dbc761958c56d5cf5c767';
const frames={
  aliceIssueRace:[apply,18],aliceReplay:[apply,18],staleEpoch:[apply,13],revokedRenew:[apply,31],
  unregistered:['9cc69d4ca9f4d377188d5a17e93f4c1f070c753d1621b35ad82b13aa4af9f0e1',14],
  expiredTicket:['d02ff32f8978a8f1f50f3a1915b122e06b06aecf1c0d558d3d383deb055df897',43],
  bobExpiredGrant:['325f872316c35321a81ba343321dfda9143074fa035b9f4132e7937fb6aa3db3',7]
};

function checkRead(s, scope) {
  ok(s?.readOnly === true && s.rollback === true && Number.isSafeInteger(s.backendPid) && s.backendPid>0);
  ok(s.gatesOpen===true && s.sessionActive===true && s.generationActive===true && s.currentEpoch===scope.epoch && Number.isSafeInteger(s.dbNow));
  ok([s.tickets,s.receipts,s.grants].every(n => n===0 || n===1));
  ok(/^[a-f0-9]{64}$/.test(s.protectedSha));
  ok(s.grants ? uuid(s.grantId) && /^[a-f0-9]{64}$/.test(s.grantSha) &&
    Number.isSafeInteger(s.grantExpiry) && typeof s.revoked==='boolean' :
    s.grantId===null && s.grantSha===null && s.grantExpiry===null && s.revoked===null);
}
class UnexpectedSuccess extends Error {}
function denied(e) {return e instanceof BusinessError && e.code==='BUSINESS_DENIED' && e.status===403;}
async function requireDenial(fn) {
  try {await fn();} catch(e) {if (denied(e)) return; throw e;}
  throw new UnexpectedSuccess();
}

export function prepareR3Batch(host) {
  let position=0, busy=false, stopped=false;
  let aliceTicket;
  const seenIds=new Set(), grantIds=new Map(), scopes=new Map();
  const history=[];
  const receipt = () => history.map(r=>({...r}));
  async function next(name) {
    if (!host || stopped || busy || name!==sequence[position]) throw new Error('NOT_READY');
    busy=true;
    let observation, before, proof, context;
    let dispatched=false, claiming=false, result='STOP', rpcCalls=0, finalRead='NOT_RUN';
    try {
      const actor = name.startsWith('bob') ? 'bob' : 'alice';
      // Context comes only from the trusted process, never directly from HTTP/JSON.
      context=await host.context(name);
      const {identity,handle,clock,keyId,epoch,proofId,sessionId}=context;
      const who=boundAccountContext(handle,identity,authIssuer);
      ok(who.uid===users[actor] && who.session_id===sessionId && uuid(proofId));
      ok(Number.isSafeInteger(epoch) && epoch>=0 && /^[a-zA-Z0-9_-]{1,40}$/.test(keyId));
      if (scopes.has(actor)) deepStrictEqual(scopes.get(actor),[sessionId,epoch,keyId]);
      else scopes.set(actor,[sessionId,epoch,keyId]);
      const id=name==='aliceReplay' ? aliceTicket.proof_id : proofId;
      if(name==='aliceReplay') ok(proofId===id);
      else {ok(!seenIds.has(id));seenIds.add(id);}
      observation=Object.freeze({project:PROJECT,name,actor,uid:who.uid,sid:sessionId,id,keyId,epoch});
      before=await host.observe(observation); checkRead(before,observation);
      const isReplay=name==='aliceReplay';
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
      if(actor==='alice') ok(epoch>=1); // A lower, nonnegative epoch must exist for the sealed stale-epoch case.
      if(isReplay || name==='unregistered') ok(clock()<aliceTicket.expires_at);
      if(name==='unregistered') {
        ok(before.revoked===false && before.grantExpired===false);
        const request={...aliceTicket,proof_id:id,action:'renew',event:'account-session'};
        proof=Object.freeze({...request,payload_digest:await sha256(grantBytes(request))});
      }
      else if(isReplay) proof=aliceTicket;
      const action=purpose[name]??'renew';
      // claimOnce is a protected, persistent consume (including cross-process reuse) and is
      // scoped to this sealed name, id, source bundle, fixture, target, and operation budget.
      claiming=true;
      const admitted=await host.claimOnce(observation);
      if(admitted!==true && admitted!==false) throw new Error('CLAIM_UNKNOWN');
      claiming=false;
      if(!admitted) throw new Error('NOT_APPROVED');
      const nominal = ['aliceIssueRace','aliceRenew','aliceRevoke','bobIssue'].includes(name);
      const deniedAtRpc = ['unregistered','aliceReplay','staleEpoch','expiredTicket','revokedRenew','bobExpiredGrant'].includes(name);
      const send = async (handle,envelope) => {
        rpcCalls++;
        if(rpcCalls>(name==='aliceIssueRace'?2:1)) throw new Error('RPC_BUDGET');
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
          if(name!=='aliceIssueRace') return send(h,envelope);
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
      ok(rpcCalls===(name==='aliceIssueRace'?2:1));
      const after=await host.observe(observation,proof);checkRead(after,observation);
      ok(after.backendPid!==before.backendPid && after.protectedSha===before.protectedSha);
      ok(after.tickets===before.tickets+Number(!skipIssue.has(name)));
      ok(after.receipts===before.receipts+Number(nominal));
      ok(after.grants===before.grants+Number(action==='issue' && nominal));
      if(name==='expiredTicket') ok(after.dbNow>=proof.expires_at);
      if(['aliceReplay','unregistered','staleEpoch','revokedRenew'].includes(name)) ok(after.dbNow<proof.expires_at);
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
      if (name==='aliceIssueRace' || name==='aliceReplay' || deniedAtRpc) {
        // A sanitized HTTP 403 conflates authentication, ACL, and business errors. The
        // trusted backend must correlate one bounded diagnostic to this request/fixture.
        const reason=await host.denialEvidence(observation);
        const branches={
          aliceIssueRace:'already_consumed',aliceReplay:'already_consumed',unregistered:'ticket_absent',
          staleEpoch:'epoch_mismatch',expiredTicket:'ticket_expired',revokedRenew:'revoked_grant',
          bobExpiredGrant:'grant_expired'
        };
        ok(reason?.branch===branches[name] && reason.state==='42501' && reason.project===PROJECT &&
          reason.id===id && reason.name===name && reason.uid===who.uid && reason.sid===sessionId &&
          Number.isSafeInteger(reason.pid) && reason.pid>0);
        deepStrictEqual([reason.bodySha,reason.raiseLine],frames[name]);
        if (name==='aliceIssueRace') {
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
      if(name==='aliceIssueRace') {
        aliceTicket=proof;
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
  return Object.freeze({next,receipt});
}
