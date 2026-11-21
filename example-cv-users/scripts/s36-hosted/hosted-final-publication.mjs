import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync,openSync,closeSync,readFileSync} from 'node:fs';
import {request} from 'node:http';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {accountContext,withCredential} from '../../lib/business/identity.mjs';
import {uuid,exact} from '../../lib/business/protocol.mjs';
import {textPayload} from '../../lib/business/text-publication.mjs';
import {assertPrivateSocket} from './compat/private-ingress.node.mjs';
import {createRpcRepository} from './compat/repository.mjs';
import {createSiteService} from './compat/service.mjs';
import {textCommand} from './compat/command.mjs';
import {createRegistrar} from './database.mjs';
import {hostedScope} from './identity.mjs';
import {privateTransport} from './transport.mjs';
import {issueGrant,generation,writeOnce} from './r3.mjs';
import {runPublicProbe,verifyPublicProbeMaterial} from './hosted-public-http-probe.mjs';
import {configuration,connectionScope,privateFile,publicationProject} from './target.mjs';

const read=path=>JSON.parse(privateFile(path));
const sha=value=>createHash('sha256').update(value).digest('hex');
const here=name=>fileURLToPath(new URL(name,import.meta.url));
const sqlFile=name=>here('../../supabase/candidates/s36-hosted/'+name);
const names=['alicePublish','bobPublish','aliceWithdraw','bobWithdraw','ownerProbe','aliceProof','bobProof'];
const actorNames=['alice','bob'];
const grants=`GRANT ecv_s3_owner,ecv_s3_command_writer TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;`;
const release=`REVOKE ecv_s3_owner,ecv_s3_command_writer FROM postgres GRANTED BY postgres RESTRICT;`;
const generationAcl='GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;';
const generationRelease='REVOKE ecv_s3_owner FROM postgres GRANTED BY postgres RESTRICT;';
const observeQuery=readFileSync(sqlFile('publication-boundaries-observe.sql'),'utf8')
 .replace('\\ir publication-target.sql',`\\i '${sqlFile('final-live-scope.sql')}'`);
const scopeSql=`\\i '${sqlFile('final-live-scope.sql')}'`;

function apiBySocket(socketPath,token,args) {
 const body=JSON.stringify(args);
 return new Promise((yes,no)=>{
   const req=request({socketPath,path:'/rpc/s36_owner_fixture',method:'POST',agent:false,signal:AbortSignal.timeout(9000),
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Profile':'site_api',
      'Accept-Profile':'site_api',Prefer:'tx=rollback','Content-Length':Buffer.byteLength(body)}},res=>{
      let raw='';
      res.setEncoding('utf8');
      res.on('data',part=>{raw+=part;if(raw.length>4096) res.destroy(Error('OWNER_BOUNDS'));});
      res.on('error',no);
      res.on('end',()=>{try{yes({status:res.statusCode,preference:res.headers['preference-applied'],body:JSON.parse(raw)});}catch(error){no(error);}});
   });
   req.on('error',no);
   req.end(body);
 });
}

export function ownerFixtureSql({target,uid,sid,requestKey}) {
 assert.ok([target,uid,sid,requestKey].every(uuid));
 const template=readFileSync(sqlFile('final-owner-body.sql'),'utf8');
 const literals={SITE:target,UID:uid,SID:sid,REQUEST:requestKey};
 const body=template.replace(/@(SITE|UID|SID|REQUEST)@/g,(_,name)=>literals[name]);
 const install=`
 ${grants}
 DO $guard$ BEGIN
 IF has_table_privilege('ecv_s3_command_writer','site_data.site_members','DELETE')
    OR to_regprocedure('site_api.s36_owner_fixture(uuid,uuid)') IS NOT NULL
    OR EXISTS(SELECT FROM pg_policies WHERE schemaname='site_data' AND tablename='site_members' AND policyname='s36_owner_fixture_delete')
 THEN RAISE EXCEPTION 'S36_OWNER_FIXTURE_EXISTS'; END IF;
 END;$guard$;
 GRANT CREATE ON SCHEMA site_api TO ecv_s3_command_writer;
 GRANT DELETE ON site_data.site_members TO ecv_s3_command_writer;
 CREATE POLICY s36_owner_fixture_delete ON site_data.site_members FOR DELETE TO ecv_s3_command_writer
 USING (site_id='${target}'::uuid AND auth_user_id='${uid}'::uuid AND role='owner' AND state='active'
  AND session_user='ecv_s3_internal_api_login' AND current_setting('role',true)='authenticated'
  AND current_setting('s36_test.owner_remove',true)='${requestKey}'
  AND (current_setting('request.jwt.claims',true)::jsonb)->>'session_id'='${sid}');
 SET LOCAL ROLE ecv_s3_command_writer;
 CREATE FUNCTION site_api.s36_owner_fixture(target uuid,request_key uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $body$${body}$body$;
 REVOKE ALL ON FUNCTION site_api.s36_owner_fixture(uuid,uuid) FROM PUBLIC,anon,authenticator,service_role;
 GRANT EXECUTE ON FUNCTION site_api.s36_owner_fixture(uuid,uuid) TO authenticated;
 RESET ROLE;
 REVOKE CREATE ON SCHEMA site_api FROM ecv_s3_command_writer;
 ${release}
 DO $acl$ BEGIN
 IF EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid='site_api.s36_owner_fixture(uuid,uuid)'::regprocedure AND a.grantee NOT IN (p.proowner,'authenticated'::regrole))
 THEN RAISE EXCEPTION 'S36_OWNER_FIXTURE_ACL'; END IF;
 END;$acl$;`;
 const remove=`
 DO $guard$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('site_api.s36_owner_fixture(uuid,uuid)')
    AND proowner='ecv_s3_command_writer'::regrole AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${sha(body)}')
 THEN RAISE EXCEPTION 'S36_OWNER_FIXTURE_IDENTITY'; END IF; END;$guard$;
 ${grants}
 DROP FUNCTION site_api.s36_owner_fixture(uuid,uuid);
 DROP POLICY s36_owner_fixture_delete ON site_data.site_members;
 REVOKE DELETE ON site_data.site_members FROM ecv_s3_command_writer;
 ${release}`;
 return {install,remove,bodySha256:sha(body)};
}

export function verifyDomainRestoration(before,after) {
 assert.equal(after.length,before.length);
 for(const [index,original] of before.entries()) {
   const restored=after[index];
   assert.ok(Number.isFinite(Date.parse(original.updated_at))&&Date.parse(restored.updated_at)>=Date.parse(original.updated_at));
   assert.deepEqual({...restored,updated_at:original.updated_at},original);
 }
}

export function verifyPublicationDelta(before,after,actor,operation,input,result) {
 const {site,uid,sid}=actor;
 const isPublish=operation==='publish_site';
 const old=before.sites.find(x=>x.id===site);
 const current=after.sites.find(x=>x.id===site);
 assert.deepEqual(result.publication,current.publication);
 assert.equal(result.request_id,input.request_id);
 assert.equal(result.changed,true);
 assert.deepEqual(after.sites.map(s=>s.id===site?{...s,publication:old.publication}:s),before.sites);
 assert.equal(current.publication.publication_revision,old.publication.publication_revision+1);
 assert.equal(current.publication.state,isPublish?'published':'unpublished');
 assert.equal(current.publication.changed_by,uid);
 const append=(key,id)=>{
   const oldIds=new Set(before[key].map(id));
   assert.deepEqual(after[key].filter(x=>oldIds.has(id(x))),before[key],key);
   return after[key].filter(x=>!oldIds.has(id(x)));
 };
 const canonical=JSON.stringify({operation,...input});
 const operations=append('operations',x=>x.id);
 const history=append('history',x=>x.site_id+':'+x.publication_revision);
 const audit=append('audits',x=>x.id);
 const events=append('outbox',x=>x.id);
 const snapshots=append('snapshots',x=>x.id);
 assert.deepEqual([operations.length,history.length,audit.length,events.length,snapshots.length],[1,1,1,1,
   isPublish&&input.snapshot_id===null?1:0]);
 const [receipt]=operations;
 assert.deepEqual([receipt.site_id,receipt.actor_auth_user_id,receipt.actor_session_id,receipt.operation,receipt.request_id,
   receipt.canonical_request,receipt.payload_digest,receipt.result],[site,uid,sid,operation,input.request_id,canonical,sha(canonical),result]);
 for(const row of [...history,...audit,...events])
   assert.deepEqual([row.site_id,row.operation_id,row.publication_revision],[site,receipt.id,current.publication.publication_revision]);
 assert.equal(history[0].snapshot_id,current.publication.snapshot_id);
 assert.equal(history[0].previous_revision,old.publication.publication_revision===0?null:old.publication.publication_revision);
 assert.equal(audit[0].actor_session_id,sid);
 assert.equal(audit[0].actor_auth_user_id,uid);
 assert.deepEqual([events[0].state,events[0].attempt_count,events[0].lease_generation,events[0].event_type],
   ['pending',0,0,current.publication.state]);
 if(isPublish) {
   const snap=after.snapshots.find(x=>x.id===current.publication.snapshot_id);
   assert.equal(snap.site_id,site);
   if(input.snapshot_id!==null) assert.equal(snap.id,input.snapshot_id);
   else {
     assert.equal(snap.source_draft_revision,old.draft_revision);
     assert.deepEqual(snap.payload,old.payload);
     assert.equal(snap.digest,sha(JSON.stringify(textPayload(old.payload))));
   }
 }
 for(const key of ['domains','members','drafts','site_total','user_total','acl']) assert.deepEqual(after[key],before[key],key);
}

async function runBatch(dir,psql,manifestHash,native) {
 assert.ok(isAbsolute(dir)&&isAbsolute(psql)&&isAbsolute(native));
 const material=name=>join(dir,'private',name+'.json');
 const journal=join(dir,'journal');
 const receipt=(name,data)=>writeOnce(join(journal,name+'.json'),data);
 const fixture=configuration(read(material('fixture')));
 assert.equal(fixture.project,publicationProject);
 const planBytes=privateFile(join(dir,'plan.json'));
 assert.equal(sha(planBytes),manifestHash);
 const plan=exact(JSON.parse(planBytes),['project','baselineSha256','sourceManifestSha256','requests']);
 assert.equal(plan.project,publicationProject);
 exact(plan.requests,names);
 assert.ok(Object.values(plan.requests).every(uuid)&&new Set(Object.values(plan.requests)).size===names.length);
 const baselineFile=privateFile(join(dir,'baseline.json'));
 assert.equal(sha(baselineFile),plan.baselineSha256);
 const baseline=JSON.parse(baselineFile);
 assert.deepEqual(baseline.acl,[false,false]);
 assert.equal(baseline.outbox.length,5);
 assert.equal(baseline.site_total,2);
 assert.equal(baseline.user_total,2);
 assert.ok(baseline.operations.every(x=>!Object.values(plan.requests).includes(x.request_id)));
 verifyPublicProbeMaterial(dir,join(dir,'public-source.json'),plan.sourceManifestSha256);
 const params={alice_site:fixture.aliceSite,bob_site:fixture.bobSite};
 function psqlOnce(label,body,write=false,vars={}) {
   const args=['-X','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',write?'-At':'-qAt',
     ...Object.entries(vars).flatMap(([k,v])=>['-v',k+'='+v]),'-f','-'];
   const result=spawnSync(psql,args,{input:body,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
   const commit=write&&(result.stdout??'').trimEnd().endsWith('\nCOMMIT');
   receipt(label+'-sql',{exitCode:result.status,commit,
     codes:[...(result.stderr??'').matchAll(/(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/g)].map(x=>x[1])});
   if(result.status!==0||write&&!commit) throw Error(label+'-SQL');
   if(!write) return JSON.parse(result.stdout);
 }
 const observe=label=>{const row=psqlOnce(label,observeQuery,false,params);receipt(label,row);return row;};
 const change=(label,body)=>psqlOnce(label,`BEGIN;\n${scopeSql}\n${body}\nCOMMIT;\n`,true);
 const guards=(label)=>psqlOnce(label,`BEGIN READ ONLY;\n${scopeSql}
 SELECT jsonb_build_object('gate',(SELECT public_read_enabled FROM site_private.text_publication_runtime WHERE singleton),
 'fixture',to_regprocedure('site_api.s36_owner_fixture(uuid,uuid)') IS NOT NULL,
 'delete',has_table_privilege('ecv_s3_command_writer','site_data.site_members','DELETE'),
 'policy',EXISTS(SELECT FROM pg_policies WHERE schemaname='site_data' AND tablename='site_members' AND policyname='s36_owner_fixture_delete'));
 ROLLBACK;`);
 assert.deepEqual(observe('initial'),baseline);
 assert.deepEqual(guards('closed-admission'),{gate:false,fixture:false,delete:false,policy:false});
 const pids=[];
 const launch=(name,script,args)=>{
   const fd=openSync(join(dir,name+'.log'),'wx',0o600);
   try {
     const process=spawn(processExec,[here(script),...args],{stdio:['ignore',fd,fd]});
     pids.push({name,process});
     receipt(name+'-launch',{pid:process.pid});
   } finally {closeSync(fd);}
 };
 const processExec=process.execPath;
 async function waitFor(test) {
   const now=performance.now();
   while(performance.now()-now<18000) {
     assert.ok(pids.every(p=>p.process.exitCode===null&&p.process.signalCode===null));
     if(await test()) return;
     await sleep(200);
   }
   throw Error('S36_FINAL_LOCAL_START');
 }
 const credentials=read(material('account-material'));
 const tls=read(material('mtls-client'));
 const socketPath=read(material('postgrest-material')).socketPath;
 const {Client}=await import('pg');
 const registrar=createRegistrar(fixture.project,read(material('registrar-database')),Client);
 const actors={};
 for(const [index,name] of actorNames.entries()) {
   const scope=connectionScope(read(material(name+'-connection')));
   assert.equal(scope.project,fixture.project);
   assert.equal(scope.publicationSite,fixture[name+'Site']);
   const {binding,identity}=await hostedScope(scope,socketPath);
   const login=await identity.passwordLogin(credentials[name]);
   const who=accountContext(login.handle);
   assert.equal(who.uid,fixture[name]);
   const repository=createRpcRepository({binding,enabled:true,project:scope.project,endpoint:scope.privateOrigin,
     identity,mtls:privateTransport(scope.privateOrigin,tls)});
   actors[name]={name,site:scope.publicationSite,uid:who.uid,sid:who.session_id,epoch:index,binding,identity,login,
     repository,service:createSiteService({repository,publicationSite:scope.publicationSite})};
   receipt(name+'-identity',{uid:who.uid,sid:who.session_id,epoch:index});
 }
 const {alice,bob}=actors;
 assert.notEqual(alice.sid,bob.sid);
 const fixtureSql=ownerFixtureSql({target:alice.site,uid:alice.uid,sid:alice.sid,requestKey:plan.requests.ownerProbe});
 const stamp=Math.floor(Date.now()/1000);
 const keyCandidate={project:fixture.project,id:'s36-final-'+randomBytes(6).toString('hex'),keyHex:randomBytes(32).toString('hex'),
   notBefore:stamp-5,signUntil:stamp+480,verifyUntil:stamp+540};
 const signing=await generation(fixture.project,keyCandidate);
 const snapshot=baseline.snapshots.find(x=>x.site_id===alice.site&&x.source_draft_revision===4);
 assert.ok(uuid(snapshot?.id));
 const versions={alice:{draft:5,before:5},bob:{draft:0,before:0}};
 const inputs={};
 for(const [name,actor] of Object.entries(actors)) {
   const v=versions[name];
   assert.deepEqual([baseline.sites.find(s=>s.id===actor.site).draft_revision,
     baseline.sites.find(s=>s.id===actor.site).publication.publication_revision],[v.draft,v.before]);
   inputs[name+'Publish']=textCommand('publish_site',{schema_version:1,request_id:plan.requests[name+'Publish'],
     expected_draft_revision:v.draft,expected_publication_revision:v.before,snapshot_id:name==='alice'?snapshot.id:null});
   inputs[name+'Withdraw']=textCommand('unpublish_site',{schema_version:1,request_id:plan.requests[name+'Withdraw'],
     expected_publication_revision:v.before+1});
 }
 const [d1,d2]=actorNames.map(name=>baseline.domains.find(d=>d.site_id===actors[name].site&&d.is_primary));
 for(const domain of [d1,d2]) assert.ok(uuid(domain?.id)&&domain.kind==='test'&&domain.state==='reserved'&&domain.verified_at===null);
 const sqlPair=`('${d1.id}'::uuid,'${d2.id}'::uuid)`;
 const endpoints=`site_api.publish_site(uuid,jsonb,text),site_api.unpublish_site(uuid,jsonb,text)`;
 const openPublic=`
 ${grants}
 DO $rows$ DECLARE affected integer; BEGIN
   UPDATE site_data.site_domains SET state='active',verified_at=clock_timestamp()
    WHERE id IN ${sqlPair} AND kind='test' AND state='reserved' AND verified_at IS NULL;
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected<>2 THEN RAISE EXCEPTION 'FINAL_DOMAIN_DRIFT'; END IF;
   UPDATE site_private.text_publication_runtime SET public_read_enabled=true WHERE singleton AND NOT public_read_enabled;
   IF NOT FOUND THEN RAISE EXCEPTION 'FINAL_PUBLIC_GATE_DRIFT'; END IF;
 END;$rows$;
 SET LOCAL ROLE ecv_s3_command_writer;
 GRANT EXECUTE ON FUNCTION ${endpoints} TO authenticated;
 RESET ROLE;
 ${release}`;
 const closePublic=`
 ${grants}
 SET LOCAL ROLE ecv_s3_command_writer;
 REVOKE EXECUTE ON FUNCTION ${endpoints} FROM authenticated;
 RESET ROLE;
 UPDATE site_private.text_publication_runtime SET public_read_enabled=false WHERE singleton AND public_read_enabled;
 UPDATE site_data.site_domains SET state='reserved',verified_at=NULL WHERE id IN ${sqlPair} AND kind='test' AND state='active';
 ${release}`;
 const sent=new Set();
 const published=new Set();
 let previous=baseline, ownerAttempted=false, generationAttempted=false, publicAttempted=false;
 async function publication(label) {
   assert.ok(!sent.has(label));
   const actor=label.startsWith('alice')?alice:bob;
   const publish=label.endsWith('Publish');
   const input=inputs[label];
   const operation=publish?'publish_site':'unpublish_site';
   receipt(label+'-dispatch',{site:actor.site,uid:actor.uid,sid:actor.sid,operation,input});
   sent.add(label);
   let result;
   try {
     result=await actor.service[publish?'publish':'unpublish'](actor.login.handle,actor.site,input);
   } catch(error) {
     receipt(label+'-transport',{code:error?.code??null});
     const match=await actor.service.readPublicationOperation(operation,actor.login.handle,actor.site,input);
     receipt(label+'-same-key',match);
     if(match.status!=='succeeded') throw error;
     result=match.result;
   }
   const after=observe(label+'-independent');
   const matched=after.operations.find(row=>row.site_id===actor.site&&row.request_id===input.request_id&&
      row.operation===operation&&row.actor_auth_user_id===actor.uid&&row.actor_session_id===actor.sid);
   assert.deepEqual(matched?.result,result);
   assert.deepEqual(after.sites.find(row=>row.id===actor.site)?.publication,result.publication);
   const before=previous;
   previous=after;
   if(publish) published.add(actor.name);
   else published.delete(actor.name);
   verifyPublicationDelta(before,after,actor,operation,input,result);
   receipt(label+'-response',result);
 }
 try {
   generationAttempted=true;
   change('generation-create',`SELECT pg_advisory_xact_lock(3303,5);
   DO $admit$ BEGIN
    IF (SELECT count(*) FROM site_private.user_security_state
     WHERE business_enabled AND NOT security_hold AND hold_reason='none'
     AND ((auth_user_id='${alice.uid}' AND security_epoch=0) OR (auth_user_id='${bob.uid}' AND security_epoch=1)))<>2
    THEN RAISE EXCEPTION 'S36_FINAL_EPOCH_DRIFT'; END IF;
   END;$admit$;
   ${generationAcl}
   INSERT INTO site_private.proof_generations(key_id,not_before,sign_until,verify_until)
     VALUES('${signing.id}',to_timestamp(${signing.notBefore}),to_timestamp(${signing.signUntil}),to_timestamp(${signing.verifyUntil}));
   ${generationRelease}`);
   ownerAttempted=true;
   receipt('owner-fixture-bind',{site:alice.site,uid:alice.uid,sid:alice.sid,requestKey:plan.requests.ownerProbe,bodySha256:fixtureSql.bodySha256});
   change('owner-fixture-install',fixtureSql.install);
   launch('postgrest','./postgrest.mjs',[material('alice-connection'),material('postgrest-material'),native,'--owner-fixture-rollback']);
   await waitFor(()=>existsSync(socketPath));
   await assertPrivateSocket(alice.binding,{uid:process.getuid(),gid:process.getgid()});
   for(const name of actorNames) {
     launch(name+'-ingress','./ingress.mjs',[material(name+'-connection'),material('ingress')]);
     await waitFor(()=>existsSync(join(dir,name+'-ingress.log'))&&readFileSync(join(dir,name+'-ingress.log'),'utf8').includes('HOSTED_TEST_INGRESS_LISTENING'));
     const actor=actors[name];
     const granted=await issueGrant({...actor,approval:{uid:actor.uid,proofId:plan.requests[name+'Proof'],epoch:actor.epoch,
       validFrom:signing.notBefore,expiresAt:signing.verifyUntil},expectedEpoch:actor.epoch,key:signing,registrar,journalDir:journal});
     receipt(name+'-grant',granted);
     assert.equal((await actor.service.introduction(actor.login.handle,actor.site)).draft_revision,versions[name].draft);
   }
   try {
     const token=withCredential(alice.login.handle,x=>x);
     const wire=await apiBySocket(socketPath,token,{target:alice.site,request_key:plan.requests.ownerProbe});
     receipt('owner-fixture-http',wire);
     assert.deepEqual(wire,{status:200,preference:'tx=rollback',body:{request_key:plan.requests.ownerProbe,same_transaction:true,missing_row_count:1,
       rpc_sqlstate:'42501',rpc_denial:'BUSINESS_DENIED',restored:true,draft_revision:5}});
   } catch(error) {
     receipt('owner-fixture-stop',{code:error?.code??null});
   } finally {
     change('owner-fixture-remove',fixtureSql.remove);
     ownerAttempted=false;
     assert.deepEqual(guards('owner-close'),{gate:false,fixture:false,delete:false,policy:false});
     assert.deepEqual(observe('after-owner'),baseline);
     assert.equal((await alice.service.introduction(alice.login.handle,alice.site)).draft_revision,5);
   }
   publicAttempted=true;
   change('publication-open',openPublic);
   previous=observe('publication-open-readback');
   assert.deepEqual(previous.acl,[true,true]);
   await publication('alicePublish');
   await publication('bobPublish');
   await runPublicProbe(dir,join(dir,'public-source.json'),plan.sourceManifestSha256,previous,'http-both-published');
   await publication('aliceWithdraw');
   await publication('bobWithdraw');
   await runPublicProbe(dir,join(dir,'public-source.json'),plan.sourceManifestSha256,previous,'http-both-withdrawn');
   receipt('public-run-complete',{requests:sent.size,published:published.size});
 } catch(error) {
   receipt('publication-phase-stop',{code:error?.code??null,requests:sent.size});
   throw error;
 } finally {
   try {
     try {
       if(ownerAttempted&&guards('owner-uncertain-state').fixture) change('owner-fallback-remove',fixtureSql.remove);
       if(publicAttempted) {
         // Only known committed publish results authorize a still-unsent withdrawal.
         for(const name of published) if(!sent.has(name+'Withdraw')) await publication(name+'Withdraw');
       }
     } finally {
       if(publicAttempted) change('publication-close',closePublic);
       if(generationAttempted) change('generation-revoke',`${generationAcl}
         UPDATE site_private.proof_generations SET revoked_at=clock_timestamp() WHERE key_id='${signing.id}' AND revoked_at IS NULL;
         ${generationRelease}`);
       assert.deepEqual(guards('final-guards'),{gate:false,fixture:false,delete:false,policy:false});
       const final=observe('publication-final');
       assert.deepEqual(final.acl,[false,false]);
       verifyDomainRestoration(baseline.domains,final.domains);
     }
   } finally {
     for(const {process:local} of pids) if(local.exitCode===null&&local.signalCode===null) local.kill('SIGTERM');
     for(const local of pids)
       await Promise.race([new Promise(yes=>{if(local.process.exitCode!==null||local.process.signalCode!==null) yes();else local.process.once('exit',yes);}),sleep(7000)]);
     receipt('local-stop',pids.map(x=>({name:x.name,pid:x.process.pid,exit:x.process.exitCode,signal:x.process.signalCode})));
     assert.ok(pids.every(x=>x.process.exitCode!==null||x.process.signalCode!==null));
   }
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [mode,dir,psql,hash,native]=process.argv.slice(2);
 assert.equal(mode,'--execute-approved');
 runBatch(dir,psql,hash,native).catch(error=>{
   console.error(JSON.stringify({status:'S36_FINAL_PUBLICATION_STOP',code:error?.code??null,
     phase:error?.message?.match(/^[a-zA-Z0-9_-]{2,60}$/)?.[0]??null,
     line:String(error?.stack).match(/hosted-final-publication\.mjs:(\d+):/)?.[1]??null}));
   process.exitCode=1;
 });
}
