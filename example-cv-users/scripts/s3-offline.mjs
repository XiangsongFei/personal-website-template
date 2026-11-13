// Offline only: no Docker, database, real Auth, secret sources or deploy commands.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,CI:'1',R3_REQUIRE_WORKERD:'1',WRANGLER_SEND_METRICS:'false'};
function run(binary,args){const r=spawnSync(binary,args,{cwd:root,env,stdio:'inherit'});if(r.error||r.status!==0)process.exit(r.status??1);}
const manifest=JSON.parse(readFileSync(root+'tests/s3/migration-source-contract.json'));assert.deepEqual(readdirSync(root+'supabase/migrations').filter(x=>x.endsWith('.sql')).sort(),Object.keys(manifest));for(const [name,sha]of Object.entries(manifest))assert.equal(createHash('sha256').update(readFileSync(root+'supabase/migrations/'+name)).digest('hex'),sha,name);
run('python3',['-B','tests/s3/offline-driver-fixtures/prepare.py']);
const tests=readdirSync(root+'tests/s3').filter(x=>x.endsWith('.test.mjs')).map(x=>'tests/s3/'+x);
run(process.execPath,['--test',...tests,'tests/s3/connection-readiness/hba-prefix.test.mjs']);
for(const file of ['static_check.py','business_static_check.py','business_acl.test.py','plpgsql_syntax.test.py','r3_database_test.py','m7_contract.test.py','clean_target.test.py','s34_baseline.test.py','driver_image.test.py'])run('python3',['-B','tests/s3/'+file]);
for(const file of readdirSync(root+'lib/business').filter(x=>x.endsWith('.mjs')))run(process.execPath,['--check','lib/business/'+file]);
console.log('S3 offline, native runtime, SQL source and ACL suites passed; no live writes');
