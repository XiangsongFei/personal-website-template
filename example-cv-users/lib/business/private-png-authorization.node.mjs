// Server-only command boundary for private PNG metadata operations.
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { businessBinding } from './binding.mjs';
import { boundAccountContext } from './identity.mjs';
import { ASSET_BUCKET, assetObjectKey, prepareAssetDigest, prepareAssetInput } from './asset-protocol.mjs';
import { deny, exact, sha256, uuid } from './protocol.mjs';
import { runPrivateRecovery } from '../../scripts/shared/recovery-journal.node.mjs';

const actions = new Set(['prepare', 'claim', 'authorize-verify']);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const epoch = value => Number.isSafeInteger(value) && value >= 0;
const xid = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const hash = value => sha256(new TextEncoder().encode(JSON.stringify(value)));

function permitScope(input, png) {
  if (input.operation === 'prepare') {
    if (input.permit !== null || png.request_id !== input.request_id) deny('INVALID_INPUT', 400);
    return null;
  }

  const permit = input.permit;
  exact(permit, ['id', 'intent_id', 'asset_id', 'object_version', 'native_version']);
  if (![permit.id, permit.intent_id, permit.asset_id, permit.object_version].every(uuid) ||
      (input.operation === 'claim' ? permit.native_version !== null : !uuid(permit.native_version)))
    deny('INVALID_INPUT', 400);
  return Object.freeze({
    id: permit.id, intent_id: permit.intent_id, asset_id: permit.asset_id, object_version: permit.object_version,
    native_version: permit.native_version, bucket_id: ASSET_BUCKET,
    object_key: assetObjectKey({ site_id: png.site_id, asset_id: permit.asset_id,
      object_version: permit.object_version, mime_type: png.mime_type }),
  });
}

async function bindIntent(input, account, scope) {
  exact(input, ['operation', 'request_id', 'grant_id', 'epoch', 'generation', 'png', 'permit']);
  if (!actions.has(input.operation) || !uuid(input.request_id) || !uuid(input.grant_id) ||
      !epoch(input.epoch) || typeof input.generation !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(input.generation))
    deny('INVALID_INPUT', 400);
  const png = prepareAssetInput(input.png);
  if (png.kind !== 'image' || png.mime_type !== 'image/png' || png.byte_size < 45 || png.byte_size > 65_536)
    deny('INVALID_INPUT', 400);
  const permit = permitScope(input, png);
  const intent = Object.freeze({
    project: scope.project, issuer: scope.authIssuer, uid: account.uid, sid: account.session_id, site_id: png.site_id,
    operation: input.operation, request_id: input.request_id, grant_id: input.grant_id, epoch: input.epoch,
    generation: input.generation, png, permit,
  });
  const intentSha256 = await hash(['ecv.private-png.authorization.v1', intent.project, intent.issuer, intent.uid,
    intent.sid, intent.site_id, intent.operation, intent.request_id, intent.grant_id, intent.epoch, intent.generation,
    png.request_id, await prepareAssetDigest(png), permit]);
  return Object.freeze({ intent, intentSha256 });
}

function enforceQualification(intent, proof) {
  const { now, actor, session, site, owner, grant, generation, permit } = proof ?? {};
  const current = (from, until) => epoch(from) && epoch(until) && from <= now && now < until;
  if (!epoch(now) || proof.project !== intent.project || proof.issuer !== intent.issuer ||
      proof.businessEnabled !== true || proof.proofVerifierReady !== true ||
      actor?.uid !== intent.uid || actor.sid !== intent.sid ||
      session?.uid !== intent.uid || session.sid !== intent.sid || session.live !== true ||
      site?.id !== intent.site_id || site.owner_uid !== intent.uid || site.active !== true || site.active_owner_member !== true ||
      owner?.uid !== intent.uid || owner.epoch !== intent.epoch || owner.enabled !== true || owner.on_hold !== false ||
      grant?.id !== intent.grant_id || grant.uid !== intent.uid || grant.sid !== intent.sid ||
      grant.epoch !== intent.epoch || grant.purpose !== 'business' || grant.revoked_at !== null ||
      grant.generation !== intent.generation || !current(grant.issued_at, grant.expires_at) ||
      !current(grant.last_renewed_at, grant.absolute_expires_at) ||
      generation?.id !== intent.generation || generation.revoked_at !== null ||
      !current(generation.not_before, generation.verify_until)) deny('BUSINESS_DENIED');

  if (intent.permit === null) {
    if (permit !== null) deny('BUSINESS_DENIED');
    return;
  }
  if (!permit || Object.entries(intent.permit).some(([key, value]) => permit[key] !== value) ||
      permit.uid !== intent.uid || permit.sid !== intent.sid || permit.site_id !== intent.site_id ||
      permit.grant_id !== intent.grant_id || permit.epoch !== intent.epoch || permit.generation !== intent.generation ||
      permit.operation !== intent.operation || permit.request_id !== intent.request_id ||
      permit.prepare_request_id !== intent.png.request_id || permit.mime_type !== intent.png.mime_type ||
      permit.byte_size !== intent.png.byte_size || permit.sha256 !== intent.png.sha256 ||
      permit.closed_at !== null || !current(permit.issued_at, permit.expires_at)) deny('BUSINESS_DENIED');
}

function observation(bound, evidence, requestId, lane) {
  const settled = evidence?.settled === true && evidence.intent_sha256 === bound.intentSha256 &&
    evidence.request_id === requestId && evidence.lane === lane && digest(evidence.receipt_sha256);
  if (!settled || !(evidence.disposition === 'committed' ? xid(evidence.xid) :
    evidence.disposition === 'absent' && evidence.xid === null)) deny('COMMIT_UNKNOWN', 503);
  return { disposition: evidence.disposition, receiptSha256: evidence.receipt_sha256 };
}

/**
 * A trusted writer opens one transaction and reads current source rows under
 * the same locks used by revocation and the mutation, using the original
 * account handle. Store the exact request UUID and intent digest atomically
 * with the effect. A distinct observer proves settlement and request ownership.
 * Keep the adapters, journal root, and original recovery plan server-owned.
 */
export function createPrivatePngAuthorization({ binding, identity, writer, observer, journalRoot, python } = {}) {
  const scope = businessBinding(binding);
  if (!scope || !identity || ![writer?.transaction, writer?.close, observer?.lookup, observer?.closed]
    .every(fn => typeof fn === 'function') || writer === observer ||
    !isAbsolute(journalRoot ?? '') || !isAbsolute(python ?? '')) deny('NOT_CONFIGURED', 503);
  const transaction = writer.transaction.bind(writer);
  const close = writer.close.bind(writer);
  const lookup = observer.lookup.bind(observer);
  const closed = observer.closed.bind(observer);

  function requestDirectory(request, recovery) {
    if (!uuid(request)) deny('INVALID_INPUT', 400);
    const stat = lstatSync(journalRoot);
    if (realpathSync(journalRoot) !== journalRoot || !stat.isDirectory() || stat.uid !== process.getuid() ||
        (stat.mode & 0o7777) !== 0o700) deny('NOT_CONFIGURED', 503);
    const directory = join(journalRoot, request);
    if (recovery) {
      if (!lstatSync(join(directory, 'run.json'), { throwIfNoEntry: false })?.isFile())
        deny('RECOVERY_REQUIRED', 409);
    } else {
      try { mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return directory;
  }

  async function execute({ input, handle, close_request_id, signal }, recoveryAccount) {
    if (!uuid(close_request_id) || close_request_id === input?.request_id || close_request_id === input?.png?.request_id)
      deny('INVALID_INPUT', 400);
    const account = () => boundAccountContext(handle, identity, scope.authIssuer);
    const bound = await bindIntent(input, recoveryAccount ?? account(), scope);
    const { intent, intentSha256 } = bound;
    const directory = requestDirectory(intent.request_id, Boolean(recoveryAccount));
    const closureHash = await hash(['ecv.private-png.close.v1', intentSha256, close_request_id]);
    const keys = { command: intent.request_id, close: close_request_id };
    const observed = async (lane, readSignal) =>
      observation(bound, await lookup(bound, { request_id: keys[lane], lane, signal: readSignal }), keys[lane], lane);
    return runPrivateRecovery({
      directory, python, signal, scopeSha256: closureHash, operations: { business: ['command'], close: ['close'] },
      work: journal => {
        if (recoveryAccount) deny('RECOVERY_REQUIRED', 409);
        return journal.dispatch('command', intentSha256, async workSignal => {
          await transaction(bound, { handle, signal: workSignal }, async locked => {
            const proof = await locked.qualification();
            workSignal.throwIfAborted();
            account();
            enforceQualification(intent, proof);
            await locked.apply();
          });
          const result = await observed('command', workSignal);
          if (result.disposition !== 'committed') deny('COMMIT_UNKNOWN', 503);
          return result;
        });
      },
      async close(journal) {
        // A denied or unproven command cannot authorize a compensation write.
        // Even an unresolved command never re-enters the business lane.
        if (journal.inspect('command').state === 'unknown') {
          journal.reconcile('command', await observed('command', journal.signal));
        }

        const closeState = journal.inspect('close').state;
        if (closeState === 'unknown') {
          journal.reconcile('close', await observed('close', journal.signal));
        } else if (closeState === 'not-started' && journal.inspect('command').disposition === 'committed') {
          await journal.dispatch('close', closureHash, async closeSignal => {
            await close(bound, keys.close, closeSignal);
            return observed('close', closeSignal);
          });
        }
      },
      async observeClosed({ signal: closeSignal }) {
        const evidence = await closed(bound, { request_id: keys.close, signal: closeSignal });
        return { closed: evidence?.intent_sha256 === intentSha256 && evidence.request_id === keys.close &&
          evidence.active_command_leases === 0 && evidence.in_flight === 0 && evidence.late_write_possible === false &&
          evidence.closed === true, receiptSha256: evidence?.receipt_sha256 };
      },
    });
  }

  return Object.freeze({
    run: (options = {}) => execute(options),
    // The protected supervisor supplies the original pinned identity. Recovery
    // does not require an unexpired bearer token and has no business write lane.
    recover: (options = {}) => {
      const { original_account } = options;
      exact(original_account, ['uid', 'session_id']);
      if (![original_account.uid, original_account.session_id].every(uuid)) deny('INVALID_INPUT', 400);
      return execute(options, Object.freeze({ ...original_account }));
    },
  });
}
