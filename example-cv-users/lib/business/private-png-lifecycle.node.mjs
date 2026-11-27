// Server composition for one approved private PNG lifecycle. Importing it performs no I/O.
import { lstatSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { ASSET_BUCKET, assetObjectKey, prepareAssetInput } from './asset-protocol.mjs';
import { businessBinding } from './binding.mjs';
import { boundAccountContext, withCredential } from './identity.mjs';
import { preparePrivatePng } from './private-png-content.node.mjs';
import { createPrivatePngAuthorization } from './private-png-authorization.node.mjs';
import { deny, exact, uuid } from './protocol.mjs';
import { runPrivateRecovery } from '../../scripts/shared/recovery-journal.node.mjs';

const steps = Object.freeze(['prepare', 'claim', 'post', 'authorize-verify', 'verify', 'seal', 'complete']);
const commandSteps = Object.freeze(['prepare', 'claim', 'authorize-verify']);
const requestNames = Object.freeze([...steps, ...commandSteps.map(step => step + '-close'), 'close']);
const assetFields = Object.freeze(['id', 'intent_id', 'asset_id', 'object_version']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const xid = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const fail = () => deny('LIFECYCLE_UNPROVEN', 503);

function freezePlan(plan, scope) {
  exact(plan, ['run_id', 'owner_uid', 'owner_sid', 'worker_uid', 'worker_sid', 'grant_id',
    'epoch', 'generation', 'png', 'validator_sha256', 'seal_role', 'complete_role', 'requests']);
  const ids = [plan.run_id, plan.owner_uid, plan.owner_sid, plan.worker_uid, plan.worker_sid, plan.grant_id];
  if (!ids.every(uuid) || new Set(ids).size !== ids.length || !Number.isSafeInteger(plan.epoch) || plan.epoch < 0 ||
      typeof plan.generation !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(plan.generation) ||
      !digest(plan.validator_sha256) || ![plan.seal_role, plan.complete_role].every(
        role => typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role)))
    deny('INVALID_INPUT', 400);
  exact(plan.requests, requestNames);
  const requests = Object.freeze(Object.fromEntries(requestNames.map(name => [name, plan.requests[name]])));
  const values = Object.values(requests);
  if (!values.every(uuid) || new Set(values).size !== values.length || values.some(value => ids.includes(value)))
    deny('INVALID_INPUT', 400);
  const png = Object.freeze(prepareAssetInput(plan.png));
  if (png.kind !== 'image' || png.mime_type !== 'image/png' || png.byte_size < 45 || png.byte_size > 65_536 ||
      png.request_id !== requests.prepare) deny('INVALID_INPUT', 400);
  return Object.freeze({ project: scope.project, issuer: scope.authIssuer, run_id: plan.run_id,
    owner_uid: plan.owner_uid, owner_sid: plan.owner_sid, worker_uid: plan.worker_uid, worker_sid: plan.worker_sid,
    grant_id: plan.grant_id, epoch: plan.epoch, generation: plan.generation, png, requests,
    validator_sha256: plan.validator_sha256, seal_role: plan.seal_role, complete_role: plan.complete_role });
}

function exactAsset(plan, reply, previous, native) {
  if (!reply || !assetFields.every(key => uuid(reply[key])) ||
      previous && assetFields.some(key => reply[key] !== previous[key])) fail();
  const asset = Object.fromEntries(assetFields.map(key => [key, reply[key]]));
  const { png } = plan;
  const expected = {
    project: plan.project, run_id: plan.run_id, site_id: png.site_id, prepare_request_id: plan.requests.prepare,
    owner_uid: plan.owner_uid, owner_sid: plan.owner_sid, worker_uid: plan.worker_uid, worker_sid: plan.worker_sid,
    bucket_id: ASSET_BUCKET, object_key: assetObjectKey({ site_id: png.site_id, ...asset, mime_type: png.mime_type }),
    byte_size: png.byte_size, sha256: png.sha256, mime_type: png.mime_type,
  };
  if (Object.entries(expected).some(([key, value]) => reply[key] !== value) ||
      (native ? !uuid(reply.native_version) : reply.native_version !== null) ||
      (previous?.native_version && previous.native_version !== reply.native_version)) fail();
  return Object.freeze({ ...asset, ...expected, native_version: reply.native_version });
}

function command(plan, step, asset) {
  return {
    operation: step, request_id: plan.requests[step], grant_id: plan.grant_id, epoch: plan.epoch,
    generation: plan.generation, png: plan.png,
    permit: asset ? { id: asset.id, intent_id: asset.intent_id, asset_id: asset.asset_id,
      object_version: asset.object_version, native_version: asset.native_version } : null,
  };
}

/**
 * Trusted server collaborators only. The authorization core must use a trusted
 * transactional writer. The observer is a separate readback authority. Lookup
 * proves the original target effect (or a settled absence excluding late writes).
 * Verifier readVersion uses the approved, private version-qualified path.
 * recordVerified may persist a local, immutable receipt in protected custody.
 * Its independent readback has no database XID and cannot write business data.
 */
export function createPrivatePngLifecycle({ binding, identity, authorization, observer, storage,
  writer, plan: input, directory, python } = {}) {
  const scope = businessBinding(binding);
  if (!scope || !identity || ![observer?.lookup, observer?.closed, writer?.seal, writer?.complete,
    writer?.close, storage?.readVersion, storage?.recordVerified].every(fn => typeof fn === 'function') ||
    [writer, storage, authorization?.writer].includes(observer) ||
    !isAbsolute(directory ?? '') || !isAbsolute(python ?? '') ||
    typeof storage?.fetcher !== 'function' || typeof storage?.publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(storage.publishableKey))
    deny('NOT_CONFIGURED', 503);
  const lookup = observer.lookup.bind(observer);
  const closed = observer.closed.bind(observer);
  const authorize = createPrivatePngAuthorization({ binding, identity, python,
    writer: authorization?.writer, observer: authorization?.observer, journalRoot: authorization?.journalRoot }).run;
  const readVersion = storage.readVersion.bind(storage);
  const recordVerified = storage.recordVerified.bind(storage);
  const fetcher = storage.fetcher.bind(storage);
  if (!scope.testOnly && (!/^[a-z0-9]{20}$/.test(scope.project) ||
      scope.authIssuer !== 'https://' + scope.project + '.supabase.co/auth/v1')) deny('NOT_CONFIGURED', 503);
  const { publishableKey } = storage;
  const { seal, complete, close } = Object.fromEntries(['seal', 'complete', 'close']
    .map(step => [step, writer[step].bind(writer)]));
  const plan = freezePlan(input, scope);
  const planHash = hash(['ecv.private-png.lifecycle.v1', plan]);
  const intents = Object.fromEntries([...steps, 'close'].map(step => [step, Object.freeze({
    plan, plan_sha256: planHash, step, request_id: plan.requests[step], intent_sha256: hash([planHash, step]),
  })]));

  async function observe(step, signal) {
    const intent = intents[step];
    const evidence = await lookup(intent, signal);
    if (!evidence || evidence.settled !== true || evidence.late_write_possible !== false ||
        evidence.request_id !== intent.request_id || evidence.intent_sha256 !== intent.intent_sha256 ||
        evidence.project !== plan.project || evidence.step !== step || !digest(evidence.receipt_sha256) ||
        !(evidence.disposition === 'committed' ? (step === 'verify' ? evidence.xid === null : xid(evidence.xid)) :
          evidence.disposition === 'absent' && evidence.xid === null)) fail();
    if (evidence.disposition === 'committed') {
      if (step !== 'close' && step !== 'verify')
        exactAsset(plan, evidence.asset, null, step !== 'prepare' && step !== 'claim');
      if (['prepare', 'claim', 'post', 'authorize-verify'].includes(step) && evidence.state !== 'pending') fail();
      if (step === 'claim' && (evidence.upload_request_id !== plan.requests.post || evidence.permit_reserved !== true)) fail();
      if (step === 'post' && (evidence.upload_request_id !== plan.requests.post || !xid(evidence.claim_xid) ||
          evidence.permit_consumed !== true || !uuid(evidence.storage_request_id) ||
          evidence.storage_request_role !== 'authenticated' || evidence.native_session_user !== 'supabase_storage_admin' ||
          evidence.native_effective_role !== 'service_role')) fail();
      if (['verify', 'seal', 'complete'].includes(step) && !digest(evidence.verifier_sha256)) fail();
      if ((step === 'seal' && (evidence.state !== 'sealed' || evidence.execution_role !== plan.seal_role)) ||
          (step === 'complete' && (evidence.state !== 'ready' || evidence.execution_role !== plan.complete_role ||
            evidence.seal_request_id !== plan.requests.seal || !xid(evidence.seal_xid)))) fail();
    }
    return { evidence, disposition: evidence.disposition, receiptSha256: evidence.receipt_sha256 };
  }

  function verifyReceipt(receipt, write) {
    const asset = exactAsset(plan, receipt, write.asset, true);
    if (!receipt || receipt.post_xid !== write.xid || receipt.verify_request_id !== plan.requests.verify ||
        !uuid(receipt.storage_request_id) || receipt.storage_request_id === write.storage_request_id ||
        receipt.validator_sha256 !== plan.validator_sha256) fail();
    return hash(['ecv.private-png.verifier.v1', { ...asset, post_xid: receipt.post_xid,
      storage_request_id: receipt.storage_request_id, verify_request_id: receipt.verify_request_id,
      validator_sha256: receipt.validator_sha256 }]);
  }

  async function reconcileProof(step, get) {
    const result = await get(step);
    if (result.disposition !== 'committed' || step === 'prepare' || step === 'close') return result;
    const preceding = steps.slice(0, steps.indexOf(step));
    let asset;
    let claimXid;
    let write;
    let verifierHash;
    let sealXid;
    for (const current of [...preceding, step]) {
      const evidence = (await get(current)).evidence;
      if (evidence.disposition !== 'committed') fail();
      if (current !== 'verify') asset = exactAsset(plan, evidence.asset, asset, !['prepare', 'claim'].includes(current));
      if (current === 'claim') claimXid = evidence.xid;
      if (current === 'post') {
        if (evidence.claim_xid !== claimXid) fail();
        write = { ...evidence, asset };
      }
      if (current === 'verify') {
        verifierHash = verifyReceipt(evidence.verifier_receipt, write);
        if (evidence.verifier_sha256 !== verifierHash) fail();
      }
      if (['seal', 'complete'].includes(current) && evidence.verifier_sha256 !== verifierHash) fail();
      if (current === 'seal') sealXid = evidence.xid;
      if (current === 'complete' && evidence.seal_xid !== sealXid) fail();
    }
    return result;
  }

  function checkRole(handle, role) {
    const current = boundAccountContext(handle, identity, scope.authIssuer);
    if (current.uid !== plan[role + '_uid'] || current.session_id !== plan[role + '_sid']) deny('BUSINESS_DENIED');
  }

  async function post(worker, claim, bytes, signal) {
    checkRole(worker, 'worker');
    const { asset } = claim;
    const url = 'https://' + plan.project + '.supabase.co/storage/v1/object/' + asset.bucket_id + '/' + asset.object_key;
    const reply = await withCredential(worker, token => fetcher(url, {
      method: 'POST', redirect: 'error', signal, body: bytes,
      headers: { apikey: publishableKey, Authorization: 'Bearer ' + token,
        'Content-Type': plan.png.mime_type, 'x-upsert': 'false' },
    }, Object.freeze({ intent: intents.post, asset, claim_xid: claim.xid })));
    const requestId = reply?.headers?.get('sb-request-id');
    if (reply?.body) await reply.body.cancel();
    if (![200, 201].includes(reply?.status) || reply.redirected || !uuid(requestId)) fail();
    return requestId;
  }

  async function validateBody(source) {
    const prepared = await preparePrivatePng({ request_id: plan.requests.prepare, site_id: plan.png.site_id,
      original_filename: plan.png.original_filename }, plan.png.mime_type, source);
    if (prepared.prepare.sha256 !== plan.png.sha256 || prepared.prepare.byte_size !== plan.png.byte_size) fail();
    return prepared.bytes;
  }

  async function work(journal, owner, worker, bytes) {
    const dispatch = async (step, effect, validate) => {
      let value;
      await journal.dispatch(step, intents[step].intent_sha256, async signal => {
        const reply = await effect(signal);
        const result = await observe(step, signal);
        if (result.disposition !== 'committed') fail();
        value = await validate(result.evidence, reply);
        return result;
      });
      return value;
    };
    const runCommand = (step, asset, signal) => {
      checkRole(owner, 'owner');
      return authorize({ input: command(plan, step, asset), handle: owner,
        close_request_id: plan.requests[step + '-close'], signal });
    };
    const prepared = await dispatch('prepare', signal => runCommand('prepare', null, signal),
      evidence => exactAsset(plan, evidence.asset, null, false));
    const claim = await dispatch('claim', signal => runCommand('claim', prepared, signal),
      evidence => Object.freeze({ xid: evidence.xid, asset: exactAsset(plan, evidence.asset, prepared, false) }));
    const write = await dispatch('post', signal => post(worker, claim, bytes, signal), (evidence, requestId) => {
      if (evidence.storage_request_id !== requestId || evidence.claim_xid !== claim.xid) fail();
      return Object.freeze({ asset: exactAsset(plan, evidence.asset, claim.asset, true),
        xid: evidence.xid, requestId });
    });
    const uploaded = write.asset;
    await dispatch('authorize-verify', signal => runCommand('authorize-verify', uploaded, signal),
      evidence => {
        if (evidence.qualification_current !== true) fail();
        return exactAsset(plan, evidence.asset, uploaded, true);
      });
    const { receipt, receiptSha256 } = await dispatch('verify', async signal => {
      checkRole(worker, 'worker');
      const read = await readVersion({ intent: intents.verify, asset: uploaded, worker, signal });
      if (!read || read.version !== uploaded.native_version || read.worker_sid !== uploaded.worker_sid ||
          read.worker_uid !== uploaded.worker_uid || read.no_cache !== true || read.status !== 200 ||
          read.mime_type !== plan.png.mime_type || !uuid(read.storage_request_id) ||
          read.storage_request_id === write.requestId || read.validator_sha256 !== plan.validator_sha256) fail();
      await validateBody(read.bytes);
      const authorization = await observe('authorize-verify', signal);
      if (authorization.disposition !== 'committed' || authorization.evidence.qualification_current !== true) fail();
      exactAsset(plan, authorization.evidence.asset, uploaded, true);
      const receipt = Object.freeze({ ...uploaded, post_xid: write.xid, storage_request_id: read.storage_request_id,
        verify_request_id: plan.requests.verify, validator_sha256: read.validator_sha256 });
      const receiptSha256 = hash(['ecv.private-png.verifier.v1', receipt]);
      await recordVerified(intents.verify, receipt, receiptSha256, signal);
      return { receipt, receiptSha256 };
    }, (evidence, verified) => {
      if (evidence.verifier_sha256 !== verified.receiptSha256 ||
          verifyReceipt(evidence.verifier_receipt, { ...write, storage_request_id: write.requestId }) !==
            verified.receiptSha256) fail();
      return verified;
    });
    const checkVerification = (state, evidence) => {
      exactAsset(plan, evidence.asset, uploaded, true);
      if (evidence.verifier_sha256 !== receiptSha256 || evidence.state !== state) fail();
      return evidence.xid;
    };
    const sealXid = await dispatch('seal', signal => seal(intents.seal, receipt, receiptSha256, signal),
      evidence => checkVerification('sealed', evidence));
    const committedSeal = Object.freeze({ request_id: plan.requests.seal, xid: sealXid });
    const completeXid = await dispatch('complete',
      signal => complete(intents.complete, receipt, receiptSha256, committedSeal, signal),
      evidence => {
        if (evidence.seal_xid !== sealXid) fail();
        return checkVerification('ready', evidence);
      });
    return Object.freeze({ asset: uploaded, verifierSha256: receiptSha256, sealXid, completeXid });
  }

  async function execute(signal, start) {
    let completed;
    const status = await runPrivateRecovery({
      directory, python, scopeSha256: planHash, operations: { business: steps, close: ['close'] }, signal,
      async work(journal) {
        if (!start) fail();
        completed = await work(journal, start.owner, start.worker, start.bytes);
      },
      async close(journal) {
        const failures = [];
        const observations = new Map();
        const get = step => {
          const prior = journal.inspect(step);
          if (prior.state === 'not-started') fail();
          if (!observations.has(step)) {
            observations.set(step, observe(step, journal.signal).then(result => {
              if (prior.state === 'resolved' && result.receiptSha256 !== prior.receiptSha256) fail();
              return result;
            }));
          }
          return observations.get(step);
        };
        for (const step of [...steps, 'close']) {
          if (journal.inspect(step).state !== 'unknown') continue;
          try {
            const result = await reconcileProof(step, get);
            journal.reconcile(step, result);
          } catch (error) { failures.push(error); }
        }
        if (journal.inspect('close').state === 'not-started' &&
            steps.some(step => journal.inspect(step).state !== 'not-started')) {
          // Scope close is independently authorized even if a business result is unknown.
          // Its adapter may touch only the exact leases/qualifications in this plan.
          try {
            await journal.dispatch('close', intents.close.intent_sha256, async closeSignal => {
              await close(intents.close, closeSignal);
              return observe('close', closeSignal);
            });
          } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'PNG_LIFECYCLE_CLOSE_UNPROVEN');
      },
      async observeClosed({ signal: closeSignal, inspect }) {
        const final = await closed(intents.close, { signal: closeSignal });
        const postState = inspect('post');
        if (postState.state === 'unknown') fail();
        if (postState.disposition === 'committed') {
          const { evidence: postProof, disposition, receiptSha256 } = await observe('post', closeSignal);
          if (disposition !== 'committed' || receiptSha256 !== postState.receiptSha256 ||
              final?.retained_post_xid !== postProof.xid) fail();
          exactAsset(plan, final.retained_png, postProof.asset, true);
        } else if (final?.retained_png !== null || final.retained_post_xid !== null) fail();
        const ready = inspect('complete');
        if (ready.state === 'unknown') fail();
        if (ready.disposition === 'committed') {
          const witness = await observe('complete', closeSignal);
          if (witness.disposition !== 'committed' || witness.receiptSha256 !== ready.receiptSha256 ||
              final?.retained_ready?.complete_xid !== witness.evidence.xid ||
              final.retained_ready?.seal_xid !== witness.evidence.seal_xid ||
              final.retained_ready?.verifier_sha256 !== witness.evidence.verifier_sha256) fail();
        } else if (final?.retained_ready !== null) fail();
        const commandStatus = final?.command_status;
        const commandsClosed = Array.isArray(commandStatus) && commandStatus.length === commandSteps.length &&
          commandSteps.every((step, index) => {
            const proof = commandStatus[index];
            return proof?.request_id === plan.requests[step] && proof.close_request_id === plan.requests[step + '-close'] &&
              proof.command_leases === 0 && proof.in_flight === 0 && proof.late_write_possible === false;
          });
        const closeAdmitted = inspect('close').state !== 'not-started';
        return { closed: final?.closed === true && final.project === plan.project &&
          final.intent_sha256 === intents.close.intent_sha256 && final.request_id === plan.requests.close &&
          (!closeAdmitted || inspect('close').disposition === 'committed') &&
          commandsClosed && final.late_write_possible === false && final.protection_preserved === true &&
          ['sessions', 'refresh', 'grants', 'permits', 'generations', 'active_runs', 'connected', 'leases',
            'temporary_permissions'].every(field => final[field] === 0),
        receiptSha256: final?.receipt_sha256 };
      },
    });
    return Object.freeze({ ...status, completed });
  }

  return Object.freeze({
    async run({ owner, worker, bytes, signal } = {}) {
      checkRole(owner, 'owner');
      checkRole(worker, 'worker');
      return execute(signal, { owner, worker, bytes: await validateBody(bytes) });
    },
    recover({ signal } = {}) {
      if (!lstatSync(join(directory, 'run.json'), { throwIfNoEntry: false })?.isFile())
        deny('RECOVERY_REQUIRED', 409);
      return execute(signal);
    },
  });
}
