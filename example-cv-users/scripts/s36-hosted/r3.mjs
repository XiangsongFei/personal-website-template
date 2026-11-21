import {openSync,writeFileSync,fsyncSync,closeSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {businessBinding} from './compat/binding.mjs';
import {boundAccountContext,loginContext} from '../../lib/business/identity.mjs';
import {verifySecurityEnvelope} from '../../lib/business/r3-verifier.mjs';
import {exact,uuid,deny,validateProof,grantBytes,proofBytes,sha256,hex} from '../../lib/business/protocol.mjs';

const usedLogins = new WeakSet();

export function writeOnce(path,value) {
  const directory=resolve(path,'..');
  const stat=lstatSync(directory);
  if (realpathSync(directory)!==directory || !stat.isDirectory() || stat.uid!==process.getuid() || stat.mode&0o077)
    throw new Error('PRIVATE_JOURNAL_DIRECTORY_REQUIRED');
  const fd=openSync(path,'wx',0o600);
  try { writeFileSync(fd,JSON.stringify(value)+'\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  const dir=openSync(directory,'r');
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

export async function generation(project,value) {
  exact(value,['project','id','keyHex','notBefore','signUntil','verifyUntil']);
  if (value.project!==project || !/^[a-zA-Z0-9_-]{1,40}$/.test(value.id) ||
      !/^[0-9a-f]{64}$/.test(value.keyHex) ||
      ![value.notBefore,value.signUntil,value.verifyUntil].every(Number.isSafeInteger) ||
      !(0<=value.notBefore && value.notBefore<value.signUntil && value.signUntil<=value.verifyUntil))
    deny('INVALID_GENERATION',400);
  const macKey=await crypto.subtle.importKey('raw',Buffer.from(value.keyHex,'hex'),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const {id,notBefore,signUntil,verifyUntil}=value;
  return Object.freeze({project,id,notBefore,signUntil,verifyUntil,revoked:false,macKey});
}

export function issueGrant(options) { return submitGrant({...options,handle:options.login?.handle,action:'issue'}); }
export function revokeGrant(options) { return submitGrant({...options,action:'revoke'}); }

async function submitGrant({binding,identity,login,handle=login?.handle,approval,key,registrar,repository,journalDir,action,
  clock=()=>Math.floor(Date.now()/1000)}) {
  const scope=businessBinding(binding);
  if (!scope) deny('NOT_CONFIGURED',503);
  const {project,authIssuer}=scope;
  const receipt=login?.receipt;
  const issuing=action==='issue';
  const who=boundAccountContext(handle,identity,authIssuer);
  exact(approval,['uid','proofId','epoch','validFrom','expiresAt']);
  const now=clock();
  if ((issuing && loginContext(receipt).handle!==handle) || approval.uid!==who.uid || !uuid(approval.proofId) ||
      approval.epoch!==0 || ![approval.validFrom,approval.expiresAt,now].every(Number.isSafeInteger) ||
      !(approval.validFrom<=now && now<approval.expiresAt && approval.expiresAt-approval.validFrom<=1800) ||
      key.project!==project || key.revoked!==false || !(key.notBefore<=now && now<key.signUntil))
    deny('INVALID_INTENT');
  const proof={version:1,project,action,purpose:'business',uid:who.uid,session_id:who.session_id,
    epoch:approval.epoch,proof_id:approval.proofId,issued_at:now,
    expires_at:Math.min(now+60,approval.expiresAt,key.verifyUntil),payload_digest:'',key_id:key.id,event:issuing?'password-login':'account-session'};
  proof.payload_digest=await sha256(grantBytes(proof));
  validateProof(proof,project);
  if (issuing) {
    if (usedLogins.has(receipt)) deny('FRESH_PASSWORD_LOGIN_REQUIRED');
    usedLogins.add(receipt);
  }
  // Reserve the approved proof ID before signing. An ambiguous attempt remains consumed.
  writeOnce(join(journalDir,project+'-'+proof.proof_id+'.json'),proof);
  if (issuing && loginContext(receipt).handle!==handle) deny('FRESH_PASSWORD_LOGIN_REQUIRED');
  const signature=hex(await crypto.subtle.sign('HMAC',key.macKey,proofBytes(proof)));
  const checked=await verifySecurityEnvelope(action,handle,{proof,signature},
    {binding,identity,enabled:true,clock,lookupKey:async keyId=>keyId===key.id?key:null});
  await registrar(checked);
  boundAccountContext(handle,identity,authIssuer);
  if (clock()>=checked.expires_at) deny('PROOF_EXPIRED_AFTER_REGISTRATION');
  const result=await repository.grant(handle,{proof:checked});
  if (!uuid(result?.grant_id) || result.status!==(issuing?'active':'revoked') || !Number.isFinite(Date.parse(result.expires_at)))
    deny('COMMIT_UNKNOWN',503);
  return result;
}
