// A rehearsal policy model. No Auth settings, sessions, or application routes are mutated.
import assert from 'node:assert/strict';
import {uuid} from '../../lib/business/protocol.mjs';

export function calculateTimeboxWindow({policy,proof,session,jwt,grant,now}) {
  assert.equal(policy.scope,'isolated-rehearsal');
  assert.ok(Number.isSafeInteger(policy.timeboxSeconds)&&policy.timeboxSeconds>0&&policy.inactivitySeconds===0);
  assert.ok(uuid(session.id)&&uuid(session.uid));
  assert.deepEqual([jwt.sid,jwt.uid,grant.sid,grant.uid,proof.sid,proof.uid],[session.id,session.uid,
    session.id,session.uid,session.id,session.uid]);
  assert.ok(grant.active&&proof.active&&proof.epoch===grant.epoch);
  assert.ok([session.createdAt,jwt.expiresAt,grant.expiresAt,proof.expiresAt,now].every(Number.isSafeInteger));
  const policyDeadline=session.createdAt+policy.timeboxSeconds;
  assert.ok(Number.isSafeInteger(policyDeadline)&&session.createdAt<=now);
  assert.ok(session.notAfter===null||Number.isSafeInteger(session.notAfter));
  const deadline=Math.min(policyDeadline,session.notAfter??Infinity);
  assert.equal(deadline,policyDeadline,'a different native deadline would confound the timebox proof');
  const beforeAt=deadline-15, afterAt=deadline+10;
  const eligibilityEnds=Math.min(jwt.expiresAt,grant.expiresAt,proof.expiresAt);
  assert.ok(now<beforeAt&&afterAt+20<eligibilityEnds,'no isolated validity window');
  return {sid:session.id,beforeAt,afterAt,deadline,eligibilityEnds};
}
