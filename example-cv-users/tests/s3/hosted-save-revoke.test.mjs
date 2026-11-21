import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bindSaveFault,faultCommand,observeSaveFault} from '../../scripts/s36-hosted/save-fault.mjs';
import {scopedSignOut} from '../../scripts/s36-hosted/save-revoke-acceptance.mjs';
import {writeOnce} from '../../scripts/s36-hosted/r3.mjs';

const [site,uid,sid,request,entry]=Array.from({length:5},(_,i)=>`a0000000-0000-4000-a000-00000000000${i}`);
const project='vellypyadcxkvqftsbrg';
const input=faultCommand(entry,request);

test('the bound deferred save fault requires the exact actor, session, request and canonical digest',()=>{
  const {sql,bodySha,digest}=bindSaveFault({site,uid,sid,input});
  const body=sql.split('$fault$')[1];
  const sha=x=>createHash('sha256').update(x).digest('hex');
  assert.equal(bodySha,sha(body));
  assert.equal(digest,sha(JSON.stringify({operation:'save_text_draft',...input})));
  for (const value of [site,uid,sid,request,digest]) assert.ok(body.includes("'"+value+"'"));
  assert.ok(body.includes('IF NOT FOUND THEN RETURN NULL; END IF;'));
  assert.ok(body.indexOf('h.operation_id = operation.id')<body.indexOf("ERRCODE = 'PT536'"));
  assert.throws(()=>bindSaveFault({site:site+"';",uid,sid,input}));
});

test('local ingress observer ignores mismatched scope and records only the first matching refusal',()=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'s36-save-revoke-test.'));
  try {
    const plan=join(dir,'fault-plan.json');
    const receipt=join(dir,'save-fault-upstream.json');
    const observe=observeSaveFault(project,plan);
    const args={target:site,input,canonical_request:JSON.stringify({operation:'save_text_draft',...input})};
    const who={uid,session_id:sid};
    const {digest}=bindSaveFault({site,uid,sid,input});
    observe({args,who,status:536});
    writeOnce(plan,{project,site,uid,sid,request,digest});
    observe({args,who:{...who,session_id:uid},status:536});
    observe({args:{...args,canonical_request:'{}'},who,status:536});
    assert.throws(()=>readFileSync(receipt),{code:'ENOENT'});
    observe({args,who,status:536});
    assert.deepEqual(JSON.parse(readFileSync(receipt)),{project,site,uid,sid,request,digest,upstreamStatus:536,
      sqlstate:'PT536',phase:'deferred_constraint_after_save_effects'});
    assert.throws(()=>observe({args,who,status:536}),{code:'EEXIST'});
    assert.throws(()=>observeSaveFault('other',plan));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('native Auth logout is scoped to one access token and requires a real 204',async()=>{
  const scope={project,publishableKey:'synthetic'};
  let calls=0;
  const send=async (url,options)=>{
    calls++;
    assert.equal(url,'https://'+project+'.supabase.co/auth/v1/logout?scope=local');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer synthetic');
    return {status:204};
  };
  await scopedSignOut(scope,'synthetic',send);
  await assert.rejects(()=>scopedSignOut({...scope,project:'makwjnbubmrmopjhzror'},'synthetic',send));
  assert.equal(calls,1);
  await assert.rejects(()=>scopedSignOut(scope,'synthetic',async()=>({status:403})));
});
