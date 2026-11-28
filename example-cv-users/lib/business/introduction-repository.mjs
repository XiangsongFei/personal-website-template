import {createBusinessBinding, businessBinding} from './binding.mjs';
import {checkRpc} from './private-rpc.mjs';
import {deny, exact, uuid} from './protocol.mjs';
import {createS36RpcTransport} from './s36-rpc-transport.mjs';
import {textPublicationCommand} from './text-publication.mjs';

const save = 'save_text_draft';
const lookup = 'read_text_publication_operation';

export function textDraftArgs(target, value) {
  const input = textPublicationCommand(save, value);
  return {target, input, canonical_request: JSON.stringify({operation: save, ...input})};
}

export function createIntroductionRepository({project, authIssuer, endpoint, mtls, identity}) {
  const binding = createBusinessBinding({project, authIssuer, privateOrigin: endpoint, registrarHost: new URL(endpoint).hostname});
  const rpc = createS36RpcTransport({scope:businessBinding(binding), enabled:true, project, endpoint, mtls, identity,
    rpcResponseLimit:name=>name === 'read_introduction' ? 131072 : 65536,
    checkRpc(name, args) {
      if (name === 'get_my_site' || name === 'read_introduction') return checkRpc(name, args, binding);
      if (name !== save && name !== lookup) deny('INVALID_INPUT', 400);
      exact(args, name === save ? ['target','input','canonical_request'] : ['target','input','canonical_request','operation']);
      if (!uuid(args.target) || (name === lookup && args.operation !== save) ||
          args.canonical_request !== textDraftArgs(args.target, args.input).canonical_request)
        deny('INVALID_INPUT', 400);
    },
  });
  return Object.freeze({
    mine: handle => rpc(handle, 'get_my_site', {}),
    readIntroduction: (handle, siteId) => rpc(handle, 'read_introduction', {target: siteId}),
    saveTextDraft: (handle, siteId, input) => rpc(handle, save, textDraftArgs(siteId,input)),
    readTextDraftOperation: (handle, siteId, input) =>
      rpc(handle, lookup, {...textDraftArgs(siteId,input), operation: save}),
  });
}
