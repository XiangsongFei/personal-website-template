import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { preparePrivatePng } from '../../lib/business/private-png-content.node.mjs';
import { createPrivatePngAuthorization } from '../../lib/business/private-png-authorization.node.mjs';
import { binding, closeRequest, command, id, identityFixture, now, originalAccount, qualification } from './support/private-png-authorization-fixture.mjs';

const python = realpathSync('/usr/bin/python3');
const receipt = '2'.repeat(64);
async function fixture(t, { input = command(), identity = identityFixture(), handleIdentity = identity,
  proof = qualification(input), commitError = false, overrideLookup, overrideClosed } = {}) {
  const journalRoot = mkdtempSync(join(realpathSync(tmpdir()), 'png-authorization-'));
  t.after(() => rmSync(journalRoot, { recursive: true, force: true }));
  const directory = join(journalRoot, input.request_id);
  const handle = await handleIdentity.verifyAccount('fixture-bearer');
  const committed = new Map();
  const calls = { business: 0, close: 0 };
  const writer = {
    transaction: async (bound, { handle: accountHandle }, work) => {
      assert.equal(accountHandle, handle);
      const row = { xid: '42' };
      await work({
        qualification: async () => proof,
        async apply() {
          calls.business++;
          committed.set(bound.intent.request_id, row);
        },
      });
      if (commitError) throw Error('local response lost');
    },
    async close(bound, request) {
      calls.close++;
      committed.set(request, { xid: '43' });
    },
  };
  const observer = {
    async lookup(bound, request) {
      const row = committed.get(request.request_id);
      const evidence = { request_id: request.request_id, intent_sha256: bound.intentSha256, lane: request.lane,
        settled: true, disposition: row ? 'committed' : 'absent', xid: row?.xid ?? null, receipt_sha256: receipt };
      return overrideLookup?.(evidence, request) ?? evidence;
    },
    async closed(bound, request) {
      const evidence = { intent_sha256: bound.intentSha256, request_id: request.request_id,
        active_command_leases: 0, in_flight: 0, late_write_possible: false, closed: true, receipt_sha256: receipt };
      return overrideClosed?.(evidence, request) ?? evidence;
    },
  };
  const auth = createPrivatePngAuthorization({ binding, identity, writer, observer, journalRoot, python });
  const args = { input, handle, close_request_id: closeRequest };
  return { auth, args, calls, directory };
}
const cause = code => error => error.errors?.some(e => e.code === code);

for (const operation of ['prepare', 'claim', 'authorize-verify']) {
  test(operation + ' binds and independently confirms exactly one mutation', async t => {
    const { auth, args, calls, directory } = await fixture(t, { input: command(operation) });
    await auth.run(args);
    const persisted = readFileSync(join(directory, 'command.intent.json'), 'utf8');
    assert.equal(persisted.includes('fixture-bearer'), false);
    assert.equal((await auth.run(args)).alreadyClosed, true);
    assert.deepEqual(calls, { business: 1, close: 1 });
  });
}

const wrong = {
  'closed business gate': p => p.businessEnabled = false,
  'wrong issuer': p => p.issuer += '/other',
  'other Owner': p => p.site.owner_uid = id(21),
  'cross-site': p => p.site.id = id(21),
  'inactive membership': p => p.site.active_owner_member = false,
  'wrong database actor': p => p.actor.uid = id(21),
  'old SID': p => p.session.sid = id(21),
  'ended Auth session': p => p.session.live = false,
  'expired Grant': p => p.grant.expires_at = now,
  'past absolute expiry': p => p.grant.absolute_expires_at = now,
  'future Grant': p => p.grant.issued_at = now + 1,
  'revoked Grant': p => p.grant.revoked_at = now,
  'moved Owner epoch': p => p.owner.epoch += 1,
  'revoked signing generation': p => p.generation.revoked_at = now,
  'wrong Permit operation': p => p.permit.operation = 'seal',
  'wrong request key': p => p.permit.request_id = id(21),
  'wrong object version': p => p.permit.object_version = id(21),
  'wrong native version': p => p.permit.native_version = id(21),
  'wrong body digest': p => p.permit.sha256 = 'f'.repeat(64),
  'expired Permit': p => p.permit.expires_at = now,
  'closed Permit': p => p.permit.closed_at = now,
};
for (const [name, change] of Object.entries(wrong)) {
  test(name + ' fails before business effect', async t => {
    const input = command();
    const proof = qualification(input);
    change(proof);
    const { auth, args, calls } = await fixture(t, { input, proof });
    await assert.rejects(auth.run(args), cause('BUSINESS_DENIED'));
    assert.deepEqual(calls, { business: 0, close: 0 });
  });
}

test('Recovery and other identity adapter handles cannot reach the writer', async t => {
  const recovery = await fixture(t, { identity: identityFixture({ recovery: true }) });
  await assert.rejects(recovery.auth.run(recovery.args), { code: 'BUSINESS_DENIED' });
  const other = await fixture(t, { handleIdentity: identityFixture() });
  await assert.rejects(other.auth.run(other.args), { code: 'IDENTITY_REQUIRED' });
  assert.equal(recovery.calls.business + other.calls.business, 0);
  assert.equal(recovery.calls.close + other.calls.close, 0);
});

test('ambiguous commit keeps the original key and recovers after identity expiry without re-dispatch', async t => {
  let time = now / 1_000;
  let unavailable = true;
  const f = await fixture(t, { identity: identityFixture({ clock: () => time }), commitError: true,
    overrideLookup: (e, r) => r.lane === 'command' && unavailable ? { ...e, settled: false } : e,
    overrideClosed: e => ({ ...e, late_write_possible: unavailable }) });
  await assert.rejects(f.auth.run(f.args), cause('COMMIT_UNKNOWN'));
  const changed = { ...f.args.input, grant_id: id(20) };
  await assert.rejects(f.auth.recover({ ...f.args, input: changed, original_account: originalAccount }), /BINDING/);
  assert.deepEqual(f.calls, { business: 1, close: 0 });
  time += 11;
  unavailable = false;
  await assert.rejects(f.auth.run(f.args), { code: 'IDENTITY_REQUIRED' });
  const { handle, ...resume } = f.args;
  const outcome = await f.auth.recover({ ...resume, original_account: originalAccount });
  assert.equal(outcome.recovered, true);
  assert.deepEqual(f.calls, { business: 1, close: 1 });
});

test('settled but mismatched observer correlation cannot satisfy closure', async t => {
  const f = await fixture(t, { overrideLookup: (e, r) =>
    r.lane === 'command' ? { ...e, request_id: id(20) } : e });
  await assert.rejects(f.auth.run(f.args), cause('COMMIT_UNKNOWN'));
  assert.throws(() => readFileSync(join(f.directory, 'closed.json')), { code: 'ENOENT' });
});

test('protected recovery rejects a missing journal and creates no business intent', async t => {
  const f = await fixture(t);
  await assert.rejects(f.auth.recover({ ...f.args, original_account: originalAccount }), { code: 'RECOVERY_REQUIRED' });
  assert.deepEqual(f.calls, { business: 0, close: 0 });
});

test('one original request cannot be re-dispatched under another close key or directory', async t => {
  const f = await fixture(t);
  await f.auth.run(f.args);
  await assert.rejects(f.auth.run({ ...f.args, close_request_id: id(20), directory: '/caller-selected' }), /BINDING/);
  assert.deepEqual(f.calls, { business: 1, close: 1 });
});

test('Seal stays out of the metadata authorization interface', async t => {
  const f = await fixture(t, { input: command('seal') });
  await assert.rejects(f.auth.run(f.args), { code: 'INVALID_INPUT' });
  assert.deepEqual(f.calls, { business: 0, close: 0 });
});


test('the real PNG prepare contract provides the byte fingerprint used by Permit qualification', async t => {
  const input = command();
  const bytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108000000003a7e9b55' +
    '0000000a49444154789c6330020000340033ce83246f0000000049454e44ae426082', 'hex');
  const { prepare } = await preparePrivatePng({
    request_id: input.png.request_id, site_id: input.png.site_id, original_filename: input.png.original_filename,
  }, 'image/png', bytes);
  const prepared = { ...input, png: prepare };
  const f = await fixture(t, { input: prepared });
  await f.auth.run(f.args);
  assert.deepEqual(f.calls, { business: 1, close: 1 });
});
