import {spawn} from 'node:child_process';
import {lstatSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {connectionScope,privateFile} from './target.mjs';
import {databaseOptions,apiRole} from './database.mjs';
import {createHostedBinding,businessBinding} from './compat/binding.mjs';
import {exact} from '../../lib/business/protocol.mjs';

export function nativeEnvironment(scope, material, jwks) {
  exact(material,['database','socketPath','caFile']);
  const binding=businessBinding(createHostedBinding(scope,material.socketPath));
  const db=databaseOptions(scope.project,material.database,apiRole);
  if (!isAbsolute(material.caFile) || realpathSync(material.caFile)!==material.caFile ||
      privateFile(material.caFile)!==material.database.ca) throw new Error('POSTGREST_CA_MISMATCH');
  const directory=dirname(binding.socketPath);
  const stat=lstatSync(directory);
  if (realpathSync(directory)!==directory || !stat.isDirectory() || stat.uid!==process.getuid() ||
      stat.gid!==process.getgid() || (stat.mode&0o7777)!==0o770) throw new Error('POSTGREST_SOCKET_DIRECTORY');
  if (!Array.isArray(jwks?.keys) || jwks.keys.length===0 || jwks.keys.length>5 ||
    new Set(jwks.keys.map(k=>k?.kid)).size!==jwks.keys.length || jwks.keys.some(k=>
      typeof k?.kid!=='string' || !k.kid || k.use!=='sig' || 'd' in k ||
      !((k.kty==='EC' && k.alg==='ES256' && k.crv==='P-256' && typeof k.x==='string' && typeof k.y==='string') ||
        (k.kty==='RSA' && k.alg==='RS256' && typeof k.n==='string' && typeof k.e==='string'))))
    throw new Error('HOSTED_ASYMMETRIC_SIGNING_KEYS_REQUIRED');
  const uri=new URL('postgresql://'+db.host+':5432/postgres');
  uri.username=db.user;
  uri.password=db.password;
  for(const [k,v] of Object.entries({sslmode:'verify-full',sslrootcert:material.caFile,connect_timeout:'5'}))
    uri.searchParams.set(k,v);
  return {PATH:'/usr/bin:/bin',LANG:'C',PGRST_DB_URI:uri.href,PGRST_DB_SCHEMAS:'site_api',
    PGRST_DB_CONFIG:'false',PGRST_DB_CHANNEL_ENABLED:'false',PGRST_DB_POOL:'2',
    PGRST_OPENAPI_MODE:'disabled',PGRST_JWT_AUD:'authenticated',PGRST_JWT_SECRET:JSON.stringify(jwks),
    PGRST_SERVER_UNIX_SOCKET:binding.socketPath,PGRST_SERVER_UNIX_SOCKET_MODE:'660',PGRST_LOG_LEVEL:'crit'};
}

async function main() {
  const [configurationPath,materialPath,binary]=process.argv.slice(2);
  if (process.argv.length!==5 || !isAbsolute(binary)) throw new Error('POSTGREST_BIN_REQUIRED');
  const scope=connectionScope(JSON.parse(privateFile(configurationPath)));
  const material=JSON.parse(privateFile(materialPath));
  // Read the reviewed JWKS from the one approved project's Auth endpoint.
  const response=await fetch(scope.url+'/auth/v1/.well-known/jwks.json',
    {redirect:'error',signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('HOSTED_JWKS_UNAVAILABLE');
  const stream=response.body.getReader(), chunks=[];
  let bytes=0;
  try {
    for(;;) {
      const part=await stream.read();
      if(part.done) break;
      bytes+=part.value.byteLength;
      if(bytes>16384) throw new Error('HOSTED_JWKS_OVERSIZE');
      chunks.push(part.value);
    }
  } finally {await stream.cancel();}
  const jwks=JSON.parse(Buffer.concat(chunks));
  const env=nativeEnvironment(scope,material,jwks);
  // Keep the password out of argv and child diagnostics.
  const child=spawn(binary,[],{env,stdio:'ignore'});
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{console.error('POSTGREST_START_FAILED');process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('HOSTED_POSTGREST_STOP');process.exitCode=1;});
