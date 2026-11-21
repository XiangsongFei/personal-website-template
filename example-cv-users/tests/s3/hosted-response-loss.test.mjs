import test from 'node:test';
import assert from 'node:assert/strict';
import {dropPublicationReplyOnce,dropSaveReplyOnce} from '../../scripts/s36-hosted/drop-save-reply.mjs';

const origin='https://127.0.0.1:9443', target='fixture-site';
const input={request_id:'reserved-request'};
const save=origin+'/rpc/save_text_draft';
const options={method:'POST',body:JSON.stringify({
  target,input,canonical_request:JSON.stringify({operation:'save_text_draft',...input}),
})};

test('response-loss transport discards one scoped successful save, then forwards reconciliation',async()=>{
  const calls=[], seen=[];
  const transport={fetch:async (url,opts)=>{
    calls.push([url,opts]);
    return new Response('{}',{status:200});
  }};
  const fault=dropSaveReplyOnce(transport,{origin,target,input,onDiscard:value=>seen.push(value)});
  await assert.rejects(()=>fault.fetch(save,{...options,body:'{}'}),{code:'ERR_ASSERTION'});
  assert.equal(calls.length,0);
  await assert.rejects(()=>fault.fetch(save,options),/CONTROLLED_TEST_SAVE_REPLY_LOSS/);
  await assert.rejects(()=>fault.fetch(save,options),/DUPLICATE_TEST_SAVE_DISPATCH/);
  const read=origin+'/rpc/read_text_publication_operation';
  await assert.rejects(()=>fault.fetch(origin+'/rpc/publish_site',options),/OUT_OF_SCOPE_TEST_RPC/);
  await assert.rejects(()=>fault.fetch(read,options),{code:'ERR_ASSERTION'});
  await fault.fetch(read,{...options,
    body:JSON.stringify({...JSON.parse(options.body),operation:'save_text_draft'}),
  });
  assert.deepEqual(calls.map(([url])=>url),[save,read]);
  assert.deepEqual(seen,[{requestId:input.request_id,httpStatus:200}]);
});

test('response-loss transport preserves a real server failure',async()=>{
  const response=new Response('{}',{status:503});
  const fault=dropSaveReplyOnce({fetch:async()=>response},{
    origin,target,input,onDiscard:()=>assert.fail('unexpected simulated success'),
  });
  assert.equal(await fault.fetch(save,options),response);
});

test('publish and withdraw each discard only their own reply and forward only the original readback',async()=>{
  for(const operation of ['publish_site','unpublish_site']) {
    const calls=[];
    const transport={fetch:async url=>{calls.push(url);return new Response('{}',{status:200});}};
    const fault=dropPublicationReplyOnce(transport,{origin,target,input,onDiscard:()=>{}},operation);
    const endpoint=origin+'/rpc/'+operation;
    const read=origin+'/rpc/read_text_publication_operation';
    const command={target,input,canonical_request:JSON.stringify({operation,...input})};
    const opts=args=>({method:'POST',body:JSON.stringify(args)});
    await assert.rejects(()=>fault.fetch(endpoint,opts(command)),/CONTROLLED_TEST_PUBLICATION_REPLY_LOSS/);
    await assert.rejects(()=>fault.fetch(endpoint,opts(command)),/DUPLICATE_TEST_PUBLICATION_DISPATCH/);
    await assert.rejects(()=>fault.fetch(read,opts({...command,target:'unbound',operation})),{code:'ERR_ASSERTION'});
    await fault.fetch(read,opts({...command,operation}));
    assert.deepEqual(calls,[endpoint,read]);
  }
  assert.throws(()=>dropPublicationReplyOnce(null,{},'save_text_draft'),{code:'ERR_ASSERTION'});
});
