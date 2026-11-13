import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pins,WORK_ROOT,root} from './driver/contract.mjs';
import {hostOfflineChecks} from './driver/startup.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
test('public synthetic fixture pin cannot authorize any REAL host execution',()=>{
 assert.equal(pins.fixture_mode,'OFFLINE_SYNTHETIC_NOT_EXECUTION_AUTHORITY');
 assert.throws(()=>hostOfflineChecks(),/SYNTHETIC_FIXTURES_CANNOT_AUTHORIZE_REAL_EXECUTION/);
 assert.equal(WORK_ROOT,resolve(fileURLToPath(root),'.s34-fixtures/work'));
});
test('public templates hold no user home, real JWT or private-key material',()=>{
 const text=readFileSync(new URL('./offline-driver-fixtures/templates.json',import.meta.url),'utf8');
 assert(!/\/Users\/[a-zA-Z0-9]+\/(?:Documents|Downloads)/.test(text));
 assert(!/eyJ[\w-]{8,}\.[\w-]{10,}\.[\w-]{10,}/.test(text));
 assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text));
 assert.match(JSON.parse(text).notice,/Synthetic OFFLINE/);
 for(const value of Object.values(JSON.parse(text).dummyMountFiles))assert.match(value,/NOT A CERTIFICATE OR KEY/);
});
