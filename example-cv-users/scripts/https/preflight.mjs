// Read-only tool preflight. No listeners, authentication, Keychain write or supplied trust anchors.
import {spawnSync} from 'node:child_process';
import {readPublicCertificate,CERT} from './identity.mjs';
import {assertCurrentNode} from './node-identity.mjs';
const args=process.argv.slice(2);
if(args.length>1||args.length===1&&args[0]!=='--certificate-only')throw Error('unsupported_preflight_argument');
const node=assertCurrentNode(),cert=readPublicCertificate();
if(!args.length){const r=spawnSync('/usr/bin/security',['verify-cert','-c',CERT,'-p','ssl','-s','127.0.0.1'],{encoding:'utf8',timeout:5000,maxBuffer:16384});if(r.error||r.signal||r.status!==0)throw Error('trusted_https_unavailable_no_services_started');}
console.log(JSON.stringify({node,certificateSha256:cert.fingerprint256.replaceAll(':',''),nonCA:!cert.ca,SAN:cert.subjectAltName,validFrom:cert.validFrom,validTo:cert.validTo,sslSystemTrust:args.length?'NOT_EVALUATED':'PASS',keychainWrites:0,authenticationRequests:0}));
