import {binding,PROJECT} from './binding.mjs';
import * as core from '../../../lib/business/r3-intent-ledger.mjs';
export const createIntentClaim=namespace=>core.createIntentClaim(namespace,binding);
export const claimApprovedIntent=(storage,intent,clock)=>core.claimApprovedIntent(storage,intent,clock,binding);
export const ledgerName=core.ledgerName(PROJECT);
