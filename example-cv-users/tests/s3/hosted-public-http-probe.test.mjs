import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hostedRpcReceipt,verifyPublicProbeMaterial} from '../../scripts/s36-hosted/hosted-public-http-probe.mjs';

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
