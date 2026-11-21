import assert from 'node:assert/strict';
import {writeOnce} from './r3.mjs';
import {privateTransport} from './transport.mjs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isAbsolute,resolve} from 'node:path';
import {configuration, privateFile} from './target.mjs';
import {hostedScope} from './identity.mjs';
import {accountContext} from '../../lib/business/identity.mjs';
import {createRpcRepository} from './compat/repository.mjs';
import {createSiteService} from './compat/service.mjs';

const guardSql = fileURLToPath(new URL('./first-save-guard.sql',import.meta.url));

function readSnapshot(psql, config) {
  const args = ['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','project='+config.project,
    '-v','alice_site='+config.aliceSite,'-v','bob_site='+config.bobSite,
    '-v','request_id='+config.requestId,'-f',guardSql];
  const row = JSON.parse(execFileSync(psql,args,{encoding:'utf8',timeout:20000}));
  assert.equal(row.valid_identity,true);
  assert.equal(row.site_count,2);
  assert.equal(row.draft_zero,2);
  assert.equal(row.unpublished,2);
  assert.equal(row.request_rows,0);
  return row;
}

export async function firstAcceptance(config, service, handles, onDispatch, beforeSave = async () => {}) {
  const {alice,bob} = handles;
  assert.equal(accountContext(alice).uid, config.alice);
  assert.equal(accountContext(bob).uid, config.bob);
  const before = await service.introduction(alice,config.aliceSite);
  assert.equal(before.draft_revision,config.expectedDraftRevision);
  const bobBefore = await service.introduction(bob,config.bobSite);
  const seed = {zh:'请填写个人介绍。', en:'Add your introduction.'};
  assert.deepEqual(before.entries,[{id:config.entry,position:0,translations:seed}]);
  assert.equal(bobBefore.draft_revision,0);
  const input = {schema_version:1,request_id:config.requestId,expected_draft_revision:before.draft_revision,
    payload:{schema_version:1,entries:[{id:config.entry,position:0,translations:{
      zh:'S3 合成验收 ' + config.requestId, en:'S3 synthetic acceptance ' + config.requestId}}]}};
  onDispatch();
  for (const [handle,target] of [[bob,config.aliceSite],[alice,config.bobSite]]) {
    await assert.rejects(() => service.introduction(handle,target), {code:'BUSINESS_DENIED',status:403});
    await assert.rejects(() => service.saveTextDraft(handle,target,input), {code:'BUSINESS_DENIED',status:403});
  }
  await assert.rejects(() => service.introduction(undefined,config.aliceSite), {code:'IDENTITY_REQUIRED',status:401});
  await assert.rejects(() => service.saveTextDraft(undefined,config.aliceSite,input), {code:'IDENTITY_REQUIRED',status:401});
  await beforeSave();
  const saved = await service.saveTextDraft(alice,config.aliceSite,input);
  assert.equal(saved.changed,true);
  const after = await service.introduction(alice,config.aliceSite);
  assert.equal(after.draft_revision,before.draft_revision+1);
  assert.deepEqual(after.entries,input.payload.entries);
  assert.deepEqual(await service.introduction(bob,config.bobSite),bobBefore);
  const operation = await service.readTextDraftOperation(alice,config.aliceSite,input);
  assert.deepEqual(operation,{status:'succeeded',result:saved});
  return {status:'APPLICATION_CHECKS_PASS_AUDIT_PENDING',project:config.project,site:config.aliceSite,
    actor:config.alice,session:accountContext(alice).session_id,requestId:config.requestId,revision:after.draft_revision};
}

async function main() {
  const [file, credentials, journal, psql] = process.argv.slice(2);
  if (!file || !credentials || !journal || !psql || !isAbsolute(psql) || process.argv.length!==6)
    throw new Error('Usage: acceptance.mjs <config.json> <private-session-and-tls.json> <new-journal> <absolute-psql-wrapper>');
  const config = configuration(JSON.parse(privateFile(file)));
  const material = JSON.parse(privateFile(credentials));
  const {binding,identity} = await hostedScope(config);
  const {ca,cert,key,aliceToken,bobToken} = material;
  if (![ca,cert,key,aliceToken,bobToken].every(v => typeof v === 'string' && v.length>0))
    throw new Error('REAL_SESSIONS_AND_TEST_MTLS_REQUIRED');
  const mtls=privateTransport(config.privateOrigin,{ca,cert,key});
  const service = createSiteService({repository:createRpcRepository({binding,enabled:true,
    project:config.project,endpoint:config.privateOrigin,identity,mtls})});
  const handles = {alice:await identity.verifyAccount(aliceToken),bob:await identity.verifyAccount(bobToken)};
  const baseline = readSnapshot(psql,config);
  writeOnce(journal+'.baseline.json',baseline);
  const anonymous=await mtls.fetch(config.privateOrigin+'/rpc/read_introduction',
    {method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
      headers:{'Content-Type':'application/json'},body:JSON.stringify({target:config.aliceSite})});
  assert.equal(anonymous.status,403);
  assert.deepEqual(await anonymous.json(),{code:'42501'});
  const row = await firstAcceptance(config,service,handles,()=>{
    writeOnce(journal,{state:'NEGATIVE_PROBES_DISPATCHED',project:config.project,
      requestId:config.requestId,aliceSite:config.aliceSite,bobSite:config.bobSite});
  },async ()=>{
    const afterDenials = readSnapshot(psql,config);
    assert.deepEqual(afterDenials,baseline);
    writeOnce(journal+'.save-dispatch.json',{state:'SAVE_DISPATCHED',project:config.project,
      requestId:config.requestId,site:config.aliceSite,actor:config.alice,
      session:accountContext(handles.alice).session_id,expectedRevision:0});
  });
  writeOnce(journal+'.application.json',row);
  console.log(JSON.stringify(row));
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error?.code ?? 'HOSTED_ACCEPTANCE_STOP'); process.exitCode=1; });
