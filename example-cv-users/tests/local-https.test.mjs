import test from 'node:test';
import assert from 'node:assert/strict';
import {HTTPS_ORIGIN, authorizeLocalRequest, outgoingHeaders, cookieMetadata, cookieNames} from '../scripts/local-https-boundary.mjs';
const request = (extra = {}) => ({socket: {remoteAddress: '127.0.0.1', encrypted: true}, url: '/api/account/login', method: 'POST',
  headers: {host: '127.0.0.1:8787', origin: HTTPS_ORIGIN, 'content-type': 'application/json'}, ...extra});
test('TLS URL and Origin stay fixed without forwarded protocol trust', () => {
  assert.equal(authorizeLocalRequest(request()).url, HTTPS_ORIGIN + '/api/account/login');
  for (const name of ['forwarded','x-forwarded-proto','x-forwarded-host','cf-connecting-ip','x-miniflare-foo']) {
    const req=request(); req.headers[name]='forged'; assert.throws(() => authorizeLocalRequest(req), /untrusted_header/);
  }
});
test('wrong host, Origin, peer and cleartext fail closed', () => {
  for (const extra of [{headers: {...request().headers,host:'localhost:8787'}}, {headers: {...request().headers,origin:'http://127.0.0.1:8787'}},
    {socket:{remoteAddress:'127.0.0.1',encrypted:false}}, {socket:{remoteAddress:'192.0.2.1',encrypted:true}}]) assert.throws(() => authorizeLocalRequest(request(extra)));
});
test('diagnostic entry cannot send recovery, signup or password updates', () => {
  for (const action of ['register','recovery-otp-send','recovery-otp-verify','reset-password','change-password'])
    assert.throws(() => authorizeLocalRequest(request({url:'/api/account/'+action})), /session_diagnostic_scope/);
});
test('unrelated cookie identities are not forwarded or logged', () => {
  const req=request();req.headers.cookie='cms-secret=PRIVATE; __Host-ecv-users-session.0=VALUE; __Host-ecv-users-session.1=OTHER';
  const a=authorizeLocalRequest(req);
  assert.deepEqual(cookieNames(req.headers.cookie), ['__Host-ecv-users-session.0','__Host-ecv-users-session.1']);
  assert.ok(!a.headers.get('cookie').includes('PRIVATE'));
});
test('Set-Cookie fields remain separate including Expires commas', () => {
  const h=new Headers();
  const cookies=['__Host-ecv-users-session.0=SECRET_A; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600',
    '__Host-ecv-users-session.1=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT'];
  for(const cookie of cookies)h.append('Set-Cookie',cookie);
  const output=outgoingHeaders(new Response('{}',{headers:h}));
  assert.deepEqual(output['set-cookie'],cookies);
  assert.equal(output['cache-control'],'private, no-store');
  const meta=JSON.stringify(cookies.map(cookieMetadata));assert.ok(!meta.includes('SECRET_A'));
  assert.equal(cookieMetadata(cookies[1]).maxAge,0);
});
test('redirects cannot change protocol, host or port', () => {
  for(const location of ['http://127.0.0.1:8787/login','https://localhost:8787/login','https://127.0.0.1:8795/login','//other.invalid/login'])
    assert.throws(() => outgoingHeaders(new Response(null,{status:303,headers:{location}})), /redirect_denied/);
  assert.equal(outgoingHeaders(new Response(null,{status:303,headers:{location:'/login'}})).location,'/login');
});
