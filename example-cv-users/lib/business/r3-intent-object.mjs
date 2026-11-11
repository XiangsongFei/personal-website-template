// Private, unbound candidate. No fetch handler, initialization, approval or cleanup method.
import {createBusinessBinding} from './binding.mjs';
import { DurableObject } from 'cloudflare:workers';
import { claimApprovedIntent, ledgerName } from './r3-intent-ledger.mjs';

export class R3IntentLedger extends DurableObject {
  async claimOnce(plan) {
    let binding;try{binding=createBusinessBinding(this.env.S3_BUSINESS_BINDING);}catch{return false;}
    const namespace = this.env.R3_PROOF_INTENTS;
    if (!namespace || !this.ctx.id.equals(namespace.idFromName(ledgerName(binding.project)))) return false;
    return claimApprovedIntent(this.ctx.storage, plan,undefined,binding);
  }
}
