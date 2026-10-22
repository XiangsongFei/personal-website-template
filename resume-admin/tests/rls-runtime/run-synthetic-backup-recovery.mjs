// TEST ONLY: generated fixtures; never accepts an external database or archive.
/* global process, console, URL, fetch, AbortSignal */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, lstatSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { createConnection } from 'node:net';
import { setTimeout, clearTimeout } from 'node:timers';
import { withStagedLocalSupabase } from './stage-local-supabase.mjs';
import { observeCompatibilityStaging, waitBoundedChild } from './compatibility-contract.mjs';
import { artifactNames, caseNames, cliVersion, sha256, makeManifest, verifyArtifacts, restoreInputs,
  assertConsistent, sealArtifacts, openArtifacts, safeResult } from './backup-recovery-contract.mjs';

const self = fileURLToPath(import.meta.url);
const helper = join(dirname(self), 'stage-local-supabase.mjs');
const user = 'ba111111-1111-4111-8111-111111111111';
const bucket = 'synthetic-backup';
const objectNames = ['synthetic.pdf', 'synthetic.png'];
const objects = [Buffer.from('%PDF-1.4\nsynthetic-backup-only\n%%EOF'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9foAAAAASUVORK5CYII=', 'base64')];
const emit = (stage, status) => process.send?.({ kind: 'result', ...safeResult(stage, status) });
const completed = new Set();
export const exportStages = Object.freeze(['roles-dump','app-schema-dump','app-data-dump','auth-data-dump',
  'migration-schema-dump','migration-data-dump','default-schema-dump','default-data-dump','filter-assertions']);
export function safeExportResult(stage, status) {
  return { stage: exportStages.includes(stage) ? stage : 'unknown',
    status: ['success','failed','unverified'].includes(status) ? status : 'unverified' };
}
export function exportStep(stage, operation, report = result => process.send?.({ kind: 'export-result', ...result })) {
  assert(exportStages.includes(stage), 'synthetic-export-stage-rejected');
  report(safeExportResult(stage, 'unverified'));
  try { const value = operation(); report(safeExportResult(stage, 'success')); return value; }
  catch (error) { report(safeExportResult(stage, 'failed')); throw error; }
}

// A bounded lexer for the fixed CLI schema dump, not an SQL execution/parser API.
// Skip literals/comments so embedded DDL cannot satisfy or defeat table checks.
// Unsupported lexical/table forms fail closed; never include SQL in diagnostics.
export function assertDefaultSchemaTables(text) {
  const reject = () => { throw new Error('synthetic-schema-format-rejected'); };
  if (typeof text !== 'string' || !text.length || text.length > 16 * 1024 * 1024 || text.includes('\0')) reject();
  const tokens = [];
  const lex = /\s+|--[^\r\n]*|\/\*|\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$|"(?:[^"]|"")*"|'(?:[^'\\]|'')*'|[A-Za-z_][A-Za-z_0-9$]*|[0-9]+|[().,;:=+*/<>![\]%-]/y;
  let position = 0;
  while (position < text.length) {
    lex.lastIndex = position;
    const match = lex.exec(text); if (!match) reject();
    const raw = match[0]; position = lex.lastIndex;
    if (/^\s|^--/.test(raw)) continue;
    if (raw === '/*') {
      let depth = 1;
      while (depth && position < text.length) {
        if (text.startsWith('/*', position)) { depth++; position += 2; }
        else if (text.startsWith('*/', position)) { depth--; position += 2; }
        else position++;
      }
      if (depth) reject();
      continue;
    }
    if (raw.startsWith('$')) {
      const end = text.indexOf(raw, position); if (end < 0) reject();
      position = end + raw.length; tokens.push({ literal: true });
    } else if (raw.startsWith("'")) tokens.push({ literal: true });
    else if (raw.startsWith('"')) tokens.push({ identifier: raw.slice(1,-1).replaceAll('""','"') });
    else if (/^[A-Za-z_]/.test(raw)) tokens.push({ identifier: raw.toLowerCase(), keyword: raw.toLowerCase() });
    else tokens.push({ punctuation: raw });
    if (tokens.length > 500_000) reject();
  }
  let depth = 0;
  for (const token of tokens) {
    if (token.punctuation === '(') depth++;
    if (token.punctuation === ')' && --depth < 0) reject();
  }
  if (depth || tokens.at(-1)?.punctuation !== ';') reject();
  const tables = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].keyword !== 'create') continue;
    const next = tokens[i+1]?.keyword;
    if (['global','local','temporary','temp','unlogged','foreign'].includes(next)) reject();
    if (next !== 'table') continue;
    let j = i + 2;
    if (tokens[j]?.keyword === 'if') {
      if (tokens[j+1]?.keyword !== 'not' || tokens[j+2]?.keyword !== 'exists') reject();
      j += 3;
    }
    const schema = tokens[j]?.identifier, table = tokens[j+2]?.identifier;
    if (!schema || !table || tokens[j+1]?.punctuation !== '.' || tokens[j+3]?.punctuation !== '(') reject();
    if (['auth','storage','vault','supabase_migrations'].includes(schema)) reject();
    const name = JSON.stringify([schema,table]);
    if (tables.has(name)) reject();
    tables.add(name);
  }
  if (!tables.has(JSON.stringify(['synthetic_backup','items']))) reject();
}

export function fallbackRequired(manifest, cleaned) { return !cleaned.has(manifest); }
const roleDumpStatuses = Object.freeze(['cli-command-failed','artifact-missing','artifact-empty',
  'artifact-not-regular','artifact-oversize','success','unverified']);
export const safeRoleDumpStatus = status => roleDumpStatuses.includes(status) ? status : 'unverified';
export function dumpRoles(stage, supabase, report = status => process.send?.({ kind: 'roles-dump-result', status: safeRoleDumpStatus(status) })) {
  const file = join(stage.stagedRoot, 'roles.sql');
  report('unverified');
  try { supabase(['db','dump','--local','--role-only','-f',file]); }
  catch (error) { report('cli-command-failed'); throw error; }
  let stat;
  try { stat=lstatSync(file); }
  catch (error) { report(error?.code==='ENOENT'?'artifact-missing':'unverified'); throw error; }
  const failure = !stat.isFile() || stat.isSymbolicLink() ? 'artifact-not-regular'
    : stat.size===0 ? 'artifact-empty' : stat.size>=16*1024*1024 ? 'artifact-oversize' : null;
  if(failure){ report(failure); throw new Error('synthetic-role-artifact-rejected'); }
  let bytes;
  try { bytes=readFileSync(file); assert.equal(bytes.length,stat.size,'synthetic-role-artifact-changed'); }
  catch (error) { report('unverified'); throw error; }
  report('success'); return bytes;
}
function passed(name) {
  assert(caseNames.includes(name) && !completed.has(name));
  completed.add(name); process.send?.({ kind: 'case', name, status: 'verified' });
}
function checked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.signal || result.status !== 0) throw new Error('synthetic-subprocess-failed');
  return result.stdout;
}
// CLI v2.119.0 rewrites --local loopback to host.docker.internal on a bridge.
// An explicit, passwordless --db-url keeps the verified project container host;
// libpq PGPASSWORD supplies only this disposable stage's synthetic credential.
const dumpImage = 'ghcr.io/supabase/postgres@sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53';
export function ownedDumpConnection(stage, manifest, db, network, image) {
  try {
    validateStage(stage);
    assert.deepEqual(stage.migrationManifest, []);
    assert(validManifestPath(join(stage.stagedRoot, 'ownership.json')));
    assert.equal(manifest.projectId, stage.projectId);
    assert.equal(manifest.stageRoot, stage.stagedRoot);
    assert.deepEqual(manifest.ports, stage.ports);
    for (const kind of ['containers','networks','volumes']) {
      assert(Array.isArray(manifest.created[kind]) && Array.isArray(manifest.preexisting[kind]));
      assert.deepEqual(new Set(manifest.preexisting[kind]), stage.preexistingResources[kind]);
    }
    assert.match(network.Id, /^[a-f0-9]{64}$/);
    assert.equal(network.Id, stage.dockerNetworkId);
    assert.equal(network.Driver, 'bridge');
    assert.equal(network.Labels?.['com.docker.compose.project'], stage.projectId);
    assert.equal(network.Options?.['com.docker.network.bridge.host_binding_ipv4'], '127.0.0.1');
    assert(manifest.created.networks.includes(network.Id) && !stage.preexistingResources.networks.has(network.Id));
    assert.match(db.Id, /^[a-f0-9]{64}$/);
    assert.equal(db.Name, `/${stage.dbContainer}`);
    assert.equal(db.Config?.Labels?.['com.docker.compose.project'], stage.projectId);
    assert.equal(db.State?.Running, true);
    assert.equal(db.HostConfig?.Privileged, false);
    assert(!['host','none'].includes(db.HostConfig?.NetworkMode));
    assert(manifest.created.containers.includes(db.Id) && !stage.preexistingResources.containers.has(db.Id));
    assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
    assert(image.RepoDigests.includes(dumpImage));
    assert.equal(db.Image, image.Id);
    const endpoints = Object.values(db.NetworkSettings.Networks);
    assert.equal(endpoints.length, 1);
    assert.equal(endpoints[0].NetworkID, network.Id);
    assert.equal(network.Containers?.[db.Id]?.Name, stage.dbContainer);
    const published = db.NetworkSettings.Ports;
    assert.deepEqual(published['5432/tcp'], [{ HostIp:'127.0.0.1', HostPort:String(stage.ports.db) }]);
    for (const bindings of Object.values(published)) {
      assert(bindings === null || (Array.isArray(bindings) && bindings.every(x => x.HostIp === '127.0.0.1')));
    }
    // Credentials are taken from staging's verified status, never ambient PG* settings.
    const local = new URL(stage.dbUrl);
    assert.equal(local.protocol, 'postgresql:');
    assert.equal(local.hostname, '127.0.0.1');
    assert.equal(Number(local.port), stage.ports.db);
    assert.equal(local.username, 'postgres');
    assert.equal(local.pathname, '/postgres');
    assert.equal(local.search + local.hash, '');
    const password = decodeURIComponent(local.password);
    assert(password.length > 0 && password.length <= 1024 && [...password].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
    return { url:`postgresql://postgres@${db.Name.slice(1)}:5432/postgres`, password };
  } catch { throw new Error('synthetic-dump-target-rejected'); }
}
export function runOwnedDump(stage, args, execute = checked) {
  try {
    validateStage(stage);
    assert.match(stage.dockerNetworkId, /^[a-f0-9]{64}$/);
    const flags = new Map([
      ['roles.sql',['--role-only']], ['schema.sql',['--schema','synthetic_backup']],
      ['data.sql',['--schema','synthetic_backup','--data-only','--use-copy']],
      ['auth-data.sql',['--schema','auth','--data-only','--use-copy']],
      ['history-schema.sql',['--schema','supabase_migrations']],
      ['history-data.sql',['--schema','supabase_migrations','--data-only','--use-copy']],
      ['default-schema.sql',[]], ['default-data.sql',['--data-only','--use-copy']],
    ]);
    assert([...flags].some(([name, options]) => JSON.stringify(args) ===
      JSON.stringify(['db','dump','--local',...options,'-f',join(stage.stagedRoot,name)])));
    const path = join(stage.stagedRoot, 'ownership.json');
    assert(validManifestPath(path));
    const stat = lstatSync(path);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size < 4*1024*1024);
    const manifest = JSON.parse(readFileSync(path,'utf8'));
    const inspect = argv => {
      const values = JSON.parse(execute('docker', argv, {timeout:10000,maxBuffer:1024*1024}));
      assert(Array.isArray(values) && values.length === 1); return values[0];
    };
    const db = inspect(['inspect',stage.dbContainer]);
    const network = inspect(['network','inspect',stage.dockerNetworkId]);
    const image = inspect(['image','inspect',dumpImage]);
    const connection = ownedDumpConnection(stage,manifest,db,network,image);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG') && key !== 'SUPABASE_DB_PASSWORD'));
    env.PGPASSWORD = connection.password;
    env.SUPABASE_TELEMETRY_DISABLED = '1';
    // No password in argv; checked captures and suppresses stdout/stderr on failure.
    return execute('supabase', ['--workdir',stage.stagedRoot,'--network-id',network.Id,
      'db','dump','--db-url',connection.url,...args.slice(3)], {env});
  } catch { throw new Error('synthetic-dump-command-failed'); }
}
const networkPaths = Object.freeze(['host-loopback','tool-host-gateway','tool-project-internal']);
const networkStatuses = Object.freeze(['success','refused','timeout','name-resolution-failed','command-unavailable','command-failed','unsupported-probe','unknown','unverified']);
export function safeNetworkResult(path, status) {
  return { path: networkPaths.includes(path) ? path : 'unknown',
    status: networkStatuses.includes(status) ? status : 'unverified' };
}
export function socketFailure(code) {
  return ({ ECONNREFUSED:'refused', ETIMEDOUT:'timeout', ENOTFOUND:'name-resolution-failed', EAI_AGAIN:'name-resolution-failed' })[code] ?? 'unknown';
}
export function loopbackProbe(port, connect = createConnection, deadline = 5000) {
  assert(Number.isInteger(port) && port > 1024 && port < 65536);
  assert(Number.isInteger(deadline) && deadline > 0 && deadline <= 5000);
  return new Promise(resolveProbe => {
    let socket, timer, done = false;
    const finish = status => {
      if(done)return; done=true; clearTimeout(timer); socket?.destroy(); resolveProbe(status);
    };
    timer=setTimeout(()=>finish('timeout'),deadline);
    try {
      socket=connect({ host:'127.0.0.1', port });
      socket.once('connect',()=>finish('success'));
      socket.once('error',error=>finish(socketFailure(error?.code)));
      socket.once('close',()=>finish('unknown'));
    } catch { finish('unknown'); }
  });
}
// No SQL/authentication probe: each TCP connection runs once, with a hard timeout.
// stderr is classified in shell memory and discarded; only fixed enums reach stdout.
export const networkProbeScript = `
set -eu
export LC_ALL=C
report_unavailable() {
  printf 'tool-host-gateway=%s\\ntool-project-internal=%s\\n' "$1" "$1"
}
for tool in timeout bash; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    report_unavailable command-unavailable
    exit 0
  fi
done
# The short option works with both BusyBox and GNU timeout. This preflight makes
# no connection; failure must not be misreported as a network failure.
if ! timeout -s KILL 1 bash -c 'exit 0' >/dev/null 2>&1; then
  report_unavailable command-failed
  exit 0
fi
probe() {
  set +e
  detail=$(timeout -s KILL 5 bash -c 'exec 3<>/dev/tcp/"$1"/"$2"' -- "$2" "$3" 2>&1)
  code=$?
  set -e
  result=unknown
  case "$code" in
    0) result=success ;;
    124|137) result=timeout ;;
    125) result=command-failed ;;
    126|127) result=command-unavailable ;;
    *) case "$detail" in
      *'/dev/tcp/'*'No such file or directory'*) result=unsupported-probe ;;
      *'Connection refused'*) result=refused ;;
      *'Name or service not known'*|*'Temporary failure in name resolution'*) result=name-resolution-failed ;;
    esac ;;
  esac
  unset detail
  printf '%s=%s\\n' "$1" "$result"
}
probe tool-host-gateway host.docker.internal "$1"
probe tool-project-internal "$2" 5432
`;

export function parseNetworkProbeOutput(output) {
  assert(typeof output==='string' && output.length<256, 'network-output-rejected');
  const lines=output.trim().split('\n');
  assert.equal(lines.length,2,'network-output-rejected');
  return networkPaths.slice(1).map((path,index)=>{
    const [actual,status,...extra]=lines[index].split('=');
    assert.equal(actual,path,'network-output-rejected');
    assert.equal(extra.length,0,'network-output-rejected');
    assert(networkStatuses.includes(status) && status!=='unverified','network-output-rejected');
    return {path,status};
  });
}
export function recordNetworkProbe(manifest, stage, container, imageId) {
  assert.equal(manifest.projectId,stage.projectId);
  assert.equal(manifest.stageRoot,stage.stagedRoot);
  assert.deepEqual(manifest.ports,stage.ports);
  assert.match(container.Id,/^[a-f0-9]{64}$/);
  assert.equal(container.Name,`/supabase_backup_probe_${stage.projectId}`);
  assert.equal(container.Config?.Labels?.['com.docker.compose.project'],stage.projectId);
  assert.equal(container.Config?.Labels?.['synthetic-backup-role'],'tcp-probe');
  assert.equal(container.Image,imageId);
  assert.equal(container.HostConfig?.NetworkMode,stage.dockerNetworkId);
  assert.deepEqual(container.HostConfig?.ExtraHosts,['host.docker.internal:host-gateway']);
  assert.equal(container.HostConfig?.Privileged,false);
  assert.equal(container.HostConfig?.ReadonlyRootfs,true);
  assert.equal(container.HostConfig?.PublishAllPorts,false);
  assert.equal(Object.keys(container.HostConfig?.PortBindings ?? {}).length,0);
  assert.equal((container.Mounts ?? []).filter(m=>m.Type!=='tmpfs').length,0);
  for(const kind of ['containers','volumes','networks']) {
    assert(Array.isArray(manifest.preexisting?.[kind]) && Array.isArray(manifest.created?.[kind]));
    assert.deepEqual(new Set(manifest.preexisting[kind]),stage.preexistingResources[kind]);
  }
  assert(!manifest.preexisting.containers.includes(container.Id));
  return {...manifest,created:{...manifest.created,containers:[...new Set([...manifest.created.containers,container.Id])]}};
}
async function networkDiagnostics(stage) {
  validateStage(stage);
  const report=(path,status)=>process.send?.({kind:'backup-network',...safeNetworkResult(path,status)});
  const lifecycle=(operation,status)=>process.send?.({kind:'backup-network-container',operation,status});
  for(const path of networkPaths)report(path,'unverified');
  for(const operation of ['create','start','exit'])lifecycle(operation,'unverified');
  // Validate the already-owned network/database and pinned cache before any new resource.
  const inspect=args=>JSON.parse(checked('docker',args,{timeout:10000,maxBuffer:1024*1024}))[0];
  const network=inspect(['network','inspect',stage.dockerNetworkId]);
  assert.equal(network.Id,stage.dockerNetworkId);
  assert.equal(network.Driver,'bridge');
  assert.equal(network.Labels?.['com.docker.compose.project'],stage.projectId);
  assert.equal(network.Options?.['com.docker.network.bridge.host_binding_ipv4'],'127.0.0.1');
  const db=inspect(['inspect',stage.dbContainer]);
  assert.equal(db.Config?.Labels?.['com.docker.compose.project'],stage.projectId);
  assert(!stage.preexistingResources.containers.has(db.Id));
  assert(Object.values(db.NetworkSettings.Networks).some(n=>n.NetworkID===stage.dockerNetworkId));
  const reference='ghcr.io/supabase/postgres@sha256:0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53';
  const image=inspect(['image','inspect',reference]);
  assert.match(image.Id,/^sha256:[a-f0-9]{64}$/);
  assert(image.RepoDigests.includes(reference));
  assert.equal(db.Image,image.Id);
  // Prevent Docker image VOLUME declarations from creating unlabelled anonymous volumes.
  assert(Object.keys(image.Config?.Volumes ?? {}).every(path=>path==='/var/lib/postgresql/data'));
  const manifestPath=join(stage.stagedRoot,'ownership.json');
  assert(validManifestPath(manifestPath));
  const stat=lstatSync(manifestPath); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size<4*1024*1024);
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.equal(manifest.projectId,stage.projectId);
  report('host-loopback',await loopbackProbe(stage.ports.db));
  let operation='create';
  try {
    const id=checked('docker',['create','--pull=never','--name',`supabase_backup_probe_${stage.projectId}`,
      '--label',`com.docker.compose.project=${stage.projectId}`,'--label','synthetic-backup-role=tcp-probe',
      '--network',stage.dockerNetworkId,'--add-host','host.docker.internal:host-gateway',
      '--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--pids-limit','32',
      '--memory','128m','--cpus','0.5','--tmpfs','/tmp:rw,noexec,nosuid,size=1m',
      '--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=1m',
      '--entrypoint','bash',image.Id,'-c',networkProbeScript,'--',String(stage.ports.db),stage.dbContainer],
    {timeout:10000,maxBuffer:4096}).trim();
    assert.match(id,/^[a-f0-9]{64}$/);
    const container=inspect(['inspect',id]);
    const recorded=recordNetworkProbe(manifest,stage,container,image.Id);
    // Existing fallback also rediscovers labelled resources if creation/recording is interrupted.
    const pendingManifest=join(stage.stagedRoot,'ownership-network-pending.json');
    writeFileSync(pendingManifest,JSON.stringify(recorded),{mode:0o600,flag:'wx'});
    renameSync(pendingManifest,manifestPath);
    lifecycle('create','success'); operation='start';
    checked('docker',['start',id],{timeout:10000,maxBuffer:4096});
    lifecycle('start','success'); operation='exit';
    const exit=checked('docker',['wait',id],{timeout:15000,maxBuffer:4096}).trim();
    assert.equal(exit,'0','network-tool-exit-failed');
    const ended=inspect(['inspect',id]);
    recordNetworkProbe(recorded,stage,ended,image.Id);
    assert.equal(ended.State.Running,false); assert.equal(ended.State.ExitCode,0);
    lifecycle('exit','success');
    for(const result of parseNetworkProbeOutput(checked('docker',['logs',id],{timeout:5000,maxBuffer:4096})))report(result.path,result.status);
    // Do not auto-remove: staging owns verification/removal, including timeout/failure paths.
  } catch { lifecycle(operation,'failed'); throw new Error('synthetic-network-diagnostic-failed'); }
}

export function validateStage(stage) {
  assert.match(stage.projectId, /^pr1-\d+-[a-f0-9]{12}$/);
  assert.equal(stage.dbContainer, `supabase_db_${stage.projectId}`);
  assert.equal(stage.authContainer, `supabase_auth_${stage.projectId}`);
  const url = new URL(stage.apiUrl);
  assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
  assert.equal(Number(url.port), stage.ports.api);
  assert.equal(url.username + url.password + url.search + url.hash, '');
}
function sql(stage, input) {
  validateStage(stage);
  return checked('docker', ['exec', '-i', stage.dbContainer, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input }).trim();
}
export const restoreStages = Object.freeze(['restore-input-validation','restore-roles','restore-schema',
  'restore-auth-data','restore-app-data','restore-commit']);
export function safeRestoreResult(stage, status) {
  return { stage:restoreStages.includes(stage)?stage:'unknown',
    status:['success','failed','unverified'].includes(status)?status:'unverified' };
}
// Markers acknowledge psql execution, not durable changes before COMMIT. Never
// forward arbitrary stdout, and discard stderr at the subprocess boundary.
export function restoreInTransaction(stage, manifest, files, execute = spawnSync,
  report = result => process.send?.({kind:'restore-result',...result})) {
  const emitRestore = (name,status) => report(safeRestoreResult(name,status));
  for(const name of restoreStages)emitRestore(name,'unverified');
  let inputs;
  try { validateStage(stage); inputs=restoreInputs(manifest,files); }
  catch { emitRestore('restore-input-validation','failed'); throw new Error('synthetic-restore-input-rejected'); }
  emitRestore('restore-input-validation','success');
  const token=randomBytes(16).toString('hex');
  const phases=restoreStages.slice(1);
  const bodies=[inputs[0].bytes,inputs[1].bytes,
    `SET LOCAL session_replication_role=replica;\n${files.get('auth-data.sql')}`,
    inputs[2].bytes,'COMMIT;'];
  const markers=phases.flatMap(name=>['begin','end'].map(event=>`backup_restore_${token}:${name}:${event}`));
  // One stdin stream, one session, original SQL order and transaction unchanged.
  const input='BEGIN;\n'+bodies.map((body,i)=>
    `\\echo ${markers[i*2]}\n${body}\n\\echo ${markers[i*2+1]}\n`).join('');
  let result;
  try {
    result=execute('docker',['exec','-i',stage.dbContainer,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],
      {input,encoding:'utf8',stdio:['pipe','pipe','ignore'],timeout:60000,killSignal:'SIGKILL',maxBuffer:64*1024});
  } catch { emitRestore('unknown','failed'); throw new Error('synthetic-restore-process-failed'); }
  let seen=[];
  try {
    assert(typeof result.stdout==='string' && Buffer.byteLength(result.stdout)<=64*1024);
    // Only this invocation's exact nonce + ordered whitelist can establish position.
    seen=result.stdout.split(/\r?\n/).filter(line=>line.startsWith(`backup_restore_${token}:`));
    assert(seen.length<=markers.length && seen.every((line,i)=>line===markers[i]));
  } catch { emitRestore('unknown','failed'); throw new Error('synthetic-restore-markers-rejected'); }
  const cleanExit=!result.error && !result.signal && result.status===0;
  for(let i=0;i<phases.length;i++) {
    if(seen.length>i*2+1 && (phases[i]!=='restore-commit' || cleanExit))emitRestore(phases[i],'success');
  }
  if(cleanExit && seen.length===markers.length)return;
  // Exit 3 is psql ON_ERROR_STOP script failure. A started segment plus this
  // controlled return distinguishes a script failure from timeout/transport loss.
  const active=seen.length%2===1?phases[Math.floor(seen.length/2)]:undefined;
  if(active && !result.error && !result.signal && result.status===3)emitRestore(active,'failed');
  else emitRestore('unknown','failed');
  throw new Error('synthetic-restore-process-failed');
}
function emptyTarget(stage) {
  // Extensions/platform schemas are retained; no application schema is preinstalled.
  assert.equal(sql(stage, `SELECT count(*) FROM pg_namespace WHERE nspname IN ('synthetic_backup','cms_private')`), '0');
  assert.equal(sql(stage, `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND NOT EXISTS
    (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')`), '0');
  assert.equal(sql(stage, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`), '0');
  assert.equal(sql(stage, `SELECT count(*) FROM pg_policies WHERE schemaname IN ('public','synthetic_backup')`), '0');
  assert.equal(sql(stage, 'SELECT count(*) FROM auth.users'), '0');
  assert.equal(sql(stage, 'SELECT count(*) FROM storage.objects'), '0');
  assert.equal(sql(stage, 'SELECT count(*) FROM storage.buckets'), '0');
  assert.equal(sql(stage, "SELECT count(*) FROM pg_roles WHERE rolname='synthetic_backup_reader'"), '0');
}
function jwt(stage, role, subject) {
  validateStage(stage);
  const inspected = JSON.parse(checked('docker', ['inspect', stage.authContainer]));
  const container = inspected[0];
  assert.equal(container.Config.Labels['com.docker.compose.project'], stage.projectId);
  const value = container.Config.Env.find(x => x.startsWith('GOTRUE_JWT_SECRET='));
  assert(value); const secret = value.slice('GOTRUE_JWT_SECRET='.length);
  const encode = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, ...(subject ? { sub: subject } : {}), aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
async function request(stage, path, token, method = 'GET', body, contentType = 'application/json') {
  validateStage(stage);
  assert(typeof stage.syntheticAnonKey==='string' && stage.syntheticAnonKey.length>20);
  assert(/^\/(auth\/v1\/(admin\/users|token\?grant_type=password)|storage\/v1\/(bucket|object\/synthetic-backup\/synthetic\.(pdf|png)))$/.test(path));
  const response = await fetch(new URL(path, stage.apiUrl), { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { apikey: stage.syntheticAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': contentType }, body });
  assert(response.ok, 'synthetic-api-failed');
  const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length < 1024 * 1024);
  return bytes;
}
function catalog(stage) {
  return sql(stage, `SELECT jsonb_build_object(
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.relacl::text) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='synthetic_backup' AND c.relkind='r'),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='synthetic_backup'),
    'functions',(SELECT jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.prosecdef,p.proconfig,p.proacl::text,pg_get_userbyid(p.proowner)) ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='synthetic_backup'),
    'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='synthetic_backup' AND NOT t.tgisinternal),
    'role',(SELECT jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) FROM pg_roles WHERE rolname='synthetic_backup_reader'))::text`);
}
function ledgerSnapshot(stage) {
  const exists=sql(stage, "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL");
  if(exists==='f')return 'absent';
  assert.equal(exists,'t');
  return sql(stage, "SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY version),'[]'::jsonb)::text FROM supabase_migrations.schema_migrations m");
}
function rows(stage) { return sql(stage, "SELECT jsonb_agg(to_jsonb(t) ORDER BY id)::text FROM synthetic_backup.items t"); }
function authRows(stage) { return sql(stage, `SELECT jsonb_build_object('users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM auth.users u),'identities',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM auth.identities i))::text`); }
function storageRows(stage) { return sql(stage, `SELECT jsonb_agg(jsonb_build_array(bucket_id,name,owner_id) ORDER BY name)::text FROM storage.objects WHERE bucket_id='synthetic-backup'`); }
async function snapshot(stage, token) {
  const bytes = [];
  for (const name of objectNames) bytes.push(sha256(await request(stage, `/storage/v1/object/${bucket}/${name}`, token)));
  return { database: sha256(rows(stage)), auth: sha256(authRows(stage)), storage: sha256(JSON.stringify(bytes)), references: sha256(storageRows(stage)) };
}
function dump(stage, supabase, name, args) {
  assert(artifactNames.includes(name) || ['default-schema.sql','default-data.sql'].includes(name));
  if(name==='roles.sql'){
    assert.deepEqual(args,['--role-only']);
    return dumpRoles(stage,supabase);
  }
  const file = join(stage.stagedRoot, name);
  supabase(['db', 'dump', '--local', ...args, '-f', file]);
  const stat = lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size < 16 * 1024 * 1024);
  return readFileSync(file);
}
const fixtureSql = `CREATE ROLE synthetic_backup_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA synthetic_backup;
CREATE TABLE synthetic_backup.items(id integer PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), path text NOT NULL, title text NOT NULL);
CREATE TABLE synthetic_backup.events(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, item_id integer NOT NULL);
ALTER TABLE synthetic_backup.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_backup.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_items ON synthetic_backup.items TO synthetic_backup_reader USING (user_id::text=current_setting('synthetic.actor',true));
GRANT USAGE ON SCHEMA synthetic_backup TO synthetic_backup_reader;
GRANT SELECT ON synthetic_backup.items TO synthetic_backup_reader;
CREATE FUNCTION synthetic_backup.record_update() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN INSERT INTO synthetic_backup.events(item_id) VALUES(NEW.id); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION synthetic_backup.record_update() FROM PUBLIC;
CREATE TRIGGER record_update AFTER UPDATE ON synthetic_backup.items FOR EACH ROW EXECUTE FUNCTION synthetic_backup.record_update();
INSERT INTO synthetic_backup.items VALUES(1,'${user}','synthetic.pdf','synthetic-resume'),(2,'${user}','synthetic.png','synthetic-profile');
CREATE POLICY synthetic_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='synthetic-backup' AND owner_id=auth.uid()::text);
CREATE POLICY synthetic_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='synthetic-backup' AND owner_id=auth.uid()::text);
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY, statements text[], name text);
INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES('19000101000000',ARRAY['synthetic-only'],'synthetic-only');`;

async function observed(callback) {
  return observeCompatibilityStaging(cb => withStagedLocalSupabase(cb, 'synthetic-recovery'), callback,
    (stage, status) => emit(stage, status === 'success' ? 'verified' : status));
}
async function rehearsal() {
  assert.equal(checked('supabase', ['--version']).trim(), cliVersion);
  const key = randomBytes(32); const password = randomBytes(24).toString('hex');
  let sealed, originalManifest, before, expectedRows, expectedCatalog, expectedAuth, expectedStorage, sourceId;
  const disk = mkdtempSync(join(tmpdir(), 'synthetic-backup-encrypted-'));
  try {
    await observed(async (source, supabase) => {
      const sourceStatus=JSON.parse(supabase(['status','-o','json']));
      assert.equal(sourceStatus.API_URL,source.apiUrl);
      assert(typeof sourceStatus.ANON_KEY==='string' && sourceStatus.ANON_KEY.length>20);
      source.syntheticAnonKey=sourceStatus.ANON_KEY;
      emptyTarget(source); sourceId = source.projectId; emit('source','verified');
      assert.equal(sql(source, "SELECT current_setting('server_version_num')::int / 10000"), '17');
      const service = jwt(source,'service_role'); const token = jwt(source,'authenticated',user);
      const created = JSON.parse((await request(source,'/auth/v1/admin/users',service,'POST',JSON.stringify({ id:user,email:'backup-synthetic@example.invalid',password,email_confirm:true }))).toString());
      assert.equal(created.id ?? created.user?.id,user);
      sql(source, fixtureSql);
      await request(source,'/storage/v1/bucket',service,'POST',JSON.stringify({ id:bucket,name:bucket,public:false }));
      for (let i=0;i<objectNames.length;i++) await request(source,`/storage/v1/object/${bucket}/${objectNames[i]}`,token,'POST',objects[i],i===0?'application/pdf':'image/png');
      // Vault dependence is inventoried using a newly generated synthetic secret only.
      sql(source, "SELECT vault.create_secret('synthetic-vault-value','synthetic-vault-probe')");
      before = await snapshot(source,token);
      expectedRows=rows(source); expectedCatalog=catalog(source); expectedAuth=authRows(source); expectedStorage=storageRows(source);
      await networkDiagnostics(source);
      emit('export','unverified');
      const files = new Map();
      const dumpCli = args => runOwnedDump(source,args);
      files.set('roles.sql',exportStep('roles-dump',()=>dump(source,dumpCli,'roles.sql',['--role-only'])));
      files.set('schema.sql',exportStep('app-schema-dump',()=>dump(source,dumpCli,'schema.sql',['--schema','synthetic_backup'])));
      files.set('data.sql',exportStep('app-data-dump',()=>dump(source,dumpCli,'data.sql',['--schema','synthetic_backup','--data-only','--use-copy'])));
      files.set('auth-data.sql',exportStep('auth-data-dump',()=>dump(source,dumpCli,'auth-data.sql',['--schema','auth','--data-only','--use-copy'])));
      files.set('history-schema.sql',exportStep('migration-schema-dump',()=>dump(source,dumpCli,'history-schema.sql',['--schema','supabase_migrations'])));
      files.set('history-data.sql',exportStep('migration-data-dump',()=>dump(source,dumpCli,'history-data.sql',['--schema','supabase_migrations','--data-only','--use-copy'])));
      const defaultSchema = exportStep('default-schema-dump',()=>dump(source,dumpCli,'default-schema.sql',[]).toString());
      const defaultData = exportStep('default-data-dump',()=>dump(source,dumpCli,'default-data.sql',['--data-only','--use-copy']).toString());
      exportStep('filter-assertions',()=>{
        assertDefaultSchemaTables(defaultSchema);
        assert(!defaultSchema.includes('synthetic_read')); // Storage policies need separate recovery.
        assert(defaultData.includes('backup-synthetic@example.invalid') && defaultData.includes('synthetic.pdf'));
        assert(!defaultData.includes('synthetic-vault-value') && !defaultData.includes('synthetic-vault-probe'));
        assert(!defaultData.includes('19000101000000'));
      });
      files.set('security-catalog.json',Buffer.from(expectedCatalog));
      files.set('auth-coverage.json',Buffer.from(JSON.stringify({ data:true,managedSchema:false,vault:false,ledger:false })));
      files.set('storage-metadata.json',Buffer.from(expectedStorage));
      for(let i=0;i<objectNames.length;i++) files.set(`objects/${objectNames[i]}`,await request(source,`/storage/v1/object/${bucket}/${objectNames[i]}`,token));
      passed('cli-filters'); emit('filter-coverage','verified'); emit('export','verified');
      assertConsistent(before,await snapshot(source,token)); emit('consistency','verified');
      originalManifest=makeManifest(files); sealed=sealArtifacts(files,key); emit('encrypt','verified');
      writeFileSync(join(disk,'backup.enc'),sealed,{flag:'wx',mode:0o600});
      assert.equal(sha256(readFileSync(join(disk,'backup.enc'))),sha256(sealed));
      const opened=openArtifacts(sealed,key); emit('decrypt','verified'); assert.deepEqual(opened.manifest,originalManifest); assert.deepEqual(opened.files,files); passed('encryption-roundtrip');
      assert.throws(()=>openArtifacts(sealed,randomBytes(32))); passed('wrong-key');
      const bad=Buffer.from(sealed);bad[15]^=1;assert.throws(()=>openArtifacts(bad,key));passed('corrupt-ciphertext');
      const missing=new Map(files);missing.delete('data.sql');assert.throws(()=>verifyArtifacts(originalManifest,missing));passed('missing-artifact');
      const changed=new Map(files);changed.set('data.sql',Buffer.from('changed'));assert.throws(()=>verifyArtifacts(originalManifest,changed));passed('changed-artifact');
      // Mutations occur only after the accepted backup time point, in the source fixture.
      sql(source,"UPDATE synthetic_backup.items SET title='drift' WHERE id=1");
      assert.throws(()=>assertConsistent(before,{...before,database:sha256(rows(source))}));passed('database-drift');
      sql(source,`UPDATE auth.users SET raw_user_meta_data='{"synthetic":"drift"}' WHERE id='${user}'`);
      assert.throws(()=>assertConsistent(before,{...before,auth:sha256(authRows(source))}));passed('auth-drift');
      await request(source,`/storage/v1/object/${bucket}/synthetic.pdf`,service,'PUT',Buffer.from('synthetic-drift'),'application/pdf');
      const changedSnapshot=await snapshot(source,token);
      assert.throws(()=>assertConsistent(before,{...before,storage:changedSnapshot.storage}));
      assert.notEqual(sha256(await request(source,`/storage/v1/object/${bucket}/synthetic.pdf`,token)),sha256(objects[0]));passed('storage-drift');
    });
    await observed(async (target, supabase) => {
      const targetStatus=JSON.parse(supabase(['status','-o','json']));
      assert.equal(targetStatus.API_URL,target.apiUrl);
      assert(typeof targetStatus.ANON_KEY==='string' && targetStatus.ANON_KEY.length>20);
      target.syntheticAnonKey=targetStatus.ANON_KEY;
      assert.notEqual(target.projectId,sourceId); emptyTarget(target); emit('target','verified');
      const ledgerBefore=ledgerSnapshot(target);
      const opened=openArtifacts(readFileSync(join(disk,'backup.enc')),key);
      assert.deepEqual(opened.manifest,originalManifest); emit('integrity','verified');
      restoreInTransaction(target,opened.manifest,opened.files);
      assert.equal(rows(target),expectedRows);passed('schema-data');
      assert.equal(catalog(target),expectedCatalog);
      assert.equal(sql(target,`BEGIN; SET LOCAL ROLE synthetic_backup_reader; SET LOCAL synthetic.actor='${user}'; SELECT count(*) FROM synthetic_backup.items; ROLLBACK;`),'2');
      assert.equal(sql(target,"BEGIN; SET LOCAL ROLE synthetic_backup_reader; SET LOCAL synthetic.actor='00000000-0000-4000-8000-000000000000'; SELECT count(*) FROM synthetic_backup.items; ROLLBACK;"),'0');
      assert.equal(sql(target,"SELECT has_table_privilege('anon','synthetic_backup.items','SELECT')"),'f');passed('roles-acl-rls'); emit('authorization','verified');
      assert.equal(sql(target,"SELECT count(*) FROM synthetic_backup.events"),'0');
      sql(target,"BEGIN; UPDATE synthetic_backup.items SET title='trigger-probe' WHERE id=1; DO $$ BEGIN IF (SELECT count(*) FROM synthetic_backup.events)<>1 THEN RAISE EXCEPTION 'synthetic-trigger-failed'; END IF; END $$; ROLLBACK;");passed('functions-triggers');
      assert.equal(authRows(target),expectedAuth);
      const login=JSON.parse((await request(target,'/auth/v1/token?grant_type=password',jwt(target,'anon'),'POST',JSON.stringify({email:'backup-synthetic@example.invalid',password}))).toString());
      assert.equal(login.user.id,user);assert(typeof login.access_token==='string');passed('auth-roundtrip'); emit('auth','verified');
      assert.equal(ledgerSnapshot(target),ledgerBefore);
      assert(opened.files.get('history-data.sql').includes(Buffer.from('19000101000000')));passed('ledger-export-only');
      // These explicit fixture policies are NOT claimed to have survived CLI schema filtering.
      sql(target,"CREATE POLICY synthetic_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='synthetic-backup' AND owner_id=auth.uid()::text); CREATE POLICY synthetic_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='synthetic-backup' AND owner_id=auth.uid()::text);");
      const service=jwt(target,'service_role');const token=jwt(target,'authenticated',user);
      await request(target,'/storage/v1/bucket',service,'POST',JSON.stringify({id:bucket,name:bucket,public:false}));
      for(let i=0;i<objectNames.length;i++) {
        await request(target,`/storage/v1/object/${bucket}/${objectNames[i]}`,token,'POST',opened.files.get(`objects/${objectNames[i]}`),i===0?'application/pdf':'image/png');
        assert.equal(sha256(await request(target,`/storage/v1/object/${bucket}/${objectNames[i]}`,token)),sha256(objects[i]));
      }
      assert.equal(storageRows(target),expectedStorage);
      assert.equal(sql(target, `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000000'; SELECT count(*) FROM storage.objects WHERE bucket_id='synthetic-backup'; ROLLBACK;`),'0');
      assert.equal(sql(target, `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='${user}'; SELECT count(*) FROM storage.objects WHERE bucket_id='synthetic-backup'; ROLLBACK;`),'2');
      passed('storage-roundtrip'); emit('storage','verified');
      assert.equal(sql(target,"SELECT count(*) FROM synthetic_backup.items i LEFT JOIN storage.objects o ON o.name=i.path AND o.bucket_id='synthetic-backup' AND o.owner_id=i.user_id::text WHERE o.id IS NULL"),'0');passed('reference-integrity');
      emit('restore','verified');
    });
    await failureSelfTest(name=>passed(name));
    assert.equal(completed.size,caseNames.length);
  } finally { key.fill(0); rmSync(disk,{recursive:true,force:true}); }
}

export async function failureSelfTest(record = () => {}) {
  for (const failedStage of exportStages) {
    const events=[];
    const error=new Error('synthetic-password=never-print SQL PRIVATE JWT');
    assert.throws(()=>{
      for(const stage of exportStages) exportStep(stage,()=>{
        if(stage===failedStage)throw error;
        return 'private-dump-content';
      },result=>events.push(result));
    },caught=>caught===error);
    assert.deepEqual(events.filter(e=>e.status==='failed'),[{stage:failedStage,status:'failed'}]);
    assert.equal(events.length,2*(exportStages.indexOf(failedStage)+1));
    assert(events.every(e=>exportStages.includes(e.stage) && ['success','failed','unverified'].includes(e.status)));
    assert(!/PRIVATE|JWT|password|dump-content/.test(JSON.stringify(events)));
  }
  assert.deepEqual(safeExportResult('private-secret','private-output'),{stage:'unknown',status:'unverified'});
  const clean=new Set(['source']);
  assert.equal(fallbackRequired('source',clean),false);
  assert.equal(fallbackRequired('target',clean),true);
  for(const [callbackFails,cleanupFails] of [[true,false],[false,true],[true,true]]) {
    const events=[];const callbackError=new Error('synthetic-secret');
    await assert.rejects(()=>observeCompatibilityStaging(async cb=>{
      let error;try{await cb();}catch(e){error=e;}
      if(cleanupFails)throw new Error('private-cleanup-error');if(error)throw error;
    },async()=>{if(callbackFails)throw callbackError;},(stage,status)=>events.push({stage,status})));
    assert.equal(events.find(e=>e.stage==='resources').status,cleanupFails?'failed':'success');
    assert(!JSON.stringify(events).includes('secret'));
  }
  record('callback-failure');record('cleanup-failure');
  const child=new EventEmitter();let killed=false;
  const result=await waitBoundedChild(child,5,()=>{killed=true;child.emit('close',null);});
  assert(result.timedOut && killed && result.code===null);record('timeout');
}
export function validManifestPath(path) {
  if(typeof path!=='string')return false;
  const prefix=join(tmpdir(),'pr1-supabase-');
  return path.startsWith(prefix) && /^\d+-[a-f0-9]{12}-[A-Za-z0-9]{6}\/ownership\.json$/.test(path.slice(prefix.length));
}
async function supervise() {
  assert.equal(process.platform,'linux');assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
  assert.equal(process.env.SYNTHETIC_BACKUP_ONLY,'1');
  for(const name of Object.keys(process.env)) assert(!/^(?:SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD|PGPASSWORD|PGSERVICE|DATABASE_URL|PRODUCTION_.*)$/.test(name));
  // Do not forward arbitrary repository/host environment secrets or Docker overrides.
  const childEnv=Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','SUPABASE_USE_SLIM_IMAGES'].filter(name=>typeof process.env[name]==='string').map(name=>[name,process.env[name]]));
  const child=spawn(process.execPath,[self,'--child'],{env:childEnv,detached:true,stdio:['ignore','ignore','ignore','ipc']});
  const manifests=new Set(), cleaned=new Set(), cases=new Set();let resources=0;let failed=false;let activeManifest;
  child.on('message',m=>{
    if(m?.kind==='backup-manifest' && validManifestPath(m.path)){
      if (activeManifest && !cleaned.has(activeManifest)) failed=true;
      activeManifest=m.path; manifests.add(m.path);
    }
    if(m?.kind==='restore-result'){
      const result=safeRestoreResult(m.stage,m.status);
      if(result.status==='failed')failed=true;
      console.log(`backup_restore_stage=${result.stage} status=${result.status}`);
    }
    if(m?.kind==='export-result'){
      const result=safeExportResult(m.stage,m.status);
      if(result.status==='failed')failed=true;
      console.log(`backup_export_stage=${result.stage} status=${result.status}`);
    }
    if(m?.kind==='backup-network'){
      const result=safeNetworkResult(m.path,m.status);
      console.log(`backup_network=${result.path} tcp=${result.status} authentication=unverified`);
    }
    if(m?.kind==='backup-network-container'){
      const operation=['create','start','exit'].includes(m.operation)?m.operation:'unknown';
      const status=['success','failed','unverified'].includes(m.status)?m.status:'unverified';
      console.log(`backup_network_container=${operation} status=${status}`);
    }
    if(m?.kind==='roles-dump-result'){
      const status=safeRoleDumpStatus(m.status);
      if(status!=='success' && status!=='unverified')failed=true;
      console.log(`backup_roles_dump=${status}`);
    }
    if(m?.kind==='case' && caseNames.includes(m.name) && m.status==='verified'){
      if(cases.has(m.name))failed=true;cases.add(m.name);console.log(`backup_case=${m.name} status=verified`);
      console.log(`backup_case_type=${['callback-failure','timeout','cleanup-failure'].includes(m.name)?'synthetic-failure-injection':'isolated-rehearsal'}`);
    }
    if(m?.kind==='result'){
      const result=safeResult(m.stage,m.status);
      if(result.stage==='resources' && result.status==='verified'){
        resources++;
        if(activeManifest && !cleaned.has(activeManifest))cleaned.add(activeManifest);
        else failed=true;
      }
      if(result.status==='failed')failed=true;
      console.log(`backup_stage=${result.stage} status=${result.status}`);
    }
  });
  const result=await waitBoundedChild(child,40*60_000,()=>{try{process.kill(-child.pid,'SIGKILL');}catch{/* already exited */}});
  const success=result.code===0 && !result.timedOut && !failed && cases.size===caseNames.length && resources===2 && manifests.size===2;
  if(!success){
    try{process.kill(-child.pid,'SIGKILL');}catch{/* already exited */}
    for(const manifest of manifests){
      if(!fallbackRequired(manifest,cleaned)){
        console.log('backup_stage=fallback-cleanup status=not-needed');
        continue;
      }
      let status='unverified';
      // Missing manifest means normal cleanup may have completed; absence is not proof.
      try{
        if(lstatSync(manifest).isFile()){
          const r=spawnSync(process.execPath,[helper,'--cleanup-manifest',manifest],{env:childEnv,stdio:'ignore',timeout:120000,killSignal:'SIGKILL'});
          status=!r.error&&!r.signal&&r.status===0?'verified':'failed';
        }
      }catch{/* keep unverified */}
      console.log(`backup_stage=fallback-cleanup status=${status}`);
    }
  }
  if(success)console.log('backup_stage=fallback-cleanup status=not-needed');
  console.log(`backup_total=${caseNames.length} verified=${cases.size} incomplete=${caseNames.length-cases.size} skipped=0`);
  console.log(`backup_acceptance=${success?'verified':'failed'} production_recoverability=unverified managed_schema_lossless=unverified vault_restore=unverified`);
  if(!success)process.exitCode=1;
}
if(process.argv[1] && resolve(process.argv[1])===self){
  process.umask(0o077);
  const mode=process.argv[2];
  const main=mode==='--run'?supervise:mode==='--child'&&process.send?rehearsal:mode==='--security-self-test'?failureSelfTest:null;
  if(!main || process.argv.length!==3){console.error('backup_status=failed');process.exitCode=1;}
  else main().then(()=>{if(mode==='--security-self-test')console.log('backup_failure_selftest=verified');}).catch(()=>{
    if(process.send)emit('callback','failed');else console.error('backup_status=failed');process.exitCode=1;
  });
}
