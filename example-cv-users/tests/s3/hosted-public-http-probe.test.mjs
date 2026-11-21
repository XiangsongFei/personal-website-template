import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hostedRpcReceipt,publicProjection,verifyPublicProbeMaterial} from '../../scripts/s36-hosted/hosted-public-http-probe.mjs';

test('public local acceptance permits only an anonymous call to the fixed test project RPC',()=>{
  const url='https://vellypyadcxkvqftsbrg.supabase.co/rest/v1/rpc/read_public_text';
  const hostname='alice.sites.example.test', apikey='fixture';
  const args={hostname,locale:'en'};
  const init={method:'POST',headers:{apikey,'Content-Profile':'public','Accept-Profile':'public'},body:JSON.stringify(args)};
  assert.deepEqual(hostedRpcReceipt(url,init,apikey,[hostname]),args);
  assert.throws(()=>hostedRpcReceipt(url.replace('vellypyadcxkvqftsbrg','makwjnbubmrmopjhzror'),init,apikey,[hostname]));
  assert.throws(()=>hostedRpcReceipt(url,{...init,headers:{...init.headers,Authorization:'Bearer fixture'}},apikey,[hostname]));
  assert.throws(()=>hostedRpcReceipt(url,{...init,body:JSON.stringify({...args,site_id:'wrong'})},apikey,[hostname]));
  assert.throws(()=>hostedRpcReceipt(url,init,apikey,['bob.sites.example.test']));
});

test('a missing loopback TLS fixture fails preflight before a publication batch can begin',()=>{
  const run=mkdtempSync(join(realpathSync(tmpdir()),'s36-http-preflight.'));
  try {
    const directory=join(run,'private');
    mkdirSync(directory,{mode:0o700});
    const source=join(run,'worker.mjs'), manifest=join(run,'manifest.json');
    const digest=x=>createHash('sha256').update(x).digest('hex');
    writeFileSync(source,'export {};',{mode:0o600});
    const specification=JSON.stringify({files:{[source]:digest('export {};')},workerModule:source,bindingModule:source});
    writeFileSync(manifest,specification,{mode:0o600});
    const [alice,bob,aliceSite,bobSite,entry,requestId]=Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
    writeFileSync(join(directory,'fixture.json'),JSON.stringify({project:'vellypyadcxkvqftsbrg',
      publishableKey:'sb_publishable_fixture',privateOrigin:'https://127.0.0.1:9443',alice,bob,aliceSite,
      bobSite,entry,requestId,expectedDraftRevision:0}),{mode:0o600});
    assert.throws(()=>verifyPublicProbeMaterial(run,manifest,digest(specification)),{code:'ENOENT'});
  } finally {rmSync(run,{recursive:true,force:true});}
});

test('the public HTTPS contract projects the selected site snapshot and requested locale only',()=>{
  const pub={state:'published',publication_revision:8,snapshot_id:'selected'};
  const snapshot={site_id:'alice',id:'selected',digest:'selected-digest',payload:{entries:[
    {position:2,translations:{en:'Second',zh:'二'}},
    {position:1,translations:{en:'First'}},
    {position:3,translations:{zh:'三'}}
  ]}};
  const readback={sites:[{id:'alice',publication:pub}],snapshots:[snapshot]};
  assert.deepEqual(publicProjection(readback,'alice'),{snapshotId:'selected',snapshotDigest:'selected-digest',
    expected:{schema_version:1,locale:'en',publication_revision:8,entries:[
      {position:1,text:'First'},{position:2,text:'Second'}
    ]}});
  assert.throws(()=>publicProjection({...readback,snapshots:[{...snapshot,site_id:'bob'}]},'alice'));
  assert.equal(publicProjection({sites:[{id:'alice',publication:{state:'unpublished',snapshot_id:null}}]},'alice'),null);
});
