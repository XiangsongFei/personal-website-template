// @vitest-environment node
// Local tests are contract/failure tests. The opt-in case invokes REAL isolated
// Supabase stages; default skips must never be described as a restored database.
import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const { validateStage, validManifestPath, failureSelfTest } = await import(new URL('./rls-runtime/run-synthetic-backup-recovery.mjs', import.meta.url).href) as {
  validateStage:(stage:unknown)=>void; validManifestPath:(path:unknown)=>boolean; failureSelfTest:()=>Promise<void>;
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
it.skipIf(process.env.SYNTHETIC_BACKUP_INTEGRATION!=='1')('restores all required synthetic cases on an isolated GitHub Runner',()=>{
  const result=spawnSync(process.execPath,['tests/rls-runtime/run-synthetic-backup-recovery.mjs','--run'],{encoding:'utf8',timeout:48*60_000,maxBuffer:1024*1024});
  // Runner prints fixed enums/counts only; do not include subprocess output in failures.
  expect(!result.error && !result.signal && result.status===0).toBe(true);
  for(const name of caseNames)expect(result.stdout.includes(`backup_case=${name} status=verified`)).toBe(true);
  expect(result.stdout.includes(`backup_total=${caseNames.length} verified=${caseNames.length} incomplete=0 skipped=0`)).toBe(true);
  expect(result.stdout.includes('backup_acceptance=verified')).toBe(true);
},49*60_000);
