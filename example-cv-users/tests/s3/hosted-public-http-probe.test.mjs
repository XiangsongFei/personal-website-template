import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedRpcReceipt} from '../../scripts/s36-hosted/hosted-public-http-probe.mjs';

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
