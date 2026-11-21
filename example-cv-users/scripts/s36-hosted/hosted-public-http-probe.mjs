// Isolated host bridge for the frozen root Worker candidate. Never deploys the Worker.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer,request as httpsRequest} from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {configuration,privateFile,publicationProject} from './target.mjs';
import {writeOnce} from './r3.mjs';

const read=path=>JSON.parse(privateFile(path));
const sha=value=>createHash('sha256').update(value).digest('hex');
const hostPattern=/^[a-z][a-z0-9-]{1,46}[a-z0-9]\.sites\.example\.test$/;
const path='/api/text-publication';

export function hostedRpcReceipt(url,init,projectKey,allowedHosts) {
  assert.equal(url,'https://'+publicationProject+'.supabase.co/rest/v1/rpc/read_public_text');
  assert.equal(init.method,'POST');
  assert.equal(init.headers.apikey,projectKey);
  assert.equal(init.headers['Content-Profile'],'public');
  assert.equal(init.headers['Accept-Profile'],'public');
  assert.equal(Object.keys(init.headers).some(h=>h.toLowerCase()==='authorization'),false);
  const args=JSON.parse(init.body);
  assert.deepEqual(Object.keys(args).sort(),['hostname','locale']);
  assert.ok(allowedHosts.includes(args.hostname));
  return args;
}

async function main(run,manifestPath,manifestHash) {
  const manifest=privateFile(manifestPath);
  assert.equal(sha(manifest),manifestHash);
  const {files,workerModule,bindingModule}=JSON.parse(manifest);
  assert.ok(files[workerModule]&&files[bindingModule]);
  for(const [file,hash] of Object.entries(files)) {
    assert.ok(isAbsolute(file));
    assert.equal(sha(readFileSync(file)),hash);
  }
  const {createTextPublicationWorkerCandidate}=await import(pathToFileURL(workerModule));
  const {createBusinessBinding}=await import(pathToFileURL(bindingModule));
  const config=configuration(read(join(run,'private','fixture.json')));
  assert.equal(config.project,publicationProject);
  const baseline=read(join(run,'baseline.json'));
  const hosts=[config.aliceSite,config.bobSite].map(id=>{
    const domain=baseline.domains.find(row=>row.site_id===id&&row.is_primary&&row.kind==='test');
    assert.ok(hostPattern.test(domain?.hostname_normalized));
    return domain.hostname_normalized;
  });
  const tls=read(join(run,'private','receiver.json'));
  const upstream=[];
  const binding=createBusinessBinding({project:config.project,authIssuer:config.url+'/auth/v1',
    privateOrigin:config.privateOrigin,registrarHost:'db.'+config.project+'.supabase.co',testOnly:true});
  const candidate=createTextPublicationWorkerCandidate({binding,enabled:true,publishableKey:config.publishableKey,
    timeoutMs:5000,fetcher:async(url,init)=>{
      const args=hostedRpcReceipt(url,init,config.publishableKey,hosts);
      assert.ok(upstream.length<2);
      const response=await fetch(url,{...init,redirect:'error'});
      const body=await response.clone().json();
      upstream.push({args,status:response.status,code:body?.code??null});
      return response;
    }});
  const calls=[];
  async function vhost(authority,probes) {
    const server=createServer({...tls.server,minVersion:'TLSv1.2',headersTimeout:2000,requestTimeout:6500},async(req,res)=>{
      try {
        assert.equal(req.socket.remoteAddress,'127.0.0.1');
        assert.ok(req.url.startsWith('/')&&!req.url.startsWith('//'));
        const request=new Request('https://'+authority+req.url,{method:req.method,headers:{host:req.headers.host}});
        const response=await candidate.fetch(request);
        const responseBody=await response.text();
        res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':response.headers.get('Cache-Control'),
          'X-ECV-Test-Handler':'frozen-text-publication-candidate'});
        res.end(responseBody);
      } catch {res.writeHead(500);res.end();}
    });
    await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
    try {
      for(const probe of probes) {
        const observed=upstream.length;
        const result=await new Promise((yes,no)=>{
          const client=httpsRequest({host:'127.0.0.1',port:server.address().port,method:'GET',path:probe.path,
            headers:{host:probe.host??authority},ca:tls.client.ca,rejectUnauthorized:true,agent:false,
            servername:'',checkServerIdentity:(_,certificate)=>checkServerIdentity('127.0.0.1',certificate),
            signal:AbortSignal.timeout(7000)},response=>{
            const parts=[];
            response.on('data',chunk=>parts.push(chunk));
            response.on('end',()=>yes({status:response.statusCode,headers:response.headers,
              body:Buffer.concat(parts).toString('utf8')}));
            response.on('error',no);
          });
          client.once('error',no);
          client.end();
        });
        const code=JSON.parse(result.body)?.code;
        assert.equal(result.headers['x-ecv-test-handler'],'frozen-text-publication-candidate');
        assert.equal(result.headers['cache-control'],'no-store');
        calls.push({name:probe.name,status:result.status,code,upstreamCalls:upstream.length-observed});
        assert.equal(result.status,404);
        assert.equal(code,probe.code);
        assert.equal(upstream.length-observed,probe.rpc?1:0);
        if(probe.rpc) assert.deepEqual(upstream.at(-1),{args:{hostname:authority,locale:'en'},status:404,code:'PT404'});
      }
    } finally {await new Promise((yes,no)=>server.close(err=>err?no(err):yes()));}
  }
  try {
    const missing='PUBLICATION_NOT_FOUND';
    await vhost(hosts[0],[
      {name:'known-alice-authority',path:path+'?locale=en',code:missing,rpc:true},
      {name:'old-snapshot-route',path:path+'/'+baseline.snapshots[0].id,code:'NOT_FOUND'},
      {name:'extra-snapshot-id',path:path+'?snapshot_id='+baseline.snapshots[0].id,code:missing},
      {name:'extra-site-id',path:path+'?site_id='+config.aliceSite,code:missing},
      {name:'invalid-locale',path:path+'?locale=fr',code:missing},
      {name:'duplicate-locale',path:path+'?locale=en&locale=zh',code:missing},
      {name:'mismatched-host-authority',path:path+'?locale=en',host:hosts[1],code:missing}
    ]);
    await vhost(hosts[1],[{name:'known-bob-authority',path:path+'?locale=en',code:missing,rpc:true}]);
  } finally {writeOnce(join(run,'public-http-receipt.json'),{calls,upstream,listenersClosed:true,publicationFixtureChanged:false});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [flag,run,manifest,hash]=process.argv.slice(2);
  assert.equal(flag,'--read-only-http');
  assert.ok(isAbsolute(run)&&isAbsolute(manifest));
  main(run,manifest,hash).catch(error=>{
    const location=String(error?.stack).match(/hosted-public-http-probe\.mjs:(\d+):\d+/)?.[1];
    console.error(JSON.stringify({status:'HOSTED_PUBLIC_HTTP_STOP',code:error?.code??null,line:location??null}));
    process.exitCode=1;
  });
}
