import test from 'node:test';
import assert from 'node:assert/strict';
import {createAcceptanceSave} from '../scripts/s47/acceptance-save.mjs';

const attempt={body:{siteId:'site-a',command:{request_id:'key-a',expected_draft_revision:2,payload:'private text'}},
  digest:Promise.resolve('digest-a')};
const identity={uid:'owner-a',sid:'session-a'};
const failure={status:503,value:{code:'COMMIT_UNKNOWN'}};
const confirmed={status:200,value:{state:'saved'}};
const validate=r=>r?.status===200?r.value:undefined;

for(const scenario of [
  {name:'committed response lost', response:confirmed,state:'committed',outcome:'reconciled'},
  {name:'commit independently found', response:failure,state:'committed',outcome:'committed-without-application-receipt'},
  {name:'confirmed rollback', response:failure,state:'rolled-back',outcome:'rolled-back'},
  {name:'absence alone is not rollback', response:failure,state:'unobserved',outcome:'unknown'},
  {name:'reconciliation transport unavailable',state:'unobserved',outcome:'unknown'},
])test(scenario.name,async()=>{
  const order=[],journal=[];
  const save=createAcceptanceSave({journal:e=>{journal.push(e);order.push(e.outcome);},
    reconcile:async original=>{assert.equal(original,attempt);order.push('lookup');if (!scenario.response) throw Error();return scenario.response;},
    inspect:async metadata=>{assert.equal(metadata.requestId,'key-a');assert.equal(metadata.digest,'digest-a');assert.equal(metadata.sid,'session-a');
      order.push('read-only');return {state:scenario.state};}});
  assert.equal((await save.run(identity,attempt,()=>{order.push('dispatch');return failure;},validate)).outcome,scenario.outcome);
  assert.equal(order[0],'pending');
  assert.equal(order[1],'dispatch');
  assert.ok(order.indexOf('lookup')<order.indexOf('read-only'));
  assert.doesNotMatch(JSON.stringify(journal),/private text/);
  await assert.rejects(save.run(identity,attempt,()=>assert.fail('retry'),validate),/SAVE_BLOCKED/);
});
test('bounds exhausted, closed authority, and unknown credential scope preempt both checks',async()=>{
  const events=[];
  const save=createAcceptanceSave({journal:e=>events.push(e),allowed:()=>false,
    reconcile:()=>assert.fail('lookup'),inspect:()=>assert.fail('sql')});
  assert.equal((await save.run(identity,attempt,()=>{throw Error('timeout');},validate)).outcome,'unknown');
  assert.equal(events.at(-1).reason,'scope-or-budget');
});
test('ordinary conflict is conclusive and permits unrelated later commands',async()=>{
  const save=createAcceptanceSave({journal(){},reconcile:()=>assert.fail('lookup'),inspect:()=>assert.fail('sql')});
  const conflict={status:409,value:{code:'REQUEST_CONFLICT'}};
  assert.equal((await save.run(identity,attempt,()=>conflict,validate)).outcome,'rejected');
  assert.equal((await save.run(identity,attempt,()=>confirmed,validate)).outcome,'confirmed');
});
