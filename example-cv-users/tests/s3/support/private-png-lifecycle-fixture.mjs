import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPrivatePngLifecycle } from '../../../lib/business/private-png-lifecycle.node.mjs';
import { preparePrivatePng } from '../../../lib/business/private-png-content.node.mjs';
import { ASSET_BUCKET, assetObjectKey } from '../../../lib/business/asset-protocol.mjs';
import { createIdentityAdapter } from '../../../lib/business/identity.mjs';
import { binding, id, now, originalAccount, qualification } from './private-png-authorization-fixture.mjs';

export const bytes = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b55' +
  '0000000a49444154789c6330020000340033ce83246f0000000049454e44ae426082', 'hex');
const actor = originalAccount;
const worker = { uid: id(30), session_id: id(31) };
const requests = Object.freeze(Object.fromEntries([
  'prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'complete',
  'prepare-close', 'claim-close', 'authorize-verify-close', 'close',
].map((step, index) => [step, id(40 + index)])));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = Buffer.from(bytes).toString('hex');
const liveUntil = now / 1000 + 3600;
const verifierDigest = 'e'.repeat(64);
const createdRequest = id(57);
const readRequest = id(58);

export async function memoryStore() {
  const events = new Map();
  const leases = new Set();
  let xid = 100;
  return {
    add(id, value, effect) {
      assert.ok(!events.has(id));
      if (effect === 'open') leases.add(id);
      if (effect === 'close') leases.clear();
      if (effect?.closeLease) leases.delete(effect.closeLease);
      events.set(id, { ...value, xid: String(++xid) });
    },
    get(id) { return events.get(id); },
    countLeases() { return leases.size; },
    hasLease(id) { return leases.has(id); },
  };
}

export async function lifecycleFixture({ root, authRoot, python, store, fault, calls = [], createTail, roles = { seal: 'fixture_verify', complete: 'fixture_complete' } }) {
  const { prepare: png } = await preparePrivatePng({
    original_filename: 'fixture.png', site_id: id(4), request_id: requests.prepare,
  }, 'image/png', bytes);
  const plan = { owner_uid: actor.uid, owner_sid: actor.session_id, worker_uid: worker.uid, worker_sid: worker.session_id,
    run_id: id(32), grant_id: id(33), epoch: 4, generation: 'fixture-v1', png, requests,
    validator_sha256: verifierDigest, seal_role: roles.seal, complete_role: roles.complete };
  const nativeVersion = id(36);
  const asset = {
    id: id(37), intent_id: id(38), asset_id: id(34), object_version: id(35), native_version: null,
    project: binding.project, run_id: plan.run_id, site_id: png.site_id, prepare_request_id: requests.prepare,
    owner_uid: actor.uid, owner_sid: actor.session_id, worker_uid: worker.uid, worker_sid: worker.session_id,
    bucket_id: ASSET_BUCKET, byte_size: png.byte_size, sha256: png.sha256, mime_type: png.mime_type,
  };
  asset.object_key = assetObjectKey(asset);
  const pending = Object.freeze(asset);
  const uploaded = Object.freeze({ ...pending, native_version: nativeVersion });
  const identity = createIdentityAdapter({ issuer: binding.authIssuer, clock: () => now / 1000, auth: {
    async verifyTokenAndUser(token) {
      const current = token === 'fixture-worker' ? worker : actor;
      return { data: { claims: { iss: binding.authIssuer, aud: 'authenticated', role: 'authenticated',
        sub: current.uid, session_id: current.session_id, exp: liveUntil, is_anonymous: false,
        amr: [{ method: 'password' }] }, user: { id: current.uid, is_anonymous: false,
        email_confirmed_at: '2026-01-01T00:00:00Z' } } };
    },
  } });
  const authorization = { journalRoot: authRoot,
    writer: {
      async transaction(bound, _proof, work) {
        const { intent } = bound;
        const state = intent.operation === 'authorize-verify' ? uploaded : pending;
        await work({
          async qualification() {
            const proof = qualification(intent, now);
            if (proof.permit) proof.permit = { ...proof.permit, ...state };
            return proof;
          },
          async apply() {
            calls.push(intent.operation);
            const row = { asset: state, inner: bound.intentSha256, state: 'pending' };
            if (intent.operation === 'claim') {
              row.upload_request_id = fault?.wrongPostKey ? readRequest : requests.post;
              row.permit_reserved = true;
            }
            await store.add(intent.request_id, row, 'open');
          },
        });
      },
      async close(bound, key) {
        await store.add(key, { inner: bound.intentSha256 }, { closeLease: bound.intent.request_id });
      },
    },
    observer: {
      async lookup(bound, { request_id, lane }) {
        const row = await store.get(request_id);
        return { intent_sha256: row?.inner ?? bound.intentSha256, request_id, lane,
          settled: true, disposition: row ? 'committed' : 'absent', xid: row?.xid ?? null,
          receipt_sha256: hash([request_id, row ?? null]) };
      },
      async closed(bound, { request_id }) {
        const count = Number(await store.hasLease(bound.intent.request_id));
        return { intent_sha256: bound.intentSha256, request_id, active_command_leases: count,
          in_flight: 0, late_write_possible: false, closed: count === 0, receipt_sha256: hash(count) };
      },
    },
  };
  async function record(step, value, effect) {
    await store.add(requests[step], value, effect);
    if (fault?.kill === step) process.kill(process.pid, 'SIGKILL');
  }
  const tail = await createTail?.({ binding, plan, asset: uploaded, requests });
  const tailSteps = ['seal', 'complete', 'close'];
  const lifecycle = createPrivatePngLifecycle({ binding, identity, authorization, plan, directory: root, python,
    observer: {
      async lookup(intent, signal) {
        if (tail && tailSteps.includes(intent.step)) return tail.observer.lookup(intent, signal);
        const row = await store.get(intent.request_id);
        const mutates = intent.step !== 'verify';
        const witness = fault?.alter === intent.step && row ? { ...row, ...fault.changed } : row;
        return { ...witness, request_id: intent.request_id, intent_sha256: intent.intent_sha256,
          project: binding.project, step: intent.step, settled: fault?.unknown !== intent.step,
          late_write_possible: fault?.unknown === intent.step, disposition: row ? 'committed' : 'absent',
          xid: row && mutates ? row.xid : null, receipt_sha256: hash([intent.request_id, row ?? null]),
          qualification_current: !fault?.revokedAfterRead || !calls.includes('verify') };
      },
      async closed(intent, options) {
        const count = await store.countLeases();
        const retained = await store.get(requests.post);
        const ready = await store.get(requests.complete);
        const command_status = await Promise.all(['prepare', 'claim', 'authorize-verify'].map(async step => ({
          request_id: requests[step], close_request_id: requests[step + '-close'],
          command_leases: Number(await store.hasLease(requests[step])), in_flight: 0,
          late_write_possible: fault?.innerLate === step,
        })));
        const actualTail = await tail?.observer.closed(intent, options);
        return { closed: count === 0 && (actualTail?.closed ?? !tail), project: binding.project, command_status,
          retained_ready: tail ? actualTail.retained_ready :
            ready ? { complete_xid: ready.xid, seal_xid: ready.seal_xid, verifier_sha256: ready.verifier_sha256 } : null,
          retained_png: fault?.retainedDrift ? pending : retained?.asset ?? null,
          retained_post_xid: retained?.xid ?? null, intent_sha256: intent.intent_sha256,
          request_id: intent.request_id, late_write_possible: false, protection_preserved: !fault?.drift,
          sessions: 0, refresh: 0, grants: 0, permits: 0, generations: 0, active_runs: 0,
          connected: 0, leases: count, temporary_permissions: 0, receipt_sha256: hash([intent.request_id, count]) };
      },
    },
    storage: {
      publishableKey: 'sb_publishable_fixture',
      async fetcher(url, options, context) {
        calls.push('post');
        assert.equal(url, 'https://' + binding.project + '.supabase.co/storage/v1/object/' + ASSET_BUCKET + '/' + asset.object_key);
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer fixture-worker');
        assert.equal(options.headers['x-upsert'], 'false');
        assert.equal(Buffer.from(options.body).toString('hex'), digest);
        const claim = await store.get(requests.claim);
        assert.equal(context.intent.request_id, claim.upload_request_id);
        assert.equal(context.claim_xid, claim.xid);
        await record('post', { asset: uploaded, state: 'pending', upload_request_id: requests.post,
          claim_xid: fault?.otherClaim ? '99999' : claim.xid, permit_consumed: !fault?.badPermit,
          storage_request_id: createdRequest, storage_request_role: 'authenticated',
          native_session_user: 'supabase_storage_admin', native_effective_role: 'service_role' }, 'open');
        if (fault?.lost === 'post') throw Error('fixture POST receipt lost');
        return new Response(null, { status: 200, headers: { 'sb-request-id': createdRequest } });
      },
      async readVersion({ asset }) {
        calls.push('verify');
        assert.deepEqual(asset, uploaded);
        return { version: fault?.badVersion ? id(100) : nativeVersion, worker_uid: worker.uid,
          worker_sid: worker.session_id, no_cache: !fault?.cached, status: 200, mime_type: png.mime_type,
          storage_request_id: readRequest, validator_sha256: verifierDigest,
          bytes: fault?.corrupt ? bytes.subarray(1) : bytes };
      },
      async recordVerified(intent, receipt, sha) {
        await record('verify', { verifier_receipt: receipt, verifier_sha256: sha });
        await tail?.registerFixtureReceipt(intent, receipt, sha);
      },
    },
    writer: {
      async seal(intent, receipt, sha, signal) {
        calls.push('seal');
        if (tail) return tail.writer.seal(intent, receipt, sha, signal);
        await record('seal', { asset: uploaded, verifier_sha256: sha, state: 'sealed', execution_role: plan.seal_role });
        if (fault?.lost === 'seal') throw Error('fixture Seal receipt lost');
      },
      async complete(intent, receipt, sha, seal, signal) {
        calls.push('complete');
        if (tail) return tail.writer.complete(intent, receipt, sha, seal, signal);
        assert.deepEqual(seal, { request_id: requests.seal, xid: (await store.get(requests.seal)).xid });
        await record('complete', { asset: uploaded, verifier_sha256: sha, state: 'ready', execution_role: plan.complete_role,
          seal_request_id: seal.request_id, seal_xid: fault?.otherSeal ? '999999' : seal.xid });
      },
      async close(intent, signal) {
        calls.push('close');
        if (tail) await tail.writer.close(intent, signal);
        await record('close', {}, 'close');
      },
    },
  });
  return { lifecycle, requests, owner: await identity.verifyAccount('fixture-owner'),
    worker: await identity.verifyAccount('fixture-worker') };
}
