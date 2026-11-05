// Runs the existing Workers bundle, never the old Node probe application.
import {assertCurrentNode} from './https/node-identity.mjs';
import https from 'node:https';
import {readFileSync, writeFileSync, appendFileSync, mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createInterface} from 'node:readline';
import {spawnSync} from 'node:child_process';
import {runtime} from '../tests/runtime.mjs';
import {realAuthority} from '../tests/auth-fixture.mjs';
// Reuse only the prior certificate's validated, synchronous TLS identity loader.
import {CERT, readPublicCertificate, loadServerIdentity} from './https/identity.mjs';
import {HTTPS_ORIGIN, authorizeLocalRequest, outgoingHeaders, cookieNames, cookieMetadata, browserFamily} from './local-https-boundary.mjs';

assertCurrentNode();
const root = resolve('.');
// Explicit server CLI argument allows a newly fingerprinted build; never a browser parameter.
const manifest = JSON.parse(readFileSync(resolve(root, process.argv[2] ?? 'evidence/s2-parity-20261104/build-manifest.json')));
for (const file of [...manifest.source, ...manifest.artifacts]) {
  if (createHash('sha256').update(readFileSync(resolve(root, file.path))).digest('hex') !== file.sha256) throw Error('business_build_mismatch');
}
const certificate = readPublicCertificate();
// Evaluate existing macOS SSL/host trust only. No supplied trust anchor, install,
// exception or Keychain mutation. A valid date alone does not authorize startup.
const trust = spawnSync('/usr/bin/security', ['verify-cert', '-c', CERT, '-p', 'ssl', '-s', '127.0.0.1'],
  {encoding: 'utf8', timeout: 5000, maxBuffer: 16384});
if (trust.error || trust.signal || trust.status !== 0) throw Error('trusted_https_unavailable_no_services_started');
const run = mkdtempSync(resolve(root, '.runtime/safari-https-live-'));
const emit = value => {
  const line = JSON.stringify({at: new Date().toISOString(), ...value});
  appendFileSync(resolve(run, 'events.jsonl'), line + '\n', {mode: 0o600});
  console.log(line);
};
const authority = await realAuthority();
let upstreamSequence = 0;
const mf = runtime({port: 0, unsafeInspectDurableObjects: false, resourcePersistencePath: resolve(run, 'state'),
  bindings: {USERS_CURRENT_PASSWORD_POLICY: 'ON', USERS_MODE: 'isolated', USERS_PROJECT_REF: 'isolated-users',
    USERS_SUPABASE_URL: 'https://users.auth.example.invalid', USERS_PUBLISHABLE_KEY: 'sb_publishable_SYNTHETIC_REAL_CONTRACT_ONLY', USERS_APP_ORIGIN: HTTPS_ORIGIN},
  outboundService: async request => {
    const url = new URL(request.url);
    const stage = url.pathname === '/auth/v1/token' ? 'token_' + url.searchParams.get('grant_type') : url.pathname.split('/').at(-1);
    if (url.origin !== 'https://users.auth.example.invalid' || request.method === 'PUT' || !['token_password', 'token_refresh_token', 'user', 'logout', 'jwks.json'].includes(stage)) throw Error('diagnostic_outbound_denied');
    const seq = ++upstreamSequence;
    try {
      const response = await authority.fetch(request);
      let fixtureIdentityMatches;
      if (response.ok && stage === 'user') {
        const user = await response.clone().json();
        fixtureIdentityMatches = user.id === authority.ids.A && user.email === 'user-a@example.invalid' || user.id === authority.ids.B && user.email === 'user-b@example.invalid';
      }
      emit({kind: 'synthetic_auth', seq, stage, status: response.status, ...(fixtureIdentityMatches !== undefined ? {fixtureIdentityMatches} : {})});
      return response;
    } catch { emit({kind: 'synthetic_auth', seq, stage, status: null, reason: 'synthetic_connection_failure'}); throw Error('synthetic_connection_failure'); }
  }});
await mf.ready;
let sequence = 0, stopping = false;
const active = new Set();
const handler = async (req, res) => {
  const seq = ++sequence;
  let authorized;
  try {
    if (stopping) throw Error('stopping');
    authorized = authorizeLocalRequest(req);
    let body;
    if (req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) throw Error('body_too_large'); chunks.push(chunk); }
      body = Buffer.concat(chunks);
    }
    const observed = !authorized.path.startsWith('/assets/') && !/\.(?:js|css|ico|svg|woff2?)$/.test(authorized.path);
    if (observed) emit({kind: 'request', seq, browser: browserFamily(req.headers['user-agent']), method: authorized.method, path: authorized.path,
      cookieNames: cookieNames(authorized.headers.get('cookie') ?? ''), originMatches: req.method !== 'POST' || req.headers.origin === HTTPS_ORIGIN});
    const response = await mf.dispatchFetch(authorized.url, {method: authorized.method, headers: authorized.headers, ...(body ? {body} : {}), redirect: 'manual'});
    body?.fill(0);
    const headers = outgoingHeaders(response);
    if (observed) emit({kind: 'response', seq, status: response.status, location: headers.location ?? null,
      cacheControl: headers['cache-control'], setCookies: (headers['set-cookie'] ?? []).map(cookieMetadata)});
    res.writeHead(response.status, headers);
    if (req.method === 'HEAD' || !response.body) { await response.body?.cancel(); res.end(); }
    else await pipeline(Readable.fromWeb(response.body), res);
  } catch {
    emit({kind: 'request_failed', seq, reason: authorized ? 'local_dispatch_failed' : 'local_boundary_rejected'});
    if (!res.headersSent) res.writeHead(stopping ? 503 : 403, {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store'});
    res.end('{"ok":false}');
  }
};
const server = loadServerIdentity('tls', options => https.createServer(options, (req, res) => {
  const promise = handler(req, res); active.add(promise); promise.finally(() => active.delete(promise));
}));
server.requestTimeout = 20000; server.headersTimeout = 10000;
try { await new Promise((ok, no) => { server.once('error', no); server.listen(8787, '127.0.0.1', ok); }); }
catch { await mf.dispose(); throw Error('local_https_listen_failed'); }
writeFileSync(resolve(run, 'runtime.json'), JSON.stringify({sourceSha256: manifest.sourceSha256, artifactSha256: manifest.artifactSha256,
  origin: HTTPS_ORIGIN, mode: 'isolated', noNetworkFallback: true, noRemoteBindings: true, node: process.execPath, pid: process.pid,
  workerURL: String(await mf.ready), certificate: {fingerprint: certificate.fingerprint256, validFrom: certificate.validFrom, validTo: certificate.validTo, subjectAltName: certificate.subjectAltName}}, null, 2) + '\n');
emit({kind: 'ready', run, origin: HTTPS_ORIGIN});
console.log('Commands: refresh-network-on, refresh-network-off, stop. No passwords or OTPs in terminal.');
const input = createInterface({input: process.stdin});
async function stop() {
  if (stopping) return; stopping = true;
  let timeout;
  const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('shutdown_timeout')), 10000); });
  try {
    await Promise.race([(async () => {
      const closed = new Promise((ok, no) => server.close(error => error ? no(error) : ok()));
      server.closeIdleConnections();
      await Promise.allSettled([...active]); await closed; await mf.dispose();
    })(), deadline]);
    emit({kind: 'stopped', confirmed: true});
  } catch { emit({kind: 'stopped', confirmed: false, reason: 'shutdown_unconfirmed'}); process.exitCode = 1; server.closeAllConnections(); await mf.dispose().catch(() => {}); }
  finally { clearTimeout(timeout); input.close(); process.stdin.pause(); }
}
input.on('line', line => {
  if (line === 'stop') void stop();
  else if (!stopping && ['refresh-network-on', 'refresh-network-off'].includes(line)) {
    authority.controls.refresh = line === 'refresh-network-on' ? 'network' : 'ok';
    emit({kind: 'fault_control', refreshNetworkFailure: authority.controls.refresh === 'network'});
  }
});
