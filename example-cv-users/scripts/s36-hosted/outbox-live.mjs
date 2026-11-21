import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,createHmac,pbkdf2Sync,randomBytes,X509Certificate} from 'node:crypto';
import {checkServerIdentity} from 'node:tls';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {privateFile,publicationProject} from './target.mjs';
import {writeOnce} from './r3.mjs';
import {admitOutboxPlan,outboxCall,verifyOutboxCurrent} from './outbox-batch-plan.mjs';
import {isolatedOutboxReceiver} from './outbox-loopback-receiver.mjs';
import {privateTransport} from './transport.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const worker='ecv_s36_outbox_worker';
const host='aws-1-ap-southeast-1.pooler.supabase.com';
const rootHash='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
const file=name=>fileURLToPath(new URL('../../supabase/candidates/s36-hosted/'+name,import.meta.url));
const read=path=>JSON.parse(privateFile(path));

function verifier(password) {
  const salt=randomBytes(16);
  const salted=pbkdf2Sync(password,salt,4096,32,'sha256');
  const key=type=>createHmac('sha256',salted).update(type).digest();
  return 'SCRAM-SHA-256$4096:'+salt.toString('base64')+'$'+
    createHash('sha256').update(key('Client Key')).digest('base64')+':'+key('Server Key').toString('base64');
}

export function expectedWorkerReply(value,expected,event) {
  if (Object.hasOwn(expected,'publication_revision')) return assert.deepEqual(value,expected);
  const row=Object.hasOwn(expected,'claimed')?value.record:value;
  if(Object.hasOwn(expected,'claimed')) assert.equal(value.claimed,expected.claimed);
  assert.equal(row.id,event.event_id);
  assert.equal(row.site_id,event.site_id);
  assert.equal(row.event_type,event.event_type);
  assert.equal(row.publication_revision,event.publication_revision);
  assert.equal(row.max_attempts,3);
  assert.equal(row.lease_generation,row.attempt_count);
  for(const [field,key] of [['state','state'],['attempt','attempt_count'],['code','last_code']])
    if(Object.hasOwn(expected,field)) assert.equal(row[key],expected[field],key);
  if(expected.dispatch_started) assert.ok(Number.isSafeInteger(row.dispatch_started_at));
  return row;
}

export function checkEventInventory(plan,rows,recorded) {
  assert.equal(rows.length,5);
  for(const event of plan.events) {
    const row=rows.find(r=>r.id===event.event_id);
    assert.equal(row?.site_id,event.site_id);
    assert.equal(row.publication_revision,event.publication_revision);
    assert.equal(row.event_type,event.event_type);
    const done=recorded.get(event.event_id);
    if(done) {
      for(const name of ['state','attempt_count','lease_generation','lease_owner','lease_token','last_code'])
        assert.equal(row[name],done[name],name);
      for(const name of ['dispatch_started_at','completed_at'])
        assert.equal(row[name]===null?null:Math.floor(Date.parse(row[name])),done[name],name);
    } else {
      assert.deepEqual([row.state,row.attempt_count,row.lease_generation,row.dispatch_started_at],['pending',0,0,null]);
    }
  }
}

async function main(run,psql,hash) {
  assert.ok(isAbsolute(run)&&isAbsolute(psql));
  const suffix=run.match(/\/hosted-outbox-live\.([A-Za-z0-9]{8})$/)?.[1].toLowerCase();
  assert.ok(suffix);
  const login='ecv_s36_outbox_'+suffix, mark='S36-OUTBOX:'+hash;
  const journal=join(run,'journal');
  const record=(name,value)=>writeOnce(join(journal,name+'.json'),value);
  const plan=admitOutboxPlan(join(run,'live-plan.json'),hash);
  const expected=read(join(run,'baseline.json'));
  assert.equal(sha(JSON.stringify(expected)),plan.sourceSha256);
  assert.equal(plan.workerCallLimit,30);
  assert.equal(plan.workerConnectionLimit,2);
  assert.equal(plan.egressLimit,1);
  const transport=read(join(run,'private','receiver.json'));
  const ca=privateFile(join(run,'private','db-ca.crt'));
  assert.equal(sha(new X509Certificate(ca).raw),rootHash);
  const clientCertificate=new X509Certificate(transport.client.cert);
  assert.equal(clientCertificate.fingerprint256,transport.fingerprint);
  const password=randomBytes(36).toString('base64url');
  const roleGuard=`DO $guard$ BEGIN
    IF (SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname='${login}')
       IS DISTINCT FROM '${mark}' THEN RAISE EXCEPTION 'OUTBOX_ROLE_IDENTITY'; END IF;
  END; $guard$;`;
  const putGate=value=>`GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET FALSE GRANTED BY postgres;
    UPDATE site_private.text_publication_runtime SET outbox_enabled=${value} WHERE singleton;
    REVOKE ecv_s3_owner FROM postgres GRANTED BY postgres RESTRICT;`;
  function admin(label,{sql,path,params={}}) {
    const args=['-X','-w','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',sql?'-At':'-qAt',
      ...Object.entries(params).flatMap(([k,v])=>['-v',k+'='+v]),'-f',path??'-'];
    const result=spawnSync(psql,args,{input:sql,encoding:'utf8',timeout:19000,maxBuffer:1024*1024});
    const acknowledged=(result.stdout??'').trimEnd().endsWith('\nCOMMIT');
    record(label+'-sql',{exitCode:result.status,commit:sql?acknowledged:null,
      codes:[...(result.stderr??'').matchAll(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/g)].map(match=>match[1])});
    if(result.status!==0||sql&&!acknowledged) throw new Error(label+'-SQL');
    if(!sql) return JSON.parse(result.stdout);
  }
  const observe=label=>{
    const row=admin(label,{path:file('outbox-live-observe.sql'),params:{alice_site:plan.aliceSite,login}});
    record(label,row);
    verifyOutboxCurrent(plan,row.pointer);
    return row;
  };
  const change=(label,body)=>admin(label,{sql:`BEGIN;\n\\i '${file('outbox-live-scope.sql')}'\n${body}\nCOMMIT;\n`});
  const initial=observe('admission');
  assert.equal(initial.worker_login,null);
  assert.equal(initial.outbox_enabled,false);
  assert.equal(initial.worker_edges,1);
  assert.deepEqual(initial.sessions,[]);
  assert.deepEqual(initial.events,[...expected.outbox].sort((a,b)=>a.publication_revision-b.publication_revision));

  const {Client}=await import('pg');
  const clients=[];
  const pids=[];
  const config={host,port:5432,database:'postgres',user:login+'.'+publicationProject,password,
    ssl:{ca,servername:host,rejectUnauthorized:true,minVersion:'TLSv1.3',
      checkServerIdentity:(_,certificate)=>checkServerIdentity(host,certificate)},
    connectionTimeoutMillis:8000,query_timeout:8000,application_name:'s36-outbox-'+suffix};
  const receiver=isolatedOutboxReceiver({plan,journal,origin:transport.origin,tls:transport.server,fingerprint:transport.fingerprint});
  let created=false,listening=false,calls=0,egress=0;
  const last=new Map(),terminal=new Map();
  const deadline=performance.now()+180000;
  const sendOnce=async (event,attempt)=>{
    assert.ok(performance.now()<deadline);
    assert.equal(egress,0);
    assert.equal(attempt.state,'leased');
    assert.ok(Number.isSafeInteger(attempt.dispatch_started_at)&&attempt.lease_until>Date.now()+2500);
    const input={event_id:event.event_id,site_id:event.site_id,publication_revision:event.publication_revision,event_type:event.event_type};
    const body=JSON.stringify(input);
    const binding={...input,bodySha256:sha(body),owner:attempt.lease_owner,token:attempt.lease_token,generation:attempt.lease_generation};
    record('egress-dispatch',binding);
    egress++;
    const response=await privateTransport(transport.origin,transport.client).fetch(transport.origin+'/invalidate',{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(2000),
      headers:{'Content-Type':'application/json','Idempotency-Key':event.event_id},body});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{accepted:true,duplicate:false});
    const received=read(join(journal,'invalidate-'+event.event_id+'.json'));
    assert.deepEqual(received,input);
    assert.equal(sha(JSON.stringify(received)),binding.bodySha256);
    record('egress-verified',{...binding,httpStatus:response.status,receiverAck:true});
  };
  async function dispatch(event,index,clientIndex=0,raceWinner) {
    const action=outboxCall(plan,event.event_id,index,raceWinner);
    if(action.conditions.waitForLeaseExpiry) {
      // Anchor to the database clock captured immediately after the prior result.
      const row=last.get(event.event_id);
      assert.ok(Number.isSafeInteger(row?.lease_until)&&Number.isSafeInteger(row?.observedClock));
      const delay=Math.max(0,row.lease_until-row.observedClock+125);
      assert.ok(delay<=1700);
      await sleep(delay);
    }
    assert.ok(performance.now()<deadline&&calls<30);
    const client=clients[clientIndex];
    const label='rev'+event.publication_revision+'-'+String(index+1).padStart(2,'0');
    const args=action.values;
    await client.query('BEGIN');
    let invoked=false,commitSent=false;
    try {
      await client.query("SET LOCAL statement_timeout='5s'");
      await client.query("SET LOCAL lock_timeout='3s'");
      await client.query('SET LOCAL ROLE ecv_s36_outbox_worker');
      const audit=await client.query('SELECT session_user AS login,current_user AS role,pg_backend_pid() AS pid');
      assert.deepEqual(audit.rows,[{login,role:worker,pid:pids[clientIndex]}]);
      record(label+'-dispatch',{event:event.event_id,index,pid:pids[clientIndex],args,expected:action.expected});
      calls++;
      invoked=true;
      const returned=await client.query({text:action.text,values:args});
      assert.equal(returned.rowCount,1);
      const value=returned.rows[0].result;
      const clock=Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000) AS ms')).rows[0].ms);
      commitSent=true;
      assert.equal((await client.query('COMMIT')).command,'COMMIT');
      if(action.conditions.fault==='discard-finish-reply') {
        // DB ACK was observed. Drop only the result handed to the application.
        record(label+'-lost-app-reply',{simulation:'after-real-commit',event:event.event_id,owner:args[1],token:args[2],generation:args[3]});
        return {discarded:true};
      }
      record(label+'-commit',{pid:pids[clientIndex],value,clock});
      return {value,clock};
    } catch(error) {
      if(!commitSent) {
        const rollback=await client.query('ROLLBACK');
        assert.equal(rollback.command,'ROLLBACK');
      }
      record(label+'-stop',{errorCode:error?.code??null,commitSent});
      if(invoked&&!commitSent&&['PT409','PT503'].includes(error?.code))
        return {rejected:error.code,message:error.message};
      throw error;
    }
  }
  function accept(event,index,reply,raceWinner) {
    const {expected,values}=outboxCall(plan,event.event_id,index,raceWinner);
    if(typeof expected==='string') {
      assert.equal(reply.rejected,expected);
      assert.equal(reply.message,expected==='PT503'?'DELIVERY_UNKNOWN':'OUTBOX_LEASE_LOST');
      return;
    }
    const row=expectedWorkerReply(reply.value,expected,event);
    if(row) {
      const previous=last.get(event.event_id);
      const lease=reply.value?.claimed===true?{lease_owner:values[1],lease_token:values[2],lease_generation:values[3]+1}:previous;
      for(const field of ['lease_owner','lease_token','lease_generation']) assert.equal(row[field],lease?.[field],field);
      last.set(event.event_id,{...row,observedClock:reply.clock});
    }
  }
  try {
    created=true;
    record('role-register-dispatch',{login,mark});
    const validUntil=new Date(Date.now()+540000).toISOString();
    change('register',`SET LOCAL createrole_self_grant='';
      CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        CONNECTION LIMIT 2 PASSWORD '${verifier(password)}' VALID UNTIL '${validUntil}';
      COMMENT ON ROLE ${login} IS '${mark}';
      GRANT ecv_s36_outbox_worker TO ${login} WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;`);
    const admitted=observe('role-registered');
    assert.deepEqual(admitted.worker_login,{attributes:[true,false,false,false,false,false,false],limit:2,valid:true,
      mark,set_only:true,own_memberships:1,edge:[false,false,true]});
    assert.deepEqual(admitted.sessions,[]);
    assert.equal(admitted.worker_edges,2);
    for(let i=0;i<2;i++) {
      const client=new Client(config);
      client.on('error',()=>{});
      clients.push(client);
      await client.connect();
      const {rows:[who]}=await client.query(`SELECT session_user AS login,current_user AS role,pg_backend_pid() AS pid,
        (SELECT version FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls,
        current_database() AS db,current_setting('server_version_num') AS version,
        (SELECT has_function_privilege(session_user,p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n
          ON n.oid=p.pronamespace WHERE n.nspname='site_private' AND p.proname='claim_text_outbox') AS inherited,
        pg_has_role(session_user,'ecv_s36_outbox_worker','SET') AS can_set`);
      assert.deepEqual(who,{login,role:login,pid:who.pid,tls:'TLSv1.3',db:'postgres',version:'170012',inherited:false,can_set:true});
      assert.ok(Number.isInteger(who.pid)&&!pids.includes(who.pid));
      pids.push(who.pid);
      record('worker-'+i,who);
    }
    await receiver.listen();
    listening=true;
    change('gate-open',roleGuard+putGate(true));
    for(const event of plan.events) {
      let index=0,winner;
      if(event.publication_revision===1) {
        const pair=await Promise.allSettled([dispatch(event,0,0),dispatch(event,1,1)]);
        assert.ok(pair.every(x=>x.status==='fulfilled'));
        const replies=pair.map(x=>x.value);
        winner=replies.findIndex(reply=>reply.value?.claimed===true);
        assert.ok(winner===0||winner===1);
        assert.equal(replies[1-winner].rejected,'PT409');
        assert.ok(['REQUEST_CONFLICT','OUTBOX_LEASE_BUSY'].includes(replies[1-winner].message));
        const row=expectedWorkerReply(replies[winner].value,{claimed:true,state:'leased',attempt:1},event);
        const args=event.actions[winner].values;
        assert.deepEqual([row.lease_owner,row.lease_token],[args[1],args[2]]);
        last.set(event.event_id,{...row,observedClock:replies[winner].clock});
        index=2;
      }
      for(;index<event.actions.length;index++) {
        // Readbacks use the other physical connection.
        const action=event.actions[index];
        const reply=await dispatch(event,index,action.method==='read'?1:0,winner);
        if(reply.discarded) continue; // only the exact next read may reconcile this event
        accept(event,index,reply,winner);
        if(action.egressAfterRollback===1) await sendOnce(event,last.get(event.event_id));
      }
      const row=last.get(event.event_id);
      const expectedStates=['superseded','failed','unknown','superseded','delivered'];
      assert.equal(row.state,expectedStates[event.publication_revision-1]);
      assert.equal(row.attempt_count,event.publication_revision===2?3:1);
      terminal.set(event.event_id,row);
      const independent=observe('after-revision-'+event.publication_revision);
      assert.equal(independent.outbox_enabled,true);
      checkEventInventory(plan,independent.events,terminal);
    }
    assert.deepEqual([calls,egress],[30,1]);
    record('run-complete',{calls,egress,terminal:[...terminal.values()].map(x=>({revision:x.publication_revision,state:x.state,attempts:x.attempt_count}))});
  } finally {
    try {await Promise.allSettled(clients.map(client=>client.end()));}
    finally {
      let closeReceiverError;
      if(listening) try { await receiver.close(); } catch(error) { closeReceiverError=error; }
      const current=observe('before-close');
      if(created&&current.worker_login?.mark===mark) {
        change('gate-and-login-close',roleGuard+putGate(false)+`ALTER ROLE ${login} NOLOGIN PASSWORD NULL;
          REVOKE ecv_s36_outbox_worker FROM ${login} GRANTED BY postgres RESTRICT;`);
        const disabled=observe('closed-before-drop');
        assert.equal(disabled.outbox_enabled,false);
        assert.equal(disabled.worker_edges,1);
        assert.equal(disabled.worker_login.attributes[0],false);
        assert.ok(disabled.sessions.every(pid=>pids.includes(pid)));
        change('drop-owned-login',roleGuard+
          `DO $end$ DECLARE backend integer; BEGIN
             FOR backend IN SELECT pid FROM pg_stat_activity WHERE usename='${login}' LOOP
               IF backend<>ALL(ARRAY[${pids.length?pids.join(','):'0'}]) OR NOT pg_terminate_backend(backend,3000)
                 THEN RAISE EXCEPTION 'OUTBOX_BACKEND_CLOSE'; END IF;
             END LOOP;
           END; $end$;
           DROP ROLE ${login};`);
      } else assert.equal(current.outbox_enabled,false);
      const end=observe('independent-close');
      assert.equal(end.outbox_enabled,false);
      assert.equal(end.worker_login,null);
      assert.deepEqual(end.sessions,[]);
      assert.equal(end.worker_edges,1);
      assert.deepEqual(admin('closed-acl',{path:file('publication-catalog.sql'),params:{expected_02:true}}),
        {project:publicationProject,closed_02_check:true});
      record('counters',{calls,egress});
      if(closeReceiverError) throw closeReceiverError;
    }
  }
  console.log(JSON.stringify({status:'HOSTED_OUTBOX_REAL_PASS',calls,egress}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [flag,run,psql,hash]=process.argv.slice(2);
  assert.equal(flag,'--execute-approved');
  main(run,psql,hash).catch(error=>{
    console.error(error?.code??(error?.message?.match(/^[a-z-]+-SQL$/)?.[0])??'HOSTED_OUTBOX_STOP');
    process.exitCode=1;
  });
}
