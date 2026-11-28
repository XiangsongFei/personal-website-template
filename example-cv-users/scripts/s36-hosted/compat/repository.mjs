import {textCommand} from './command.mjs';
import {businessBinding} from './binding.mjs';
import { checkRpc, rpcResponseLimit } from './private-rpc.mjs';
import {createS36RpcTransport} from '../../../lib/business/s36-rpc-transport.mjs';

export function createRpcRepository({binding, ...options} = {}) {
  const rpc = createS36RpcTransport({...options, scope:businessBinding(binding),
    checkRpc:(name,args)=>checkRpc(name,args,binding), rpcResponseLimit:name=>rpcResponseLimit(name,binding)});
  function textArgs(operation, target, value) {
    const input = textCommand(operation,value);
    return {target,input,canonical_request:JSON.stringify({operation,...input})};
  }
  const readTextOperation=(h,operation,target,value)=>rpc(h,'read_text_publication_operation',
    {...textArgs(operation,target,value),operation});
  return Object.freeze({
    grant: (h, e) => rpc(h, 'apply_business_grant', { envelope: e }),
    create: (h, p) => rpc(h, 'create_site', { input: p }),
    readOperation: (h, p) => rpc(h, 'read_create_operation', { input: p }),
    mine: h => rpc(h, 'get_my_site', {}),
    readIntroduction: (h, target) => rpc(h, 'read_introduction', { target }),
    saveTextDraft: (h,target,value)=>rpc(h,'save_text_draft',textArgs('save_text_draft',target,value)),
    publish: (h,target,value)=>rpc(h,'publish_site',textArgs('publish_site',target,value)),
    unpublish: (h,target,value)=>rpc(h,'unpublish_site',textArgs('unpublish_site',target,value)),
    readTextDraftOperation: (h,target,value)=>readTextOperation(h,'save_text_draft',target,value),
    readTextOperation
  });
}
