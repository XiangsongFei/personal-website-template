import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,chmodSync,realpathSync,symlinkSync,linkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PIN,ROOT,CERT,KEY,checked,validateCertificate,loadServerIdentity} from '../scripts/https/identity.mjs';
import {assertCurrentNode} from '../scripts/https/node-identity.mjs';
const node=process.execPath;
test('macOS Node identity verifies this PID and the pinned executable bytes; wrong digest is rejected',{skip:process.platform!=='darwin' && 'macOS-specific executable and Keychain tool; other offline TLS tests still run'},()=>{
  const actual=assertCurrentNode();assert.equal(actual.pid,process.pid);assert.equal(actual.version,'24.22.1');assert.equal(actual.executableSha256,PIN.nodeExecutableSha256);
  const dir=mkdtempSync(resolve(tmpdir(),'s2-node-pin-'));
  try{const code=resolve(dir,'scripts/https');mkdirSync(code,{recursive:true});for(const name of ['identity.mjs','node-identity.mjs'])copyFileSync(resolve(ROOT,'scripts/https',name),resolve(code,name));writeFileSync(resolve(code,'policy.json'),JSON.stringify({...PIN,nodeExecutableSha256:'0'.repeat(64)}));
    const r=spawnSync(node,['--input-type=module','-e',`import {assertCurrentNode} from ${JSON.stringify(new URL('file://'+resolve(code,'node-identity.mjs')).href)};assertCurrentNode();`],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/node_identity_digest_denied/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('certificate pins retain exact leaf, only local SAN, serverAuth and real validity checks',()=>{
 const now=Date.now(),base={fingerprint256:PIN.serverCertificateSha256,ca:false,subjectAltName:'IP Address:127.0.0.1',checkIP:()=> '127.0.0.1',keyUsage:['1.3.6.1.5.5.7.3.1'],validFrom:new Date(now-1000).toISOString(),validTo:new Date(now+1000).toISOString()};
 assert.equal(validateCertificate(base,now),base);
 for(const patch of [{fingerprint256:'0'.repeat(64)},{ca:true},{subjectAltName:'DNS:*.example.invalid'},{subjectAltName:'IP Address:127.0.0.1, DNS:localhost'},{checkIP:()=>undefined},{keyUsage:['1.3.6.1.5.5.7.3.2']},{keyUsage:[]},{validFrom:new Date(now+1).toISOString()},{validTo:new Date(now).toISOString()}])assert.throws(()=>validateCertificate({...base,...patch},now));
 assert.equal(CERT,resolve(ROOT,'.runtime/tls/server.crt'));assert.equal(KEY,resolve(ROOT,'.runtime/tls/server.key'));
 assert.throws(()=>loadServerIdentity('backend',()=>{}),/private_key_role_denied/);assert.throws(()=>loadServerIdentity('tls',async()=>{}),/synchronous_tls_consumer_required/);
});
test('loader keeps owner, symlink, hardlink and key-mode boundaries without reading any key',()=>{
 const dir=realpathSync(mkdtempSync(resolve(tmpdir(),'s2-path-pin-')));try{const p=resolve(dir,'metadata-only');writeFileSync(p,'not a key',{mode:0o600});assert.ok(checked(p,{root:dir,mode:0o600}));const alias=resolve(dir,'alias');symlinkSync(p,alias);assert.throws(()=>checked(alias,{root:dir}),/unsafe_path/);unlinkSync(alias);linkSync(p,alias);assert.throws(()=>checked(p,{root:dir}),/unsafe_file_type/);unlinkSync(alias);chmodSync(p,0o644);assert.throws(()=>checked(p,{root:dir,mode:0o600}),/unsafe_permissions/);assert.throws(()=>checked('/outside',{root:dir}),/path_outside_users_package/);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('tool sources have package-local imports and no historical absolute path; trust policy tests are offline',()=>{
 for(const name of ['local-https.mjs','controlled-https.mjs']){const s=readFileSync(resolve(ROOT,'scripts',name),'utf8');assert.doesNotMatch(s,/users-session-probe|\/Users\//);assert.match(s,/assertCurrentNode\(\)/);assert.match(s,/\.\/https\/identity.mjs/);}
 const effective=readFileSync(resolve(ROOT,'scripts/https/read-leaf-effective.py'),'utf8');
 assert.doesNotMatch(effective,/S2_VERIFIED_NODE|preflight\.mjs/);assert.match(effective,/server\.pem/);assert.match(effective,/certificate validity changed; not evidence of trust restoration/);
 const r=spawnSync('/usr/bin/python3',[resolve(ROOT,'tests/fixtures/tls-policy-offline.py')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/offline trust tests passed/);
});
