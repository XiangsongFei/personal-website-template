// One-shot reproduction of a real M3 revision zero over a disposable internal Docker network.
import assert from 'node:assert/strict';
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createIdentityAdapter,accountContext,withCredential} from '../../lib/business/identity.mjs';
import {createBusinessBinding} from '../../lib/business/binding.mjs';
import {hex,grantBytes,proofBytes,sha256,uuid} from '../../lib/business/protocol.mjs';
import {verifySecurityEnvelope} from '../../lib/business/r3-verifier.mjs';
import {generation,writeOnce} from './r3.mjs';
import {privateFile} from './target.mjs';

const project='ecv-s33a-20261109-7dd22a81', issuer='http://127.0.0.1:56321/auth/v1';
const [run]=process.argv.slice(2);
assert.equal(process.argv.length,3);
const group=privateFile(join(run,'local-id')).trim();
assert.match(group,/^s36last[a-z0-9]{8}$/);
const db=group+'-db',authHost=group+'-auth',rest=group+'-rest',net=group+'-net';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:12000,stdio:['pipe','pipe','pipe']});
for(const name of [db,authHost,rest]) {
 const value=JSON.parse(docker(['inspect',name]))[0];
 assert.equal(value.Config.Labels['s36.run'],group+'-pg');
 assert.equal(value.State.Running,true);
 assert.deepEqual(Object.keys(value.NetworkSettings.Networks),[net]);
 assert.ok(Object.values(value.NetworkSettings.Ports??{}).every(published=>published===null||published.length===0));
}
const network=JSON.parse(docker(['network','inspect',net]))[0];
assert.ok(network.Internal&&network.Labels['s36.run']===group+'-pg');
const key=privateFile(join(run,'private/local-jwt')).trim();
const regPass=privateFile(join(run,'private/registration-password')).trim();
assert.match(key,/^[a-f0-9]{64}$/);
assert.match(regPass,/^[a-f0-9]{48}$/);

function wire(host,path,{body,token}={}) {
 assert.ok([authHost,rest].includes(host));
 const endpoint='http://'+host+(host===authHost?':9999':':3000')+path;
 const header=['Content-Type: application/json',...(token?['Authorization: Bearer '+token]:[]),
   ...(host===rest?['Content-Profile: site_api','Accept-Profile: site_api']:[])];
 const option=values=>values.map(value=>'header = '+JSON.stringify(value)).join('\n');
 // Token and password JSON pass through curl's stdin, never through argv.
 const config=option(header)+(body?'\ndata-binary = '+JSON.stringify(JSON.stringify(body)):'')+'\n';
 return JSON.parse(docker(['exec','-i',db,'curl','--silent','--show-error','--fail-with-body','--max-time','8','--config','-',endpoint],config));
}
function verifiedClaims(token) {
 const [rawHeader,rawClaims,signature]=token.split('.');
 const header=JSON.parse(Buffer.from(rawHeader,'base64url'));
 const claims=JSON.parse(Buffer.from(rawClaims,'base64url'));
 assert.equal(header.alg,'HS256');
 const expected=createHmac('sha256',key).update(rawHeader+'.'+rawClaims).digest();
 const received=Buffer.from(signature,'base64url');
 assert.equal(received.length,expected.length);
 assert.ok(timingSafeEqual(received,expected));
 assert.equal(claims.iss,issuer);
 return claims;
}
const binding=createBusinessBinding({project,authIssuer:issuer,privateOrigin:'https://api.'+project+'.internal.test',
 registrarHost:'pg.'+project+'.internal.test',socketPath:'/run/ecv-s33a-internal/postgrest.sock',testOnly:true});
const identity=createIdentityAdapter({issuer,auth:{
 signInWithPassword:async body=>{const response=wire(authHost,'/token?grant_type=password',{body});
   return {data:{session:{access_token:response.access_token,user:response.user},user:response.user}};},
 getClaims:async token=>({data:{claims:verifiedClaims(token)}}),
 getUser:async token=>{
  const user=wire(authHost,'/user',{token}), claims=verifiedClaims(token);
  writeOnce(join(run,'local-auth-claims-'+credentials.email.split('@')[0]+'.json'),{
    issuer:claims.iss,role:claims.role,audience:claims.aud,exp:claims.exp,now:Math.floor(Date.now()/1000),
    anonymousClaim:claims.is_anonymous??null,anonymousUser:user.is_anonymous??null,confirmed:!!user.email_confirmed_at,
    matches:claims.sub===user.id,hasSession:uuid(claims.session_id)});
  return {data:{user}};
 },
}});
const credentials={email:group+'-'+randomBytes(3).toString('hex')+'@example.test',password:randomBytes(24).toString('hex')};
const signedUp=wire(authHost,'/signup',{body:credentials});
assert.ok(uuid(signedUp.user.id));
const login=await identity.passwordLogin(credentials);
const {uid,session_id:sid}=accountContext(login.handle);
assert.equal(uid,signedUp.user.id);
assert.ok(uuid(uid)&&uuid(sid));
docker(['exec','-i',db,'psql','-X','-w','-qAt','-h','/run/postgresql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],`
BEGIN;
GRANT ecv_s3_owner TO postgres WITH ADMIN FALSE,INHERIT TRUE,SET TRUE GRANTED BY postgres;
INSERT INTO site_private.user_security_state(auth_user_id,business_enabled,security_hold,hold_reason)
 SELECT '${uid}'::uuid,true,false,'none' WHERE EXISTS (
 SELECT FROM auth.sessions WHERE id='${sid}'::uuid AND user_id='${uid}'::uuid);
REVOKE ecv_s3_owner FROM postgres GRANTED BY postgres RESTRICT;
COMMIT;`);

const now=Math.floor(Date.now()/1000), id='local-rebuild-1', proofId=randomUUID();
const signing=await generation(project,{project,id,keyHex:randomBytes(32).toString('hex'),
 notBefore:now-5,signUntil:now+80,verifyUntil:now+90});
const proof={version:1,project,action:'issue',purpose:'business',uid,session_id:sid,epoch:0,proof_id:proofId,
 issued_at:now,expires_at:now+55,payload_digest:'',key_id:id,event:'password-login'};
proof.payload_digest=await sha256(grantBytes(proof));
const signature=hex(await crypto.subtle.sign('HMAC',signing.macKey,proofBytes(proof)));
const checked=await verifySecurityEnvelope('issue',login.handle,{proof,signature},
 {binding,identity,enabled:true,lookupKey:async lookup=>lookup===id?signing:null});
const sql=`SELECT session_user||':'||current_user||':'||current_setting('role');
SELECT site_private.register_business_ticket($ticket$${JSON.stringify(checked)}$ticket$::jsonb);\n`;
const registered=docker(['exec','-i',db,'sh','-c',
 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -X -w -qAt -h 127.0.0.1 -U ecv_s3_registration_login -d postgres -v ON_ERROR_STOP=1'],
 regPass+'\n'+sql).trim().split('\n');
assert.deepEqual(registered,['ecv_s3_registration_login:ecv_s3_registration_login:none','t']);
const token=withCredential(login.handle,value=>value);
const grant=wire(rest,'/rpc/apply_business_grant',{token,body:{envelope:{proof:checked}}});
assert.ok(uuid(grant.grant_id)&&grant.status==='active');
const request_id=randomUUID(), slug='s36rebuild-'+group.slice(-8);
const site=wire(rest,'/rpc/create_site',{token,body:{input:{schema_version:1,request_id,slug,default_locale:'en'}}});
assert.equal(site.request_id,request_id);
assert.ok(uuid(site.site_id)&&site.persisted);
assert.deepEqual(site.publication,{state:'unpublished',snapshot_id:null,publication_revision:0});
writeOnce(join(run,'private/local-m3-token.json'),{token});
writeOnce(join(run,'local-m3-receipt.json'),{site:site.site_id,uid,sid,proof:proofId,grant:grant.grant_id,request:request_id,
 nativeAuth:true,postgresRole:registered[0],publication:site.publication});
