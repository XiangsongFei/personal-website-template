// Independent synthetic TLS lifecycle fixture; never contacts Docker or project services.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('HTTP completion, expected 409, RST, abort, truncation and timeout keep distinct outcomes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'s3-close-test-'));
 try {
  const ssl=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=synthetic-fixture','-addext','subjectAltName=DNS:close-fixture.invalid'],{encoding:'utf8'});assert.equal(ssl.status,0);
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./support/close-fixture.mjs',import.meta.url)),directory],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);const data=JSON.parse(result.stdout);assert.equal(data.tests,7);assert.equal(data.pass,7);assert.equal(data.businessWrites,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
