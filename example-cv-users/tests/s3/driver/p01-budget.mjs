import {Meter,need} from './state.mjs';
// Separate authorized read-only rehearsal. The P02-P16 plan stays unchanged.
// 2 P00 + 3 dynamic observer + 2 final ROLLBACK transactions, health(2 edges)
// and one Mailpit metadata GET. No quota is borrowed from a business attempt.
export function p01Meter(plan,options){
 const copy=structuredClone(plan);copy.steps.find(s=>s.id==='P01').slots.mail_http=1;
 const meter=new Meter(copy,{...options,limits:{http_edges:3,explicit_database_transactions:7,read_only_audit:7,outer_business:0,auth_control:0,auth_user_get:0,proof_sign:0,registration_tx:0,grant_apply:0,local_intent:0}});
 for(const [k,v]of Object.entries(options.limits??{})){need(k in meter.cap&&Number.isSafeInteger(v)&&v>=0&&v<=meter.cap[k],'BUDGET_OVERRIDE');meter.cap[k]=v;}
 meter.cleanupReserve=Object.freeze({read_only_audit:2,explicit_database_transactions:2});return meter;
}
