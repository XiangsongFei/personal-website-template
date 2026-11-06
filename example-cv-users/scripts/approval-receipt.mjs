import {MANUAL_POLICY,MANUAL_SOURCE,MANUAL_R03_BATCH_ID,verifyManualEvidence} from './manual-dashboard-evidence.mjs';
// Local operator authorization only. No provider credentials or authentication calls.
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
export const RUN_LEASE_MAX_MS=30*60000;
export const APPROVAL_POLICY='session-live-read-receipt-v1';
export const RECOVERY_APPROVAL_POLICY='recovery-live-read-receipt-v1';
// Live entry points have no implicit legacy mode. Offline tests opt in separately
// and validate synthetic accounts; an absent/unknown policy is never approval.
export function usesReceipt(batch){
  if(![APPROVAL_POLICY,RECOVERY_APPROVAL_POLICY,MANUAL_POLICY].includes(batch?.approvalPolicy))throw Error('approval_policy_denied');
  return true;
}
const receiptAccount=batch=>batch.accounts?.[batch.profile==='recovery-only-v1'?'A':'R'];
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const contexts=new WeakMap();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const deny=()=>{throw Error('approval_receipt_denied');};
export function inspectApproval({batch,candidateBytes,receipt,liveReadBytes,now=Date.now(),certificateValidTo}) {
  const evidence=JSON.parse(liveReadBytes);
  const manual=batch.approvalPolicy===MANUAL_POLICY;
  if(manual)verifyManualEvidence({batch,candidateBytes,evidence,now});
  // R03 retains R02's earlier cutoff. Its newly prepared window may be shorter,
  // never longer, than 12h; all existing batch policies retain their exact rule.
  const duration=batch.expiresAt-batch.preparedAtMs;
  const candidateWindowAllowed=manual&&batch.id===MANUAL_R03_BATCH_ID?duration>0&&duration<=12*3600000:duration===12*3600000;
  if(!equal(JSON.parse(candidateBytes),batch)||!usesReceipt(batch)
    ||!Number.isSafeInteger(batch.preparedAtMs)||!Number.isSafeInteger(batch.expiresAt)||!candidateWindowAllowed||batch.preparedAtMs>now
    ||!((batch.approvalPolicy===APPROVAL_POLICY&&batch.profile==='login-refresh-only-v1')||((batch.approvalPolicy===RECOVERY_APPROVAL_POLICY||manual)&&batch.profile==='recovery-only-v1'))||batch.authorization!=='PREPARED_NOT_APPROVED'||batch.executable!==false
    ||batch.expiresAt<=now||batch.configurationLiveRead!==(manual?MANUAL_SOURCE:'LIVE_READ')
    ||!receipt||receipt.schema!==1||receipt.policy!==batch.approvalPolicy||receipt.authorization!=='USER_APPROVED'
    ||!/^S2-APPROVAL-[A-Za-z0-9-]{16,100}$/.test(receipt.approvalReference??'')
    ||receipt.candidateSha256!==digest(candidateBytes)||receipt.toolingSha256!==batch.toolingSha256
    ||receipt.batchId!==batch.id||receipt.project!==batch.project||receipt.uidSha256!==receiptAccount(batch)?.userIdSha256
    ||!equal(receipt.scope,scopeFor(batch))||receipt.batchExpiresAt!==batch.expiresAt
    ||(manual?receipt.manualEvidenceSha256:receipt.liveReadSha256)!==digest(liveReadBytes)
    ||(manual?receipt.liveReadSha256!==undefined:receipt.manualEvidenceSha256!==undefined)
    ||receipt.userApproval?.source!=='USER_CHAT_EXPLICIT_APPROVAL'||receipt.userApproval.candidateSha256!==digest(candidateBytes)
    ||typeof receipt.userApproval.reference!=='string'||!receipt.userApproval.reference.trim()
    ||!Number.isSafeInteger(receipt.issuedAt)||receipt.issuedAt>now||!Number.isSafeInteger(receipt.expiresAt)
    ||receipt.expiresAt<=now||receipt.expiresAt<=receipt.issuedAt||receipt.expiresAt-receipt.issuedAt>3600000
    ||!Number.isSafeInteger(evidence.readAt)||evidence.readAt>now||now-evidence.readAt>3600000
    ||evidence.source!==(manual?MANUAL_SOURCE:'LIVE_READ')||evidence.project!==batch.project||evidence.uidSha256!==receipt.uidSha256
    ||!manual&&!['projectIdentity','emailProvider','confirmEmail','sessionPolicy','rateLimits','accountIdentity','accountConfirmed','accountNotBanned','accountNotDeleted'].every(k=>evidence.checks?.[k]===true)
    ||(!manual&&batch.profile==='recovery-only-v1'&&(!['recoveryPolicy','otpPolicy','mailPolicy','recoveryCodeTemplateReady'].every(k=>evidence.checks?.[k]===true)||!equal(evidence.templatePlan,batch.templatePlan)||evidence.resetPasswordBodySha256!==batch.templatePlan?.codeBodySha256||evidence.resetPasswordSubjectSha256!==batch.templatePlan?.beforeSubjectSha256))
    ||!Number.isFinite(certificateValidTo)||certificateValidTo-now<3600000)deny();
  const expiresAt=Math.min(now+RUN_LEASE_MAX_MS,batch.expiresAt,receipt.expiresAt,certificateValidTo-3600000);
  if(expiresAt<=now)deny();
  return {candidateSha256:digest(candidateBytes),receiptSha256:digest(JSON.stringify(receipt)),approvalReference:receipt.approvalReference,expiresAt};
}
export function scopeFor(batch){
  if(batch.profile==='recovery-only-v1')return {operations:['recover','verifyRecovery','passwordUpdate','passwordLogin','localLogout','getUser','jwks'],maxUpstreamTotal:batch.maxUpstreamTotal,identityRequests:batch.identityRequests,maxUpstreamRequests:batch.maxUpstreamRequests,primaryBrowser:batch.primaryBrowser,maxEmails:batch.maxEmails,runLeaseMaxMs:RUN_LEASE_MAX_MS,passwordStages:batch.passwordStages,templatePlan:batch.templatePlan,...(batch.approvalPolicy===MANUAL_POLICY?{evidencePolicy:MANUAL_POLICY,evidenceSource:MANUAL_SOURCE}:{})};
  return {operations:['passwordLogin','refresh','localLogout','getUser','jwks'],maxUpstreamTotal:batch.maxUpstreamTotal,identityRequests:batch.identityRequestsPerBrowser*2,maxUpstreamRequests:batch.maxUpstreamRequests,perBrowserLimits:batch.perBrowserLimits,browserOrder:batch.browserOrder,maxEmails:batch.maxEmails,runLeaseMaxMs:RUN_LEASE_MAX_MS};
}
export function claimApproval(input,leaseRoot) {
  const checked=inspectApproval(input);
  mkdirSync(leaseRoot,{recursive:true,mode:0o700});
  const st=lstatSync(leaseRoot);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)deny();
  const runId=randomUUID(),record={...checked,runId,batchId:input.batch.id,pid:process.pid,uid:process.getuid(),state:'CLAIMED_NO_RETRY'};
  // O_EXCL is the cross-process winner. Never remove either marker, even on error or UNKNOWN.
  for(const name of ['batch-'+checked.candidateSha256,'receipt-'+digest(checked.approvalReference)]) {
    const fd=openSync(resolve(leaseRoot,name+'.lease'),'wx',0o600);
    try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);}finally{closeSync(fd);}
    const directory=openSync(leaseRoot,'r');try{fsyncSync(directory);}finally{closeSync(directory);}
  }
  const context=Object.freeze({runId,expiresAt:checked.expiresAt});
  contexts.set(context,{...record,batchDigest:digest(JSON.stringify(input.batch)),toolingSha256:input.batch.toolingSha256,attached:false});
  return context;
}
export function checkRunContext(context,batch,now=Date.now(),attach=false){
  const r=contexts.get(context);
  if(!r||r.pid!==process.pid||r.uid!==process.getuid()||r.expiresAt<=now||r.batchDigest!==digest(JSON.stringify(batch))||r.toolingSha256!==batch.toolingSha256||attach&&r.attached)deny();
  if(attach)r.attached=true;
  return context;
}
