// Candidate endpoints for this one isolated project. No DNS, binding or listener is provisioned.
import {businessBinding} from './binding.mjs';
import {textCommand} from './command.mjs';
import { createInput, deny, exact, uuid, validateProof } from '../../../lib/business/protocol.mjs';

// A save serializes both the DTO and its canonical JSON string.
export const isTextDraftRpc = name => name === 'save_text_draft' || name === 'read_text_publication_operation';
export const isPublicationOperation = name => name==='publish_site' || name==='unpublish_site';
export const rpcResponseLimit = (name, binding) => businessBinding(binding)?.textDraft &&
  (isTextDraftRpc(name) || name === 'read_introduction') ? 131072 : 65536;

export function checkRpc(name, args, binding) {
  switch (name) {
    case 'get_my_site':
      exact(args, []);
      break;
    case 'create_site':
    case 'read_create_operation':
      exact(args, ['input']);
      createInput(args.input);
      break;
    case 'read_introduction':
      exact(args, ['target']);
      if (!uuid(args.target)) deny('INVALID_INPUT', 400);
      break;
    case 'save_text_draft':
    case 'publish_site':
    case 'unpublish_site':
    case 'read_text_publication_operation': {
      if (businessBinding(binding)?.textDraft !== true) deny('NOT_CONFIGURED',503);
      const read = name === 'read_text_publication_operation';
      exact(args, read ? ['target','operation','input','canonical_request'] : ['target','input','canonical_request']);
      const operation = read ? args.operation : name;
      if (!uuid(args.target) || (operation!=='save_text_draft' && !isPublicationOperation(operation)))
        deny('INVALID_INPUT',400);
      if(isPublicationOperation(operation)) {
        const allowed=businessBinding(binding)?.publicationSite;
        if(!allowed) deny('INVALID_INPUT',400);
        if(args.target!==allowed) deny();
      }
      const input = textCommand(operation,args.input);
      if (args.canonical_request !== JSON.stringify({operation,...input})) deny('INVALID_INPUT',400);
      break;
    }
    case 'apply_business_grant':
      exact(args, ['envelope']);
      exact(args.envelope, ['proof']);
      if(!businessBinding(binding))deny('NOT_CONFIGURED',503);
      validateProof(args.envelope.proof,binding.project);
      break;
    default:
      deny('INVALID_INPUT', 400);
  }
}
