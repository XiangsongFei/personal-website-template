// Local evidence export only. Never imports LiveHost or an execution adapter.
import{readFileSync,writeFileSync,lstatSync,realpathSync}from'node:fs';import{resolve,isAbsolute}from'node:path';import{randomUUID}from'node:crypto';
import{checkpoint,continuationBudget,continuationPlan,OLD_MANIFEST,OLD_RUN}from'../tests/s3/driver/checkpoints.mjs';import{hash,need,same}from'../tests/s3/driver/state.mjs';import{loadContract}from'../tests/s3/driver/contract.mjs';
const args=process.argv.slice(2);need(args.length===6&&args[0]==='--history'&&args[2]==='--observation'&&args[4]==='--output','CHECKPOINT_ARGUMENTS');
const[history,observation,output]=[args[1],args[3],args[5]].map(p=>resolve(p));
function raw(base,name){need(!isAbsolute(name)&&!name.split(/[\\/]/).includes('..'),'EVIDENCE_PATH');const p=resolve(base,name),s=lstatSync(p);need(s.isFile()&&!s.isSymbolicLink()&&s.size<=4*1024*1024&&realpathSync(p)===p,'EVIDENCE_FILE');return readFileSync(p);}
const manifest=raw(history,'RECEIPTS-SHA256.json');need(hash(manifest)===OLD_MANIFEST,'HISTORY_MANIFEST_CHANGED');
for(const f of JSON.parse(manifest).files){const b=raw(history,f.path);need(b.length===f.bytes&&hash(b)===f.sha256,'HISTORY_FILE_CHANGED');}
const intentManifest=JSON.parse(raw(history,'INTENT-SHA256.json'));
for(const f of intentManifest.files){const b=raw(intentManifest.directory,f.path);need(b.length===f.bytes&&hash(b)===f.sha256,'CONSUMED_INTENT_CHANGED');}
const historical=JSON.parse(raw(history,'EVIDENCE-ACCOUNTING.json')),prior=JSON.parse(raw(history,'FINAL-baseline.json'));
const receipt=JSON.parse(raw(observation,'CURRENT-receipt.json')),stdout=raw(observation,'CURRENT-V2.stdout'),sql=raw(observation,'CURRENT-V2.sql');
need(receipt.readOnly&&receipt.rollback&&receipt.exitCode===0&&receipt.tags.at(-1)==='ROLLBACK'&&receipt.stdoutSha256===hash(stdout)&&receipt.sqlSha256===hash(sql),'CURRENT_OBSERVATION_RECEIPT');
const rows=stdout.toString().split('\n').filter(s=>s.startsWith('{')).map(JSON.parse);need(rows.length===5&&rows[3].observer_read_only==='on'&&rows[3].observer_pid===receipt.pid,'OBSERVER_FRAME');
const refs=[{path:resolve(history,'RECEIPTS-SHA256.json'),sha256:hash(manifest)},{path:resolve(observation,'CURRENT-V2.stdout'),sha256:hash(stdout)},{path:resolve(observation,'CURRENT-receipt.json'),sha256:hash(raw(observation,'CURRENT-receipt.json'))}];
const c=checkpoint({historical,prior,current:rows[0],details:rows[4],refs}),b=continuationBudget(loadContract().plan,c.charged),plan=continuationPlan(c,{runId:randomUUID(),fixtureIds:[randomUUID(),randomUUID(),randomUUID()],consumedRunIds:[OLD_RUN]},b);
need(same(c.state.fingerprints,prior.fingerprints),'FINAL_STATE');
writeFileSync(output,JSON.stringify({checkpoint:c,proposal:plan},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:'CHECKPOINT_SAVED_PLAN_ONLY',path:output,sha256:hash(readFileSync(output)),oldUnknown:'PRESERVED',oldBatchBudgetSufficient:b.budgetCanResumeOldBatch,externalIo:0,realExecution:'NOT AUTHORIZED'}));
