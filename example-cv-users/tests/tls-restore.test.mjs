import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('trust CLI dispatch stays exact and independent of key/expiry (offline native boundary)',()=>{
 const r=spawnSync('/usr/bin/python3',['tests/fixtures/tls-restore-offline.py'],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 12 tests/);assert.match(r.stderr,/OK/);
});
