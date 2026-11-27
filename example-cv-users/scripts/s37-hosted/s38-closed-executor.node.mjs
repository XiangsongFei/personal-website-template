// Local S3.8 rehearsal only. No CLI, HTTP ingress or hosted target selection.
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, isAbsolute, join } from 'node:path';
import { boundAccountContext, withCredential } from '../../lib/business/identity.mjs';
import { startPrivatePostgrest } from '../shared/private-postgrest.node.mjs';
import { runPrivateRecovery } from '../shared/recovery-journal.node.mjs';
import { isS38AuthBinding } from './s38-auth-binding.node.mjs';
import { freezeS38ClosedCases } from './s38-closed-case-plan.mjs';
import { correlateLocalS38Denials } from './s38-local-source-provenance.mjs';

const issuer = 'https://s38.fixture.invalid/auth/v1';
const schema = 'site_api';
const connectionRole = 'ecv_s3_internal_api_login';
const executionRole = 'authenticated';
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const fail = code => { throw Error('S38_CLOSED_EXECUTOR_' + code); };
const expectedStatus = Object.freeze({ '42501': 403, PT503: 503 });

function fixtureRoot(directory) {
  if (!isAbsolute(directory ?? '')) fail('FIXTURE_DIRECTORY');
  const root = dirname(directory);
  const prefix = realpathSync('/tmp') + '/ecv-s38-closed-';
  if (!root.startsWith(prefix) || !/^[a-zA-Z0-9]{6}$/.test(root.slice(prefix.length)) ||
      directory !== join(root, 'journal') || realpathSync(root) !== root) fail('FIXTURE_DIRECTORY');
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700)
    fail('FIXTURE_DIRECTORY');
  return root;
}

function requireFixtureDatabase(databaseUri, root) {
  let uri;
  try { uri = new URL(databaseUri); } catch { fail('FIXTURE_DATABASE'); }
  if (uri.protocol !== 'postgresql:' || uri.hostname !== 'localhost' || uri.port || uri.hash ||
      uri.username !== connectionRole || uri.password || uri.pathname !== '/postgres' ||
      [...uri.searchParams.keys()].sort().join(',') !== 'host,port' ||
      !/^\d{4,5}$/.test(uri.searchParams.get('port') ?? '') || uri.searchParams.get('host') !== root)
    fail('FIXTURE_DATABASE');
}

function invoke(socketPath, plan, token, signal) {
  return new Promise((resolve, reject) => {
    const pending = request({ socketPath, path: '/rpc/' + plan.rpc, method: 'POST', agent: false, signal,
      headers: {
        authorization: 'Bearer ' + token, 'content-type': 'application/json',
        'content-length': Buffer.byteLength(plan.body), 'content-profile': schema, 'accept-profile': schema,
        'x-request-id': plan.requestId, 'x-s38-case-sha256': plan.requestSha256, 'x-s38-body-sha256': plan.bodySha256,
      },
    }, async response => {
      try {
        const chunks = [];
        let length = 0;
        if (response.statusCode !== expectedStatus[plan.sqlstate] ||
            response.headers['content-type']?.split(';')[0] !== 'application/json') fail('HTTP_DENIAL');
        for await (const chunk of response) {
          if ((length += chunk.length) > 4096) fail('HTTP_DENIAL');
          chunks.push(chunk);
        }
        if (!response.complete) fail('HTTP_UNKNOWN');
        const bytes = Buffer.concat(chunks, length);
        const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (parsed?.code !== plan.sqlstate || parsed?.message !== plan.reason ||
            parsed.hint != null || parsed.details != null) fail('HTTP_DENIAL');
        resolve(Object.freeze({ status: response.statusCode, bodySha256: sha(bytes) }));
      } catch {
        response.destroy();
        reject(Error('S38_CLOSED_EXECUTOR_HTTP_UNKNOWN'));
      }
    });
    pending.once('error', () => reject(Error('S38_CLOSED_EXECUTOR_HTTP_UNKNOWN')));
    pending.end(plan.body);
  });
}

// The source and closure callbacks belong to an independent fixture observer.
// A reopened journal acquires no JWT and cannot enter the dispatch lane.
export async function runS38ClosedFixture({ lane, cases, fixtureId, targetFingerprint, protectedSha256,
  directory, python, runtime, identity, handles, authBinding, authScopeSha256, readSource, readClosure, signal } = {}) {
  const plan = freezeS38ClosedCases(lane, cases, { fixture: true });
  if (!/^[0-9a-f]{32}$/.test(fixtureId ?? '') || !digest(targetFingerprint) || !digest(protectedSha256) ||
      typeof readSource !== 'function' || typeof readClosure !== 'function' || readSource === readClosure ||
      (authScopeSha256 !== undefined && !digest(authScopeSha256)) ||
      (authBinding && (!isS38AuthBinding(authBinding) || authBinding.scopeSha256 !== authScopeSha256 ||
        authBinding.targetFingerprint !== targetFingerprint ||
        authBinding.issuer !== issuer)))
    fail('SCOPE');

  const root = fixtureRoot(directory);
  const operations = plan.map(item => 'case-' + item.requestId);
  const scopeSha256 = sha(JSON.stringify(['s38.closed.fixture.v1', lane, fixtureId, targetFingerprint,
    protectedSha256, plan.map(item => item.requestSha256), ...(authScopeSha256 ? [authScopeSha256] : [])]));
  const requestIds = Object.freeze(plan.map(item => item.requestId));
  const denials = [];
  async function source(item, sourceSignal) {
    const raw = await readSource({ requestId: item.requestId, signal: sourceSignal });
    const [event] = correlateLocalS38Denials({ raw, requests: [item], fixtureId,
      definitions: { [item.decisionFunction]: { originalSha256: item.definitionSha256, branches: item.branches } } });
    return event;
  }

  const result = await runPrivateRecovery({
    directory, python, signal, scopeSha256, operations: { business: operations, close: [] },
    async work(journal) {
      requireFixtureDatabase(runtime?.databaseUri, root);
      if (authScopeSha256 && (!authBinding || typeof runtime.jwtSecret !== 'string' ||
        sha(runtime.jwtSecret) !== authBinding.jwksSha256)) fail('IDENTITY');
      if (!(handles instanceof Map) || handles.size !== new Set(plan.map(item => item.sid)).size) fail('IDENTITY');
      for (const item of plan) verifyIdentity(item);
      const socketPath = join(root, 'api', 'rpc.sock');
      const handle = await startPrivatePostgrest({
        binary: runtime.binary, databaseUri: runtime.databaseUri, jwtSecret: runtime.jwtSecret,
        audience: executionRole, schema, socketPath, transactionEnd: 'rollback', identityRpc: 'observe_identity',
        identityToken: runtime.identityToken, connectionRole, executionRole, targetFingerprint, signal: journal.signal,
      });
      let originalSocket, originalDirectory, failure;
      try {
        originalSocket = lstatSync(socketPath);
        originalDirectory = lstatSync(dirname(socketPath));
        for (const [index, item] of plan.entries()) {
          const accountHandle = verifyIdentity(item);
          if (authBinding) await authBinding.observeActor({ handle: accountHandle, uid: item.uid, sid: item.sid,
            requestId: item.requestId, signal: AbortSignal.any([journal.signal, AbortSignal.timeout(3000)]) });
          await journal.dispatch(operations[index], item.requestSha256, async dispatchSignal => {
            const socket = lstatSync(socketPath);
            if (!socket.isSocket() || socket.dev !== originalSocket.dev || socket.ino !== originalSocket.ino ||
                socket.uid !== process.getuid() || (socket.mode & 0o7777) !== 0o600) fail('SOCKET');
            const wire = await withCredential(accountHandle, token => invoke(socketPath, item, token,
              AbortSignal.any([dispatchSignal, AbortSignal.timeout(3000)])));
            const event = await source(item, dispatchSignal);
            denials.push(Object.freeze({ requestId: item.requestId, wire, event }));
            return absence(item, event, wire);
          });
        }
      } catch (error) {
        failure = error;
      }
      try {
        if ((await handle.close()).code !== 0) fail('RUNTIME_CLOSE');
        const stale = lstatSync(socketPath, { throwIfNoEntry: false });
        if (stale) {
          const parent = lstatSync(dirname(socketPath));
          if (!stale.isSocket() || stale.dev !== originalSocket?.dev || stale.ino !== originalSocket.ino ||
              !parent.isDirectory() || parent.dev !== originalDirectory?.dev || parent.ino !== originalDirectory.ino)
            fail('SOCKET_CHANGED');
          unlinkSync(socketPath);
        }
      } catch (cleanup) {
        if (failure) throw new AggregateError([failure, cleanup], 'S38_CLOSED_EXECUTOR_STOP_AND_CLOSE');
        throw cleanup;
      }
      if (failure) throw failure;
    },
    async close(journal) {
      for (const [index, item] of plan.entries()) {
        if (journal.inspect(operations[index]).state !== 'unknown') continue;
        const event = await source(item, journal.signal);
        journal.reconcile(operations[index], absence(item, event, null));
        denials.push(Object.freeze({ requestId: item.requestId, wire: null, event }));
      }
    },
    async observeClosed({ signal: closeSignal }) {
      const end = await readClosure({ fixtureId, targetFingerprint, requestIds, signal: closeSignal });
      return {
        closed: end?.fixtureId === fixtureId && end.targetFingerprint === targetFingerprint &&
          Array.isArray(end.requestIds) && end.requestIds.length === requestIds.length &&
          requestIds.every((id, index) => end.requestIds[index] === id) &&
          end.protectedSha256 === protectedSha256 && end.gatesClosed === true && end.runtimeStopped === true &&
          end.connections === 0 && end.lateWritePossible === false,
        receiptSha256: end?.receiptSha256,
      };
    },
  });
  return Object.freeze({ ...result, evidence: 'LOCAL_FIXTURE_ONLY', denials: Object.freeze(denials) });

  function verifyIdentity(item) {
    const handle = handles.get(item.sid);
    const who = authBinding ? authBinding.verifyActor(handle) : boundAccountContext(handle, identity, issuer);
    if (who.uid !== item.uid || who.session_id !== item.sid) fail('IDENTITY');
    return handle;
  }
}

// "Absent" describes a business mutation. A source-only result does not
// manufacture the lost HTTP receipt, even when the original denial is proven.
function absence(item, event, wire) {
  return { disposition: 'absent', receiptSha256: sha(JSON.stringify([item.requestSha256, event, wire])) };
}
