// @vitest-environment node
// Synthetic inputs and mocked Docker only; no database equivalence is proved.
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Handle = object;
const { parameterAclQuery, collectParameterAcl, compareParameterCollections, bindParameterExport,
  summarizeParameterAcl, formatParameterAclDiagnostic } = await import(new URL('./rls-runtime/parameter-acl-observation.mjs',import.meta.url).href) as {
  parameterAclQuery:string;
  collectParameterAcl:(read:(query:string)=>unknown)=>Handle;
  compareParameterCollections:(a:Handle,b:Handle)=>string;
  bindParameterExport:(a:Handle,b:Handle,bytes:Buffer)=>Handle;
  summarizeParameterAcl:(initial:Handle,binding:Handle,target:Handle,again:Handle,bytes:Buffer)=>Record<string,string>;
  formatParameterAclDiagnostic:(field:unknown,status:unknown)=>string;
};
const { collectOwnedParameterAcl } = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs',import.meta.url).href) as {
  collectOwnedParameterAcl:(stage:unknown,execute:(command:string,args:string[],options:Record<string,unknown>)=>string)=>Handle;
};
const fixture = () => ({
  model:'pg17-parameter-acl-collection-v1',readOnly:true,version:17,actorVerified:true,
  entries:[{
    snapshot:{model:'pg17-parameter-acl-v1',complete:true,parameter:'synthetic.setting',catalogState:'explicit',
      roles:[{oid:10,logicalIdentity:'synthetic_grantor'},{oid:20,logicalIdentity:'synthetic_reader'}],
      rows:[{grantor:10,grantee:20,privilege_type:'SET',is_grantable:false}]},
    capabilities:{set:true,alterSystem:true,setGrant:true,alterSystemGrant:true},
  }],
});
type Fixture = ReturnType<typeof fixture>;
const collected = (value:unknown=fixture())=>collectParameterAcl(()=>JSON.stringify(value));
const bytes=Buffer.from('synthetic-original-export-only');
const evidence = (source:Handle,target:Handle,again=target)=>
  summarizeParameterAcl(source,bindParameterExport(source,source,bytes),target,again,bytes);

describe('parameter ACL native collection adapter (mock only)',()=>{
  it('uses one fixed read-only transaction, native expansion and separate grant-option checks',()=>{
    const read=vi.fn(()=>JSON.stringify(fixture()));collectParameterAcl(read);
    expect(read).toHaveBeenCalledOnce();expect(read.mock.calls[0]).toEqual([parameterAclQuery]);
    expect(parameterAclQuery.startsWith('\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;')).toBe(true);
    expect(parameterAclQuery.trim().endsWith('ROLLBACK;')).toBe(true);
    for(const token of ['pg_catalog.pg_parameter_acl','pg_catalog.aclexplode','pg_catalog.pg_roles',
      "'SET WITH GRANT OPTION'","'ALTER SYSTEM WITH GRANT OPTION'","statement_timeout = '5s'",'LIMIT 33','LIMIT 257'])
      expect(parameterAclQuery.includes(token)).toBe(true);
    expect(/\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\s+(?:TABLE|ROLE|ON|INTO|FROM)/i.test(parameterAclQuery)).toBe(false);
  });
  it('compares complete native-shaped records but never claims SQL requirements are verified',()=>{
    const a=collected();const result=evidence(a,collected());
    expect(result.source_collection).toBe('success');expect(result.target_collection).toBe('success');
    expect(result.source_target).toBe('equal');expect(result.source_acl_grant_capability).toBe('true');
    expect(result.export_binding).toBe('equal');expect(result.export_requirements).toBe('unverified');
    expect(JSON.stringify(a)).toBe('{}');expect(Object.isFrozen(a)).toBe(true);
  });
  it('maps native OIDs independently on each cluster',()=>{
    const f=fixture();f.entries[0].snapshot.roles[0].oid=90;f.entries[0].snapshot.roles[1].oid=80;
    f.entries[0].snapshot.rows[0].grantor=90;f.entries[0].snapshot.rows[0].grantee=80;
    expect(evidence(collected(),collected(f)).source_target).toBe('equal');
  });
  it.each([
    ['missing role', (f:Fixture)=>{f.entries[0].snapshot.roles.pop();}],
    ['NULL ACL', (f:Fixture)=>{f.entries[0].snapshot.catalogState='null';}],
    ['default ACL', (f:Fixture)=>{f.entries[0].snapshot.catalogState='default';}],
    ['duplicate record', (f:Fixture)=>{f.entries[0].snapshot.rows.push({...f.entries[0].snapshot.rows[0]});}],
    ['duplicate parameter', (f:Fixture)=>{f.entries.push(f.entries[0]);}],
    ['incomplete records', (f:Fixture)=>{f.entries[0].snapshot.complete=false;}],
    ['wrong version', (f:Fixture)=>{f.version=16;}],
    ['wrong execution identity', (f:Fixture)=>{f.actorVerified=false;}],
    ['non-read-only transaction', (f:Fixture)=>{f.readOnly=false;}],
    ['overflow catalog', (f:Fixture)=>{f.entries=Array.from({length:33},()=>f.entries[0]);}],
  ] as const)('does not accept %s',(_name,mutate)=>{
    const f=fixture();mutate(f);const bad=collected(f);
    expect(compareParameterCollections(bad,bad)).toBe('unverified');
    const result=evidence(collected(),bad);
    expect(result.source_target).toBe('unverified');expect(result.source_acl_grant_capability).toBe('unverified');
  });
  it.each([
    ()=>{throw new Error('synthetic-secret raw failure');},
    ()=>'{broken',()=>'',()=>null,()=> 'x'.repeat(2*1024*1024+1),
    ()=>JSON.stringify({...fixture(),extra:'synthetic-secret'}),
    ()=>JSON.stringify({...fixture(),entries:[{...fixture().entries[0],capabilities:{set:true}}]}),
  ])('contains collection/transport failure %# without exposing it',read=>{
    const bad=collectParameterAcl(read);
    expect(compareParameterCollections(bad,collected())).toBe('unverified');
    expect(JSON.stringify(evidence(bad,collected())).includes('synthetic-secret')).toBe(false);
  });
  it('detects grant-option differences independently from executor capability',()=>{
    const f=fixture();f.entries[0].snapshot.rows[0].is_grantable=true;
    expect(evidence(collected(),collected(f)).source_target).toBe('different');
    const same=fixture();same.entries[0].capabilities.setGrant=false;
    const result=evidence(collected(),collected(same));
    expect(result.source_target).toBe('equal');expect(result.source_acl_grant_capability).toBe('false');
  });
  it('does not let one grant option satisfy a different privilege',()=>{
    const f=fixture();f.entries[0].snapshot.rows.push({...f.entries[0].snapshot.rows[0],privilege_type:'ALTER SYSTEM'});
    const target=globalThis.structuredClone(f);target.entries[0].capabilities.alterSystemGrant=false;
    expect(evidence(collected(f),collected(target)).source_acl_grant_capability).toBe('false');
  });
  it('does not treat empty catalogs as proof of authority or dump requirements',()=>{
    const f=fixture();f.entries=[];const h=collected(f);
    expect(evidence(h,h).source_acl_grant_capability).toBe('unverified');
    expect(evidence(h,h).export_requirements).toBe('unverified');
    expect(evidence(collected(),h).source_target).toBe('different');
  });
  it('detects ACL drift while exporting without asserting equivalence',()=>{
    const before=collected();const f=fixture();f.entries[0].snapshot.rows[0].is_grantable=true;
    const result=summarizeParameterAcl(before,bindParameterExport(before,collected(f),bytes),before,before,bytes);
    expect(result.source_export_stability).toBe('different');expect(result.source_target).toBe('unverified');
  });
  it('detects target ACL and effective capability drift',()=>{
    const a=collected();
    for(const mutate of [(f:Fixture)=>{f.entries[0].snapshot.rows[0].is_grantable=true;},
      (f:Fixture)=>{f.entries[0].capabilities.setGrant=false;}]){
      const f=fixture();mutate(f);const result=evidence(a,a,collected(f));
      expect(result.target_stability).toBe('different');expect(result.source_target).toBe('unverified');
      expect(result.source_acl_grant_capability).toBe('unverified');
    }
  });
  it('binds original bytes without parsing, rewriting or trusting changed dump input',()=>{
    const a=collected();const input=Buffer.from(bytes);const binding=bindParameterExport(a,a,input);
    expect(summarizeParameterAcl(a,binding,a,a,Buffer.from(bytes)).export_binding).toBe('equal');
    input[0]^=1;
    const result=summarizeParameterAcl(a,binding,a,a,input);
    expect(result.export_binding).toBe('different');expect(result.source_target).toBe('unverified');
    expect(summarizeParameterAcl(a,bindParameterExport(a,a,Buffer.alloc(0)),a,a,bytes).export_binding).toBe('unverified');
  });
  it('allows only fixed fields and enums across the diagnostic boundary',()=>{
    expect(formatParameterAclDiagnostic('secret/path','secret')).toBe('backup_parameter_acl=unknown status=unverified');
    expect(formatParameterAclDiagnostic('__proto__','equal')).toBe('backup_parameter_acl=unknown status=unverified');
    expect(formatParameterAclDiagnostic('export_requirements','equal')).toBe('backup_parameter_acl=export_requirements status=unverified');
    for(const [field,status] of Object.entries(evidence(collected(),collected())))
      expect(formatParameterAclDiagnostic(field,status)).toMatch(/^backup_parameter_acl=[a-z_]+ status=(success|equal|different|unverified|true|false)$/);
  });
});

describe('owned-stage ACL reader (mocked Docker, no DB)',()=>{
  const setup=()=>{
    const projectId='pr1-1700000000-aabbccddeeff';
    const stagedRoot=mkdtempSync(join(tmpdir(),'pr1-supabase-1700000000-aabbccddeeff-'));
    const stage={projectId,stagedRoot,dbContainer:`supabase_db_${projectId}`,authContainer:`supabase_auth_${projectId}`,
      apiUrl:'http://127.0.0.1:54321',ports:{api:54321,db:54322},migrationManifest:[],dockerNetworkId:'b'.repeat(64),
      preexistingResources:{containers:new Set<string>(),networks:new Set<string>()}};
    const db={Id:'a'.repeat(64),Name:`/${stage.dbContainer}`,Config:{Labels:{'com.docker.compose.project':projectId}},
      State:{Running:true},HostConfig:{Privileged:false,NetworkMode:'synthetic'},
      NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'54322'}]},Networks:{synthetic:{NetworkID:stage.dockerNetworkId}}}};
    writeFileSync(join(stagedRoot,'ownership.json'),JSON.stringify({projectId,stageRoot:stagedRoot,ports:stage.ports,
      created:{containers:[db.Id],networks:[stage.dockerNetworkId]},preexisting:{containers:[],networks:[]}}),{flag:'wx',mode:0o600});
    return {stage,db};
  };
  it('executes the fixed catalog read using the reverified immutable container ID and bounded timeout',()=>{
    const {stage,db}=setup();
    const execute=vi.fn((_cmd:string,args:string[],options:Record<string,unknown>)=>{
      if(args[0]==='inspect')return JSON.stringify([db]);
      expect(args.slice(0,5)).toEqual(['exec','-i','-e','LC_ALL=C',db.Id]);
      expect(options.input).toBe(parameterAclQuery);expect(options.timeout).toBe(10000);
      expect(options.maxBuffer).toBe(2*1024*1024);return JSON.stringify(fixture());
    });
    try{expect(compareParameterCollections(collectOwnedParameterAcl(stage,execute),collected())).toBe('equal');expect(execute).toHaveBeenCalledTimes(2);}
    finally{rmSync(stage.stagedRoot,{recursive:true,force:true});}
  });
  it.each(['label','preexisting','loopback','manifest','network','preexisting-network','query-failure'])('fails closed for %s',kind=>{
    const {stage,db}=setup();
    if(kind==='label')db.Config.Labels['com.docker.compose.project']='other';
    if(kind==='preexisting')stage.preexistingResources.containers.add(db.Id);
    if(kind==='loopback')db.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0';
    if(kind==='network')db.NetworkSettings.Networks.synthetic.NetworkID='c'.repeat(64);
    if(kind==='preexisting-network')stage.preexistingResources.networks.add(stage.dockerNetworkId);
    if(kind==='manifest')rmSync(join(stage.stagedRoot,'ownership.json'));
    const execute=vi.fn((_cmd:string,args:string[])=>{
      if(args[0]==='inspect')return JSON.stringify([db]);
      throw new Error('synthetic-private-error');
    });
    try{
      const result=collectOwnedParameterAcl(stage,execute);
      expect(compareParameterCollections(result,collected())).toBe('unverified');
      if(kind!=='query-failure')expect(execute.mock.calls.some(([,args])=>args[0]==='exec')).toBe(false);
    }finally{rmSync(stage.stagedRoot,{recursive:true,force:true});}
  });
});
