// Candidate endpoints for this one isolated project. No DNS, binding or listener is provisioned.
import {businessBinding} from './binding.mjs';
import { textCommand } from './text-publication.mjs';
import { createInput, deny, exact, uuid, validateProof } from './protocol.mjs';

// A save serializes both the DTO and its canonical JSON string.
export const isTextDraftRpc = name => name === 'save_text_draft' || name === 'read_text_publication_operation';
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
    case 'read_text_publication_operation': {
      if (businessBinding(binding)?.textDraft !== true) deny('NOT_CONFIGURED',503);
      const read = name === 'read_text_publication_operation';
      exact(args, read ? ['target','operation','input','canonical_request'] : ['target','input','canonical_request']);
      if (!uuid(args.target) || (read && args.operation !== 'save_text_draft')) deny('INVALID_INPUT',400);
      const input = textCommand('save_text_draft',args.input);
      if (args.canonical_request !== JSON.stringify({operation:'save_text_draft',...input})) deny('INVALID_INPUT',400);
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
