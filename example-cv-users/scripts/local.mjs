// Strictly local synthetic Auth. There is no network fallback or credential loading.
import {runtime} from '../tests/runtime.mjs';
import {realAuthority} from '../tests/auth-fixture.mjs';
import {resolve} from 'node:path';
const authority=await realAuthority();
const mf=runtime({port:8795,unsafeInspectDurableObjects:false,resourcePersistencePath:resolve('.runtime/local-state'),outboundService:request=>authority.fetch(request)});
await mf.ready;
console.log('Example CV isolated local app: http://localhost:8795/login');
console.log('Use fictional .invalid accounts only. No real Auth or email connection exists.');
console.log('Type stop and Enter for confirmed local shutdown.');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;const timer=setTimeout(()=>{console.error('Local runtime shutdown unconfirmed');process.exitCode=1;},10000);try{await mf.dispose();console.log('Local runtime stopped');}finally{clearTimeout(timer);process.stdin.pause();}}
// Miniflare installs its own immediate SIGINT/SIGTERM exit hooks. Explicit
// stdin shutdown lets disposal finish and reports its result before Node exits.
process.stdin.setEncoding('utf8');
process.stdin.on('data',text=>{if(text.trim()==='stop')void stop();});
process.stdin.resume();
