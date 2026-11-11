// Offline text generator for a proposed prefix, never an installer or an HBA parser.
// Its inputs must come from independently frozen network/OS inventory.
import { isIPv4 } from 'node:net';
const api = 'ecv_s3_internal_api_login';
const registration = 'ecv_s3_registration_login';
const principals = [api, registration];
const both = principals.join(',');

function privateSource(value) {
  if (typeof value !== 'string' || !isIPv4(value)) throw Error('UNFROZEN_IPV4_SOURCE');
  const [a,b] = value.split('.').map(Number);
  if (a !== 10 && !(a === 192 && b === 168) && !(a === 172 && b >= 16 && b <= 31))
    throw Error('UNFROZEN_IPV4_SOURCE');
  return value+'/32';
}

// local mode requires a kernel-visible OS user with the exact role name, and
// an independent audit for login as *another* role through prior/remaining HBA.
export function servicePrefix(mode, sources) {
  const lines=[];
  if (mode === 'tls') {
    if (!sources || Object.keys(sources).sort().join(',') !== 'api,registration')
      throw Error('TWO_DEDICATED_SOURCES_REQUIRED');
    const hosts = [privateSource(sources.api),privateSource(sources.registration)];
    if (hosts[0]===hosts[1]) throw Error('SHARED_SOURCE');
    for (const [i,role] of principals.entries()) lines.push('hostssl postgres '+role+' '+hosts[i]+' cert');
    // The two *exclusive* sources must not log into another role, DB or replication slot.
    for (const host of hosts) lines.push('host all,replication all '+host+' reject');
  } else if (mode === 'peer' && sources === undefined) {
    for (const role of principals) lines.push('local postgres '+role+' peer');
  } else {
    throw Error('UNAPPROVED_MODE');
  }
  // Positive rules alone would fall through to unrelated catch-all/trust rules.
  lines.push('local all,replication '+both+' reject');
  for (const cidr of ['0.0.0.0/0','::/0']) lines.push('host all,replication '+both+' '+cidr+' reject');
  return lines.join('\n')+'\n';
}
