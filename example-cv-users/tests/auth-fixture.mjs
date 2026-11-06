// Offline Auth wire fixture. Real SDK methods parse these HTTP responses.
// All identities/credentials are synthetic; no native fetch exists here.
const USERS_URL='https://users.auth.example.invalid';
const encoder=new TextEncoder();
const encode=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
const json=(body,status=200)=>Response.json(body,{status,headers:{'X-Supabase-Api-Version':'2024-01-01'}});
const error=(code,status=400)=>json({code,error_code:code,msg:'SYNTHETIC_RAW_ERROR_DO_NOT_LOG',message:'SYNTHETIC_RAW_ERROR_DO_NOT_LOG'},status);
export const TEST_PASSWORD='SYNTHETIC_REAL_ADAPTER_PASSWORD';
export const TEST_KEY='sb_publishable_SYNTHETIC_REAL_CONTRACT_ONLY';
export const TEST_ORIGIN='http://localhost:8795';
export const TEST_OTP='012345';
export async function realAuthority({now=()=>Date.now(),url=USERS_URL,issuer=url+'/auth/v1',padding=0,algorithm='ES256',otpExpired=false,signupSession=false,verifyUnconfirmed=false,requireCurrentPassword=true,recoveryEmailOtp=true,otpSessionMethod='otp'}={}) {
  if(!['ES256','HS256'].includes(algorithm))throw Error('fixture_algorithm_invalid');
  const symmetric=algorithm==='HS256';
  const keys=await crypto.subtle.generateKey(symmetric?{name:'HMAC',hash:'SHA-256'}:{name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=symmetric?{kid:crypto.randomUUID()}:{...await crypto.subtle.exportKey('jwk',keys.publicKey),alg:'ES256',use:'sig',kid:crypto.randomUUID()};
  const users=new Map(),tokens=new Map(),refresh=new Map(),sessions=new Map();
  const events=[];
  const recoveryOtps=new Map();
  const controls={update:'ok', logout:'ok', user:'ok', login:'ok', refresh:'ok'};let recoveryCode=TEST_OTP;
  const user=id=>{const u=users.get(id);return {id,email:u.email,email_confirmed_at:u.confirmed?'2026-10-29T00:00:00Z':null,
    aud:'authenticated',role:'authenticated',created_at:'2026-10-29T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{padding:'x'.repeat(padding)},identities:[{id}]};};
  const add=(email,confirmed=true,password=TEST_PASSWORD)=>{const id=crypto.randomUUID();users.set(id,{email,confirmed,password,confirmationExpires:now()+120000});return id;};
  const A=add('user-a@example.invalid'),B=add('user-b@example.invalid');
  const find=email=>[...users].find(([,u])=>u.email===email)?.[0];
  async function session(id,recovery=false,sid=crypto.randomUUID(),method=recovery?'recovery':'password') {
    const claims={iss:issuer,sub:id,aud:'authenticated',role:'authenticated',iat:Math.floor(now()/1000),exp:Math.floor(now()/1000)+3600,session_id:sid,...(method?{amr:[{method,timestamp:Math.floor(now()/1000)}]}:{})};
    const plain=encode({alg:algorithm,typ:'JWT',kid:jwk.kid})+'.'+encode(claims);
    const signature=await crypto.subtle.sign(symmetric?{name:'HMAC'}:{name:'ECDSA',hash:'SHA-256'},symmetric?keys:keys.privateKey,encoder.encode(plain));
    const access=plain+'.'+Buffer.from(signature).toString('base64url'),renew=crypto.randomUUID();
    sessions.set(sid,{id,recovery,revoked:false});tokens.set(access,sid);refresh.set(renew,sid);
    return {access_token:access,refresh_token:renew,expires_in:3600,expires_at:claims.exp,token_type:'bearer',user:user(id)};
  }
  const state=request=>{const token=(request.headers.get('authorization')??'').replace(/^Bearer /,'');const sid=tokens.get(token),s=sessions.get(sid);return s&&!s.revoked?{...s,sid}:null;};
  const fetch=async(input,init)=>{
    const request=input&&typeof input==='object'&&'url'in input?new Request(input.url,{method:input.method,headers:[...input.headers],...(!['GET','HEAD'].includes(input.method)?{body:await input.arrayBuffer()}:{}),...init}):new Request(input,init),target=new URL(request.url);
    if(target.origin!==url||request.headers.get('apikey')!==TEST_KEY)throw Error('fixture_target_mismatch');
    return handle(request,target);
  };
  const handle=async(request,url)=>{
    const route=request.method+' '+url.pathname+url.search;
    events.push({method:request.method,path:url.pathname,grant:url.searchParams.get('grant_type')});
    const body=request.method==='POST'||request.method==='PUT'?await request.json().catch(()=>({})):{};
    if(url.pathname.endsWith('/.well-known/jwks.json'))return json({keys:symmetric?[]:[jwk]});
    if(url.pathname==='/auth/v1/resend'){const id=find(body.email);if(id&&!users.get(id).confirmed)users.get(id).confirmationExpires=now()+120000;return json({});}
    if(url.pathname==='/auth/v1/signup'){
      const existing=find(body.email);if(existing)return json({...user(existing),identities:[]});
      const id=add(body.email,false,body.password);return json(signupSession?await session(id):user(id));
    }
    if(url.pathname==='/auth/v1/verify'){
      events.at(-1).otpType=body.type;
      const id=find(body.email);
      // Match Auth 2.197.0 verifyUserAndToken: general 'email' can also use the recovery slot.
      const generalRecovery = body.type === 'email' && recoveryOtps.get(id)?.code === body.token;
      if(recoveryEmailOtp && (body.type === 'recovery' || generalRecovery)){
        if(!id||!users.get(id).confirmed||!recoveryOtps.has(id)||recoveryOtps.get(id).expires<=now()||otpExpired||body.token!==recoveryOtps.get(id).code)return error('otp_expired',403);
        recoveryOtps.delete(id);return json(await session(id,!generalRecovery,crypto.randomUUID(),otpSessionMethod));
      }
      if(!['email','signup'].includes(body.type)||body.token!==TEST_OTP||otpExpired||!id||users.get(id).confirmed||users.get(id).confirmationExpires<=now())return error('otp_expired');
      users.get(id).confirmed=!verifyUnconfirmed;return json(await session(id));
    }
    if(url.pathname==='/auth/v1/recover'){
      if(recoveryEmailOtp){
        if(url.search||body.code_challenge_method!=='s256'||!body.code_challenge)throw Error('fixture_recovery_otp_target_mismatch');
        const id=find(body.email);if(id)recoveryOtps.set(id,{code:recoveryCode,expires:now()+120000});return json({});
      }
      throw Error('fixture_link_flow_disabled');
    }
    if(url.pathname==='/auth/v1/token'){
      if(url.search==='?grant_type=password'){
        if(controls.login==='network')throw Error('synthetic_connection_failed');
        if(controls.login==='limited')return error('over_request_rate_limit',429);
        const id=find(body.email);if(!id||users.get(id).password!==body.password)return error('invalid_credentials');
        if(!users.get(id).confirmed)return error('email_not_confirmed');return json(await session(id));
      }
      if(url.search==='?grant_type=refresh_token'){
        if(controls.refresh==='network')throw Error('synthetic_connection_failed');
        if(controls.refresh==='limited')return error('over_request_rate_limit',429);
        const sid=refresh.get(body.refresh_token),s=sessions.get(sid);refresh.delete(body.refresh_token);
        if(!s||s.revoked)return error('refresh_token_not_found');return json(await session(s.id,s.recovery,sid));
      }
    }
    if(url.pathname==='/auth/v1/logout'){
      if(controls.logout==='unknown')throw Error('synthetic_connection_failed');
      const s=state(request);if(s)sessions.get(s.sid).revoked=true;return new Response(null,{status:204});
    }
    if(url.pathname==='/auth/v1/user'){
      const s=state(request);if(!s)return error('bad_jwt',401);
      if(request.method==='GET'){
        if(controls.user==='network')throw Error('synthetic_connection_failed');
        if(controls.user==='limited')return error('over_request_rate_limit',429);
        return json(user(controls.user==='mixed'?B:s.id));
      }
      if(request.method==='PUT'){
        if(controls.update==='reject')return error('weak_password',422);
        if(controls.update==='limited')return error('over_request_rate_limit',429);
        if(typeof body.password!=='string'||body.password.length<12||body.password.length>128)return error('weak_password',422);
        const u=users.get(s.id);if(requireCurrentPassword&&!s.recovery&&body.current_password!==u.password)return error('current_password_mismatch');
        if(body.password===u.password)return error('same_password',422);u.password=body.password;for(const [sid,other] of sessions)if(other.id===s.id&&sid!==s.sid)other.revoked=true;
        if(controls.update==='lost')throw Error('synthetic_response_lost');
        if(controls.update==='timeout')await new Promise(r=>setTimeout(r,19000));
        return json(user(s.id));
      }
    }
    throw Error('fixture_route_denied');
  };
  return {fetch,events,controls,rotateCode:()=>{recoveryCode='654321';},expireCodes:()=>{for(const r of recoveryOtps.values())r.expires=0;},passwordMatches:(id,candidate)=>users.get(id)?.password===candidate,ids:{A,B},setPadding:value=>{padding=value;}};
}
