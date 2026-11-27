// Local acceptance entry for the reviewed libpq path. No hosted dispatcher.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {trackedTunnel} from './tracked-tunnel.mjs';

const client='/opt/homebrew/opt/libpq/bin/psql';
const libpq='/opt/homebrew/opt/libpq/lib/libpq.5.dylib';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sqlHash='8544f72277a8ec5d1917157dfa5e464df4c4611d7db6da3b6e39fec25ac3bed5';
const fixtureHost='db.png-gate0.fixture.invalid';
const psqlHash='e6d0132f8bdcc85bf0a976ccb4781a66eab1c7ae3ec0044980041d6e2829d5b5';
const pqHash='4fdd8198a46036a7633199e550cfea578ebe337b9878a8bbe06cffe19492259a';
const record=(file,value)=>fs.writeFileSync(file,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx',flush:true});

export async function runLocalDirect(proposed,inputs) {
  // Pin caller-owned bytes and primitive values before any asynchronous transport activity.
  const plan=Object.freeze({...proposed});
  const statement=Buffer.from(inputs.statement).toString('utf8');
  const ca=Buffer.from(inputs.ca);
  const password=inputs.password;
  assert.equal(typeof password,'string');
  assert.equal(plan.host,fixtureHost);
  assert.match(plan.request,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for(const key of ['proxyPort','dbPort']) assert(Number.isInteger(plan[key])&&plan[key]>=1024&&plan[key]<=65535);
  assert.match(plan.system,/^[1-9][0-9]+$/);
  assert.match(plan.oid,/^[1-9][0-9]*$/);
  assert.equal(hash(fs.readFileSync(client)),psqlHash);
  assert.equal(hash(fs.readFileSync(libpq)),pqHash);
  assert.equal(hash(statement),sqlHash);
  assert.equal(hash(ca),plan.caSha256);
  const pem=ca.toString('ascii');
  assert.match(pem,/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/);
  assert.equal(new X509Certificate(pem).ca,true);
  const parent=fs.lstatSync(inputs.ledgerDir);
  assert(parent.isDirectory()&&parent.uid===process.getuid()&&(parent.mode&0o077)===0);
  const dir=path.join(fs.realpathSync(inputs.ledgerDir),plan.request);
  fs.mkdirSync(dir,{mode:0o700}); // exclusive request reservation in the same persistent ledger
  const put=(n,v)=>record(path.join(dir,n+'.json'),v);
  let seq=0,primary,secondary,result;
  const stages=[];
  const log=(stage,value)=>{
    try{
      put('transport-'+(++seq),{at:new Date().toISOString(),stage,value});
      stages.push([stage,value]);
    }catch(e){primary??=new Error('TRANSPORT_EVIDENCE_WRITE_FAILED');}
  };
  const tunnel=trackedTunnel(plan.host,plan.dbPort,plan.proxyPort,log);
  try{
    put('intent',{request:plan.request,host:plan.host,upstreamPort:plan.dbPort,proxyPort:plan.proxyPort,
      at:new Date().toISOString(),psqlHash,pqHash,sqlHash,caSha256:plan.caSha256,expectedSystem:plan.system,expectedOid:plan.oid,
      role:'postgres',sslmode:'verify-full',sni:true,hostaddr:'127.0.0.1'});
    const caPath=path.join(dir,'trusted-root.pem');
    fs.writeFileSync(caPath,ca,{mode:0o600,flag:'wx'});
    const port=await tunnel.start();
    const env={PATH:'/usr/bin:/bin',HOME:dir,LC_ALL:'C',PGDATABASE:'postgres',PGUSER:'postgres',PGHOST:plan.host,
      PGHOSTADDR:'127.0.0.1',PGPORT:String(port),PGSSLMODE:'verify-full',PGSSLSNI:'1',PGSSLROOTCERT:caPath,
      PGGSSENCMODE:'disable',PGCONNECT_TIMEOUT:'10',PGAPPNAME:'ecv-s35-png-gate0-readonly',PGPASSWORD:password};
    const receipt=await new Promise((resolve,reject)=>{
      const proc=spawn(client,['-X','-qAt','-w','-v','ON_ERROR_STOP=1'],{env,stdio:['pipe','pipe','pipe']});
      let stdout='',stderr='',deadline=false,kill;
      const timer=setTimeout(()=>{deadline=true;proc.kill('SIGTERM');kill=setTimeout(()=>proc.kill('SIGKILL'),1200);},26000);
      proc.stdout.setEncoding('utf8').on('data',s=>{stdout+=s;});
      proc.stderr.setEncoding('utf8').on('data',s=>{stderr+=s;});
      proc.stdin.on('error',()=>{});
      proc.once('error',reject);
      proc.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(kill);resolve({pid:proc.pid,code,signal,deadline,stdout,stderr});});
      proc.stdin.end('\\echo G0_AUTHENTICATED\n'+statement+'\\echo G0_FINISHED\n');
    });
    put('client',receipt);
    const lines=receipt.stdout.trimEnd().split('\n');
    if(receipt.deadline||receipt.code!==0||lines.length!==3||lines[0]!=='G0_AUTHENTICATED'||lines[2]!=='G0_FINISHED'){
      throw Error(lines[0]==='G0_AUTHENTICATED'?'UNKNOWN_READ':'NO_VERIFIED_LOGIN');
    }
    const row=JSON.parse(lines[1]);
    assert.deepEqual(stages.filter(([s])=>['accepted','proxy-tcp','CONNECT','SSLRequest','SSLRequest-answer'].includes(s)),
      [['accepted',undefined],['proxy-tcp',undefined],['CONNECT','200'],['SSLRequest',undefined],['SSLRequest-answer','S']]);
    if(row.database_system_id!==plan.system||String(row.database_oid)!==plan.oid||row.database!=='postgres'||
      row.session_role!=='postgres'||row.effective_role!=='postgres'||row.transaction_read_only!=='on'||
      row.tls_observed_on_database_hop!==true||row.initial?.session_replication_role!=='origin') throw Error('WRONG_DATABASE_WITNESS');
    result={catalogSha256:hash(lines[1]),clientPid:receipt.pid};
  }catch(e){primary??=e;}
  try{put('primary',{outcome:primary?.message??'DIRECT_WITNESS',at:new Date().toISOString()});}catch(e){primary??=e;}
  try{await tunnel.close();}catch(e){secondary=e;}
  try{put('cleanup',{tunnelClosed:!secondary,error:secondary?.name??null,at:new Date().toISOString()});}catch(e){secondary??=e;}
  if(primary||secondary)throw primary??secondary;
  return result;
}
