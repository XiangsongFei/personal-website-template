import assert from 'node:assert/strict';

// Local acceptance only. Send exactly one reserved write and discard its
// successful HTTP reply before the business repository can consume it.
export function dropSaveReplyOnce(transport, scope) {
  return dropReplyOnce(transport,scope,'save_text_draft','SAVE');
}

export function dropPublicationReplyOnce(transport, scope, operation) {
  assert.ok(operation==='publish_site'||operation==='unpublish_site');
  return dropReplyOnce(transport,scope,operation,'PUBLICATION');
}

function dropReplyOnce(transport, {origin, target, input, onDiscard}, operation, label) {
  const commandUrl = origin+'/rpc/'+operation;
  const readUrl = origin+'/rpc/read_text_publication_operation';
  const request = {target,input,canonical_request:JSON.stringify({operation,...input})};
  let dispatched = false;
  return {
    async fetch(url, options) {
      assert.equal(options.method,'POST');
      if (url===readUrl) {
        assert.equal(dispatched,true,`TEST_${label}_WAS_NOT_DISPATCHED`);
        assert.deepEqual(JSON.parse(options.body),{...request,operation});
        return transport.fetch(url,options);
      }
      assert.equal(url,commandUrl,'OUT_OF_SCOPE_TEST_RPC');
      assert.equal(dispatched,false,`DUPLICATE_TEST_${label}_DISPATCH`);
      assert.deepEqual(JSON.parse(options.body),request);
      dispatched = true;
      const response = await transport.fetch(url,options);
      if (response.status!==200) return response;
      await response.body?.cancel();
      onDiscard({requestId:input.request_id,httpStatus:response.status});
      throw new Error(`CONTROLLED_TEST_${label}_REPLY_LOSS`);
    },
  };
}
