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
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, openSync, ftruncateSync, closeSync } from 'node:fs';
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
    expect(netDiag.networkProbeScript).toContain('timeout --signal=KILL 5');
    expect(netDiag.networkProbeScript).not.toMatch(/PGPASSWORD|psql|pg_dump|while|until/);
    expect(netDiag.networkProbeScript.match(/^probe tool-/gm)).toHaveLength(2);
  });
});
