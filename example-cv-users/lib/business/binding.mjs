// Server composition only. No environment is enabled and no credentials live here.
import {deny} from './protocol.mjs';
const known=new WeakSet();
export function createBusinessBinding({project,authIssuer,privateOrigin,registrarHost,socketPath='/run/ecv-private/postgrest.sock',testOnly=false,textDraft=false}={}) {
 if(typeof project!=='string'||!/^[a-z0-9][a-z0-9-]{1,79}$/.test(project))deny('NOT_CONFIGURED',503);
 let issuer,origin;
 try{issuer=new URL(authIssuer);origin=new URL(privateOrigin);}catch{deny('NOT_CONFIGURED',503);}
 const localHostedSocket = textDraft === true && testOnly === true &&
   origin.hostname === '127.0.0.1' && issuer.origin === 'https://' + project + '.supabase.co' &&
   /^\/private\/var\/tmp\/s36-hosted-[a-zA-Z0-9-]{8,32}\/postgrest\.sock$/.test(socketPath);
 const localTest=testOnly===true&&(issuer.hostname==='127.0.0.1'||issuer.hostname==='localhost'||issuer.hostname.endsWith('.internal.test'));
 if((issuer.protocol!=='https:'&&!(localTest&&issuer.protocol==='http:'))||issuer.username||issuer.password||issuer.search||issuer.hash||!issuer.pathname.endsWith('/auth/v1')||
  origin.protocol!=='https:'||origin.origin!==privateOrigin||origin.username||origin.password||origin.search||origin.hash||
  typeof registrarHost!=='string'||!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(registrarHost)||!registrarHost.includes('.')||
  typeof socketPath!=='string'||(!socketPath.startsWith('/run/')&&!localHostedSocket)||socketPath.includes('..')||!/^\/[a-zA-Z0-9_./-]+$/.test(socketPath))deny('NOT_CONFIGURED',503);
 const value=Object.freeze({project,authIssuer,privateOrigin,privateHost:origin.hostname,privateAuthority:origin.host,registrarHost,socketPath,testOnly:testOnly===true,textDraft:textDraft===true});known.add(value);return value;
}
export const businessBinding=value=>known.has(value)?value:undefined;
