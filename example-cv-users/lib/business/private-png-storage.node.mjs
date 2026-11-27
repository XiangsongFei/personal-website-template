// Server-side Storage transport contract. No default network or credential source.
import { createHash } from 'node:crypto';
import { ASSET_BUCKET, assetObjectKey } from './asset-protocol.mjs';
import { boundAccountContext, withCredential } from './identity.mjs';
import { bindPrivatePngLifecyclePlan } from './private-png-lifecycle.node.mjs';
import { deny, uuid } from './protocol.mjs';

const fail = () => deny('PNG_STORAGE_UNPROVEN', 503);
const sha = value => createHash('sha256').update(value).digest('hex');
const positiveXid = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const limitedSignal = signal => signal ?
  AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);

async function readExactly(response, size) {
  if (!response?.body || response.headers.get('content-length') !== String(size)) fail();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let done = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) { done = true; break; }
      if (!(next.value instanceof Uint8Array) || (total += next.value.length) > size) fail();
      chunks.push(next.value);
    }
  } finally {
    if (!done) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (total !== size) fail();
  return Buffer.concat(chunks, total);
}

export function createPrivatePngStorageTransport({ binding, plan: input, identity, publishableKey,
  sendCreateOnly, readNative, observeNativeRead, recordVerified } = {}) {
  const callbacks = [sendCreateOnly, readNative, observeNativeRead, recordVerified];
  if (!identity || callbacks.some(fn => typeof fn !== 'function') || new Set(callbacks).size !== callbacks.length ||
      typeof publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey))
    deny('NOT_CONFIGURED', 503);
  const { plan, planSha256 } = bindPrivatePngLifecyclePlan(binding, input);

  function verifyScope(intent, step, asset, versioned) {
    if (intent?.step !== step || intent.request_id !== plan.requests[step] || intent.plan_sha256 !== planSha256 ||
        intent.intent_sha256 !== sha(JSON.stringify([planSha256, step])) ||
        !asset || asset.bucket_id !== ASSET_BUCKET || asset.project !== plan.project || asset.run_id !== plan.run_id ||
        asset.site_id !== plan.png.site_id || asset.owner_uid !== plan.owner_uid || asset.owner_sid !== plan.owner_sid ||
        asset.worker_uid !== plan.worker_uid || asset.worker_sid !== plan.worker_sid ||
        asset.prepare_request_id !== plan.requests.prepare ||
        ![asset.id, asset.intent_id, asset.asset_id, asset.object_version].every(uuid) ||
        asset.object_key !== assetObjectKey(asset) || asset.mime_type !== 'image/png' ||
        asset.byte_size !== plan.png.byte_size || asset.sha256 !== plan.png.sha256 ||
        (versioned ? !uuid(asset.native_version) : asset.native_version !== null)) fail();
  }

  function verifyWorker(worker) {
    const actor = boundAccountContext(worker, identity, binding.authIssuer);
    if (actor.uid !== plan.worker_uid || actor.session_id !== plan.worker_sid) fail();
    return actor;
  }

  return Object.freeze({
    publishableKey,
    async fetcher(url, options, context) {
      const { intent, asset, claim_xid, worker } = context ?? {};
      verifyScope(intent, 'post', asset, false);
      verifyWorker(worker);
      const expectedUrl = 'https://' + plan.project + '.supabase.co/storage/v1/object/' + ASSET_BUCKET + '/' + asset.object_key;
      const bearer = options?.headers?.Authorization;
      if (url !== expectedUrl || options.method !== 'POST' || options.redirect !== 'error' ||
          options.headers.apikey !== publishableKey || options.headers['x-upsert'] !== 'false' ||
          options.headers['Content-Type'] !== 'image/png' || typeof bearer !== 'string' || !/^Bearer \S+$/.test(bearer) ||
          !(options.body instanceof Uint8Array) || options.body.byteLength !== asset.byte_size ||
          sha(options.body) !== asset.sha256 || !positiveXid(claim_xid)) fail();
      const signal = limitedSignal(options.signal);
      signal.throwIfAborted();
      return withCredential(worker, token => {
        if (bearer !== 'Bearer ' + token) fail();
        return sendCreateOnly(expectedUrl, { method: 'POST', redirect: 'error', signal,
          headers: { apikey: publishableKey, Authorization: bearer, 'Content-Type': 'image/png', 'x-upsert': 'false' },
          body: Buffer.from(options.body) }, Object.freeze({ intent, asset, claim_xid }));
      });
    },
    async readVersion({ intent, asset, worker, signal: callerSignal } = {}) {
      verifyScope(intent, 'verify', asset, true);
      const actor = verifyWorker(worker);
      const signal = limitedSignal(callerSignal);
      signal.throwIfAborted();
      const request = Object.freeze({ project: plan.project, requestId: intent.request_id,
        bucket: ASSET_BUCKET, objectKey: asset.object_key, nativeVersion: asset.native_version });
      const response = await withCredential(worker, token =>
        readNative(request, Object.freeze({ token, signal, cache: 'no-store', redirect: 'error' })));
      const requestId = response?.headers?.get('sb-request-id');
      if (response?.status !== 200 || response.redirected || !uuid(requestId) ||
          response.headers.get('content-type') !== asset.mime_type) {
        await response?.body?.cancel();
        fail();
      }
      const bytes = await readExactly(response, asset.byte_size);
      signal.throwIfAborted();
      const witness = await observeNativeRead(request, { requestId, signal });
      if (witness?.project !== plan.project || witness.requestId !== requestId ||
          witness.originalRequestId !== request.requestId ||
          witness.bucket !== ASSET_BUCKET || witness.objectKey !== asset.object_key ||
          witness.nativeVersion !== asset.native_version || witness.uid !== actor.uid ||
          witness.sid !== actor.session_id || witness.noCache !== true || sha(bytes) !== asset.sha256) fail();
      boundAccountContext(worker, identity, binding.authIssuer);
      signal.throwIfAborted();
      return { version: witness.nativeVersion, worker_uid: witness.uid, worker_sid: witness.sid,
        no_cache: true, status: response.status, mime_type: asset.mime_type, storage_request_id: requestId,
        validator_sha256: plan.validator_sha256, bytes };
    },
    recordVerified,
  });
}
