import {createBusinessBinding, businessBinding as verifiedBinding} from '../../../lib/business/binding.mjs';
import {connectionScope} from '../target.mjs';

const hosted = new WeakMap();
export function createHostedBinding(input,socketPath) {
  const {project,privateOrigin,url,publicationSite}=connectionScope(input);
  if (socketPath!==undefined && (typeof socketPath!=='string' ||
      !/^\/private\/var\/tmp\/s36-hosted-[a-zA-Z0-9-]{8,32}\/postgrest\.sock$/.test(socketPath)))
    throw new Error('PRIVATE_TEST_SOCKET_REQUIRED');
  const binding = createBusinessBinding({project,authIssuer:url+'/auth/v1',privateOrigin,
    registrarHost:'db.'+project+'.supabase.co',testOnly:true});
  hosted.set(binding,Object.freeze({...verifiedBinding(binding),textDraft:true,publicationSite,socketPath}));
  return binding;
}
export const businessBinding = binding=>hosted.get(binding);
