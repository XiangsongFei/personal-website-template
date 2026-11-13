// Arithmetic over the sealed plan only. No executor or network capability.
export function budget(plan) {
 const sum={};
 for(const step of plan.steps)for(const [key,n]of Object.entries(step.slots)){
  if(!Number.isSafeInteger(n)||n<0)throw Error('BUDGET_INVALID');sum[key]=(sum[key]??0)+n;
 }
 const authUser=sum.normal_reads*2+sum.recovery_reads+sum.grant_apply+sum.auth_user_fresh;
 const authClient=authUser+sum.auth_control;
 const privateTls=sum.normal_reads+sum.grant_apply;
 const uds=privateTls+sum.direct_db;
 return Object.freeze({...sum,outer_business:sum.normal_reads+sum.recovery_reads+sum.grant_apply,
  auth_user_get:authUser,auth_client:authClient,auth_internal_hop:authClient,
  private_mtls:privateTls,postgrest_uds:uds,
  http_edges:authClient*2+privateTls+uds+sum.mail_http,
  explicit_database_transactions:uds+sum.registration_tx+sum.maintenance_tx+sum.fence_tx+plan.read_only_audit_transaction_cap,
  auth_row_insert_cap:Object.values(plan.auth_row_insert_caps).reduce((a,b)=>a+b,0),
  business_row_insert_cap:Object.values(plan.business_insert_caps).reduce((a,b)=>a+b,0)});
}
