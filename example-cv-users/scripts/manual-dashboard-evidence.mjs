// Local byte checks over user-delivered Dashboard exports. Never claims a Codex cloud read.
import {createHash} from 'node:crypto';
export const MANUAL_POLICY='recovery-manual-dashboard-receipt-v1';
export const MANUAL_BATCH_ID='S2-USERS-REAL-R-RECOVERY-20261106-02';
export const MANUAL_R03_BATCH_ID='S2-USERS-REAL-R-RECOVERY-20261106-03';
export const isManualBatchId=id=>id===MANUAL_BATCH_ID||id===MANUAL_R03_BATCH_ID;
export const MANUAL_SOURCE='MANUAL_DASHBOARD_RECHECK';
const PROJECT='makwjnbubmrmopjhzror',UID='656d2712217564e0900bb29b57942863750190364d7a76e6beaab20d42877f86';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('manual_dashboard_evidence_denied');};
const exact=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const TURL=`https://supabase.com/dashboard/project/${PROJECT}/auth/templates/reset-password`;
export const MANUAL_FIELDS=Object.freeze({
 project:['projectName','projectRef'],account:['exists','uidSha256','emailConfirmed','banned','deleted'],
 email:['enabled','confirmEmail'],password:['requireCurrentPassword','securePasswordChange','minimumLength','characterRequirements','leakedProtection'],
 otp:['digits','expiresSeconds','minimumSendIntervalSeconds','passwordChangedNotification'],
 limits:['emailPerHour','verifyPer5Minutes','loginPer5Minutes','refreshPer5Minutes'],
 sessions:['jwtSeconds','rotation','reuseSeconds','timeBoxHours','inactivityHours','singleSession']
});
const PAGES={project:'settings/general',account:'auth/users',email:'auth/providers',password:'auth/providers',otp:'auth/providers;auth/rate-limits;auth/templates',limits:'auth/rate-limits',sessions:'auth/sessions'};
export function verifyManualEvidence({batch,candidateBytes,evidence,now=Date.now()}){
 if(!isManualBatchId(batch.id)||batch.project!==PROJECT||batch.profile!=='recovery-only-v1'||batch.approvalPolicy!==MANUAL_POLICY||batch.configurationLiveRead!==MANUAL_SOURCE
  ||evidence.source!==MANUAL_SOURCE||evidence.codexIndependentCloudRead!==false||evidence.batchId!==batch.id||evidence.project!==PROJECT||evidence.uidSha256!==UID
  ||batch.accounts?.A?.userIdSha256!==UID||evidence.candidateSha256!==sha(candidateBytes)||evidence.toolingSha256!==batch.toolingSha256
  ||!exact(evidence.templatePlan,batch.templatePlan)||evidence.userConfirmed!==true||typeof evidence.confirmationReference!=='string'||!evidence.confirmationReference.trim())fail();
 const times=[];
 function attested(r,page){
  if(!r||r.source!==MANUAL_SOURCE||r.batchId!==batch.id||r.project!==PROJECT||r.page!==page||r.userConfirmed!==true
   ||typeof r.confirmationReference!=='string'||!r.confirmationReference.trim()||!Number.isSafeInteger(r.observedAt)||r.observedAt>now||now-r.observedAt>3600000)fail();times.push(r.observedAt);
 }
 if(!Array.isArray(evidence.configRecords)||evidence.configRecords.length!==Object.keys(MANUAL_FIELDS).length)fail();
 const values={};
 for(const [section,fields] of Object.entries(MANUAL_FIELDS)){
  const rows=evidence.configRecords.filter(x=>x.section===section);if(rows.length!==1)fail();const r=rows[0];attested(r,PAGES[section]);
  if(!r.values||!exact(Object.keys(r.values).sort(),[...fields].sort()))fail();values[section]=r.values;
 }
 const v=values;
 if(v.project.projectName!=='example-cv-users'||v.project.projectRef!==PROJECT||v.account.uidSha256!==UID||v.account.exists!==true||v.account.emailConfirmed!==true||v.account.banned!==false||v.account.deleted!==false
  ||v.email.enabled!==true||v.email.confirmEmail!==true||v.password.requireCurrentPassword!==true||v.password.securePasswordChange!==false||v.password.minimumLength!==8||v.password.characterRequirements!=='none'||v.password.leakedProtection!==false
  ||v.otp.digits!==6||v.otp.expiresSeconds!==120||v.otp.minimumSendIntervalSeconds!==60||v.otp.passwordChangedNotification!==true
  ||v.limits.emailPerHour!==30||v.limits.verifyPer5Minutes!==30||v.limits.loginPer5Minutes!==30||v.limits.refreshPer5Minutes!==150
  ||v.sessions.jwtSeconds!==3600||v.sessions.rotation!==true||v.sessions.reuseSeconds!==10||v.sessions.timeBoxHours!==0||v.sessions.inactivityHours!==0||v.sessions.singleSession!==false)fail();
 if(!Array.isArray(evidence.templateReads)||evidence.templateReads.length!==3)fail();
 const decoded={};const operations=new Set();
 for(const stage of ['baseline-first','baseline-reread','code-reread']){
  const rows=evidence.templateReads.filter(x=>x.stage===stage);if(rows.length!==1)fail();const r=rows[0];attested(r,'auth/templates/reset-password');
  if(r.url!==TURL||r.template!=='Reset password'||r.fullBodyCopied!==true||r.fullSubjectCopied!==true||typeof r.reopenedFromDashboard!=='boolean'||stage!=='baseline-first'&&r.reopenedFromDashboard!==true||!r.copyOperationId||operations.has(r.copyOperationId))fail();operations.add(r.copyOperationId);
  const item={};
  for(const field of ['body','subject']){
   const encoded=r[field+'Base64'];if(typeof encoded!=='string'||encoded.length>140000)fail();const bytes=Buffer.from(encoded,'base64');
   if(bytes.toString('base64')!==encoded||!bytes.length||bytes.length>100000||sha(bytes)!==r[field+'Sha256'])fail();
   let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail();}
   if(text.startsWith('\ufeff')||text.startsWith('{\\rtf'))fail();item[field]=bytes;
  }
  decoded[stage]=item;
 }
 const a=decoded['baseline-first'],b=decoded['baseline-reread'],c=decoded['code-reread'];
 const first=evidence.templateReads.find(r=>r.stage==='baseline-first'),second=evidence.templateReads.find(r=>r.stage==='baseline-reread'),last=evidence.templateReads.find(r=>r.stage==='code-reread');
 if(first.observedAt>=second.observedAt||second.observedAt>=last.observedAt||!a.subject.equals(b.subject)||!a.body.equals(b.body)||!a.subject.equals(c.subject)
  ||sha(a.body)!==batch.templatePlan.beforeBodySha256||sha(a.subject)!==batch.templatePlan.beforeSubjectSha256||sha(c.body)!==batch.templatePlan.codeBodySha256
  ||!a.body.includes(Buffer.from('{{ .ConfirmationURL }}'))||!c.body.includes(Buffer.from('{{ .Token }}'))||c.body.includes(Buffer.from('{{ .ConfirmationURL }}'))||c.body.includes(Buffer.from('{{ .TokenHash }}')))fail();
 if(evidence.readAt!==Math.min(...times))fail();
 return {source:MANUAL_SOURCE,localBytesVerified:true,codexIndependentCloudRead:false,oldestObservationAt:evidence.readAt,expiresAt:evidence.readAt+3600000};
}
