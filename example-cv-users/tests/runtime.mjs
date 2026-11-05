import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
export function runtime(overrides = {}) {
  const root=resolve('dist/server');
  const names=readdirSync(root,{recursive:true}).filter(n=>n.endsWith('.js')&&n!=='index.js');
  return new Miniflare(convertV4MiniflareOptions({
    host:'127.0.0.1', port:0, unsafeInspectDurableObjects:true, log:new Log(LogLevel.ERROR), cf:false,
    name:'example-cv-users', modulesRoot:root,
    modules:['index.js',...names].map(n=>({type:'ESModule',path:resolve(root,n)})),
    compatibilityDate:'2026-08-15', compatibilityFlags:['nodejs_compat'],
    assets:{directory:resolve('dist/client'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},
    bindings:{USERS_CURRENT_PASSWORD_POLICY:'ON',USERS_MODE:'isolated',USERS_PROJECT_REF:'isolated-users',USERS_SUPABASE_URL:'https://users.auth.example.invalid',USERS_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_REAL_CONTRACT_ONLY',USERS_APP_ORIGIN:'http://localhost:8795'},
    durableObjects:{USERS_RECOVERY_STATE:{className:'RecoveryState',useSQLite:true}},
    outboundService:()=>{throw Error('external_network_denied');},
    ...overrides,
  }));
}
