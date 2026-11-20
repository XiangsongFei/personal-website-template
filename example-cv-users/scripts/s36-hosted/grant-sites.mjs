import {join,resolve} from 'node:path';
import {connectionScope,privateFile} from './target.mjs';
import {hostedScope} from './identity.mjs';
import {privateTransport} from './transport.mjs';
import {createRpcRepository} from './compat/repository.mjs';
import {createSiteService} from './compat/service.mjs';
import {accountContext,withCredential} from '../../lib/business/identity.mjs';
import {createInput,exact,uuid} from '../../lib/business/protocol.mjs';
import {generation,issueGrant,writeOnce} from './r3.mjs';
import {createRegistrar} from './database.mjs';

async function main() {
  const [targetPath,fixturePath,outputPath]=process.argv.slice(2);
  if (!outputPath || process.argv.length!==5)
    throw new Error('Usage: grant-sites.mjs <connection.json> <private-approved-fixture.json> <new-private-output-dir>');
  const target=connectionScope(JSON.parse(privateFile(targetPath)));
  const fixture=JSON.parse(privateFile(fixturePath));
  exact(fixture,['project','generation','database','tls','alice','bob','saveRequestId']);
  if (fixture.project!==target.project || !uuid(fixture.saveRequestId)) throw new Error('FIXTURE_SCOPE_DENIED');
  const accounts=[fixture.alice,fixture.bob];
  for(const account of accounts) {
    exact(account,['credentials','approval','createRequest']);
    exact(account.approval,['uid','proofId','epoch','validFrom','expiresAt']);
    if (!uuid(account.approval.uid) || !uuid(account.approval.proofId) || account.approval.epoch!==0)
      throw new Error('FIXTURE_ID_DENIED');
    createInput(account.createRequest);
  }
  for(const values of [accounts.map(a=>a.approval.uid),accounts.map(a=>a.approval.proofId),
    [...accounts.map(a=>a.createRequest.request_id),fixture.saveRequestId],accounts.map(a=>a.createRequest.slug)])
    if (new Set(values).size!==values.length) throw new Error('DUPLICATE_FIXTURE_ID');
  exact(fixture.tls,['ca','cert','key']);
  const {Client}=await import('pg');
  const registrar=createRegistrar(target.project,fixture.database,Client);
  const key=await generation(target.project,fixture.generation);
  const {binding,identity}=await hostedScope(target);
  const repository=createRpcRepository({enabled:true,binding,identity,project:target.project,
    endpoint:target.privateOrigin,mtls:privateTransport(target.privateOrigin,fixture.tls)});
  const service=createSiteService({repository});
  const output=resolve(outputPath);
  writeOnce(join(output,'fixture-start.json'),{project:target.project,saveRequestId:fixture.saveRequestId,
    users:accounts.map(a=>({uid:a.approval.uid,proofId:a.approval.proofId,create:a.createRequest.request_id}))});
  const result=[];
  for(const account of accounts) {
    const login=await identity.passwordLogin(account.credentials);
    if (accountContext(login.handle).uid!==account.approval.uid) throw new Error('FIXTURE_USER_MISMATCH');
    await issueGrant({binding,identity,login,approval:account.approval,key,registrar,repository,journalDir:output});
    const operation=await service.create(login.handle,account.createRequest);
    const intro=await service.introduction(login.handle,operation.site_id);
    if (intro.draft_revision!==0 || intro.entries.length!==1) throw new Error('FIXTURE_REVISION_MISMATCH');
    const token=withCredential(login.handle,value=>value);
    result.push({site:operation.site_id,entry:intro.entries[0].id,token});
  }
  const [alice,bob]=result;
  const {url,...connection}=target;
  writeOnce(join(output,'acceptance.json'),{...connection,alice:fixture.alice.approval.uid,bob:fixture.bob.approval.uid,
    aliceSite:alice.site,bobSite:bob.site,entry:alice.entry,requestId:fixture.saveRequestId,expectedDraftRevision:0});
  writeOnce(join(output,'acceptance-secrets.json'),{...fixture.tls,aliceToken:alice.token,bobToken:bob.token});
  console.log(JSON.stringify({state:'FIXTURES_READY',project:target.project}));
}

main().catch(error=>{console.error(error?.code ?? 'HOSTED_FIXTURE_STOP');process.exitCode=1;});
