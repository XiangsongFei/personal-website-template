import{utcNanoseconds}from'./time-window.mjs';
import {SqlSession} from './io.mjs';
import {fenceSQL,queueSQL} from './sql.mjs';
import {need,DriverStop,hash} from './state.mjs';
// Actual coordination shared by LiveHost and fake-I/O tests. Queue observations
// are in ONE read-only transaction, and neither issued leg is ever replayed.
export function raceReadReceipt(r){return {...Object.fromEntries(['outerStatus','postgrest','database','transport','requestBinding','udsEvidence'].map(k=>[k,r[k]??null])),resultSummary:{schemaVersion:r.data?.schema_version??null,siteId:r.data?.site?.id??null,canRead:r.data?.capabilities?.read===true}};}
export async function configurationRace({read,revocationSQL,sessionFactory=()=>new SqlSession(),clock=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 let fence,observer,revoker,reading,revoke,readDoneAt,queue,fenceDone=false,observerDone=false,revokerDone=false,fenceReleaseIssued=false,observerReleaseIssued=false,cleanupError;
 const parse=lines=>lines.filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
 const settled=p=>Promise.resolve(p).then(value=>({ok:true,value}),error=>({ok:false,error}));
 const unwrap=r=>{if(!r.ok)throw r.error;return r.value;};
 const start=clock();
 try{
  fence=sessionFactory();observer=sessionFactory();revoker=sessionFactory();
  const f=parse(await fence.query(fenceSQL))[0];need(f?.fence,'FENCE_RECEIPT');await observer.query('BEGIN READ ONLY;');
  reading=settled(read().then(r=>{readDoneAt=clock();return r;}));
  const inspect=async()=>{await observer.query('SELECT pg_stat_clear_snapshot();');return parse(await observer.query(queueSQL))[0];};
  let readSeen;
  while(clock()-start<3000){const v=await inspect();readSeen=v.rows.find(x=>!x.granted&&x.mode==='ShareLock'&&x.role==='ecv_s3_internal_api_login'&&x.blockers.includes(f.pid));if(readSeen)break;await sleep(25);}
  need(readSeen,'READ_NOT_QUEUED');
  revoke=settled(revoker.query(revocationSQL,8000).then(lines=>{const prepared=parse(lines).find(x=>x.prepared===true);need(lines.at(-1)==='COMMIT'&&prepared?.roleDelta===0,'REVOKE_COMMIT_UNKNOWN',true);return {committed:true,prepared:true,nativePrepared:{prepared:prepared.prepared,roleDelta:prepared.roleDelta,pid:prepared.pid},pid:prepared.pid,roleDelta:prepared.roleDelta,sqlText:revocationSQL,completedAt:clock(),sqlSha256:hash(revocationSQL),commandTags:lines.filter(x=>/^(BEGIN|SET|DO|GRANT ROLE|REVOKE ROLE|UPDATE \d+|COMMIT)$/.test(x)),responseSha256:hash(JSON.stringify(lines))};}));
  while(clock()-start<3000){const v=await inspect();const waiting=v.rows.find(x=>!x.granted&&x.mode==='ExclusiveLock'&&x.role==='postgres');if(waiting){queue={readOnly:v.readOnly,observerPid:v.observerPid,fencePid:f.pid,observedLocks:v.rows.map(x=>({pid:x.pid,role:x.role,mode:x.mode,granted:x.granted,waitstart:x.waitstart,blockers:x.blockers})),classid:3303,objid:5,objsubid:2,readMode:'ShareLock',revokeMode:'ExclusiveLock',readPid:readSeen.pid,revokePid:waiting.pid,readWaitStart:readSeen.waitstart,revokeWaitStart:waiting.waitstart,readQueuedFirst:utcNanoseconds(readSeen.waitstart)<utcNanoseconds(waiting.waitstart),bothBlocked:v.rows.some(x=>x.pid===readSeen.pid&&!x.granted),waitBoundMs:clock()-start};break;}await sleep(25);}
  need(queue?.bothBlocked,'REVOKE_NOT_QUEUED');
  observerReleaseIssued=true;let o;try{o=await observer.end();observerDone=true;queue.rollback=o.rollback;}catch{throw new DriverStop('QUEUE_OBSERVER_CLOSE_UNKNOWN',true);}
  fenceReleaseIssued=true;let fEnd;try{fEnd=await fence.end();fenceDone=true;}catch{throw new DriverStop('FENCE_RELEASE_UNKNOWN',true);}
  const [rr,rv]=await Promise.all([reading,revoke]);const readResult=unwrap(rr),rev=unwrap(rv);rev.carrier=await revoker.finish();revokerDone=true;need(rev.pid===queue.revokePid,'REVOKE_BACKEND_UNKNOWN',true);
  const readReceipt=raceReadReceipt(readResult);
  return {read:readResult,revoke:rev,queue,fence:{rollback:fEnd.rollback},databaseReadBeforeRevoke:true,orderingSource:'shared-before-exclusive-queue-and-verified-results',safeReceipt:{read:readReceipt,revoke:rev,fence:{...fEnd,pid:f.pid,sqlText:fenceSQL,sqlSha256:hash(fenceSQL)},observer:{...o,pid:queue.observerPid,snapshotSql:queueSQL,snapshotSqlSha256:hash(queueSQL)},queue,httpReadCompletedAt:readDoneAt,revokeCompletedAt:rev.completedAt,databaseOrdering:'shared-before-exclusive-queue-and-verified-results'}};
 }finally{
  if(fence&&!fenceDone){if(fenceReleaseIssued){fence.abort();cleanupError=new DriverStop('FENCE_RELEASE_UNKNOWN',true);}else try{fenceReleaseIssued=true;await fence.end();}catch{fence.abort();cleanupError=new DriverStop('FENCE_RELEASE_UNKNOWN',true);}}
  if(observer&&!observerDone){if(observerReleaseIssued){observer.abort();cleanupError??=new DriverStop('QUEUE_OBSERVER_CLOSE_UNKNOWN',true);}else try{observerReleaseIssued=true;await observer.end();}catch{observer.abort();cleanupError??=new DriverStop('QUEUE_OBSERVER_CLOSE_UNKNOWN',true);}}
  await Promise.allSettled([reading,revoke].filter(Boolean));
  if(revoker&&!revokerDone)revoker.abort();
  if(cleanupError)throw cleanupError;
 }
}
