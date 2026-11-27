// Narrow server-side transport for the post-verifier portion of the PNG lifecycle.
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, isAbsolute } from 'node:path';
import { bindPrivatePngLifecyclePlan } from './private-png-lifecycle.node.mjs';
import { ASSET_BUCKET, assetObjectKey } from './asset-protocol.mjs';
import { deny, exact, uuid } from './protocol.mjs';

const rpcs = Object.freeze({
  seal: 's35_png_seal', complete: 's35_png_complete', close: 's35_png_close',
  lookup: 's35_png_observe', closed: 's35_png_closed',
});
const writes = Object.freeze(['seal', 'complete', 'close']);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const xid = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const name = value => typeof value === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(value);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unproven = () => deny('PNG_RPC_UNPROVEN', 503);
const schema = 'site_api';
const receiptFields = Object.freeze(['id', 'intent_id', 'asset_id', 'object_version', 'project', 'run_id', 'site_id',
  'prepare_request_id', 'owner_uid', 'owner_sid', 'worker_uid', 'worker_sid', 'bucket_id', 'object_key',
  'byte_size', 'sha256', 'mime_type', 'native_version', 'post_xid', 'storage_request_id', 'verify_request_id',
  'validator_sha256']);

function socketIdentity(path) {
  const parent = dirname(path);
  const directory = lstatSync(parent, { throwIfNoEntry: false });
  const socket = lstatSync(path, { throwIfNoEntry: false });
  if (!directory?.isDirectory() || realpathSync(parent) !== parent || directory.uid !== process.getuid() ||
      (directory.mode & 0o7777) !== 0o700 || !socket?.isSocket() || socket.uid !== directory.uid ||
      socket.gid !== directory.gid || (socket.mode & 0o7777) !== 0o600) unproven();
  return [directory.dev, directory.ino, socket.dev, socket.ino].join('/');
}

function channel(config, expectedTarget) {
  const { runtime, credential } = config ?? {};
  if (!isAbsolute(runtime?.socketPath ?? '') || runtime.targetFingerprint !== expectedTarget ||
      !name(runtime.executionRole) || !name(runtime.connectionRole) || runtime.executionRole === runtime.connectionRole ||
      typeof credential !== 'function') deny('NOT_CONFIGURED', 503);
  const path = runtime.socketPath;
  const socket = socketIdentity(path);
  let exited = false;
  if (typeof runtime.exited?.then !== 'function') deny('NOT_CONFIGURED', 503);
  void runtime.exited.then(() => { exited = true; }, () => { exited = true; });
  const prove = () => { if (exited || socketIdentity(path) !== socket) unproven(); };
  return Object.freeze({ path, socket: socket.split('/').slice(2).join('/'),
    connection: runtime.connectionRole, role: runtime.executionRole, credential, prove });
}

async function send(channel, rpc, readOnly, input, signal) {
  const wireSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000);
  wireSignal.throwIfAborted();
  channel.prove();
  const token = await channel.credential(wireSignal);
  if (typeof token !== 'string' || token.length > 6144 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) unproven();
  wireSignal.throwIfAborted();
  channel.prove();
  const query = readOnly ? '?' + new URLSearchParams(input).toString() : '';
  const body = readOnly ? undefined : JSON.stringify(input);
  if (body && Buffer.byteLength(body) > 8192) unproven();
  const result = await new Promise((resolve, reject) => {
    const req = request({
      socketPath: channel.path, path: '/rpc/' + rpc + query, method: readOnly ? 'GET' : 'POST', agent: false,
      signal: wireSignal, headers: { authorization: 'Bearer ' + token, accept: 'application/json',
        'accept-profile': schema, ...(!readOnly ? { 'content-type': 'application/json', 'content-profile': schema,
          'content-length': Buffer.byteLength(body) } : {}) },
    }, async res => {
      try {
        if (res.statusCode !== 200 || res.headers['content-type']?.split(';')[0] !== 'application/json') unproven();
        const chunks = [];
        let total = 0;
        for await (const chunk of res) {
          if ((total += chunk.length) > 16_384) unproven();
          chunks.push(chunk);
        }
        if (!res.complete) unproven();
        resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))));
      } catch {
        res.destroy();
        reject(new Error('PNG_RPC_UNPROVEN'));
      }
    });
    req.once('error', () => reject(new Error('PNG_RPC_UNPROVEN')));
    req.end(body);
  });
  channel.prove();
  wireSignal.throwIfAborted();
  return result;
}

/**
 * Writer and observer are distinct private startPrivatePostgrest runtimes
 * authenticated to the same independently pinned target. The observer GET
 * contract uses STABLE SECURITY INVOKER functions on the read-only role.
 * Stage and recovery admission remain owned by the lifecycle journal.
 */
export function createPrivatePngPostgrestAdapters({ binding, plan: input, targetFingerprint, closeRole,
  writers, observer } = {}) {
  if (!digest(targetFingerprint) || !name(closeRole)) deny('NOT_CONFIGURED', 503);
  const { plan, planSha256 } = bindPrivatePngLifecyclePlan(binding, input);
  const keys = plan.requests;
  exact(writers, writes);
  const mutate = Object.fromEntries(writes.map(step => [step, channel(writers[step], targetFingerprint)]));
  const observe = channel(observer, targetFingerprint);
  const channels = [...Object.values(mutate), observe];
  const unique = field => new Set(channels.map(lane => lane[field])).size === channels.length;
  if (mutate.seal.role !== plan.seal_role || mutate.complete.role !== plan.complete_role ||
      mutate.close.role !== closeRole || !unique('role') || !unique('path') || !unique('socket') ||
      Object.values(mutate).some(lane => lane.connection === observe.connection))
    deny('NOT_CONFIGURED', 503);

  function parameters(intent, step) {
    if (!writes.includes(step) || intent?.step !== step || intent.request_id !== keys[step] ||
        intent.plan_sha256 !== planSha256 || intent.intent_sha256 !== sha([planSha256, step]) ||
        sha(['ecv.private-png.lifecycle.v1', intent.plan]) !== planSha256) unproven();
    return { p_project: plan.project, p_run: plan.run_id, p_request: keys[step], p_intent: intent.intent_sha256 };
  }

  function receiptParameters(intent, receipt, receiptSha256) {
    exact(receipt, receiptFields);
    const bound = Object.fromEntries(receiptFields.map(key => [key, receipt[key]]));
    if (receiptSha256 !== sha(['ecv.private-png.verifier.v1', bound]) ||
        bound.project !== plan.project || bound.run_id !== plan.run_id || bound.verify_request_id !== keys.verify ||
        bound.owner_uid !== intent.plan.owner_uid || bound.owner_sid !== intent.plan.owner_sid ||
        bound.worker_uid !== intent.plan.worker_uid || bound.worker_sid !== intent.plan.worker_sid ||
        bound.site_id !== intent.plan.png.site_id || bound.prepare_request_id !== intent.plan.requests.prepare ||
        bound.validator_sha256 !== intent.plan.validator_sha256 || bound.mime_type !== intent.plan.png.mime_type ||
        bound.byte_size !== intent.plan.png.byte_size || bound.sha256 !== intent.plan.png.sha256 ||
        ![bound.id, bound.intent_id, bound.asset_id, bound.object_version, bound.native_version, bound.storage_request_id]
          .every(uuid) || !xid(bound.post_xid) || bound.bucket_id !== ASSET_BUCKET ||
        bound.object_key !== assetObjectKey(bound)) unproven();
    return { p_receipt: bound, p_receipt_sha: receiptSha256 };
  }

  async function write(step, input, signal) {
    const lane = mutate[step];
    const ack = await send(lane, rpcs[step], false, input, signal);
    if (ack?.request_id !== input.p_request || ack?.accepted !== true || ack.execution_role !== lane.role ||
        ack.connection_role !== lane.connection) unproven();
  }

  async function read(rpc, input, signal) {
    const row = await send(observe, rpc, true, input, signal);
    if (row?.reader !== observe.role || row.connection_role !== observe.connection || row.readonly !== 'on' ||
        row.project !== input.p_project || row.run_id !== input.p_run || row.request_id !== input.p_request ||
        row.intent_sha256 !== input.p_intent) unproven();
    return { ...row, receipt_sha256: sha(row) };
  }

  return Object.freeze({
    writer: Object.freeze({
      seal(intent, receipt, receiptSha256, signal) {
        return write('seal', { ...parameters(intent, 'seal'), ...receiptParameters(intent, receipt, receiptSha256) }, signal);
      },
      complete(intent, receipt, receiptSha256, committedSeal, signal) {
        exact(committedSeal, ['request_id', 'xid']);
        if (committedSeal.request_id !== keys.seal || !xid(committedSeal.xid)) unproven();
        return write('complete', { ...parameters(intent, 'complete'), ...receiptParameters(intent, receipt, receiptSha256),
          p_seal_request: committedSeal.request_id, p_seal_xid: committedSeal.xid }, signal);
      },
      close(intent, signal) { return write('close', parameters(intent, 'close'), signal); },
    }),
    observer: Object.freeze({
      async lookup(intent, signal) {
        const step = intent?.step;
        const row = await read(rpcs.lookup, { ...parameters(intent, step), p_step: step }, signal);
        if (row.step !== step || (row.disposition === 'committed' && row.execution_role !== mutate[step].role))
          unproven();
        return row;
      },
      closed(intent, { signal } = {}) { return read(rpcs.closed, parameters(intent, 'close'), signal); },
    }),
  });
}
