import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {uuid} from '../../lib/business/protocol.mjs';
import {withCredential} from '../../lib/business/identity.mjs';
import {textPayload} from '../../lib/business/text-publication.mjs';
import {textCommand} from './compat/command.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');

function nativeRpc(socketPath, actor, operation, input, target = actor.site, canonical) {
  assert.ok(['read_introduction','save_text_draft','publish_site','s36_literal_boundary'].includes(operation));
  const body=JSON.stringify(operation==='s36_literal_boundary'?{}:operation==='read_introduction'?{target}:{target,input,canonical_request:canonical??JSON.stringify({operation,...input})});
  return withCredential(actor.login.handle,token=>new Promise((yes,no)=>{
    const req=request({socketPath,path:'/rpc/'+operation,method:'POST',agent:false,signal:AbortSignal.timeout(9000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Profile':'site_api',
        'Accept-Profile':'site_api',Prefer:'tx=rollback','Content-Length':Buffer.byteLength(body)}},res=>{
      let raw='';
      res.setEncoding('utf8');
      res.on('data',part=>{raw+=part;if(raw.length>131072) res.destroy(Error('BOUNDARY_RESPONSE_SIZE'));});
      res.on('error',no);
      res.on('end',()=>{try{yes({status:res.statusCode,preference:res.headers['preference-applied'],body:JSON.parse(raw)});}catch(error){no(error);}});
    });
    req.on('error',no);
    req.end(body);
  }));
}

export function verifyReceiptOnly(before,after,actor,operation,input,result) {
  const oldIds=new Set(before.operations.map(row=>row.id));
  assert.deepEqual(after.operations.filter(row=>oldIds.has(row.id)),before.operations);
  assert.deepEqual({...after,operations:before.operations},before);
  const rows=after.operations.filter(row=>!oldIds.has(row.id));
  assert.equal(rows.length,1);
  const canonical=JSON.stringify({operation,...input});
  const row=rows[0];
  assert.deepEqual([row.site_id,row.actor_auth_user_id,row.actor_session_id,row.operation,row.request_id,
    row.state,row.canonical_request,row.payload_digest,row.digest_encoding,row.result],
  [actor.site,actor.uid,actor.sid,operation,input.request_id,'succeeded',canonical,sha(canonical),'js-json-stringify-v1',result]);
  const site=before.sites.find(item=>item.id===actor.site);
  assert.deepEqual(result,{schema_version:1,request_id:input.request_id,site_id:actor.site,changed:false,
    draft_revision:site.draft_revision,publication:site.publication});
}

export async function runRemainingBoundaries({actors,baseline,keys,observe,receipt,socketPath}) {
  let previous=baseline;
  const mode=await nativeRpc(socketPath,actors.alice,'read_introduction');
  assert.deepEqual([mode.status,mode.preference,mode.body.site_id],[200,'tx=rollback',actors.alice.site]);
  receipt('native-rollback-admission',{status:mode.status,preference:mode.preference});
  const same=label=>assert.deepEqual(observe(label+'-independent'),previous);
  const save=(actor,key)=> {
    const site=baseline.sites.find(row=>row.id===actor.site);
    return textCommand('save_text_draft',{schema_version:1,request_id:key,expected_draft_revision:site.draft_revision,
      payload:textPayload(site.payload)});
  };
  for(const [name,actor] of Object.entries(actors)) {
    const other=name==='alice'?actors.bob:actors.alice;
    const site=baseline.sites.find(row=>row.id===actor.site);
    const foreign=baseline.snapshots.find(row=>row.site_id===other.site);
    assert.ok(foreign);
    const input=textCommand('publish_site',{schema_version:1,request_id:keys[name+'Publish'],
      expected_draft_revision:site.draft_revision,expected_publication_revision:site.publication.publication_revision,
      snapshot_id:foreign.id});
    const response=await nativeRpc(socketPath,actor,'publish_site',input);
    receipt(name+'-foreign-snapshot',response);
    assert.deepEqual([response.status,response.body.code,response.body.message],[400,'22023','SNAPSHOT_NOT_FOUND']);
    same(name+'-foreign-snapshot');
  }

  const {alice,bob}=actors;
  const original=save(alice,keys.boundary);
  const entry=original.payload.entries[0];
  assert.ok(entry);
  for(const [label,change,error] of [
    ['file-field',item=>({...item,assets:[{key:'synthetic-file'}]}),'22023'],
    ['nul',item=>({...item,translations:{en:'before\u0000after'}}),'22P05'],
    ['surrogate',item=>({...item,translations:{en:'before\ud800after'}}),'22P05']
  ]) {
    const input={...original,payload:{schema_version:1,entries:[change(entry)]}};
    await assert.rejects(alice.service.saveTextDraft(alice.login.handle,alice.site,input),{code:'INVALID_INPUT',status:400});
    const wire=await nativeRpc(socketPath,alice,'save_text_draft',input);
    receipt('input-'+label,{application:'INVALID_INPUT',native:wire});
    assert.equal(wire.status,400);
    assert.ok((error==='22P05'?['22P05','PGRST102']:[error]).includes(wire.body.code));
    same('input-'+label);
  }
  const literal={en:'Quoted "text" \\ 😀 https://example.test/path <b>literal</b>\nline',zh:'中文「原文」😀 <i>文字</i>'};
  const positive=textCommand('save_text_draft',{...original,payload:{schema_version:1,entries:[{...entry,translations:literal}]}});
  const roundtrip=await nativeRpc(socketPath,alice,'save_text_draft',positive);
  receipt('input-literal-rollback',roundtrip);
  assert.deepEqual([roundtrip.status,roundtrip.preference,roundtrip.body?.changed,roundtrip.body?.draft_revision],
    [200,'tx=rollback',true,original.expected_draft_revision+1]);
  assert.deepEqual(roundtrip.body.publication,baseline.sites.find(row=>row.id===alice.site).publication);
  same('input-literal-rollback');

  const bobSave=save(bob,keys.boundary);
  const unpublish=textCommand('unpublish_site',{schema_version:1,request_id:keys.boundary,expected_publication_revision:9});
  const bobUnpublish=textCommand('unpublish_site',{...unpublish,expected_publication_revision:4});
  async function absent(actor,operation,input,label) {
    const output=operation==='save_text_draft'
      ?await actor.service.readTextDraftOperation(actor.login.handle,actor.site,input)
      :await actor.service.readPublicationOperation(operation,actor.login.handle,actor.site,input);
    receipt(label,output);
    assert.deepEqual(output,{status:'UNKNOWN',request_id:keys.boundary,retry_with_new_id:false});
    same(label);
  }
  async function noOp(actor,operation,input,label) {
    receipt(label+'-dispatch',{site:actor.site,operation,request_id:input.request_id});
    const result=await actor.service[operation==='save_text_draft'?'saveTextDraft':'unpublish'](actor.login.handle,actor.site,input);
    receipt(label,result);
    const current=observe(label+'-independent');
    verifyReceiptOnly(previous,current,actor,operation,input,result);
    previous=current;
    return result;
  }
  const aliceResult=await noOp(alice,'save_text_draft',original,'alice-save-noop');
  assert.deepEqual(await alice.service.saveTextDraft(alice.login.handle,alice.site,original),aliceResult);
  same('alice-save-replay');
  await assert.rejects(bob.service.readTextDraftOperation(bob.login.handle,alice.site,original),{code:'BUSINESS_DENIED',status:403});
  receipt('cross-actor-owner',{denied:true});
  await absent(bob,'save_text_draft',bobSave,'other-site-before');
  await absent(alice,'unpublish_site',unpublish,'other-operation-before');
  const bobResult=await noOp(bob,'save_text_draft',bobSave,'bob-same-key-save-noop');
  const unpublishResult=await noOp(alice,'unpublish_site',unpublish,'alice-other-operation-noop');
  await absent(bob,'unpublish_site',bobUnpublish,'other-site-and-operation');
  for(const [actor,command,input,result,label] of [
    [alice,'save_text_draft',original,aliceResult,'alice-own-save'],
    [bob,'save_text_draft',bobSave,bobResult,'bob-own-save'],
    [alice,'unpublish_site',unpublish,unpublishResult,'alice-own-unpublish']
  ]) {
    const actual=command==='save_text_draft'?await actor.service.readTextDraftOperation(actor.login.handle,actor.site,input)
      :await actor.service.readPublicationOperation(command,actor.login.handle,actor.site,input);
    assert.deepEqual(actual,{status:'succeeded',result});
    receipt(label,actual);
  }
  same('boundary-final-open-acl');
}

// This invoker uses the signed request identity and the unmodified save/read RPCs.
export function literalFixture(actor,site,key) {
  assert.ok([actor.site,actor.uid,actor.sid,key].every(uuid));
  assert.equal(site.id,actor.site);
  const entry=site.payload.entries[0];
  assert.ok(entry);
  const expected=textPayload({schema_version:1,entries:[{...entry,translations:{
    en:'Quoted "text" \\ 😀 https://example.test/path <b>literal</b>\nline',
    zh:'中文「原文」😀 <i>文字</i>'
  }}]});
  const input=textCommand('save_text_draft',{schema_version:1,request_id:key,expected_draft_revision:5,payload:expected});
  const canonical=JSON.stringify({operation:'save_text_draft',...input});
  const scoped=`
 IF session_user<>'ecv_s3_internal_api_login' OR current_user<>'authenticated'
   OR auth.uid() IS DISTINCT FROM '${actor.uid}'::uuid
   OR auth.jwt()->>'session_id' IS DISTINCT FROM '${actor.sid}'
 THEN RAISE EXCEPTION 'BOUNDARY_DENIED' USING ERRCODE='42501'; END IF;`;
  const body=`
DECLARE before_save jsonb; written jsonb; readback jsonb; restored jsonb; rolled_back boolean:=false;
BEGIN
 ${scoped}
 before_save:=site_api.read_introduction('${actor.site}'::uuid);
 IF (before_save->>'draft_revision')::integer IS DISTINCT FROM 5
 THEN RAISE EXCEPTION 'BOUNDARY_BASELINE'; END IF;
 BEGIN
   written:=site_api.save_text_draft('${actor.site}'::uuid,$input$${JSON.stringify(input)}$input$::jsonb,$wire$${canonical}$wire$);
   readback:=site_api.read_introduction('${actor.site}'::uuid);
   IF (written->>'changed')::boolean IS DISTINCT FROM true
     OR (readback->>'draft_revision')::integer IS DISTINCT FROM 6
     OR (readback->>'section_revision')::integer IS DISTINCT FROM 6
     OR readback->'entries' IS DISTINCT FROM $entries$${JSON.stringify(expected.entries)}$entries$::jsonb
   THEN RAISE EXCEPTION 'S36_LITERAL_CONTENT'; END IF;
   RAISE EXCEPTION 'S36_LITERAL_ROLLBACK' USING ERRCODE='PZ362';
 EXCEPTION WHEN SQLSTATE 'PZ362' THEN
   IF SQLERRM<>'S36_LITERAL_ROLLBACK' THEN RAISE; END IF;
   rolled_back:=true;
 END;
 restored:=site_api.read_introduction('${actor.site}'::uuid);
 IF NOT rolled_back OR restored IS DISTINCT FROM before_save THEN RAISE EXCEPTION 'S36_LITERAL_RESTORE'; END IF;
 RETURN jsonb_build_object('request_id','${key}'::uuid,'readback',readback,'written',written,'restored',true);
END;`;
  const signature='site_api.s36_literal_boundary()';
  const functionMarker='$literal_fixture$';
  assert.ok(!body.includes(functionMarker));
  const admit=`
 DO $check$ BEGIN
 IF to_regprocedure('${signature}') IS NOT NULL
    OR pg_has_role('postgres','ecv_s3_command_writer','SET')
    OR has_schema_privilege('ecv_s3_command_writer','site_api','CREATE')
 THEN RAISE EXCEPTION 'S36_LITERAL_ADMISSION'; END IF; END;$check$;`;
  const grant='GRANT ecv_s3_owner,ecv_s3_command_writer TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;';
  const revoke='REVOKE ecv_s3_owner,ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;';
  return {input,expected,bodySha:sha(body),install:`
 ${admit}
 ${grant}
 GRANT CREATE ON SCHEMA site_api TO ecv_s3_command_writer;
 SET LOCAL ROLE ecv_s3_command_writer;
 CREATE FUNCTION ${signature} RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
  SET search_path='' AS ${functionMarker}${body}${functionMarker};
 REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticator,service_role;
 GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;
 RESET ROLE;
 REVOKE CREATE ON SCHEMA site_api FROM ecv_s3_command_writer;
 ${revoke}
 DO $acl$ BEGIN
 IF EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid='${signature}'::regprocedure AND a.grantee NOT IN (p.proowner,'authenticated'::regrole))
 THEN RAISE EXCEPTION 'S36_LITERAL_ACL'; END IF; END;$acl$;`,remove:`
 DO $check$ BEGIN IF NOT EXISTS(SELECT FROM pg_proc
  WHERE oid=to_regprocedure('${signature}') AND proowner='ecv_s3_command_writer'::regrole AND NOT prosecdef
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${sha(body)}')
 THEN RAISE EXCEPTION 'S36_LITERAL_IDENTITY'; END IF; END;$check$;
 ${grant}
 SET LOCAL ROLE ecv_s3_command_writer;
 DROP FUNCTION ${signature};
 RESET ROLE;
 ${revoke}`};
}

export async function verifyLiteralRoundTrip(socketPath,actor,fixture,receipt) {
  const actual=await nativeRpc(socketPath,actor,'s36_literal_boundary');
  receipt('literal-roundtrip',actual);
  assert.deepEqual([actual.status,actual.preference,actual.body.request_id,actual.body.restored],
    [200,'tx=rollback',fixture.input.request_id,true]);
  assert.deepEqual(actual.body.readback,{schema_version:1,site_id:actor.site,section_revision:6,draft_revision:6,
    entries:fixture.expected.entries});
}
