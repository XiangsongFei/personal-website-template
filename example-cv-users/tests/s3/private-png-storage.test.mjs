import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ASSET_BUCKET, assetObjectKey } from '../../lib/business/asset-protocol.mjs';
import { preparePrivatePng } from '../../lib/business/private-png-content.node.mjs';
import { bindPrivatePngLifecyclePlan } from '../../lib/business/private-png-lifecycle.node.mjs';
import { createPrivatePngStorageTransport } from '../../lib/business/private-png-storage.node.mjs';
import { binding, id, identityFixture, originalAccount } from './support/private-png-authorization-fixture.mjs';
import { bytes } from './support/private-png-lifecycle-fixture.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');

async function fixture({ wrongWitness, clipped } = {}) {
  const commands = ['prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'complete',
    'prepare-close', 'claim-close', 'authorize-verify-close', 'close'];
  const requests = Object.fromEntries(commands.map((step, index) => [step, id(401 + index)]));
  const { prepare: png } = await preparePrivatePng({
    request_id: requests.prepare, site_id: id(423), original_filename: 'test.png',
  }, 'image/png', bytes);
  const workerUid = id(420);
  const workerSid = id(421);
  const input = { owner_uid: originalAccount.uid, owner_sid: originalAccount.session_id,
    worker_uid: workerUid, worker_sid: workerSid, run_id: id(422), grant_id: id(424), epoch: 4,
    generation: 'g1', png, requests, validator_sha256: 'a'.repeat(64), seal_role: 'fixture_seal',
    complete_role: 'fixture_complete' };
  const { plan, planSha256 } = bindPrivatePngLifecyclePlan(binding, input);
  const intent = step => ({ step, request_id: requests[step], plan_sha256: planSha256,
    intent_sha256: sha(JSON.stringify([planSha256, step])) });
  const asset = { id: id(429), intent_id: id(430), project: plan.project, run_id: plan.run_id, site_id: png.site_id,
    prepare_request_id: requests.prepare, owner_uid: plan.owner_uid, owner_sid: plan.owner_sid,
    worker_uid: workerUid, worker_sid: workerSid, asset_id: id(425), object_version: id(426), native_version: null,
    bucket_id: ASSET_BUCKET, mime_type: png.mime_type, byte_size: png.byte_size, sha256: png.sha256 };
  asset.object_key = assetObjectKey(asset);
  const identity = identityFixture({ uid: workerUid, sid: workerSid });
  const worker = await identity.verifyAccount('worker-fixture-token');
  const publishableKey = 'sb_publishable_fixture';
  const endpoint = 'https://' + plan.project + '.supabase.co/storage/v1/object/' + ASSET_BUCKET + '/' + asset.object_key;
  const options = { method: 'POST', redirect: 'error', headers: { apikey: publishableKey,
    'Content-Type': 'image/png', 'x-upsert': 'false', Authorization: 'Bearer worker-fixture-token' }, body: bytes };
  const calls = [];
  const transport = createPrivatePngStorageTransport({ binding, plan: input, identity, publishableKey,
    async sendCreateOnly(url, options, scope) {
      calls.push(['upload', url, options.redirect, options.headers['x-upsert'], scope.claim_xid]);
      return new Response(null, { status: 201 });
    },
    async readNative(request, options) {
      calls.push(['read', request.nativeVersion, options.cache, options.redirect]);
      return new Response(clipped ? bytes.subarray(1) : bytes, { headers: {
        'content-length': String(bytes.byteLength), 'content-type': 'image/png', 'sb-request-id': id(428),
      } });
    },
    async observeNativeRead(request, { requestId }) {
      calls.push(['observe', requestId]);
      return { ...request, originalRequestId: request.requestId, requestId, uid: workerUid, sid: workerSid,
        noCache: true, ...wrongWitness };
    },
    async recordVerified() {},
  });
  return { transport, calls, endpoint, options, post: { intent: intent('post'), asset, claim_xid: '100', worker },
    read: { intent: intent('verify'), asset: { ...asset, native_version: id(427) }, worker } };
}

test('scoped Storage sends create-only once and binds the version through a separate witness', async () => {
  const { transport, calls, endpoint, options, post, read } = await fixture();
  assert.equal((await transport.fetcher(endpoint, options, post)).status, 201);
  assert.deepEqual((await transport.readVersion(read)).bytes, bytes);
  assert.deepEqual(calls, [
    ['upload', endpoint, 'error', 'false', '100'], ['read', id(427), 'no-store', 'error'], ['observe', id(428)],
  ]);
});

test('forged path, bearer, bytes and claim scope are rejected before any Storage call', async () => {
  const { transport, calls, endpoint, options, post } = await fixture();
  for (const args of [
    [endpoint + '?upsert=true', options, post],
    [endpoint, { ...options, headers: { ...options.headers, Authorization: 'Bearer wrong-token' } }, post],
    [endpoint, { ...options, body: bytes.subarray(1) }, post],
    [endpoint, options, { ...post, claim_xid: '0' }],
    [endpoint, options, { ...post, asset: { ...post.asset, worker_sid: id(499) } }],
  ]) await assert.rejects(transport.fetcher(...args), { code: 'PNG_STORAGE_UNPROVEN' });
  assert.deepEqual(calls, []);
});

test('truncated body and drifted native version, request, SID or cache witness fail closed', async () => {
  for (const mode of [{ clipped: true }, { wrongWitness: { nativeVersion: id(499) } },
    { wrongWitness: { originalRequestId: id(499) } }, { wrongWitness: { sid: id(499) } },
    { wrongWitness: { noCache: false } }]) {
    const { transport, read } = await fixture(mode);
    await assert.rejects(transport.readVersion(read), { code: 'PNG_STORAGE_UNPROVEN' });
  }
});
