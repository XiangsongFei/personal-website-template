import assert from 'node:assert/strict';

// Local acceptance only. Send exactly one reserved write and discard its
// successful HTTP reply before the business repository can consume it.
export function dropSaveReplyOnce(transport, {origin, target, input, onDiscard}) {
  const operation = 'save_text_draft';
  const saveUrl = origin+'/rpc/'+operation;
  const readUrl = origin+'/rpc/read_text_publication_operation';
  const request = {target,input,canonical_request:JSON.stringify({operation,...input})};
  let dispatched = false;
  return {
    async fetch(url, options) {
      assert.equal(options.method,'POST');
      if (url===readUrl) {
        assert.equal(dispatched,true,'TEST_SAVE_WAS_NOT_DISPATCHED');
        assert.deepEqual(JSON.parse(options.body),{...request,operation});
        return transport.fetch(url,options);
      }
      assert.equal(url,saveUrl,'OUT_OF_SCOPE_TEST_RPC');
      assert.equal(dispatched,false,'DUPLICATE_TEST_SAVE_DISPATCH');
      assert.deepEqual(JSON.parse(options.body),request);
      dispatched = true;
      const response = await transport.fetch(url,options);
      if (response.status!==200) return response;
      await response.body?.cancel();
      onDiscard({requestId:input.request_id,httpStatus:response.status});
      throw new Error('CONTROLLED_TEST_SAVE_REPLY_LOSS');
    },
  };
}
