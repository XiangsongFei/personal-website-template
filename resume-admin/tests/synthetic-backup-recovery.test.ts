// @vitest-environment node
// Local tests are contract/failure tests. The opt-in case invokes REAL isolated
// Supabase stages; default skips must never be described as a restored database.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs';
// Explicit test-side interface for the ESM runners; no project-wide TS changes.
const { artifactNames, caseNames, makeManifest, verifyArtifacts, restoreInputs, sealArtifacts, openArtifacts, sha256, assertConsistent } = await import(new URL('./rls-runtime/backup-recovery-contract.mjs', import.meta.url).href) as {
  artifactNames: readonly string[]; caseNames: readonly string[];
  makeManifest: (files: Map<string,Buffer>) => unknown;
  verifyArtifacts: (manifest: unknown, files: Map<string,Buffer>) => boolean;
  restoreInputs: (manifest: unknown, files: Map<string,Buffer>) => {name:string;bytes:Buffer}[];
  sealArtifacts: (files: Map<string,Buffer>, key:Buffer) => Buffer;
  openArtifacts: (encrypted:Buffer,key:Buffer) => {files:Map<string,Buffer>};
  sha256: (bytes:string|Buffer) => string;
  assertConsistent: (before:Record<string,string>,after:Record<string,string>) => boolean;
};
const { validateStage, validManifestPath, failureSelfTest, assertDefaultSchemaTables, exportStep, safeExportResult, exportStages, fallbackRequired, dumpRoles, safeRoleDumpStatus } = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs', import.meta.url).href) as {
  validateStage:(stage:unknown)=>void; validManifestPath:(path:unknown)=>boolean; failureSelfTest:()=>Promise<void>;
  assertDefaultSchemaTables:(sql:unknown)=>void;
  exportStages:readonly string[];
  safeExportResult:(stage:unknown,status:unknown)=>{stage:string;status:string};
  exportStep:(stage:string,operation:()=>unknown,report:(result:{stage:string;status:string})=>void)=>unknown;
  fallbackRequired:(manifest:string,cleaned:Set<string>)=>boolean;
  dumpRoles:(stage:{stagedRoot:string},supabase:(args:string[])=>void,report:(status:string)=>void)=>Buffer;
  safeRoleDumpStatus:(status:unknown)=>string;
};

const fixtures = () => new Map(artifactNames.map((name: string) => [name,Buffer.from(`synthetic-only:${name}`)]));
describe('synthetic backup local contracts (no database)',()=>{
  it('encrypts and authenticates the whole inventory before decoding',()=>{
    const key=randomBytes(32);const files=fixtures();const encrypted=sealArtifacts(files,key);
    expect(openArtifacts(encrypted,key).files).toEqual(files);
    expect(()=>openArtifacts(encrypted,randomBytes(32))).toThrow();
    const corrupt=Buffer.from(encrypted);corrupt[20]^=1;
    expect(()=>openArtifacts(corrupt,key)).toThrow();
  });
  it('rejects missing and modified artifacts without applying migration history',()=>{
    const files=fixtures();const manifest=makeManifest(files);
    expect(restoreInputs(manifest,files).map((x: {name:string})=>x.name)).toEqual(['roles.sql','schema.sql','data.sql']);
    files.delete('history-data.sql');expect(()=>verifyArtifacts(manifest,files)).toThrow();
    const changed=fixtures();changed.set('data.sql',Buffer.from('changed'));
    expect(()=>verifyArtifacts(manifest,changed)).toThrow();
  });
  it('fails independently on database, Auth, Storage and reference drift',()=>{
    const before={database:sha256('db'),auth:sha256('auth'),storage:sha256('storage'),references:sha256('references')};
    for(const key of Object.keys(before))expect(()=>assertConsistent(before,{...before,[key]:sha256('drift')})).toThrow();
  });
  it('binds API and container identities to the same ephemeral stage',()=>{
    const stage={projectId:'pr1-123-aabbccddeeff',dbContainer:'supabase_db_pr1-123-aabbccddeeff',authContainer:'supabase_auth_pr1-123-aabbccddeeff',apiUrl:'http://127.0.0.1:12345',ports:{api:12345}};
    expect(()=>validateStage(stage)).not.toThrow();
    for(const change of [{apiUrl:'https://production.invalid'},{apiUrl:'http://127.0.0.1:12346'},{dbContainer:'supabase_db_other'},{authContainer:'supabase_auth_other'},{projectId:'production'}])expect(()=>validateStage({...stage,...change})).toThrow();
  });
  it('accepts only exact staging manifest paths for fallback cleanup',()=>{
    const valid=join(tmpdir(),'pr1-supabase-123-aabbccddeeff-Ab12Cd','ownership.json');
    expect(validManifestPath(valid)).toBe(true);
    for(const invalid of [valid+'/extra',valid.replace('ownership.json','other.json'),valid.replace('Ab12Cd','..'),valid.replace('pr1-supabase','other'),valid.replace('aabbccddeeff','aabb'),valid.replace('/ownership','/../ownership')])expect(validManifestPath(invalid)).toBe(false);
  });
  it('distinguishes callback failure, cleanup failure and timeout using synthetic failures',async()=>{
    await failureSelfTest();
  });
});
describe('roles dump command versus artifact failures (synthetic filesystem, no database)',()=>{
  it.each(['cli-command-failed','artifact-missing','artifact-empty','artifact-not-regular','symlink','artifact-oversize','success'])('classifies %s without exposing CLI output',(scenario)=>{
    const stagedRoot=mkdtempSync(join(tmpdir(),'roles-dump-contract-'));
    const file=join(stagedRoot,'roles.sql');const events:string[]=[];
    const bytes=Buffer.from('CREATE ROLE "synthetic_backup_reader";\nRESET ALL;\n');
    let calls=0;
    try{
      const command=(args:string[])=>{
        calls++;
        expect(args).toEqual(['db','dump','--local','--role-only','-f',file]);
        if(scenario==='cli-command-failed'){
          writeFileSync(file,bytes); // Even a partial output must not mask command failure.
          throw new Error('SQL PASSWORD JWT /private/secret');
        }
        if(scenario==='artifact-empty')writeFileSync(file,'');
        if(scenario==='artifact-not-regular')mkdirSync(file);
        if(scenario==='symlink'){writeFileSync(join(stagedRoot,'other'),bytes);symlinkSync('other',file);}
        if(scenario==='artifact-oversize'){
          const fd=openSync(file,'wx');try{ftruncateSync(fd,16*1024*1024);}finally{closeSync(fd);}
        }
        if(scenario==='success')writeFileSync(file,bytes);
      };
      const run=()=>dumpRoles({stagedRoot},command,status=>events.push(status));
      if(scenario==='success')expect(run()).toEqual(bytes);else expect(run).toThrow();
      expect(calls).toBe(1);
      expect(events).toEqual(['unverified',scenario==='symlink'?'artifact-not-regular':scenario]);
      expect(JSON.stringify(events)).not.toMatch(/SQL|PASSWORD|JWT|secret|private|CREATE|reader/);
    }finally{rmSync(stagedRoot,{recursive:true,force:true});}
  });
  it('sanitizes unknown statuses and preserves the outer first-failure contract',()=>{
    expect(safeRoleDumpStatus('PASSWORD JWT')).toBe('unverified');
    expect(safeRoleDumpStatus(undefined)).toBe('unverified');
    const stagedRoot=mkdtempSync(join(tmpdir(),'roles-dump-contract-'));
    const roles:string[]=[];const stages:{stage:string;status:string}[]=[];let continued=false;
    try{
      expect(()=>{
        exportStep('roles-dump',()=>dumpRoles({stagedRoot},()=>{},s=>roles.push(s)),s=>stages.push(s));
        continued=true;
      }).toThrow();
      expect(continued).toBe(false);
      expect(roles).toEqual(['unverified','artifact-missing']);
      expect(stages).toEqual([{stage:'roles-dump',status:'unverified'},{stage:'roles-dump',status:'failed'}]);
    }finally{rmSync(stagedRoot,{recursive:true,force:true});}
  });
  it('does not misclassify an unexpected filesystem error as a missing artifact',()=>{
    const root=mkdtempSync(join(tmpdir(),'roles-dump-contract-'));
    const stagedRoot=join(root,'not-a-directory');const events:string[]=[];
    try{
      writeFileSync(stagedRoot,'synthetic-only');
      expect(()=>dumpRoles({stagedRoot},()=>{},s=>events.push(s))).toThrow();
      expect(events).toEqual(['unverified','unverified']);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
describe('fixed CLI dump format and bounded diagnostics (no database)',()=>{
  const app='CREATE TABLE synthetic_backup.items (id integer);';
  it.each([
    app,
    'create table SYNTHETIC_BACKUP.ITEMS (id integer);',
    'CREATE TABLE IF NOT EXISTS "synthetic_backup"."items" ("id" integer);',
    'CrEaTe\nTaBlE\tIf  NoT\nExIsTs "synthetic_backup" \n.\t"items" (id integer);',
    'CREATE /* outer /* nested */ comment */ TABLE synthetic_backup . "items" (id integer);',
  ])('recognizes application table variant %#',(sql)=>expect(()=>assertDefaultSchemaTables(sql)).not.toThrow());
  for(const schema of ['auth','storage','vault','supabase_migrations']){
    it.each([
      `CREATE TABLE ${schema}.probe (id integer);`,
      `CREATE TABLE IF NOT EXISTS "${schema}"."probe" (id integer);`,
      `cReAtE\nTaBlE\tIF\nNOT EXISTS ${schema.toUpperCase()} . probe (id integer);`,
      `CREATE /* comment */ TABLE IF NOT EXISTS "${schema}" . probe (id integer);`,
    ])(`rejects managed schema ${schema} variant %#`,(ddl)=>expect(()=>assertDefaultSchemaTables(app+ddl)).toThrow());
  }
  it('does not mistake comments, quoted identifiers or function bodies for table declarations',()=>{
    const embedded=`-- CREATE TABLE auth.fake (id integer);\n/* CREATE TABLE storage.fake (id integer); */
      CREATE FUNCTION synthetic_backup.demo() RETURNS text LANGUAGE sql AS $fn$ SELECT 'CREATE TABLE vault.fake (id integer);' $fn$;
      COMMENT ON SCHEMA synthetic_backup IS 'CREATE TABLE supabase_migrations.fake (id integer);';`;
    expect(()=>assertDefaultSchemaTables(app+embedded)).not.toThrow();
    expect(()=>assertDefaultSchemaTables(embedded+`SELECT 'CREATE TABLE synthetic_backup.items (id integer);';`)).toThrow();
    expect(()=>assertDefaultSchemaTables('SELECT "create", "table", "synthetic_backup", "items";')).toThrow();
  });
  it.each([
    '', 'CREATE TABLE items (id integer);', 'CREATE TABLE "Synthetic_Backup"."items" (id integer);',
    'CREATE TABLE synthetic_backup.items AS SELECT 1;', 'CREATE TABLE synthetic_backup.items (id integer;',
    'CREATE TABLE synthetic_backup.items (id integer)', app+'/* unterminated', app+"SELECT 'unterminated;",
    app+'SELECT $fn$unterminated;', app+'CREATE TABLE "auth.probe" (id integer);',
    app+'CREATE TEMP TABLE auth.probe (id integer);', app+'CREATE UNLOGGED TABLE auth.probe (id integer);',
    app+'CREATE TABLE IF EXISTS auth.probe (id integer);', app+'CREATE TABLE U&"auth".probe (id integer);',
    app+'\\include private.sql', app+'\0', app+app,
  ])('fails closed on unsupported or malformed schema %#',(sql)=>expect(()=>assertDefaultSchemaTables(sql)).toThrow());
  it('records only the first failed export substage and never emits payload or error text',()=>{
    for(const failedStage of exportStages){
      const events:{stage:string;status:string}[]=[];
      expect(()=>{
        for(const stage of exportStages)exportStep(stage,()=>{
          if(stage===failedStage)throw new Error('PASSWORD JWT SECRET private.sql');
          return 'private SQL';
        },event=>events.push(event));
      }).toThrow();
      expect(events.filter(e=>e.status==='failed')).toEqual([{stage:failedStage,status:'failed'}]);
      expect(events).toHaveLength(2*(exportStages.indexOf(failedStage)+1));
      expect(JSON.stringify(events)).not.toMatch(/PASSWORD|JWT|SECRET|private|SQL/);
    }
    expect(safeExportResult('SECRET','PASSWORD')).toEqual({stage:'unknown',status:'unverified'});
    expect(()=>exportStep('SECRET',()=>0,()=>{throw new Error('must not emit');})).toThrow('synthetic-export-stage-rejected');
  });
  it('reports fallback not needed only for an explicitly verified cleanup of that stage',()=>{
    const cleaned=new Set<string>();
    expect(fallbackRequired('source',cleaned)).toBe(true);
    cleaned.add('source');
    expect(fallbackRequired('source',cleaned)).toBe(false);
    expect(fallbackRequired('target',cleaned)).toBe(true);
  });
});
it.skipIf(process.env.SYNTHETIC_BACKUP_INTEGRATION!=='1')('restores all required synthetic cases on an isolated GitHub Runner',()=>{
  const result=spawnSync(process.execPath,['tests/rls-runtime/run-synthetic-backup-recovery.mjs','--run'],{encoding:'utf8',timeout:48*60_000,maxBuffer:1024*1024});
  // Runner prints fixed enums/counts only; do not include subprocess output in failures.
  expect(!result.error && !result.signal && result.status===0).toBe(true);
  for(const name of caseNames)expect(result.stdout.includes(`backup_case=${name} status=verified`)).toBe(true);
  expect(result.stdout.includes(`backup_total=${caseNames.length} verified=${caseNames.length} incomplete=0 skipped=0`)).toBe(true);
  expect(result.stdout.includes('backup_acceptance=verified')).toBe(true);
},49*60_000);


// Pure contracts; no Docker or database reachability is claimed.
const netDiag = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs', import.meta.url).href) as {
  safeNetworkResult:(path:unknown,status:unknown)=>{path:string;status:string};
  socketFailure:(code:unknown)=>string;
  loopbackProbe:(port:number,connect:(options:unknown)=>unknown,deadline?:number)=>Promise<string>;
  parseNetworkProbeOutput:(output:string)=>unknown[];
  recordNetworkProbe:(manifest:unknown,stage:unknown,container:unknown,image:string)=>{created:{containers:string[]}};
  networkProbeScript:string;
};
describe('bounded synthetic TCP diagnostic contracts',()=>{
  it.each(['success','refused','timeout','name-resolution-failed','unknown'])('parses complete fixed result %s',status=>{
    expect(netDiag.parseNetworkProbeOutput(`tool-host-gateway=${status}\ntool-project-internal=success\n`)).toHaveLength(2);
  });
  it.each(['secret','tool-project-internal=success\ntool-host-gateway=success',
    'tool-host-gateway=success\ntool-project-internal=success\nsecret',
    'tool-host-gateway=success=secret\ntool-project-internal=success','x'.repeat(256)])('rejects unsafe output',value=>{
    expect(()=>netDiag.parseNetworkProbeOutput(value)).toThrow();
    expect(netDiag.safeNetworkResult(value,value)).toEqual({path:'unknown',status:'unverified'});
  });
  it.each([['ECONNREFUSED','refused'],['ETIMEDOUT','timeout'],['ENOTFOUND','name-resolution-failed'],['secret','unknown']])('normalizes %s',(code,status)=>{
    expect(netDiag.socketFailure(code)).toBe(status);
  });
  it.each(['connect','error','close','timeout','throw'])('bounded socket %s',async event=>{
    const socket=Object.assign(new EventEmitter(),{destroyed:false,destroy(){this.destroyed=true;}});
    const result=netDiag.loopbackProbe(54322,options=>{
      expect(options).toEqual({host:'127.0.0.1',port:54322});
      if(event==='throw')throw new Error('secret');
      if(event!=='timeout')void Promise.resolve().then(()=>socket.emit(event,{code:'ECONNREFUSED'}));
      return socket;
    },10);
    expect(await result).toBe(({connect:'success',error:'refused',close:'unknown',timeout:'timeout',throw:'unknown'} as Record<string,string>)[event]);
    if(event!=='throw')expect(socket.destroyed).toBe(true);
  });
  const owned = ()=>{
    const id='a'.repeat(64),projectId='pr1-123456-123456789abc',image=`sha256:${'b'.repeat(64)}`;
    const stage={projectId,stagedRoot:'/tmp/synthetic',ports:{db:54322},dockerNetworkId:'c'.repeat(64),
      preexistingResources:{containers:new Set(['original']),networks:new Set(),volumes:new Set()}};
    const manifest={projectId,stageRoot:stage.stagedRoot,ports:stage.ports,
      preexisting:{containers:['original'],networks:[],volumes:[]},created:{containers:[],networks:[],volumes:[]}};
    const container={Id:id,Name:`/supabase_backup_probe_${projectId}`,Image:image,
      Config:{Labels:{'com.docker.compose.project':projectId,'synthetic-backup-role':'tcp-probe'}},
      HostConfig:{NetworkMode:stage.dockerNetworkId,ExtraHosts:['host.docker.internal:host-gateway'],Privileged:false,
        ReadonlyRootfs:true,PublishAllPorts:false,PortBindings:{}},Mounts:[]};
    return {stage,manifest,container,image,id};
  };
  it('records exact probe without discarding cleanup evidence',()=>{
    const f=owned();const result=netDiag.recordNetworkProbe(f.manifest,f.stage,f.container,f.image);
    expect(result.created.containers).toEqual([f.id]);expect(f.manifest.created.containers).toEqual([]);
    expect(netDiag.recordNetworkProbe(result,f.stage,f.container,f.image).created.containers).toEqual([f.id]);
  });
  it.each(['project','image','network','preexisting','manifest','published','privileged','mount'])('rejects unsafe %s',kind=>{
    const f=owned();
    if(kind==='project')f.container.Config.Labels['com.docker.compose.project']='other';
    if(kind==='image')f.container.Image=`sha256:${'d'.repeat(64)}`;
    if(kind==='network')f.container.HostConfig.NetworkMode='host';
    if(kind==='preexisting'){f.manifest.preexisting.containers.push(f.id);f.stage.preexistingResources.containers.add(f.id);}
    if(kind==='manifest')f.manifest.projectId='other';
    if(kind==='published')f.container.HostConfig.PublishAllPorts=true;
    if(kind==='privileged')f.container.HostConfig.Privileged=true;
    if(kind==='mount')(f.container.Mounts as unknown[]).push({Type:'bind'});
    expect(()=>netDiag.recordNetworkProbe(f.manifest,f.stage,f.container,f.image)).toThrow();
  });
  it('uses bounded bash and no SQL or retry loop',()=>{
    expect(spawnSync('bash',['-n'],{input:netDiag.networkProbeScript,encoding:'utf8'}).status).toBe(0);
    expect(netDiag.networkProbeScript).toContain('timeout -s KILL 5');
    expect(netDiag.networkProbeScript).not.toMatch(/PGPASSWORD|psql|pg_dump|while|until/);
    expect(netDiag.networkProbeScript.match(/^probe tool-/gm)).toHaveLength(2);
  });
});


// Execute the production shell program with a synthetic timeout executable.
// It models BusyBox's short-option contract and never opens a network connection.
describe('network probe executable compatibility and failure isolation',()=>{
  function execute(mode:string,script=netDiag.networkProbeScript){
    const root=mkdtempSync(join(tmpdir(),'synthetic-probe-shell-'));
    const trace=join(root,'trace');
    try{
      writeFileSync(join(root,'timeout'),`#!/bin/sh
if [ "$1" != '-s' ] || [ "$2" != 'KILL' ]; then exit 1; fi
printf '%s\\n' "$3" >> "$TRACE_FILE"
if [ "$PROBE_MODE" = 'preflight-failed' ]; then exit 1; fi
if [ "$3" = '1' ]; then exit 0; fi
case "$PROBE_MODE" in
  success) exit 0 ;;
  refused) printf '%s' 'synthetic-secret: Connection refused' >&2; exit 1 ;;
  timeout) exit 137 ;;
  dns) printf '%s' 'synthetic-secret: Name or service not known' >&2; exit 1 ;;
  missing) exit 127 ;;
  cannot-execute) exit 126 ;;
  timeout-failed) exit 125 ;;
  unsupported) printf '%s' '/dev/tcp/synthetic-secret/1: No such file or directory' >&2; exit 1 ;;
  *) printf '%s' 'synthetic-secret arbitrary error' >&2; exit 2 ;;
esac
`,{mode:0o700});
      const result=spawnSync('/bin/bash',['-c',script,'--','54322','synthetic-db'],{
        encoding:'utf8',timeout:2000,maxBuffer:4096,
        env:{PATH:`${root}:/usr/bin:/bin`,PROBE_MODE:mode,TRACE_FILE:trace},
      });
      expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
      expect(result.stdout+result.stderr).not.toContain('synthetic-secret');
      expect(result.stderr).toBe('');
      const calls=existsSync(trace)?readFileSync(trace,'utf8').trim().split('\n'):[];
      return {results:netDiag.parseNetworkProbeOutput(result.stdout),calls};
    }finally{rmSync(root,{recursive:true,force:true});}
  }
  it.each([
    ['success','success'],['refused','refused'],['timeout','timeout'],['dns','name-resolution-failed'],
    ['missing','command-unavailable'],['cannot-execute','command-unavailable'],
    ['timeout-failed','command-failed'],['unsupported','unsupported-probe'],['other','unknown'],
  ])('classifies %s without raw output or retries',(mode,status)=>{
    const r=execute(mode);
    expect(r.results).toEqual([{path:'tool-host-gateway',status},{path:'tool-project-internal',status}]);
    expect(r.calls).toEqual(['1','5','5']);
  });
  it('preflight failure reports command failure and makes no TCP attempt',()=>{
    const r=execute('preflight-failed');
    expect(r.results).toEqual([{path:'tool-host-gateway',status:'command-failed'},{path:'tool-project-internal',status:'command-failed'}]);
    expect(r.calls).toEqual(['1']);
  });
  it('rejects GNU-only timeout flags in the BusyBox contract',()=>{
    const r=execute('success',netDiag.networkProbeScript.replaceAll('-s KILL','--signal=KILL'));
    expect(r.results).toEqual([{path:'tool-host-gateway',status:'command-failed'},{path:'tool-project-internal',status:'command-failed'}]);
    expect(r.calls).toEqual([]);
  });
  it('missing command is not treated as a DNS or TCP failure',()=>{
    const root=mkdtempSync(join(tmpdir(),'synthetic-probe-missing-'));
    try{
      const r=spawnSync('/bin/bash',['-c',netDiag.networkProbeScript,'--','54322','synthetic-db'],{
        encoding:'utf8',timeout:2000,env:{PATH:root},
      });
      expect(r.status).toBe(0);expect(r.stderr).toBe('');
      expect(netDiag.parseNetworkProbeOutput(r.stdout)).toEqual([
        {path:'tool-host-gateway',status:'command-unavailable'},{path:'tool-project-internal',status:'command-unavailable'},
      ]);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});

const dumpTransport = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs', import.meta.url).href) as {
  ownedDumpConnection:(stage:unknown,manifest:unknown,db:unknown,network:unknown,image:unknown)=>{url:string;password:string};
  runOwnedDump:(stage:unknown,args:string[],execute:(command:string,args:string[],options?:{env?:Record<string,string>;timeout?:number})=>string)=>string;
};
function dumpFixture(root:string){
  const projectId='pr1-123456-123456789abc',id='a'.repeat(64),networkId='c'.repeat(64),imageId=`sha256:${'b'.repeat(64)}`;
  const name=`supabase_db_${projectId}`;
  const stage={projectId,stagedRoot:root,migrationManifest:[],dbContainer:name,authContainer:`supabase_auth_${projectId}`,
    apiUrl:'http://127.0.0.1:54321',dbUrl:'postgresql://postgres:synthetic%3Apassword@127.0.0.1:54322/postgres',
    ports:{api:54321,db:54322},dockerNetworkId:networkId,preexistingResources:{containers:new Set<string>(),networks:new Set<string>(),volumes:new Set<string>()}};
  const manifest={projectId,stageRoot:root,ports:stage.ports,preexisting:{containers:[] as string[],networks:[] as string[],volumes:[]},created:{containers:[id],networks:[networkId],volumes:[]}};
  const db={Id:id,Name:`/${name}`,Image:imageId,State:{Running:true},Config:{Labels:{'com.docker.compose.project':projectId}},HostConfig:{Privileged:false,NetworkMode:networkId},
    NetworkSettings:{Networks:{isolated:{NetworkID:networkId}},Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'54322'}]}}};
  const network={Id:networkId,Driver:'bridge',Labels:{'com.docker.compose.project':projectId},Options:{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'},Containers:{[id]:{Name:name}}};
  const image={Id:imageId,RepoDigests:['ghcr.io/supabase/postgres@sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53']};
  return {stage,manifest,db,network,image};
}
describe('ownership-bound CLI dump transport (no Docker)',()=>{
  const root=join(tmpdir(),'pr1-supabase-123456-123456789abc-Ab12Cd');
  const connection=(f:ReturnType<typeof dumpFixture>)=>dumpTransport.ownedDumpConnection(f.stage,f.manifest,f.db,f.network,f.image);
  it('selects inspected project container name and internal port without credentials in argv',()=>{
    const f=dumpFixture(root),c=connection(f),url=new URL(c.url);
    expect(url.hostname).toBe(f.db.Name.slice(1));expect(url.port).toBe('5432');
    expect(url.username).toBe('postgres');expect(url.password).toBe('');expect(c.password).toBe('synthetic:password');
  });
  it.each(['foreign-project','wrong-name','preexisting-db','preexisting-network','unrecorded-db','unrecorded-network',
    'network-label','network-member','wrong-network','host-network','public-port','stopped','privileged','image','digest','metadata',
    'production-url','wrong-port','wrong-user','url-options','empty-password','application-migrations'])('rejects %s before dump',kind=>{
    const f=dumpFixture(root);
    if(kind==='foreign-project')f.db.Config.Labels['com.docker.compose.project']='other';
    if(kind==='wrong-name')f.db.Name='/other';
    if(kind==='preexisting-db'){f.stage.preexistingResources.containers.add(f.db.Id);f.manifest.preexisting.containers.push(f.db.Id);}
    if(kind==='preexisting-network'){f.stage.preexistingResources.networks.add(f.network.Id);f.manifest.preexisting.networks.push(f.network.Id);}
    if(kind==='unrecorded-db')f.manifest.created.containers=[];
    if(kind==='unrecorded-network')f.manifest.created.networks=[];
    if(kind==='network-label')f.network.Labels['com.docker.compose.project']='other';
    if(kind==='network-member')f.network.Containers[f.db.Id].Name='other';
    if(kind==='wrong-network')f.db.NetworkSettings.Networks.isolated.NetworkID='d'.repeat(64);
    if(kind==='host-network')f.db.HostConfig.NetworkMode='host';
    if(kind==='public-port')f.db.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0';
    if(kind==='stopped')f.db.State.Running=false;
    if(kind==='privileged')f.db.HostConfig.Privileged=true;
    if(kind==='image')f.db.Image=`sha256:${'d'.repeat(64)}`;
    if(kind==='digest')f.image.RepoDigests=[];
    if(kind==='metadata')f.manifest.projectId='other';
    if(kind==='production-url')f.stage.dbUrl=f.stage.dbUrl.replace('127.0.0.1','production.invalid');
    if(kind==='wrong-port')f.stage.dbUrl=f.stage.dbUrl.replace('54322','54323');
    if(kind==='wrong-user')f.stage.dbUrl=f.stage.dbUrl.replace('postgres:','other:');
    if(kind==='url-options')f.stage.dbUrl+='?host=production.invalid';
    if(kind==='empty-password')f.stage.dbUrl=f.stage.dbUrl.replace('synthetic%3Apassword','');
    if(kind==='application-migrations')(f.stage.migrationManifest as string[]).push('application.sql');
    expect(()=>connection(f)).toThrow('synthetic-dump-target-rejected');
  });
  it('runs the original CLI with a private password env and reinspects before every export',()=>{
    const dir=mkdtempSync(join(tmpdir(),'pr1-supabase-123456-123456789abc-')),f=dumpFixture(dir);
    try{
      writeFileSync(join(dir,'ownership.json'),JSON.stringify(f.manifest),{mode:0o600});
      const calls:{command:string;args:string[];options?:{env?:Record<string,string>;timeout?:number}}[]=[];
      const execute=(command:string,args:string[],options?:{env?:Record<string,string>;timeout?:number})=>{
        calls.push({command,args,options});
        if(command==='docker')return JSON.stringify([args[0]==='network'?f.network:args[0]==='image'?f.image:f.db]);
        return '';
      };
      const args=['db','dump','--local','--role-only','-f',join(dir,'roles.sql')];
      dumpTransport.runOwnedDump(f.stage,args,execute);
      expect(calls.map(c=>c.command)).toEqual(['docker','docker','docker','supabase']);
      const last=calls[3];
      expect(last.args).toEqual(['--workdir',dir,'--network-id',f.network.Id,'db','dump','--db-url',connection(f).url,'--role-only','-f',join(dir,'roles.sql')]);
      expect(last.args.join(' ')).not.toContain('synthetic:password');expect(last.options?.env?.PGPASSWORD).toBe('synthetic:password');
      expect(Object.keys(last.options?.env??{}).filter(k=>k.startsWith('PG'))).toEqual(['PGPASSWORD']);
      f.db.Config.Labels['com.docker.compose.project']='other';
      expect(()=>dumpTransport.runOwnedDump(f.stage,args,execute)).toThrow('synthetic-dump-command-failed');
      expect(calls.filter(c=>c.command==='supabase')).toHaveLength(1);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it.each(['cli','inspect','missing-manifest','symlink-manifest','extra-argument'])('keeps roles failure classification and suppresses raw %s errors',mode=>{
    const dir=mkdtempSync(join(tmpdir(),'pr1-supabase-123456-123456789abc-')),f=dumpFixture(dir),statuses:string[]=[];
    try{
      const path=join(dir,'ownership.json');
      if(mode==='symlink-manifest'){writeFileSync(join(dir,'other'),JSON.stringify(f.manifest));symlinkSync(join(dir,'other'),path);}
      else if(mode!=='missing-manifest')writeFileSync(path,JSON.stringify(f.manifest));
      let cliCalls=0;
      const execute=(cmd:string,args:string[])=>{
        if(cmd==='docker'){
          if(mode==='inspect')throw new Error('synthetic-secret stderr');
          return JSON.stringify([args[0]==='network'?f.network:args[0]==='image'?f.image:f.db]);
        }
        cliCalls++;throw new Error('synthetic-secret SQL and credentials');
      };
      expect(()=>dumpRoles(f.stage,args=>dumpTransport.runOwnedDump(f.stage,mode==='extra-argument'?[...args,'--linked']:args,execute),s=>statuses.push(s))).toThrow('synthetic-dump-command-failed');
      expect(statuses).toEqual(['unverified','cli-command-failed']);expect(cliCalls).toBe(mode==='cli'?1:0);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});

const restoreDiag = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs', import.meta.url).href) as {
  restoreStages:readonly string[];
  classifyRestoreSqlState:(input:unknown)=>string;
  safeRestoreErrorCategory:(input:unknown)=>string;
  safeRestoreResult:(stage:unknown,status:unknown)=>{stage:string;status:string};
  restoreInTransaction:(stage:unknown,manifest:unknown,files:Map<string,Buffer>,execute:(cmd:string,args:string[],options:{input:string;stdio:string[];timeout:number;maxBuffer:number})=>unknown,report:(r:{stage:string;status:string})=>void,reportError?:(category:string)=>void,reportRole?:(value:unknown)=>void,reportInput?:(value:{step:string;status:string;reason:string})=>void)=>void;
};
describe('single-transaction restore execution diagnostics (synthetic subprocess)',()=>{
  const stage={projectId:'pr1-123-123456789abc',dbContainer:'supabase_db_pr1-123-123456789abc',authContainer:'supabase_auth_pr1-123-123456789abc',apiUrl:'http://127.0.0.1:54321',ports:{api:54321}};
  const markerLines=(input:string)=>input.split('\n').filter(s=>s.startsWith('\\echo backup_restore_')).map(s=>s.slice(6));
  const transcript=(input:string)=>input.split('\n').flatMap(line=>{
    if(line.startsWith('\\echo backup_'))return [line.slice(6)];
    const probe=/^SELECT '(backup_role_[a-f0-9]{32}:[0-9]+:before:)'/.exec(line);
    return probe?[probe[1]+'t:f:'+(line.includes("|| 'u' FROM")?'u':'f')]:[];
  });
  const throughStage=(input:string,index:number)=>{const all=transcript(input);const end=all.indexOf(markerLines(input)[index]);return all.slice(0,end+1);};
  const sample=()=>{const f=fixtures();for(const name of ['roles.sql','schema.sql','auth-data.sql','data.sql'])f.set(name,Buffer.from(`-- synthetic-secret ${name}\nSELECT 1;\n`));f.set('roles.sql',Buffer.from('-- synthetic-secret roles.sql\nCREATE ROLE "synthetic_backup_reader";\n'));return f;};
  it('uses one psql call with original SQL bytes/order and exactly one BEGIN/COMMIT',()=>{
    const files=sample(),events:{stage:string;status:string}[]=[];let calls=0;
    restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(cmd,args,o)=>{
      calls++;expect(cmd).toBe('docker');expect(args).toEqual(['exec','-i',stage.dbContainer,'psql','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-U','postgres','-d','postgres']);
      expect(o.stdio).toEqual(['pipe','pipe','pipe']);expect(o.timeout).toBe(60000);expect(o.maxBuffer).toBe(65536);
      const sql=o.input.replace(/^SELECT 'backup_role_[a-f0-9]{32}:.*\n/gm,'')
        .replace(/\n\\echo backup_role_[a-f0-9]{32}:\d+:end\n/g,'')
        .split('\n').filter(s=>!s.startsWith('\\echo ')).join('\n');
      expect(sql).toBe(`BEGIN;\n${files.get('roles.sql')}\n${files.get('schema.sql')}\nSET LOCAL session_replication_role=replica;\n${files.get('auth-data.sql')}\n${files.get('data.sql')}\nCOMMIT;\n`);
      expect(markerLines(o.input)).toHaveLength(10);
      return {status:0,signal:null,stdout:transcript(o.input).join('\n'),get stderr(){throw new Error('stderr must never be read');}};
    },r=>events.push(r));
    expect(calls).toBe(1);expect(events.filter(r=>r.status==='success').map(r=>r.stage)).toEqual(restoreDiag.restoreStages);
    expect(JSON.stringify(events)).not.toMatch(/synthetic-secret|SELECT|postgres|backup_restore_/);
  });
  it.each(['restore-roles','restore-schema','restore-auth-data','restore-app-data','restore-commit'])('identifies actual entered %s plus script exit 3',name=>{
    const files=sample(),events:{stage:string;status:string}[]=[];
    const index=restoreDiag.restoreStages.indexOf(name)-1;
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,_a,o)=>({status:3,signal:null,
      stdout:throughStage(o.input,index*2).join('\n'),stderr:'ERROR: 42501\n'}),r=>events.push(r))).toThrow('synthetic-restore-process-failed');
    expect(events.filter(r=>r.status==='failed')).toEqual([{stage:name,status:'failed'}]);
    expect(events.filter(r=>r.status==='success').map(r=>r.stage)).toEqual(restoreDiag.restoreStages.slice(0,index+1));
    expect(events).not.toContainEqual({stage:'restore-commit',status:'success'});
  });
  it.each(['timeout','connection','launch','throw','zero-with-partial-markers','no-markers','failure-after-end'])('keeps %s unknown instead of guessing an SQL failure',mode=>{
    const files=sample(),events:{stage:string;status:string}[]=[];
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,_a,o)=>{
      if(mode==='throw')throw new Error('synthetic-secret');
      return {status:mode==='zero-with-partial-markers'?0:mode==='connection'?2:mode==='no-markers'||mode==='failure-after-end'?3:null,
        signal:mode==='timeout'?'SIGKILL':null,error:mode==='launch'?new Error('synthetic-secret'):undefined,
        stdout:mode==='no-markers'?'':throughStage(o.input,mode==='failure-after-end'?1:0).join('\n')};
    },r=>events.push(r))).toThrow('synthetic-restore-process-failed');
    expect(events.filter(r=>r.status==='failed')).toEqual([{stage:'unknown',status:'failed'}]);
    expect(JSON.stringify(events)).not.toContain('synthetic-secret');
  });
  it.each(['duplicate','out-of-order','unknown-stage','truncated-marker','oversize','non-string'])('fails closed for %s output',mode=>{
    const files=sample(),events:{stage:string;status:string}[]=[];
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,_a,o)=>{
      const m=markerLines(o.input);
      const stdout=mode==='duplicate'?[m[0],m[0]].join('\n'):mode==='out-of-order'?m.reverse().join('\n'):
        mode==='unknown-stage'?m[0].replace('restore-roles','synthetic-secret'):mode==='truncated-marker'?m[0].slice(0,-1):mode==='oversize'?'x'.repeat(65537):null;
      return {status:0,stdout};
    },r=>events.push(r))).toThrow('synthetic-restore-markers-rejected');
    expect(events.filter(r=>r.status==='failed')).toEqual([{stage:'unknown',status:'failed'}]);
  });
  it('does not accept markers from another invocation or reflect arbitrary data',()=>{
    const files=sample(),events:{stage:string;status:string}[]=[];
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,()=>({status:0,stdout:'backup_restore_foreign:restore-roles:end\nsynthetic-secret JWT SQL path'}),r=>events.push(r))).toThrow();
    expect(events.filter(r=>r.status==='failed')).toEqual([{stage:'unknown',status:'failed'}]);
    expect(JSON.stringify(events)).not.toMatch(/JWT|SQL|path|synthetic-secret|foreign/);
    expect(restoreDiag.safeRestoreResult('synthetic-secret','JWT')).toEqual({stage:'unknown',status:'unverified'});
  });
  it('input validation failure invokes no Docker and never adds the migration ledger to restore',()=>{
    const files=sample(),manifest=makeManifest(files),events:{stage:string;status:string}[]=[];let calls=0;
    files.set('roles.sql',Buffer.from('changed'));
    expect(()=>restoreDiag.restoreInTransaction(stage,manifest,files,()=>{calls++;return {};},r=>events.push(r))).toThrow('synthetic-restore-input-rejected');
    expect(calls).toBe(0);expect(events.filter(r=>r.status==='failed')).toEqual([{stage:'restore-input-validation',status:'failed'}]);
    const valid=sample();restoreDiag.restoreInTransaction(stage,makeManifest(valid),valid,(_c,_a,o)=>{
      expect(o.input).not.toContain(valid.get('history-data.sql')!.toString());
      expect(o.input).not.toContain(valid.get('history-schema.sql')!.toString());
      return {status:0,stdout:transcript(o.input).join('\n')};
    },()=>{});
  });
  it('late transport failure cannot confirm commit even with a complete marker transcript',()=>{
    const files=sample(),events:{stage:string;status:string}[]=[];
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,_a,o)=>({status:2,stdout:transcript(o.input).join('\n')}),r=>events.push(r))).toThrow();
    expect(events).not.toContainEqual({stage:'restore-commit',status:'success'});
    expect(events.filter(r=>r.status==='failed')).toEqual([{stage:'unknown',status:'failed'}]);
  });
});


describe('restore SQLSTATE whitelist (synthetic input; no database)',()=>{
  const codes=[['42501','insufficient-privilege'],['42710','duplicate-object'],['42704','undefined-object'],
    ['42601','syntax-error'],['25001','transaction-restriction'],['0A000','unsupported-feature'],
    ['55P03','lock-unavailable'],['57014','query-canceled']];
  it.each(codes)('maps only exact %s diagnostics to %s',(code,category)=>{
    for(const ending of ['', '\n','\r\n'])expect(restoreDiag.classifyRestoreSqlState(`ERROR:  ${code}${ending}`)).toBe(category);
  });
  it.each([null,undefined,{},'', 'ERROR: ZZ999', 'ERROR: 42501 simulated-secret',
    'ERROR: 42710\nERROR: 42501', 'NOTICE: 42710', 'ERROR: 42501\nNOTICE: simulated-secret',
    'ERROR: 00000', 'ERROR: 0a000',' ERROR: 42501','ERROR: 42501\n\n', 'x'.repeat(4097)])('rejects malformed or mixed input #%#',input=>{
    expect(restoreDiag.classifyRestoreSqlState(input)).toBe('unknown');
    expect(restoreDiag.safeRestoreErrorCategory(input)).toBe('unknown');
  });
  it.each(['valid','mixed','timeout','no-code','launch','out-of-order'])('binds error classification to entered stage and controlled exit: %s',mode=>{
    const files=fixtures(),events:{stage:string;status:string}[]=[],errors:string[]=[];files.set('roles.sql',Buffer.from('CREATE ROLE synthetic_backup_reader;\n'));
    const stage={projectId:'pr1-123-123456789abc',dbContainer:'supabase_db_pr1-123-123456789abc',authContainer:'supabase_auth_pr1-123-123456789abc',apiUrl:'http://127.0.0.1:54321',ports:{api:54321}};
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,args,o)=>{
      expect(args).toContain('VERBOSITY=sqlstate');expect(args).toContain('ON_ERROR_STOP=1');
      const markers=o.input.split('\n').filter(x=>x.startsWith('\\echo backup_restore_')).map(x=>x.slice(6));
      return {status:mode==='timeout'||mode==='launch'?null:3,signal:mode==='timeout'?'SIGKILL':null,
        error:mode==='launch'?new Error('synthetic-secret'):undefined,
        stdout:mode==='out-of-order'?markers[1]:markers[0],
        stderr:mode==='no-code'?'':mode==='mixed'?'ERROR: 42501\nsynthetic-secret':'ERROR: 42501\n'};
    },r=>events.push(r),c=>errors.push(c))).toThrow();
    expect(errors.at(-1)).toBe(mode==='valid'?'insufficient-privilege':'unknown');
    expect(JSON.stringify({events,errors})).not.toMatch(/synthetic-secret|ERROR:|42501/);
  });
});

const roleDiag = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs',import.meta.url).href) as {
  parseRoleOperations:(bytes:Buffer)=>{kind:string;target:string|null;index:number;sql:string}[];
  safeRoleFailure:(value?:unknown)=>{operation:string;index:number|string;createrole:boolean|string;superuser:boolean|string;targetExists:boolean|string;adminOption:string};
};
describe('bounded role-operation lexer and grammar (synthetic; no PostgreSQL)',()=>{
  it.each([
    ['CREATE ROLE "synthetic_backup_reader";','create-role'],
    ['create\n role synthetic_backup_reader;','create-role'],
    ['ALTER ROLE "synthetic_backup_reader" WITH INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOBYPASSRLS;','alter-role'],
    ['ALTER ROLE "synthetic_backup_reader" WITH CONNECTION LIMIT -1 VALID UNTIL \'infinity\';','alter-role'],
    ['ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';','role-configuration'],
    ['ALTER ROLE "authenticator" SET "pgrst.db_schemas" TO \'public, storage\';','role-configuration'],
    ['ALTER ROLE "synthetic_backup_reader" RESET "statement_timeout";','role-configuration'],
    ['GRANT "synthetic_backup_reader" TO "postgres" WITH ADMIN OPTION GRANTED BY "postgres";','grant-membership'],
    ['GRANT "synthetic_backup_reader" TO "postgres" WITH ADMIN TRUE, INHERIT FALSE, SET TRUE;','grant-membership'],
    ['GRANT first, second TO third, fourth;','grant-membership'],
    ['REVOKE ADMIN OPTION FOR first FROM second GRANTED BY third CASCADE;','revoke-membership'],
    ['REVOKE first FROM second RESTRICT;','revoke-membership'],
    ["SET client_encoding = 'UTF8';",'session-setting'],
    ['SET standard_conforming_strings = on;','session-setting'],
    ['SET default_transaction_read_only = off;','session-setting'],
    ['RESET ALL;','session-setting'],
  ])('classifies supported operation #%#', (sql,kind)=>{
    const parsed=roleDiag.parseRoleOperations(Buffer.from(sql));
    expect(parsed).toHaveLength(1);expect(parsed[0]).toMatchObject({kind,index:1,sql});
  });
  it('preserves all bytes and order across quotes, doubled quotes, line and nested comments',()=>{
    const sql='-- ignored ; \\! secret\n/* outer ; /* inner */ */\nCREATE ROLE "a;""b";\n'+
      'ALTER ROLE "a;""b" SET "statement_timeout" TO \'a;\'\'b\'; -- tail ;\n';
    const parsed=roleDiag.parseRoleOperations(Buffer.from(sql));
    expect(parsed.map(x=>x.sql).join('')).toBe(sql);expect(parsed.map(x=>x.index)).toEqual([1,2]);
    expect(parsed.map(x=>x.target)).toEqual(['a;"b','a;"b']);
  });
  it.each([
    '', 'CREATE ROLE a', 'CREATE ROLE a;;', 'CREATE ROLE "a;', "ALTER ROLE a SET x TO 'unterminated;",
    '/* unterminated', '/* /* */', 'CREATE ROLE a; SELECT secret;',
    "ALTER ROLE a SET x TO $$secret; CREATE ROLE bad;$$;",
    "DO $body$ BEGIN RAISE NOTICE 'secret'; END $body$;",
    "ALTER ROLE a SET x TO E'secret\\n';", 'CREATE ROLE U&"secret";',
    'CREATE ROLE :variable;', '\\i /sensitive/path\n', '\\gexec\n', '\\restrict nonce\n', '\\unrestrict nonce\n',
    'CREATE ROLE a; \\! secret\n', "CREATE ROLE a; SET standard_conforming_strings=off;",
    'SET ROLE postgres;', 'SET SESSION AUTHORIZATION postgres;', 'BEGIN;', 'COMMIT;', 'ROLLBACK;',
    'ALTER ROLE current_user WITH LOGIN;', 'ALTER ROLE a WITH PASSWORD \'secret\';',
    'GRANT SELECT ON table_name TO a;', 'CREATE ROLE "a\\b";', 'CREATE ROLE "a\nb";',
    'CREATE ROLE a;\0', 'CREATE ROLE a;\r\n', 'CREATE ROLE '+ 'a'.repeat(64)+';',
    'CREATE ROLE a;'.repeat(129), ' '.repeat(128*1024+1),
    'ALTER ROLE a SET x "=" \'3s\';', 'GRANT a "," b TO c;',
  ])('rejects unsupported or ambiguous format #%# before execution',sql=>{
    expect(()=>roleDiag.parseRoleOperations(Buffer.from(sql))).toThrow('synthetic-role-input-rejected');
  });
  it('rejects invalid UTF8, excessive nesting and token counts without reflecting input',()=>{
    for(const input of [Buffer.from([0xff]),Buffer.from('/*'.repeat(33)),Buffer.from('ALTER ROLE a WITH '+'LOGIN '.repeat(513)+';')]){
      expect(()=>roleDiag.parseRoleOperations(input)).toThrow('synthetic-role-input-rejected');
    }
  });
  it('sanitizes IPC independently and never infers membership permission',()=>{
    expect(roleDiag.safeRoleFailure({operation:'secret',index:129,createrole:'JWT',superuser:1,targetExists:null,adminOption:true})).toEqual({operation:'unknown',index:'unverified',createrole:'unverified',superuser:'unverified',targetExists:'unverified',adminOption:'unverified'});
    expect(roleDiag.safeRoleFailure({operation:'grant-membership',index:1,createrole:true,superuser:false,targetExists:true,adminOption:true}).adminOption).toBe('unverified');
  });
});

describe('first failing role operation and permission observations (mock psql)',()=>{
  const stage={projectId:'pr1-123-123456789abc',dbContainer:'supabase_db_pr1-123-123456789abc',authContainer:'supabase_auth_pr1-123-123456789abc',apiUrl:'http://127.0.0.1:54321',ports:{api:54321}};
  const roleSql='-- secret must not escape\nCREATE ROLE "synthetic_backup_reader";\nALTER ROLE "synthetic_backup_reader" WITH NOLOGIN NOBYPASSRLS;\nALTER ROLE "anon" SET "statement_timeout" TO \'3s\';\n';
  const transcript=(input:string)=>input.split('\n').flatMap(line=>{
    if(line.startsWith('\\echo backup_'))return [line.slice(6)];
    const m=/^SELECT '(backup_role_[a-f0-9]{32}:(\d+):before:)'/.exec(line);
    return m?[m[1]+`t:f:${m[2]==='1'?'f':'t'}`]:[];
  });
  it.each([1,2,3])('locates first failure at operation %i with matching observation',index=>{
    const files=fixtures();files.set('roles.sql',Buffer.from(roleSql));const observed:unknown[]=[];const errors:string[]=[];let calls=0;
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,args,o)=>{
      calls++;expect(args).toContain('ON_ERROR_STOP=1');expect(args).toContain('VERBOSITY=sqlstate');
      const all=transcript(o.input);const stop=all.findIndex(x=>x.includes(`:${index}:before:`));
      return {status:3,signal:null,stdout:all.slice(0,stop+1).join('\n'),stderr:'ERROR: 42501\n'};
    },()=>{},c=>errors.push(c),v=>observed.push(v))).toThrow('synthetic-restore-process-failed');
    expect(calls).toBe(1);expect(errors.at(-1)).toBe('insufficient-privilege');
    expect(observed).toEqual([{operation:['create-role','alter-role','role-configuration'][index-1],index,createrole:true,superuser:false,targetExists:index!==1,adminOption:'unverified'}]);
    expect(JSON.stringify(observed)).not.toMatch(/secret|synthetic_backup_reader|anon|statement_timeout|42501|backup_role_/);
  });
  it('preserves every original role byte in order and commits only once in one session',()=>{
    const files=fixtures();files.set('roles.sql',Buffer.from(roleSql));let calls=0;
    restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,_a,o)=>{
      calls++;
      const original=roleDiag.parseRoleOperations(Buffer.from(roleSql));let previous=-1;
      for(const op of original){const at=o.input.indexOf(op.sql);expect(at).toBeGreaterThan(previous);previous=at;}
      expect(o.input.match(/^BEGIN;$/gm)).toHaveLength(1);expect(o.input.match(/^COMMIT;$/gm)).toHaveLength(1);
      expect(o.input).not.toContain('SAVEPOINT');expect(o.input).not.toContain('SET ROLE');
      expect(o.input.match(/^SELECT 'backup_role_/gm)).toHaveLength(3);
      return {status:0,stdout:transcript(o.input).join('\n')};
    },()=>{});expect(calls).toBe(1);
  });
  it.each([['GRANT a TO b;','grant-membership'],['REVOKE a FROM b;','revoke-membership'],['RESET ALL;','session-setting']])('does not infer membership or nonexistent single-target evidence for %s',(sql,kind)=>{
    const files=fixtures();files.set('roles.sql',Buffer.from(sql));const observed:unknown[]=[];
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,_a,o)=>{
      const stageMarker=o.input.match(/\\echo (backup_restore_[a-f0-9]{32}:restore-roles:begin)/)![1];
      const probe=o.input.match(/SELECT '(backup_role_[a-f0-9]{32}:1:before:)'/)![1];
      expect(o.input).toContain("|| 'u' FROM pg_catalog.pg_roles");
      return {status:3,stdout:stageMarker+'\n'+probe+'f:f:u',stderr:'ERROR: 42501\n'};
    },()=>{},()=>{},x=>observed.push(x))).toThrow();
    expect(observed).toEqual([{operation:kind,index:1,createrole:false,superuser:false,targetExists:'unverified',adminOption:'unverified'}]);
  });
  it.each(['unknown-code','multiple-errors','sensitive-error','timeout','disconnect','probe-failed','reordered','duplicate','forged-index','forged-flag','stage-before-role-end'])('fails closed for %s',mode=>{
    const files=fixtures();files.set('roles.sql',Buffer.from(roleSql));const observed:unknown[]=[];const errors:string[]=[];
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_c,_a,o)=>{
      const all=transcript(o.input);let lines=all.slice(0,2);
      if(mode==='probe-failed')lines=all.slice(0,1);
      if(mode==='reordered')lines=lines.reverse();
      if(mode==='duplicate')lines.push(lines[1]);
      if(mode==='forged-index')lines[1]=lines[1].replace(':1:before:',':2:before:');
      if(mode==='forged-flag')lines[1]=lines[1].replace('t:f:f','secret:f:f');
      if(mode==='stage-before-role-end')lines.push(all.find(x=>x.includes(':restore-roles:end'))!);
      return {status:mode==='timeout'?null:mode==='disconnect'?2:3,signal:mode==='timeout'?'SIGKILL':null,
        stdout:lines.join('\n'),stderr:mode==='unknown-code'?'ERROR: ZZ999\n':mode==='multiple-errors'?'ERROR: 42501\nERROR: 42501\n':mode==='sensitive-error'?'ERROR: 42501 password JWT secret\n':'ERROR: 42501\n'};
    },()=>{},c=>errors.push(c),v=>observed.push(v))).toThrow();
    if(['unknown-code','multiple-errors','sensitive-error'].includes(mode)){
      expect(errors.at(-1)).toBe('unknown');expect(observed).toEqual([roleDiag.safeRoleFailure()]);
    }
    if(['timeout','disconnect','reordered','duplicate','forged-index','forged-flag','stage-before-role-end'].includes(mode))expect(observed).toEqual([]);
    if(mode==='probe-failed')expect(observed).toEqual([roleDiag.safeRoleFailure()]);
    expect(JSON.stringify({observed,errors})).not.toMatch(/secret|password|JWT|ZZ999|42501/);
  });
  it('rejects malformed roles before invoking Docker or changing cleanup inputs',()=>{
    const files=fixtures();files.set('roles.sql',Buffer.from('\\! secret'));let calls=0;
    expect(()=>restoreDiag.restoreInTransaction(stage,makeManifest(files),files,()=>{calls++;return {};},()=>{})).toThrow('synthetic-restore-input-rejected');
    expect(calls).toBe(0);expect(files.get('roles.sql')!.toString()).toBe('\\! secret');
  });
});


const inputDiag = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs',import.meta.url).href) as {
  safeRestoreInputDiagnostic:(step:unknown,status:unknown,reason:unknown)=>{step:string;status:string;reason:string};
  formatRestoreInputDiagnostic:(value:unknown)=>string;
};
describe('restore input rejection boundaries (synthetic; no database)',()=>{
  const stage={projectId:'pr1-123-123456789abc',dbContainer:'supabase_db_pr1-123-123456789abc',authContainer:'supabase_auth_pr1-123-123456789abc',apiUrl:'http://127.0.0.1:54321',ports:{api:54321}};
  const steps=['validate-stage','restore-inputs','parse-role-operations'];
  const reject=(input:Buffer,change?:'stage'|'manifest'|'throw')=>{
    const files=fixtures();files.set('roles.sql',Buffer.from(input));const manifest=makeManifest(files);
    const original=Buffer.from(input);const events:{step:string;status:string;reason:string}[]=[];
    const phases:{stage:string;status:string}[]=[];let calls=0;
    const target=change==='stage'?{...stage,apiUrl:'http://invalid.example.invalid/'}:change==='throw'
      ?{get projectId(){throw Object.assign(new Error('JWT synthetic-secret SQL /private/path'),{reason:'input-limit'});}}:stage;
    if(change==='manifest')files.set('schema.sql',Buffer.from('synthetic-secret corrupted'));
    expect(()=>restoreDiag.restoreInTransaction(target,manifest,files,()=>{calls++;},r=>phases.push(r),()=>{},()=>{},r=>events.push(r))).toThrow('synthetic-restore-input-rejected');
    expect(calls).toBe(0);expect(files.get('roles.sql')).toEqual(original);
    expect(phases.at(-1)).toEqual({stage:'restore-input-validation',status:'failed'});
    expect(phases.filter(x=>x.status==='success')).toEqual([]);
    expect(events.slice(0,3)).toEqual(steps.map(step=>({step,status:'unverified',reason:'unknown'})));
    expect(events.filter(x=>x.status==='failed')).toHaveLength(1);
    expect(events.map(inputDiag.formatRestoreInputDiagnostic).join('\n')).not.toMatch(/JWT|synthetic-secret|private|corrupted|SELECT|CREATE|ROLE/);
    return events;
  };
  it.each(['stage','manifest','throw'] as const)('separates %s rejection from the parser and execution',mode=>{
    const events=reject(Buffer.from('unsupported SQL synthetic-secret'),mode);
    const step=mode==='manifest'?'restore-inputs':'validate-stage';
    expect(events.at(-1)).toEqual({step,status:'failed',reason:'unknown'});
    expect(events.filter(x=>x.status==='success').map(x=>x.step)).toEqual(mode==='manifest'?['validate-stage']:[]);
  });
  it.each([
    ['session-name',Buffer.from('SET transaction_timeout = 0;'),'unsupported-session-setting'],
    ['session-value',Buffer.from('SET standard_conforming_strings = off;'),'unsupported-session-setting'],
    ['psql-restrict',Buffer.from('\\restrict syntheticKey\n'),'unsupported-psql-command'],
    ['psql-shell',Buffer.from('\\! synthetic-secret\n'),'unsupported-psql-command'],
    ['unsupported-select',Buffer.from('SELECT synthetic_secret;'),'unsupported-role-operation'],
    ['parameter-acl',Buffer.from('GRANT SET ON PARAMETER "synthetic.parameter" TO "synthetic_reader";'),'unsupported-role-operation'],
    ['list-config',Buffer.from('ALTER ROLE "synthetic_reader" SET "search_path" TO "public", "extensions";'),'unsupported-role-operation'],
    ['dollar-quote',Buffer.from('ALTER ROLE a SET x TO $$synthetic-secret$$;'),'unsupported-lexical-form'],
    ['variable',Buffer.from('CREATE ROLE :synthetic_secret;'),'unsupported-lexical-form'],
    ['quoted-newline',Buffer.from('CREATE ROLE "a\nb";'),'unsupported-lexical-form'],
    ['unterminated-quote',Buffer.from('CREATE ROLE "synthetic-secret'),'malformed-input'],
    ['unterminated-comment',Buffer.from('/* synthetic-secret'),'malformed-input'],
    ['missing-semicolon',Buffer.from('CREATE ROLE a'),'malformed-input'],
    ['invalid-utf8',Buffer.from([255]),'malformed-input'],
    ['nul',Buffer.from('CREATE ROLE a;\0'),'malformed-input'],
    ['operation-limit',Buffer.from('CREATE ROLE a;'.repeat(129)),'input-limit'],
    ['byte-limit',Buffer.alloc(128*1024+1,32),'input-limit'],
    ['token-limit',Buffer.from('ALTER ROLE a WITH '+'LOGIN '.repeat(513)+';'),'input-limit'],
    ['comment-limit',Buffer.from('/*'.repeat(33)),'input-limit'],
    ['quote-limit',Buffer.from('CREATE ROLE "'+'a'.repeat(4097)+'";'),'input-limit'],
  ])('reports fixed reason for %s without exposing input',(_name,bytes,reason)=>{
    const events=reject(bytes as Buffer);
    expect(events.filter(x=>x.status==='success').map(x=>x.step)).toEqual(steps.slice(0,2));
    expect(events.at(-1)).toEqual({step:steps[2],status:'failed',reason});
  });
  it('filters malformed IPC independently, including fake successful reasons',()=>{
    for(const value of [null,undefined,{}, {step:'JWT',status:'password',reason:'SQL'},
      {step:'parse-role-operations',status:'failed',reason:'synthetic-secret'},
      {step:'restore-inputs',status:'failed',reason:'input-limit'},
      {step:'parse-role-operations',status:'success',reason:'input-limit'}]){
      const line=inputDiag.formatRestoreInputDiagnostic(value);
      expect(line).toMatch(/^backup_restore_input=(validate-stage|restore-inputs|parse-role-operations|unknown) status=(success|failed|unverified) reason=unknown$/);
    }
  });
  // Complete synthetic CLI-output shape, derived from fixed upstream sources:
  // postgres/postgres REL_17_11 src/bin/pg_dump/pg_dumpall.c (header, dumpRoles,
  // dumpRoleMembership, footer) and supabase/cli v2.119.0
  // apps/cli/src/command-internal/pg-dump.scripts.ts + pg-dump.env.ts.
  // CLI comments/removes restrict/unrestrict and reserved-role DDL, retains safe
  // reserved-role config, and appends RESET ALL. This is NOT a live pg_dump.
  const cliFixture=[
    '-- PostgreSQL database cluster dump', '-- \\restrict SyntheticOnlyKey',
    'SET default_transaction_read_only = off;', "SET client_encoding = 'UTF8';",
    'SET standard_conforming_strings = on;',
    '-- CREATE ROLE "postgres";', '-- ALTER ROLE "postgres" WITH SUPERUSER;',
    'CREATE ROLE "synthetic_backup_reader";',
    'ALTER ROLE "synthetic_backup_reader" WITH INHERIT NOCREATEROLE NOCREATEDB NOLOGIN NOBYPASSRLS;',
    'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';',
    'ALTER ROLE "authenticator" SET "pgrst.db_schemas" TO \'public, storage\';',
    'ALTER ROLE "authenticator" SET "pgrst.db_pre_request" TO \'public.synthetic_probe\';',
    'GRANT "synthetic_backup_reader" TO "synthetic_client" WITH INHERIT TRUE, SET FALSE GRANTED BY "postgres";',
    'GRANT "synthetic_backup_reader" TO "synthetic_auditor" WITH ADMIN OPTION, INHERIT FALSE GRANTED BY "postgres";',
    '-- \\unrestrict SyntheticOnlyKey', '-- PostgreSQL database cluster dump complete',
    'RESET ALL;', '',
  ].join('\n');
  it.each([true,false])('accepts the source-derived full CLI fixture with comments=%s and preserves bytes',comments=>{
    const sql=comments?cliFixture:cliFixture.split('\n').filter(x=>!x.startsWith('--')).join('\n');
    const parsed=roleDiag.parseRoleOperations(Buffer.from(sql));
    expect(parsed).toHaveLength(11);expect(parsed.map(x=>x.sql).join('')).toBe(sql);
    expect(parsed.map(x=>x.index)).toEqual(Array.from({length:11},(_,i)=>i+1));
  });
  it('reports all three checks successful before the original one-session execution',()=>{
    const files=fixtures();files.set('roles.sql',Buffer.from(cliFixture));const events:{step:string;status:string;reason:string}[]=[];
    let calls=0;
    restoreDiag.restoreInTransaction(stage,makeManifest(files),files,(_cmd,args,o)=>{
      calls++;expect(events.filter(x=>x.status==='success').map(x=>x.step)).toEqual(steps);
      expect(args).toContain('ON_ERROR_STOP=1');expect(o.input.match(/^BEGIN;$/gm)).toHaveLength(1);
      expect(o.input.match(/^COMMIT;$/gm)).toHaveLength(1);
      let cursor=-1;for(const op of roleDiag.parseRoleOperations(Buffer.from(cliFixture))){
        const offset=o.input.indexOf(op.sql,cursor+1);expect(offset).toBeGreaterThan(cursor);cursor=offset;
      }
      const stdout=o.input.split('\n').flatMap(line=>{
        if(line.startsWith('\\echo backup_'))return [line.slice(6)];
        const m=/^SELECT '(backup_role_[a-f0-9]{32}:\d+:before:)'/.exec(line);
        return m?[m[1]+'t:f:'+(line.includes("|| 'u' FROM")?'u':'f')]:[];
      }).join('\n');return {status:0,stdout,stderr:''};
    },()=>{},()=>{},()=>{},r=>events.push(r));
    expect(calls).toBe(1);expect(events.filter(x=>x.status==='failed')).toEqual([]);
  });
});
