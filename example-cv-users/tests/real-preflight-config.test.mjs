// Pure configuration check: no Worker, SDK, credential loading or network.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/config.ts',import.meta.url),'utf8');
const target=source.match(/export const TARGET = '([^']+)';/)[1];
const code=source.slice(source.indexOf('export function configuration('),source.indexOf('export async function digest(')).replace('export function','function').replace('env: UsersEnv','env');
const configuration=new Function('TARGET',code+';return configuration;')(target);
const key='sb_publishable_NONCREDENTIAL_CONFIGURATION_CHECK';
test('same build refuses real project at local origin and permits only the documented production or synthetic pair',t=>{
 const base={USERS_PROJECT_REF:target,USERS_SUPABASE_URL:`https://${target}.supabase.co`,USERS_PUBLISHABLE_KEY:key,USERS_APP_ORIGIN:'https://127.0.0.1:8787'};
 assert.throws(()=>configuration({...base,USERS_MODE:'production'}),/configuration_denied/);
 assert.throws(()=>configuration({...base,USERS_MODE:'isolated'}),/configuration_denied/);
 assert.equal(configuration({...base,USERS_MODE:'production',USERS_APP_ORIGIN:'https://admin.example-cv.com'}).project,target);
 assert.equal(configuration({...base,USERS_MODE:'isolated',USERS_PROJECT_REF:'isolated-users',USERS_SUPABASE_URL:'https://users.auth.example.invalid'}).project,'isolated-users');
 t.diagnostic('Production and isolated modes still reject local HTTPS + hosted Auth. Controlled mode is tested separately. No authentication was attempted.');
});
