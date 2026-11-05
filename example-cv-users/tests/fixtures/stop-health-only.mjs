// No Auth, DO, TLS or cloud: exercise the actual stop bodies from the two runners.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
const scenario=process.argv[2]??'normal';
const controlled=scenario.startsWith('controlled-');
const source=readFileSync(new URL(controlled?'../../scripts/controlled-https.mjs':'../../scripts/local-https.mjs',import.meta.url),'utf8');
const body=controlled?source.slice(source.indexOf('function stop(){'),source.indexOf('\ntry{await mf.ready;')):source.slice(source.indexOf('async function stop() {'),source.indexOf("input.on('line', line => {"));
if(!(body.startsWith('async function stop() {')||body.startsWith('function stop(){'))||!body.includes('await mf.dispose()'))throw Error('stop_source_not_found');
const emit=value=>console.log(JSON.stringify({at:Date.now(),...value}));
let cleanups=0;
const hold=scenario.endsWith('timeout')?setInterval(()=>{},1000):null;
const mf={dispose:async()=>{emit({kind:'cleanup_started',call:++cleanups});if(hold)return new Promise(()=>{});await new Promise(r=>setTimeout(r,40));emit({kind:'cleanup_complete'});}};
const executor={cleanup:async()=>{emit({kind:'scoped_cleanup_started'});if(hold)return new Promise(()=>{});return true;},close:()=>emit({kind:'ledger_closed'})};
const server=http.createServer((req,res)=>{res.writeHead(req.method==='GET'&&req.url==='/health'?200:404,{'Cache-Control':'no-store'});res.end('no authentication');});
const input=createInterface({input:process.stdin});
// Only the unchanged, hashed stop function is evaluated. No business file imports.
const lifecycle=new Function('server','mf','input','emit','active','executor','log',
 'let stopping=false,stopPromise,expiryTimer;'+body+';return {stop,isStopping:()=>stopping};')(server,mf,input,emit,new Set(),executor,emit);
input.on('close',()=>emit({kind:'input_closed'}));
input.on('line',line=>{if(line==='stop'){
 const duplicate=lifecycle.isStopping();
 void lifecycle.stop();
 emit({kind:'stop_instruction_accepted',duplicate,stopping:lifecycle.isStopping()});
}});
server.listen(0,'127.0.0.1',()=>emit({kind:'ready',pid:process.pid,port:server.address().port,authRequests:0,stopBodySha256:createHash('sha256').update(body).digest('hex')}));
