import {businessBinding} from './binding.mjs';
// Private Durable Object transaction only. Population requires a separately approved operator.
import { uuid } from './protocol.mjs';

export const ledgerName = project => 'r3-proof-intents/' + project;
const fields = Object.freeze(['project','action','uid','session_id','epoch','proof_id','key_id']);

export function createIntentClaim(namespace,binding) {
  const project=businessBinding(binding)?.project;
  // Bind one project-wide ledger irrespective of the incoming operation or HTTP request.
  return async plan => project ? namespace.get(namespace.idFromName(ledgerName(project))).claimOnce(plan) : false;
}

export async function claimApprovedIntent(storage, intent, clock = () => Math.floor(Date.now()/1000),binding) {
  const PROJECT=businessBinding(binding)?.project;if(!PROJECT)return false;
  const plan = Object.freeze({ ...intent });
  if (Object.keys(plan).length !== fields.length || !fields.every(k => Object.hasOwn(plan,k)) ||
      plan.project !== PROJECT || !uuid(plan.proof_id) || !uuid(plan.uid) || !uuid(plan.session_id) ||
      !['issue','renew','revoke'].includes(plan.action) || !Number.isSafeInteger(plan.epoch) || plan.epoch < 0 ||
      typeof plan.key_id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(plan.key_id)) return false;
  const name = ledgerName(PROJECT) + '/' + plan.proof_id;
  // The storage engine may restart this callback on a serialization conflict.
  // No signing, external calls, credentials or caller-side effects belong here.
  return storage.transaction(async txn => {
    const record = await txn.get(name);
    const now = clock();
    if (!record || record.state !== 'approved' || Object.keys(record).length !== 4 ||
        !Number.isSafeInteger(record.validFrom) || !Number.isSafeInteger(record.expiresAt) ||
        !Number.isSafeInteger(now) || record.validFrom < 0 || record.validFrom > now || now >= record.expiresAt ||
        record.expiresAt - record.validFrom > 7200 || !record.intent ||
        Object.keys(record.intent).length !== fields.length ||
        !fields.every(k => Object.hasOwn(record.intent,k) && record.intent[k] === plan[k])) return false;
    await txn.put(name, { ...record, state:'consumed', consumedAt:now });
    return { proofId:plan.proof_id, validFrom:record.validFrom, expiresAt:record.expiresAt };
  });
}
