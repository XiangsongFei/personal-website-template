import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {textPayload} from '../../lib/business/text-publication.mjs';
import {textCommand} from './compat/command.mjs';
import {privateFile} from './target.mjs';
import {writeOnce} from './r3.mjs';

const [run]=process.argv.slice(2);
assert.equal(process.argv.length,3);
const read=name=>JSON.parse(privateFile(join(run,name)));
const group=privateFile(join(run,'local-id')).trim();
assert.match(group,/^s36last[a-z0-9]{8}$/);
const db=group+'-db',rest=group+'-rest-upgrade';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:12000,stdio:['pipe','pipe','pipe']});
for(const name of [db,rest]) {
 const [container]=JSON.parse(docker(['inspect',name]));
 assert.equal(container.Config.Labels['s36.run'],group+'-pg');
 assert.equal(container.State.Running,true);
 assert.deepEqual(Object.keys(container.NetworkSettings.Networks),[group+'-net']);
 assert.ok(Object.values(container.NetworkSettings.Ports??{}).every(port=>port===null||port.length===0));
}
const [network]=JSON.parse(docker(['network','inspect',group+'-net']));
assert.equal(network.Internal,true);
assert.equal(network.Labels['s36.run'],group+'-pg');
const before=read('local-before-01.json');
const installed=read('local-installed-02.json');
assert.deepEqual([installed.m3_rows,installed.m3_pointer],[before.m3_rows,before.m3_pointer]);
const {site,uid,sid}=read('local-m3-receipt.json');
const {token}=read('private/local-m3-token.json');
const old=before.m3_rows.find(x=>x.site_id===site);
assert.equal(old.actor_auth_user_id,uid);
assert.equal(old.site_revision,0);
const mappings=()=>JSON.parse(docker(['exec','-i',db,'psql','-X','-w','-qAt','-h','/private/var/tmp/s36-rebuild/socket','-p','55436',
 '-U','postgres','-d','s36_rebuild','-v','ON_ERROR_STOP=1'],
 "SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]'::jsonb) FROM site_private.text_digest_mappings m;"));
assert.deepEqual(mappings(),[]);
const operation='save_text_draft';
const input=textCommand(operation,{schema_version:1,request_id:randomUUID(),expected_draft_revision:0,payload:textPayload(old.payload)});
const canonical_request=JSON.stringify({operation,...input});
const body={target:site,input,canonical_request};
const curlConfig=['Authorization: Bearer '+token,'Content-Type: application/json',
 'Content-Profile: site_api','Accept-Profile: site_api'].map(h=>'header = '+JSON.stringify(h))
 .concat('data-binary = '+JSON.stringify(JSON.stringify(body))).join('\n')+'\n';
const result=JSON.parse(docker(['exec','-i',db,'curl','--silent','--show-error','--fail-with-body','--max-time','8',
 '--config','-','http://'+rest+':3000/rpc/'+operation],curlConfig));
assert.deepEqual([result.site_id,result.request_id,result.changed,result.draft_revision,
 result.publication.state,result.publication.publication_revision,result.publication.snapshot_id],
 [site,input.request_id,false,0,'unpublished',0,null]);
const [mapping,...extra]=mappings();
assert.equal(extra.length,0);
const canonical=JSON.stringify(input.payload);
assert.deepEqual([mapping.site_id,mapping.source_revision,mapping.source_draft_id,mapping.legacy_digest,
 mapping.js_digest,mapping.canonical_payload],
 [site,0,old.id,old.digest,createHash('sha256').update(canonical).digest('hex'),canonical]);
const rows=JSON.parse(docker(['exec','-i',db,'psql','-X','-w','-qAt','-h','/private/var/tmp/s36-rebuild/socket','-p','55436',
 '-U','postgres','-d','s36_rebuild','-v','ON_ERROR_STOP=1'],
 `SELECT jsonb_build_object('drafts',(SELECT jsonb_agg(to_jsonb(d)-'digest_encoding'-'previous_revision') FROM site_data.draft_revisions d),
 'pointers',(SELECT jsonb_agg(to_jsonb(p)) FROM site_data.site_publications p),
 'count',(SELECT count(*) FROM site_private.operation_requests WHERE request_id='${input.request_id}'::uuid
   AND actor_auth_user_id='${uid}'::uuid AND actor_session_id='${sid}'::uuid AND site_id='${site}'::uuid AND result->>'changed'='false'
   AND canonical_request=$r05$${canonical_request}$r05$),
 'outbox',(SELECT count(*) FROM site_private.publication_outbox),
 'snapshots',(SELECT count(*) FROM site_data.published_snapshots));`));
assert.deepEqual(rows,{drafts:before.m3_rows,pointers:before.m3_pointer,count:1,outbox:0,snapshots:0});
writeOnce(join(run,'local-r06-final.json'),{readback:true,noOp:true,recordedMapping:true,legacyDigest:mapping.legacy_digest,
 canonicalDigest:mapping.js_digest,sourceRevision:0,unpublished:true,outbox:0});
