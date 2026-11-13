// Same configurationRace implementation as REAL, with controlled offline SQL
// sessions. No network/child process/database capability is present here.
import{configurationRace}from'./race.mjs';import{maintenanceSQL}from'./sql.mjs';import{hash,need,DriverStop}from'./state.mjs';import{dispatchId}from'./remaining.mjs';
export async function p14rMockRace(host,a,ctx){
 const id=ctx.step+':race:A1',fault=host.faults[id];host.calls.push(id);if(fault==='unknown')throw new DriverStop('INJECTED_UNKNOWN',true);if(fault==='stop')throw new DriverStop('INJECTED_STOP');
 let index=0,readQueued=false,revokeQueued=false,releaseRead,releaseRevoke,tick=0;const at=host.now,readStart=new Date(at).toISOString(),revokeStart=new Date(at+1).toISOString();
 class Session{
  constructor(){this.kind=index++;}
  async query(sql){
   if(this.kind===0)return[JSON.stringify({fence:true,pid:101})];
   if(this.kind===2){revokeQueued=true;return new Promise(r=>{releaseRevoke=r;});}
   if(sql.includes('jsonb_build_object'))return[JSON.stringify({readOnly:true,observerPid:102,rows:readQueued?[{pid:101,role:'postgres',mode:'ExclusiveLock',granted:true,waitstart:null,blockers:[]},{pid:103,role:'ecv_s3_internal_api_login',mode:'ShareLock',granted:false,waitstart:readStart,blockers:[101]},...(revokeQueued?[{pid:104,role:'postgres',mode:'ExclusiveLock',granted:false,waitstart:revokeStart,blockers:[101,103]}]:[])]:[]})];return[];
  }
  async end(){if(this.kind===0){const r=await host.read({action:'read',slot:'A1',rpc:'get_my_site'},ctx),who=ctx.state.sessions.A1,raw=JSON.stringify(r.data);r.requestBinding={...r.requestBinding,dispatchId:dispatchId(ctx.runId,ctx.operationId),jwtSha256:who.jwtSha256,requestSha256:hash('{}')};r.postgrest.responseSha256=hash(raw);r.udsEvidence={...r.requestBinding,seq:3,startedAt:at,finishedAt:at+20,socketPath:'/run/clean-internal/postgrest.sock',requestBytes:2,status:200,code:null,contentType:'application/json',responseBytes:Buffer.byteLength(raw),responseSha256:hash(raw),complete:true};releaseRead(r);host.maintenance('revoke',ctx);releaseRevoke(['BEGIN','SET','DO','GRANT ROLE','UPDATE 1','{"prepared":true,"roleDelta":0,"pid":104}','REVOKE ROLE','COMMIT']);}return{code:0,stderrSha256:hash(''),commandTags:['ROLLBACK'],rollback:true};}
  async finish(){return{code:0,stderrSha256:hash('')};}abort(){}
 }
 const r=await configurationRace({read:()=>{readQueued=true;return new Promise(resolve=>{releaseRead=resolve;});},revocationSQL:maintenanceSQL('revoke',ctx),sessionFactory:()=>new Session(),clock:()=>at+tick++,sleep:async()=>{tick++;}});
 if(typeof fault==='function')await fault(r,host,ctx,a);return r;
}
