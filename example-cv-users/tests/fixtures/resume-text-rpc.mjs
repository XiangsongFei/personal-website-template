import assert from 'node:assert/strict';
import {realAuthority,TEST_KEY,TEST_ORIGIN} from '../auth-fixture.mjs';
import {runtime} from '../runtime.mjs';
import {emptyTextContent, textCommand, textCommandDigest,wireRecordScopes} from '../../lib/editor/resume-text.ts';

export function createResumeTextRpc(auth,sites) {
  const states=new Map(), receipts=new Map(), records=new Map();
  const controls={lost:false, delay:0, denied:new Set()};
  let writes=0;
  const rpc=async request=>{
    const url=new URL(request.url);
    assert.equal(url.origin,'https://users.resume.example.invalid');
    const actor=auth.principal(request);
    if(!actor || controls.denied.has(actor.id)) return Response.json({code:'42501'},{status:403});
    const siteId=sites.get(actor.id);
    if(url.pathname==='/rpc/get_my_site') return Response.json({schema_version:1,site:{id:siteId}});
    const body=await request.json();
    if((body.target??body.input?.siteId)!==siteId) return Response.json({code:'42501'},{status:403});
    const section=body.section_key??body.input.section;
    const scope=siteId+':'+section;
    const current=states.get(scope)??{siteId,section,revision:0,content:emptyTextContent(section)};
    if(url.pathname==='/rpc/read_resume_text') return Response.json(current);
    const receiptKey=scope+':'+(body.operation_id??body.input.requestId);
    if(url.pathname==='/rpc/read_resume_text_operation'){
      const saved=receipts.get(receiptKey);
      if(!saved||saved.sid!==actor.sid) return Response.json({state:'unknown'});
      if(saved.value.digest!==body.request_digest||saved.basis!==body.basis) return Response.json({code:'PT409'},{status:409});
      return Response.json(saved.value);
    }
    assert.equal(url.pathname,'/rpc/save_resume_text');
    const command=textCommand(body.input);
    assert.equal(body.canonical,JSON.stringify(command));
    const digest=await textCommandDigest(command);
    const prior=receipts.get(receiptKey);
    if(prior){
      if(prior.sid!==actor.sid) return Response.json({code:'42501'},{status:403});
      return prior.value.digest===digest?Response.json(prior.value):Response.json({code:'PT409'},{status:409});
    }
    const revision=states.get(scope)?.revision??0;
    if(command.expectedRevision!==revision)return Response.json({code:'PT409'},{status:409});
    const incoming=wireRecordScopes(section,command.content);
    if(incoming.some(row=>records.has(row.id)&&records.get(row.id)!==scope+':'+row.scope))
      return Response.json({code:'42501'},{status:403});
    for(const row of incoming) records.set(row.id,scope+':'+row.scope);
    const snapshot={siteId,section,revision:revision+1,content:command.content};
    const value={state:'saved',requestId:command.requestId,digest,snapshot};
    states.set(scope,snapshot);
    receipts.set(receiptKey,{sid:actor.sid,basis:revision,value});
    writes++;
    if(controls.delay)await new Promise(r=>setTimeout(r,controls.delay));
    if(controls.lost){
      controls.lost=false;
      return Response.json({code:'SIMULATED_RESPONSE_LOSS'},{status:503});
    }
    return Response.json(value);
  };
  return {rpc,controls,receipts,get writes(){return writes;}};
}

export async function resumeTextRuntime({port,enabled=true,origin=TEST_ORIGIN}={}) {
  const auth=await realAuthority();
  const sites=new Map([[auth.ids.A,crypto.randomUUID()],[auth.ids.B,crypto.randomUUID()]]);
  const fixture=createResumeTextRpc(auth,sites);
  const mf=runtime({...(port===undefined?{}:{port}),https:origin.startsWith('https:'),
    bindings:{USERS_CURRENT_PASSWORD_POLICY:'ON',USERS_MODE:'isolated',USERS_PROJECT_REF:'isolated-users',
      USERS_SUPABASE_URL:'https://users.auth.example.invalid',USERS_PUBLISHABLE_KEY:TEST_KEY,USERS_APP_ORIGIN:origin,
      ...(enabled?{USERS_RESUME_TEXT_MODE:'synthetic'}:{})},
    serviceBindings:{USERS_RESUME_TEXT_RPC:fixture.rpc},outboundService:r=>auth.fetch(r)});
  return {mf,auth,sites,controls:fixture.controls,get writes(){return fixture.writes;}};
}
