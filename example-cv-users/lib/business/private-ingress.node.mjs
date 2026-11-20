import {lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {businessBinding} from './binding.mjs';
// Private origin candidate. Construction never listens. Only the dedicated HTTPS listener
// can supply request.socket; forward no caller headers except the original bearer.
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { TLSSocket } from 'node:tls';
import { checkRpc } from './private-rpc.mjs';
import { boundAccountContext } from './identity.mjs';
import { BusinessError, deny } from './protocol.mjs';

const allowedHeaders = new Set(['host','authorization','content-type','content-length','connection','accept','user-agent','accept-encoding','transfer-encoding']);
for(const name of ['x-real-ip','x-forwarded-for','x-forwarded-proto','x-forwarded-host','x-forwarded-port','x-forwarded-path','x-forwarded-prefix','x-consumer-id','x-consumer-username','x-credential-identifier','x-anonymous-consumer','x-kong-request-id'])allowedHeaders.add(name); // discarded; original bearer is the sole identity input
const refusals = new Map([['42501',403],['PT503',503],['PT409',409],['22023',400]]);

async function readLimited(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) deny('INVALID_INPUT',400);
    chunks.push(chunk);
  }
  if (stream.complete !== true) throw new Error('INCOMPLETE');
  return new TextDecoder('utf-8',{ fatal:true }).decode(Buffer.concat(chunks));
}

// The private PostgREST process exclusively owns its DB credentials and verifies
// the original JWT again. Its Unix HTTP socket must have an OS-enforced peer boundary.
function postgrestOnce(name, body, token, signal, open = httpRequest,binding) {
  const socketPath=businessBinding(binding)?.socketPath;
  return new Promise((resolve, reject) => {
    const req = open({
      socketPath, path:'/rpc/' + name, method:'POST', agent:false, signal,
      headers:{
        Authorization:'Bearer ' + token, 'Content-Type':'application/json',
        'Content-Profile':'site_api', 'Accept-Profile':'site_api', 'Content-Length':Buffer.byteLength(body)
      }
    }, async response => {
      try {
        if (response.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('CONTENT_TYPE');
        resolve({ status:response.statusCode, json:JSON.parse(await readLimited(response,65536)) });
      } catch { response.destroy(); reject(new Error('UPSTREAM_INCOMPLETE')); }
    });
    req.once('error',reject);
    req.end(body);
  });
}

// Split only for socket-free tests; the listener below obtains its peer from the TLS engine.
export async function handlePrivateRpc(req, {binding,peerFingerprint, trustedFingerprint, identity, signal, openUnixRequest = httpRequest, send = postgrestOnce}) {
  let issued = false;
  try {
    const scope=businessBinding(binding);if(!scope)deny('NOT_CONFIGURED',503);const {privateAuthority,authIssuer}=scope;
    if (!/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(trustedFingerprint) || peerFingerprint !== trustedFingerprint) deny();
    if (req.method !== 'POST' || !/^\/rpc\/[a-z_]+$/.test(req.url)) deny('INVALID_INPUT',400);
    const name = req.url.slice(5);
    const headers = new Map();
    for (let i=0; i<req.rawHeaders.length; i+=2) {
      const key = req.rawHeaders[i].toLowerCase();
      if (!allowedHeaders.has(key) || headers.has(key)) deny('INVALID_INPUT',400);
      headers.set(key,req.rawHeaders[i+1]);
    }
    const auth = headers.get('authorization');
    if (headers.get('host') !== privateAuthority || headers.get('content-type') !== 'application/json' ||
        !auth || auth.length > 16384 || !/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)) deny();
    const raw = await readLimited(req,8192);
    let args;
    try { args = JSON.parse(raw); } catch { deny('INVALID_INPUT',400); }
    // This peer emits JSON.stringify. A byte-for-byte round trip rejects duplicate keys.
    if (JSON.stringify(args) !== raw) deny('INVALID_INPUT',400);
    checkRpc(name,args,binding);
    const token = auth.slice(7);
    signal.throwIfAborted();
    const handle = await identity.verifyAccount(token);
    const who = boundAccountContext(handle,identity,authIssuer);
    const proof = args.envelope?.proof;
    if (proof && (proof.uid !== who.uid || proof.session_id !== who.session_id)) deny();
    signal.throwIfAborted();
    issued = true;
    const { status, json } = await send(name,raw,token,signal,openUnixRequest,binding);
    if (signal.aborted || !json || Array.isArray(json) || typeof json !== 'object') throw new Error('INCOMPLETE');
    if (status === 200) return { status, json };
    if (refusals.has(json.code) && refusals.get(json.code) === status) return { status,json:{code:json.code} };
  } catch (error) {
    if (!issued && error instanceof BusinessError) {
      if (error.status === 400) return {status:400,json:{code:'22023'}};
      if (error.status === 401 || error.status === 403) return {status:403,json:{code:'42501'}};
    }
  }
  return {status:503,json:{code:'RESULT_UNKNOWN'}};
}

export function createPrivateRpcServer({ binding,tls, trustedFingerprint, identity } = {}) {
  if (!businessBinding(binding) || !tls || ![tls.ca,tls.cert,tls.key].every(x => typeof x === 'string' && x.length) ||
      typeof identity?.verifyAccount !== 'function' || !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(trustedFingerprint))
    deny('NOT_CONFIGURED',503);
  return createServer({
    ca:tls.ca, cert:tls.cert, key:tls.key, requestCert:true, rejectUnauthorized:true,
    minVersion:'TLSv1.2', headersTimeout:5000, requestTimeout:10000, maxHeaderSize:24576
  }, async (req,res) => {
    const socket = req.socket;
    const peerFingerprint = socket instanceof TLSSocket && socket.authorized
      ? socket.getPeerCertificate().fingerprint256 : undefined;
    const controller = new AbortController();
    const stop = () => controller.abort();
    res.once('close',stop);
    const timer = setTimeout(() => { stop(); res.destroy(); },9000);
    try {
      const result = await handlePrivateRpc(req,{binding,peerFingerprint,trustedFingerprint,identity,signal:controller.signal});
      if (!res.destroyed) {
        res.writeHead(result.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end(JSON.stringify(result.json));
      }
    } finally {
      clearTimeout(timer);
      res.off('close',stop);
    }
  });
}

// Deployment entry. The UDS and shared directory must be mounted read-only in this process.
// No listening, default identity or certificate loading happens on module import.
export async function assertPrivateSocket(binding,policy,inspect=lstat) {
 const scope=businessBinding(binding);
 if(!scope||!policy||!['uid','gid'].every(k=>Number.isSafeInteger(policy[k])&&policy[k]>=0))deny('NOT_CONFIGURED',503);
 const {uid,gid}=policy;
 const directory=dirname(scope.socketPath);
 const check=(value,isDirectory)=>value&& !value.isSymbolicLink() && (isDirectory?value.isDirectory():value.isSocket()) && value.uid===uid && value.gid===gid && (value.mode&0o7777)===(isDirectory?0o770:0o660);
 try {
  const a=await inspect(directory),b=await inspect(scope.socketPath);
  const afterA=await inspect(directory),afterB=await inspect(scope.socketPath);
  if(!check(a,true)||!check(b,false)||!check(afterA,true)||!check(afterB,false)||a.ino!==afterA.ino||a.dev!==afterA.dev||b.ino!==afterB.ino||b.dev!==afterB.dev)throw Error('UNSAFE');
 }catch{deny('PRIVATE_SOCKET_UNSAFE',503);}
}
export async function privateRpcPreflight(options={},inspect=lstat) {
 const {enabled=false,binding,peerPolicy,listenHost,listenPort,identity,trustedFingerprint,tls}=options;
 const config=Object.freeze({binding,identity,trustedFingerprint,listenHost,listenPort,
  peerPolicy:peerPolicy&&Object.freeze({uid:peerPolicy.uid,gid:peerPolicy.gid}),
  tls:tls&&Object.freeze({ca:tls.ca,cert:tls.cert,key:tls.key})});
 if(enabled!==true||typeof listenHost!=='string'||!Number.isSafeInteger(listenPort)||listenPort<1024||listenPort>65535)deny('NOT_CONFIGURED',503);
 await assertPrivateSocket(config.binding,config.peerPolicy,inspect);
 return config;
}
export async function startPrivateRpcService(options={}) {
 const config=await privateRpcPreflight(options);
 const server=createPrivateRpcServer(config);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.listenPort,config.listenHost,()=>{server.off('error',reject);resolve();});});
 return server;
}
