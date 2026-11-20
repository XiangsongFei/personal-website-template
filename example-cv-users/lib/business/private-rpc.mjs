// Candidate endpoints for this one isolated project. No DNS, binding or listener is provisioned.
import {businessBinding} from './binding.mjs';
import { createInput, deny, exact, uuid, validateProof } from './protocol.mjs';

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
