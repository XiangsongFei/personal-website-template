import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync,realpathSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';import {X509Certificate} from 'node:crypto';import https from 'node:https';
import {PIN,ROOT} from '../scripts/https/identity.mjs';
test('new pinned Node performs real loopback TLS and strict certificate-only preflight; no Keychain', {skip:process.platform!=='darwin'},async()=>{
 const dir=realpathSync(mkdtempSync(resolve(tmpdir(),'s2-node-tls-')));let server;
 try{
  const material=resolve(dir,'.runtime/tls'),scripts=resolve(dir,'scripts/https');mkdirSync(material,{recursive:true,mode:0o700});mkdirSync(scripts,{recursive:true});
  const cert=resolve(material,'server.crt'),key=resolve(material,'server.key');
  const r=spawnSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','basicConstraints=critical,CA:FALSE','-addext','subjectAltName=IP:127.0.0.1','-addext','extendedKeyUsage=serverAuth'],{encoding:'utf8'});assert.equal(r.status,0,'isolated fixture certificate generation failed');chmodSync(key,0o600);
  const x=new X509Certificate(readFileSync(cert));writeFileSync(resolve(scripts,'policy.json'),JSON.stringify({...PIN,serverCertificateSha256:x.fingerprint256.replaceAll(':','')}));
  for(const n of ['identity.mjs','node-identity.mjs','preflight.mjs'])copyFileSync(resolve(ROOT,'scripts/https',n),resolve(scripts,n));
  const check=spawnSync(process.execPath,[resolve(scripts,'preflight.mjs'),'--certificate-only'],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);assert.equal(JSON.parse(check.stdout).sslSystemTrust,'NOT_EVALUATED');
  const {loadServerIdentity}=await import(pathToFileURL(resolve(scripts,'identity.mjs')));
  loadServerIdentity('tls',credentials=>{server=https.createServer(credentials,(_req,res)=>{res.setHeader('Cache-Control','no-store');res.end('isolated TLS health only');});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const get=options=>new Promise((ok,no)=>{const q=https.get({hostname:'127.0.0.1',port,path:'/',...options},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>ok(s));});q.on('error',no);});
  await assert.rejects(get({}),e=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code));
  assert.equal(await get({ca:readFileSync(cert)}),'isolated TLS health only');
  await new Promise(r=>server.close(r));server=undefined;
 }finally{if(server)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
