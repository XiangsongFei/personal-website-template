// Source boundaries only, not authorization, RLS, Storage or deployment acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(root+'lib/business/text-publication.mjs','utf8');
test('STATIC text planner has no I/O, live authorization, asset implementation or resource dependencies',()=>{
  const imports=[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(x=>x[1]);
  assert.deepEqual(imports,['./protocol.mjs']);
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|createServer|listen|spawn|execSync|readFile|writeFile)\s*\(/);
  assert.doesNotMatch(source,/from\s+['"].*(?:identity|storage|asset-|gate|owner-enrollment|repository)/);
  assert.match(source,/OFFLINE_PLAN/);
});
test('STATIC no active application/worker entrypoint imports publication candidate',()=>{
  function walk(dir){
    return readdirSync(dir,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(dir+'/'+x.name):[dir+'/'+x.name]);
  }
  for(const dir of ['app','worker'])for(const path of walk(root+dir)){
    if(/\.(?:ts|tsx|js|mjs)$/.test(path))assert.doesNotMatch(readFileSync(path,'utf8'),/text-publication|planTextPublication/);
  }
});
