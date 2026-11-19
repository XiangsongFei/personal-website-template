import { closeSync, fstatSync, fsyncSync, openSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogDigest, checkSourceCatalog, compareApprovedCatalog } from '../s36-a1/preparation.mjs';
import { diskBytes, fail, isSha, limits, manifest, PG_IMAGE, sha256, sources } from './plan.mjs';

export function digestEvidence(value) {
  const canonical = item => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || Number.isSafeInteger(item)) return item;
    if (Array.isArray(item)) return item.map(canonical);
    if (!item || Object.getPrototypeOf(item) !== Object.prototype) fail('INVALID_RECEIPT');
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])]));
  };
  return sha256(JSON.stringify(canonical(value)));
}

const sidPattern = /^[1-9][0-9]{9,19}$/;
export const validSid = value => typeof value === 'string' && sidPattern.test(value) &&
  BigInt(value) <= 18446744073709551615n;

export function validateProfile(profile) {
  if (![manifest.candidate_run_id, manifest.reference_run_id].includes(profile?.runId) ||
      typeof profile.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(profile.sourceCommit) ||
      profile.image !== PG_IMAGE || profile.platform !== 'linux/arm64' ||
      typeof profile.endpoint !== 'string' || !/^unix:\/\/\/[^?#\r\n]+\/docker\.sock$/.test(profile.endpoint) ||
      !isSha(profile.engineFingerprint) || !isSha(profile.vmFingerprint) ||
      !isSha(profile.fenceFingerprint) || !isSha(profile.adapterFingerprint) || !isSha(profile.hbaFingerprint) ||
      !Array.isArray(profile.excludedSids) || !profile.excludedSids.length ||
      !profile.excludedSids.every(validSid)) fail('TARGET_PROFILE_DENIED');
}

export function boundHost(profile, observation, existing, allowStopped = false) {
  if (observation?.engineFingerprint !== profile.engineFingerprint ||
      observation.vmFingerprint !== profile.vmFingerprint || observation.endpoint !== profile.endpoint ||
      observation.fenceFingerprint !== profile.fenceFingerprint ||
      observation.adapterFingerprint !== profile.adapterFingerprint ||
      observation.diskBytes !== diskBytes || observation.dedicatedBlockDevice !== true ||
      observation.dockerAndContainerdOnDisk !== true || observation.noHostShares !== true ||
      observation.diskFullProof !== true || observation.workloadLogsBounded !== true || observation.imageVerified !== true ||
      observation.applicationAuthOpen !== false ||
      observation.hardWatchdog !== true || observation.databaseConnectionLimit !== limits.maxConnections ||
      observation.offlineNetwork !== true) fail('HOST_FENCE_DENIED');
  if (!existing) return;
  const resource = checkedResources(profile, observation.resource);
  if (digestEvidence(resource) !== digestEvidence(existing)) fail('TARGET_REBIND_DENIED');
  if (typeof observation.running !== 'boolean' || (!allowStopped && !observation.running)) fail('TARGET_NOT_RUNNING');
  const expectedPeers = observation.running ? [resource.containerId] : [];
  if (!Array.isArray(observation.activeNetworkPeers) ||
      digestEvidence(observation.activeNetworkPeers) !== digestEvidence(expectedPeers)) fail('NETWORK_PEERS_DENIED');
}

export function checkedResources(profile, resource) {
  const names = 's36-a2-' + profile.runId;
  if (!isSha(resource?.containerId) || !isSha(resource.networkId) ||
      resource.containerName !== names || resource.volumeName !== names + '-data' ||
      resource.networkName !== names + '-internal' || resource.ownerRunId !== profile.runId ||
      resource.volumeDriver !== 'local' || resource.mountTarget !== '/var/lib/postgresql/data' ||
      resource.networkInternal !== true || resource.networkConfigured !== true || resource.configuredNetworks !== 1 ||
      resource.image !== PG_IMAGE || resource.platform !== 'linux/arm64' || resource.hostPorts !== 0 ||
      resource.bindMounts !== 0 || resource.privileged !== false || resource.restart !== 'no' ||
      resource.memoryBytes !== limits.memoryBytes || resource.nanoCpus !== limits.nanoCpus || resource.pids !== limits.pids ||
      resource.hbaFingerprint !== profile.hbaFingerprint || !isSha(resource.volumeFingerprint) ||
      resource.socket !== '/var/run/postgresql') fail('RESOURCE_IDENTITY_DENIED');
  return structuredClone(resource);
}

export function referenceBundle(profile, sid, target, after01, after02) {
  checkSourceCatalog('A50', after01.catalog);
  checkSourceCatalog('A07', after02.catalog);
  const a50 = catalogDigest(after01.catalog), a07 = catalogDigest(after02.catalog);
  if (!validSid(sid) || !isSha(target) || !isSha(after01.receipt) || !isSha(after02.receipt) ||
      after01.receipt === after02.receipt || a50 === a07) fail('REFERENCE_SCOPE_DENIED');
  return {
    A50: a50, A07: a07,
    source01: sources.text_sql[0].checked_sha256, source02: sources.text_sql[1].checked_sha256,
    projection: manifest.projection_sha256,
    reference: {runId: profile.runId, systemIdentifier: sid, target,
      engineFingerprint: profile.engineFingerprint, vmFingerprint: profile.vmFingerprint,
      after01: after01.receipt, after02: after02.receipt},
  };
}

export function verifyReference(profile, sid, target, expectations, approvedDigest) {
  const reference = expectations?.reference;
  if (!isSha(approvedDigest) || digestEvidence(expectations) !== approvedDigest ||
      !isSha(expectations.A07) || !isSha(expectations.A50) || expectations.A07 === expectations.A50 ||
      expectations.source01 !== sources.text_sql[0].checked_sha256 ||
      expectations.source02 !== sources.text_sql[1].checked_sha256 ||
      expectations.projection !== manifest.projection_sha256 ||
      reference?.runId !== manifest.reference_run_id || reference.runId === profile.runId ||
      !validSid(reference.systemIdentifier) || reference.systemIdentifier === sid ||
      !isSha(reference.target) || reference.target === target ||
      !isSha(reference.engineFingerprint) || reference.engineFingerprint === profile.engineFingerprint ||
      !isSha(reference.vmFingerprint) || reference.vmFingerprint === profile.vmFingerprint ||
      !isSha(reference.after01) || !isSha(reference.after02) || reference.after01 === reference.after02 ||
      !isSha(reference.close) || !isSha(reference.stop)) {
    fail('REFERENCE_NOT_INDEPENDENT');
  }
}

export const verifyCatalog = compareApprovedCatalog;

const journals = new WeakMap();

// Caller provides the same private root for the host's exclusive supervisor.
// Locks and receipts remain on disk after STOP or UNKNOWN. No resume from a stale journal.
export function openJournal(root, profile) {
  validateProfile(profile);
  const directory = realpathSync(root);
  const info = statSync(directory);
  if (directory !== root || !info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    fail('JOURNAL_NOT_PRIVATE');
  }
  const key = digestEvidence(profile.engineFingerprint);
  function claim(name) {
    const fd = openSync(join(directory, name), 'wx', 0o600);
    try { writeFileSync(fd, profile.runId + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  }
  claim(key + '.engine.lock');
  claim(profile.runId + '.run.lock');
  const fd = openSync(join(directory, profile.runId + '.jsonl'), 'wx', 0o600);
  try {
    if (!fstatSync(fd).isFile()) fail('JOURNAL_NOT_REGULAR');
    const dirFd = openSync(directory, 'r');
    try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  let closed = false;
  const journal = Object.freeze({
    record(value) {
      if (closed) fail('JOURNAL_CLOSED');
      writeFileSync(fd, JSON.stringify(value) + '\n');
      fsyncSync(fd);
    },
    close() {
      if (closed) return;
      closed = true;
      journals.delete(journal);
      closeSync(fd);
    },
  });
  journals.set(journal, digestEvidence(profile));
  return journal;
}

export function consumeJournal(journal, scope) {
  if (journals.get(journal) !== scope) fail('JOURNAL_NOT_BOUND');
  journals.delete(journal);
}
