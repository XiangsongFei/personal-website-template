import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {boundaryPlan,publicationNoop} from '../../scripts/s36-hosted/publication-boundaries.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const digest=text=>createHash('sha256').update(text).digest('hex');
const ids={alice:id(1),bob:id(2),aliceSite:id(3),bobSite:id(4)};
const sid=id(5), oldSnapshot=id(6), uid=ids.alice;
const project='vellypyadcxkvqftsbrg';
const publish={schema_version:1,request_id:id(7),expected_draft_revision:4,expected_publication_revision:0,snapshot_id:null};
const withdraw={schema_version:1,request_id:id(8),expected_publication_revision:1};
const receipt=(operation,input,revisions,result)=> {
  const canonical_request=JSON.stringify({operation,...input});
  return {operation,request_id:input.request_id,site_id:ids.aliceSite,state:'succeeded',
    actor_auth_user_id:uid,actor_session_id:sid,canonical_request,payload_digest:digest(canonical_request),
    basis_draft_revision:revisions[0],basis_publication_revision:revisions[1],result};
};
const history={
  operations:[receipt('publish_site',publish,[4,0],{publication:{publication_revision:1}}),
    receipt('unpublish_site',withdraw,[5,1],{publication:{publication_revision:2}})],
  snapshots:[{id:oldSnapshot,source_draft_revision:4,site_id:ids.aliceSite}]
};
const requests=Object.fromEntries('draftCas publicationCas racingA racingB sameSnapshot oldSnapshot withdraw repeatWithdraw cleanupAt3 cleanupAt4'
  .split(' ').map((key,index)=>[key,id(index+21)]));
const plan={project,...ids,oldSnapshot,requests,replays:{publish,withdraw},
  proofs:{alice:id(10),bob:id(11),generationProbe:id(12)}};

test('boundary plan pins original canonical receipt bytes and rejects consumed or duplicate IDs',()=>{
  boundaryPlan(ids,plan,history);
  assert.throws(()=>boundaryPlan(ids,{...plan,requests:{...requests,racingA:publish.request_id}},history));
  assert.throws(()=>boundaryPlan(ids,{...plan,requests:{...requests,racingA:requests.racingB}},history));
  assert.throws(()=>boundaryPlan(ids,{...plan,replays:{publish,withdraw:{...withdraw,expected_publication_revision:2}}},history));
  assert.throws(()=>boundaryPlan(ids,{...plan,oldSnapshot:id(13)},history));
});

test('new-key publication and withdrawal no-ops add exactly one immutable receipt and no publication effects',()=>{
  for(const [operation,base,publication] of [
    ['publish_site',publish,{publication_revision:3,state:'published',snapshot_id:id(13)}],
    ['unpublish_site',withdraw,{publication_revision:5,state:'unpublished',snapshot_id:null}]
  ]) {
    const input={...base,request_id:id(15),expected_publication_revision:publication.publication_revision};
    const before={...history,sites:[{id:ids.aliceSite,draft_revision:5,publication}],audits:[],history:[],outbox:[],
      domains:[],members:[],drafts:[]};
    const result={changed:false,publication,draft_revision:5,request_id:input.request_id};
    const added={id:id(14),...receipt(operation,input,[5,publication.publication_revision],result)};
    const after={...before,operations:[...before.operations,added]};
    publicationNoop(ids.aliceSite,before,after,operation,input,result,{uid,session_id:sid});
    assert.throws(()=>publicationNoop(ids.aliceSite,before,before,operation,input,result,{uid,session_id:sid}));
    assert.throws(()=>publicationNoop(ids.aliceSite,before,{...after,outbox:[{}]},operation,input,result,{uid,session_id:sid}));
    assert.throws(()=>publicationNoop(ids.aliceSite,before,{...after,operations:[...after.operations,added]},operation,input,result,{uid,session_id:sid}));
  }
});
