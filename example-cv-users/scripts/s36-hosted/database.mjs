import {checkServerIdentity,createSecureContext} from 'node:tls';
import {exact, BusinessError, deny} from '../../lib/business/protocol.mjs';
import {isolatedRef} from './target.mjs';

const registrar = 'ecv_s3_registration_login';
export const apiRole = 'ecv_s3_internal_api_login';
const roles = new Set([registrar,apiRole,'postgres']);
const sql = `SELECT CASE WHEN session_user='ecv_s3_registration_login'
   AND current_user=session_user AND current_setting('role')='none'
   THEN site_private.register_business_ticket($1::jsonb) ELSE false END AS registered`;

export function databaseOptions(project, target, role) {
  const ref=isolatedRef(project);
  exact(target,['project','mode','host','ca','password']);
  if (target.project!==ref || !roles.has(role) || typeof target.host!=='string' ||
      (target.mode==='direct' ? target.host!=='db.'+ref+'.supabase.co' :
        target.mode!=='session' || !/^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/.test(target.host)) ||
      typeof target.ca!=='string' || !target.ca.includes('-----BEGIN CERTIFICATE-----') ||
      typeof target.password!=='string' || target.password.length<20 || target.password.length>512)
    throw new Error('HOSTED_DB_TARGET_DENIED');
  createSecureContext({ca:target.ca});
  return {host:target.host,port:5432,database:'postgres',user:target.mode==='direct'?role:role+'.'+ref,
    password:target.password,ssl:{ca:target.ca,rejectUnauthorized:true,minVersion:'TLSv1.2',servername:target.host,
      checkServerIdentity:(_,cert)=>checkServerIdentity(target.host,cert)},connectionTimeoutMillis:4500,
    statement_timeout:3500,query_timeout:4500,application_name:'s36-hosted-acceptance'};
}

export function createRegistrar(project,target,Client,clock=()=>Math.floor(Date.now()/1000)) {
  const options=databaseOptions(project,target,registrar);
  return async proof => {
    let client, dispatched=false;
    try {
      if (proof.project!==project || clock()>=proof.expires_at) deny('INVALID_PROOF');
      client=new Client(options);
      await client.connect();
      if (clock()>=proof.expires_at) deny('INVALID_PROOF');
      dispatched=true;
      const result=await client.query(sql,[JSON.stringify(proof)]);
      if (result?.command!=='SELECT' || result.rowCount!==1 || result.rows?.length!==1 || result.rows[0]?.registered!==true)
        deny('REGISTRATION_UNKNOWN',503);
    } catch(error) {
      if (!dispatched && error instanceof BusinessError) throw error;
      if (!dispatched) deny('REGISTRAR_UNAVAILABLE',503);
      if (error?.severity==='ERROR' && error.code==='42501' && error.message==='BUSINESS_DENIED') deny();
      if (error?.severity==='ERROR' && error.code==='PT409' && error.message==='TICKET_ALREADY_REGISTERED')
        deny('TICKET_CONFLICT',409);
      deny('REGISTRATION_UNKNOWN',503);
    } finally {
      try { await client?.end(); } catch { if(dispatched) deny('REGISTRATION_UNKNOWN',503); }
    }
  };
}
