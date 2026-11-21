// Isolated host bridge for the frozen root Worker candidate. Never deploys the Worker.
import assert from 'node:assert/strict';
import {createHash,randomBytes,X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer,request as httpsRequest} from 'node:https';
import {checkServerIdentity,createSecureContext} from 'node:tls';
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

export function verifyPublicProbeMaterial(run,manifestPath,manifestHash) {
  const manifest=privateFile(manifestPath);
  assert.equal(sha(manifest),manifestHash);
  const {files,workerModule,bindingModule}=JSON.parse(manifest);
  assert.ok(files[workerModule]&&files[bindingModule]);
  for(const [file,hash] of Object.entries(files)) {
    assert.ok(isAbsolute(file));
    assert.equal(sha(readFileSync(file)),hash);
  }
  const config=configuration(read(join(run,'private','fixture.json')));
  assert.equal(config.project,publicationProject);
  const tls=read(join(run,'private','receiver.json'));
  assert.ok(tls.client.ca);
  assert.equal(new X509Certificate(tls.server.cert).checkIP('127.0.0.1'),'127.0.0.1');
  createSecureContext({...tls.server});
  createSecureContext({ca:tls.client.ca});
  return {config,tls,workerModule,bindingModule};
}

export function publicProjection(readback,id) {
  const site=readback.sites.find(row=>row.id===id);
  assert.ok(site);
  const pub=site.publication;
  if(pub.state==='unpublished') {
    assert.equal(pub.snapshot_id,null);
    return null;
  }
  assert.equal(pub.state,'published');
  const snapshot=readback.snapshots.find(row=>row.id===pub.snapshot_id&&row.site_id===id);
  assert.ok(snapshot);
  return {
    snapshotId:snapshot.id,snapshotDigest:snapshot.digest,
    expected:{schema_version:1,locale:'en',publication_revision:pub.publication_revision,
      entries:snapshot.payload.entries.filter(e=>Object.hasOwn(e.translations,'en'))
        .sort((a,b)=>a.position-b.position).map(e=>({position:e.position,text:e.translations.en}))}
  };
}

export async function startPublicProbe(run,manifestPath,manifestHash,baseline,label,maxRpc) {
  const {config,tls,workerModule,bindingModule}=verifyPublicProbeMaterial(run,manifestPath,manifestHash);
  const {createTextPublicationWorkerCandidate}=await import(pathToFileURL(workerModule));
  const {createBusinessBinding}=await import(pathToFileURL(bindingModule));
  const siteIds=[config.aliceSite,config.bobSite];
  const hosts=siteIds.map(id=>{
    const domain=baseline.domains.find(row=>row.site_id===id&&row.is_primary&&row.kind==='test');
    assert.ok(hostPattern.test(domain?.hostname_normalized));
    return domain.hostname_normalized;
  });
  assert.equal(new Set(hosts).size,2);
  const upstream=[],calls=[],servers=new Map();
  const localKey=randomBytes(32).toString('hex');
  let dispatches=0,active=null;
  const binding=createBusinessBinding({project:config.project,authIssuer:config.url+'/auth/v1',
    privateOrigin:config.privateOrigin,registrarHost:'db.'+config.project+'.supabase.co',testOnly:true});
  const candidate=createTextPublicationWorkerCandidate({binding,enabled:true,publishableKey:config.publishableKey,
    timeoutMs:5000,fetcher:async(url,init)=>{
      const args=hostedRpcReceipt(url,init,config.publishableKey,hosts);
      assert.deepEqual(args,active?.rpc?{hostname:active.authority,locale:'en'}:null);
      assert.ok(!active.dispatched&&dispatches<maxRpc);
      active.dispatched=true;
      dispatches+=1;
      const response=await fetch(url,{...init,redirect:'error'});
      const body=await response.clone().json();
      upstream.push({args,status:response.status,code:body?.code??null});
      return response;
    }});
  async function listen(authority) {
    const server=createServer({...tls.server,minVersion:'TLSv1.2',headersTimeout:2000,requestTimeout:6500},async(req,res)=>{
      try {
        assert.equal(req.socket.remoteAddress,'127.0.0.1');
        assert.equal(req.headers['x-ecv-probe-key'],localKey);
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
    servers.set(authority,server);
  }
  async function close() {
    const ports=[...servers.values()].map(server=>server.address()?.port);
    const closed=await Promise.allSettled([...servers.values()].map(server=>
      new Promise((yes,no)=>server.close(err=>err?no(err):yes()))));
    const listenersClosed=closed.every(result=>result.status==='fulfilled');
    writeOnce(join(run,label+'.json'),{calls,upstream,dispatches,ports,listenersClosed,stage:label});
    assert.ok(listenersClosed);
  }
  try {for(const authority of hosts) await listen(authority);}
  catch(error) {await close();throw error;}

  async function probe(authority,probe) {
    assert.equal(active,null);
    const port=servers.get(authority)?.address()?.port;
    assert.ok(port);
    const host=probe.host??authority;
    const observed=upstream.length;
    const evidence={name:probe.name,authority,host,path:probe.path,port,
      snapshotId:probe.snapshotId??null,snapshotDigest:probe.snapshotDigest??null,
      expectedPublishedVersion:probe.expected?.publication_revision??null};
    active={authority,rpc:probe.rpc,dispatched:false};
    try {
      const result=await new Promise((yes,no)=>{
        const client=httpsRequest({host:'127.0.0.1',port,method:'GET',path:probe.path,
          headers:{host,'x-ecv-probe-key':localKey},ca:tls.client.ca,rejectUnauthorized:true,agent:false,
          servername:'',checkServerIdentity:(_,certificate)=>checkServerIdentity('127.0.0.1',certificate),
          signal:AbortSignal.timeout(7000)},response=>{
          const parts=[],socket=response.socket;
          response.on('data',chunk=>parts.push(chunk));
          response.on('end',()=>yes({status:response.statusCode,headers:response.headers,
            tlsAuthorized:socket.authorized,tlsProtocol:socket.getProtocol(),body:Buffer.concat(parts).toString('utf8')}));
          response.on('error',no);
        });
        client.once('error',no);
        client.end();
      });
      Object.assign(evidence,{status:result.status,tlsAuthorized:result.tlsAuthorized,tlsProtocol:result.tlsProtocol,
        handler:result.headers['x-ecv-test-handler']??null,cacheControl:result.headers['cache-control']??null,
        bodySha256:sha(result.body),upstream:upstream.slice(observed)});
      assert.equal(result.tlsAuthorized,true);
      assert.ok(['TLSv1.2','TLSv1.3'].includes(result.tlsProtocol));
      assert.equal(evidence.handler,'frozen-text-publication-candidate');
      assert.equal(evidence.cacheControl,'no-store');
      const body=JSON.parse(result.body);
      evidence.code=body?.code??null;
      assert.equal(result.status,probe.expected?200:404);
      if(probe.expected) {
        assert.deepEqual(body,probe.expected);
        evidence.projectionSha256=sha(JSON.stringify(probe.expected));
      } else assert.equal(evidence.code,probe.code);
      assert.equal(upstream.length-observed,probe.rpc?1:0);
      if(probe.rpc) assert.deepEqual(upstream.at(-1),{args:{hostname:authority,locale:'en'},
        status:probe.expected?200:404,code:probe.expected?null:'PT404'});
      evidence.verified=true;
      return evidence;
    } catch(error) {
      evidence.error=error?.code??error?.name??'Error';
      throw error;
    } finally {
      active=null;
      calls.push(evidence);
    }
  }
  return {hosts,probe,close,async probeSite(siteId,readback,name) {
    const authority=hosts[siteIds.indexOf(siteId)];
    assert.ok(authority);
    return probe(authority,{name,path:path+'?locale=en',code:'PUBLICATION_NOT_FOUND',rpc:true,
      ...publicProjection(readback,siteId)});
  }};
}

export async function runPublicProbe(run,manifestPath,manifestHash,fixtureReadback=null,label='public-http-receipt') {
  const baseline=fixtureReadback??read(join(run,'baseline.json'));
  const session=await startPublicProbe(run,manifestPath,manifestHash,baseline,label,2);
  const {hosts}=session;
  const config=configuration(read(join(run,'private','fixture.json')));
  try {
    const missing='PUBLICATION_NOT_FOUND';
    if(fixtureReadback) {
      for(const [index,id] of [config.aliceSite,config.bobSite].entries())
        await session.probeSite(id,fixtureReadback,'current-'+index);
      return;
    }
    for(const probe of [
      {name:'known-alice-authority',path:path+'?locale=en',code:missing,rpc:true},
      {name:'old-snapshot-route',path:path+'/'+baseline.snapshots[0].id,code:'NOT_FOUND'},
      {name:'extra-snapshot-id',path:path+'?snapshot_id='+baseline.snapshots[0].id,code:missing},
      {name:'extra-site-id',path:path+'?site_id='+config.aliceSite,code:missing},
      {name:'invalid-locale',path:path+'?locale=fr',code:missing},
      {name:'duplicate-locale',path:path+'?locale=en&locale=zh',code:missing},
      {name:'mismatched-host-authority',path:path+'?locale=en',host:hosts[1],code:missing}
    ]) await session.probe(hosts[0],probe);
    await session.probe(hosts[1],{name:'known-bob-authority',path:path+'?locale=en',code:missing,rpc:true});
  } finally {await session.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [flag,run,manifest,hash]=process.argv.slice(2);
  assert.equal(flag,'--read-only-http');
  assert.ok(isAbsolute(run)&&isAbsolute(manifest));
  runPublicProbe(run,manifest,hash).catch(error=>{
    const location=String(error?.stack).match(/hosted-public-http-probe\.mjs:(\d+):\d+/)?.[1];
    console.error(JSON.stringify({status:'HOSTED_PUBLIC_HTTP_STOP',code:error?.code??null,line:location??null}));
    process.exitCode=1;
  });
}
