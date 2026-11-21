import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {textCommand} from './compat/command.mjs';
import {publicationProject,privateFile} from './target.mjs';
import {writeOnce} from './r3.mjs';
import {exact,uuid} from '../../lib/business/protocol.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');

export function faultCommand(entry,requestId) {
  return textCommand('save_text_draft',{schema_version:1,request_id:requestId,expected_draft_revision:5,
    payload:{schema_version:1,entries:[{id:entry,position:0,translations:{
      zh:'S3 合成回滚 '+requestId,en:'S3 synthetic rollback '+requestId}}]}});
}

export function bindSaveFault({site,uid,sid,input},source=readFileSync(new URL(
  '../../supabase/candidates/s36-hosted/save-fault-body.sql',import.meta.url),'utf8')) {
  const command=textCommand('save_text_draft',input);
  assert.equal(command.expected_draft_revision,5);
  assert.ok([site,uid,sid,command.request_id].every(uuid));
  const digest=sha(JSON.stringify({operation:'save_text_draft',...command}));
  const values={SITE:site,UID:uid,SID:sid,REQUEST:command.request_id,DIGEST:digest};
  const body='\n'+source.replace(/@(SITE|UID|SID|REQUEST|DIGEST)@/g,(_,key)=>values[key]);
  assert.ok(!body.includes('$fault$'));
  const sql=`CREATE FUNCTION site_private.s36_test_abort_save() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $fault$${body}$fault$;\n`;
  return {sql,bodySha:sha(body),digest,site,uid,sid,request:command.request_id};
}

// Used only by the isolated loopback ingress. No tokens, SQL error text or payloads enter the receipt.
export function observeSaveFault(project,planFile) {
  assert.equal(project,publicationProject);
  const plan=resolve(planFile);
  const receipt=join(dirname(plan),'save-fault-upstream.json');
  return ({args,who,status})=>{
    if (!Number.isInteger(status) || status<400 || status>599 || !existsSync(plan)) return;
    const bound=exact(JSON.parse(privateFile(plan)),['project','site','uid','sid','request','digest']);
    if (bound.project!==project || args.target!==bound.site || who.uid!==bound.uid || who.session_id!==bound.sid ||
        args.input?.request_id!==bound.request || sha(args.canonical_request)!==bound.digest) return;
    writeOnce(receipt,{...bound,upstreamStatus:status,sqlstate:'PT536',phase:'deferred_constraint_after_save_effects'});
  };
}
