import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountContext,withCredential} from '../../lib/business/identity.mjs';
import {exact,uuid} from '../../lib/business/protocol.mjs';
import {configuration,connectionScope,privateFile,publicationProject} from './target.mjs';
import {hostedScope} from './identity.mjs';
import {privateTransport} from './transport.mjs';
import {createRpcRepository} from './compat/repository.mjs';
import {createRegistrar} from './database.mjs';
import {generation,issueGrant,writeOnce} from './r3.mjs';

const read=path=>JSON.parse(privateFile(path));

async function main() {
  const [mode,fixturePath,inputPath,expirationPath,sessionsPath]=process.argv.slice(2);
  if(mode!=='--execute-approved'||process.argv.length!==7)
    throw new Error('Usage: publication-grants.mjs --execute-approved <existing-fixture> <private-grant-plan> <historical-Alice-session-file> <new-private-sessions-file>');
  const fixture=configuration(read(fixturePath));
  assert.equal(fixture.project,publicationProject);
  const plan=exact(read(inputPath),['project','generation','database','tls','alice','bob']);
  assert.equal(plan.project,fixture.project);
  const tls=exact(plan.tls,['ca','cert','key']);
  const expiredToken=read(expirationPath).aliceToken;
  const old=JSON.parse(Buffer.from(expiredToken.split('.')[1],'base64url').toString('utf8'));
  assert.equal(old.sub,fixture.alice);
  assert.ok(uuid(old.session_id)&&Number.isSafeInteger(old.exp)&&old.exp<=Math.floor(Date.now()/1000));
  for(const name of ['alice','bob']) {
    const account=exact(plan[name],['credentials','approval']);
    const a=exact(account.approval,['uid','proofId','epoch','validFrom','expiresAt']);
    assert.equal(a.uid,fixture[name]);
    assert.equal(a.epoch,0);
    assert.ok(uuid(a.proofId));
  }
  assert.notEqual(plan.alice.approval.proofId,plan.bob.approval.proofId);
  const scope=connectionScope({...fixture,publicationSite:fixture.aliceSite});
  const {binding,identity}=await hostedScope(scope);
  await assert.rejects(()=>identity.verifyAccount(expiredToken),{code:'IDENTITY_REQUIRED',status:401});
  const {Client}=await import('pg');
  const registrar=createRegistrar(scope.project,plan.database,Client);
  const repository=createRpcRepository({binding,enabled:true,project:scope.project,endpoint:scope.privateOrigin,
    identity,mtls:privateTransport(scope.privateOrigin,tls)});
  const key=await generation(scope.project,plan.generation);
  const output=resolve(sessionsPath);
  writeOnce(output+'.dispatch.json',{project:scope.project,alice:fixture.alice,bob:fixture.bob,
    expiredSession:old.session_id,proofIds:[plan.alice.approval.proofId,plan.bob.approval.proofId]});
  const tokens={};
  for(const name of ['alice','bob']) {
    const account=plan[name];
    const login=await identity.passwordLogin(account.credentials);
    const subject=accountContext(login.handle);
    assert.equal(subject.uid,fixture[name]);
    const grant=await issueGrant({binding,identity,login,approval:account.approval,key,registrar,repository,
      journalDir:resolve(output,'..')});
    writeOnce(output+'.'+name+'-grant.json',{...subject,grantId:grant.grant_id});
    tokens[name+'Token']=withCredential(login.handle,value=>value);
  }
  // A third session of the same Alice account has deliberately never received a Grant.
  const noGrant=await identity.passwordLogin(plan.alice.credentials);
  assert.equal(accountContext(noGrant.handle).uid,fixture.alice);
  writeOnce(output,{...tls,...tokens,noGrantToken:withCredential(noGrant.handle,value=>value),expiredToken});
  console.log(JSON.stringify({status:'PUBLICATION_GRANTS_READY',project:scope.project}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error?.code??'PUBLICATION_GRANT_STOP');process.exitCode=1;});
