import {configuration,privateFile} from './target.mjs';
import {hostedScope} from './identity.mjs';
import {startPrivateRpcService} from '../../lib/business/private-ingress.node.mjs';

async function main() {
  const [file, credentials] = process.argv.slice(2);
  if (!file || !credentials || process.argv.length!==4)
    throw new Error('Usage: ingress.mjs <config.json> <private-ingress-tls.json>');
  const config=configuration(JSON.parse(privateFile(file)));
  const {trustedFingerprint,ca,cert,key,socketPath}=JSON.parse(privateFile(credentials));
  if (typeof socketPath!=='string' || !socketPath.startsWith('/private/var/tmp/s36-hosted-'))
    throw new Error('PRIVATE_TEST_SOCKET_REQUIRED');
  const {binding,identity}=await hostedScope(config,socketPath);
  await startPrivateRpcService({enabled:true,binding,identity,trustedFingerprint,tls:{ca,cert,key},
    listenHost:'127.0.0.1',listenPort:Number(new URL(config.privateOrigin).port),
    peerPolicy:{uid:process.getuid(),gid:process.getgid()}});
  console.log(JSON.stringify({state:'HOSTED_TEST_INGRESS_LISTENING',project:config.project,origin:config.privateOrigin}));
}

main().catch(error=>{console.error(error?.code ?? 'HOSTED_TEST_INGRESS_STOP');process.exitCode=1;});
