// Offline test harness. R3_WORKERD_PACKAGE may point to an existing matching installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const installed = resolve(process.env.R3_WORKERD_PACKAGE ?? join(root,'node_modules/workerd'));
const present = existsSync(join(installed,'package.json'));
test('same R3 verifier suite in pinned workerd, with zero listeners and denied outbound network', {
  skip: !present && !process.env.R3_REQUIRE_WORKERD && !process.env.R3_WORKERD_PACKAGE && 'NOT RUN: install pinned workerd or set R3_WORKERD_PACKAGE'
}, async () => {
  const lock = JSON.parse(readFileSync(join(root,'package-lock.json')));
  assert.equal(JSON.parse(readFileSync(join(installed,'package.json'))).version,lock.packages['node_modules/workerd'].version);
  const tmp = await mkdtemp(join(tmpdir(),'s33-r3-workerd-'));
  const files=['tests/s3/r3-verifier.test.mjs',...['r3-verifier','private-rpc','r3-intent-ledger','r3-intent-object','identity','protocol','binding'].map(x=>'lib/business/'+x+'.mjs'),...['binding','test-proof','verifier','ledger'].map(x=>'tests/s3/fixtures/'+x+'.mjs')];
  try {
    for (const file of files) {
      await mkdir(dirname(join(tmp,file)),{ recursive:true });await copyFile(join(root,file),join(tmp,file));
    }
    await copyFile(join(installed,'workerd.capnp'),join(tmp,'workerd.capnp'));
    const modules = files.map(s=>`(name="${s}",esModule=embed "${s}")`).join(',');
    await writeFile(join(tmp,'test.capnp'),`using Workerd = import "workerd.capnp";
const config :Workerd.Config = (services=[
 (name="suite",worker=(compatibilityDate="2026-08-15",compatibilityFlags=["nodejs_compat"],globalOutbound="offline",modules=[${modules}])),
 (name="offline",network=(allow=[],deny=["0.0.0.0/0","::/0"]))]);`);
    const result = spawnSync(join(installed,'bin/workerd'),['test','test.capnp'], {
      cwd:tmp,encoding:'utf8',timeout:20000,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}
    });
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stderr,/\[ PASS \] suite/);
  } finally { await rm(tmp,{recursive:true,force:true}); }
});
