import {createHostedBinding} from './compat/binding.mjs';
import {createIdentityAdapter} from '../../lib/business/identity.mjs';

export async function hostedScope(config,socketPath) {
  const {createClient} = await import('@supabase/supabase-js');
  const fetchBound = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin!==config.url || !url.pathname.startsWith('/auth/v1/')) throw new Error('AUTH_TARGET_MISMATCH');
    return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});
  };
  const {auth} = createClient(config.url,config.publishableKey,{global:{fetch:fetchBound},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const {url, ...input}=config;
  const binding = createHostedBinding(input,socketPath);
  return {binding,identity:createIdentityAdapter({auth,issuer:binding.authIssuer})};
}
