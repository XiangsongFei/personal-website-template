// Server-only candidate. No route, database driver, signing key or credentials are configured.
import { timingSafeEqual } from 'node:crypto';
import {businessBinding} from './binding.mjs';
import { checkServerIdentity } from 'node:tls';
import { createIntentClaim } from './r3-intent-ledger.mjs';
import { boundAccountContext, loginContext } from './identity.mjs';
import { BusinessError, deny, exact, grantBytes, hex, proofBytes, sha256, uuid, validateProof } from './protocol.mjs';

const registerSQL = 'SELECT site_private.register_business_ticket($1::jsonb) AS registered';
const spentLogins = new WeakSet();
const signedLogins = new WeakSet();
const verifierIdentities = new WeakMap();

function checkedTime(clock) {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) deny('NOT_CONFIGURED', 503);
  return now;
}

function checkWindow(proof, key, now) {
  if (!key || key.project !== proof.project || key.id !== proof.key_id || key.revoked !== false ||
      ![key.notBefore, key.signUntil, key.verifyUntil].every(Number.isSafeInteger) ||
      !(0 <= key.notBefore && key.notBefore < key.signUntil && key.signUntil <= key.verifyUntil) ||
      !(key.notBefore <= proof.issued_at && proof.issued_at < key.signUntil &&
        proof.issued_at <= now && now < proof.expires_at && proof.expires_at <= key.verifyUntil)) {
    deny('INVALID_PROOF');
  }
}

async function nativeMac(key, proof) {
  const macKey = key.macKey;
  if (!macKey || macKey.type !== 'secret' || macKey.extractable !== false ||
      macKey.algorithm?.name !== 'HMAC' || macKey.algorithm.hash?.name !== 'SHA-256' ||
      macKey.algorithm.length !== 256 || !macKey.usages?.includes('sign')) deny('INVALID_PROOF');

  try { return new Uint8Array(await crypto.subtle.sign('HMAC', macKey, proofBytes(proof))); }
  catch { deny('VERIFIER_UNAVAILABLE', 503); }
}

async function verify(envelope, who, action, lookupKey, clock, binding) {
  exact(envelope, ['proof', 'signature']);
  // Copy only flat scalar fields. Validate and register the same immutable bytes/values.
  const proof = Object.freeze(validateProof({ ...envelope.proof },binding.project));
  const signature = envelope.signature;
  if (proof.action !== action || proof.uid !== who.uid || proof.session_id !== who.session_id ||
      typeof signature !== 'string' || signature.length !== 64 || !/^[0-9a-f]{64}$/.test(signature)) {
    deny('INVALID_PROOF');
  }
  if (await sha256(grantBytes(proof)) !== proof.payload_digest) deny('INVALID_PROOF');

  const beforeKey = checkedTime(clock);
  if (proof.issued_at > beforeKey || beforeKey >= proof.expires_at) deny('INVALID_PROOF');
  let key;
  try { key = await lookupKey(proof.key_id); }
  catch { deny('VERIFIER_UNAVAILABLE', 503); }
  checkWindow(proof, key, checkedTime(clock));
  const expected = await nativeMac(key, proof);
  const supplied = Uint8Array.from(signature.match(/../g), pair => Number.parseInt(pair, 16));
  if (expected.length !== 32 || !timingSafeEqual(expected, supplied)) deny('INVALID_PROOF');
  checkWindow(proof, key, checkedTime(clock));
  return proof;
}

function unknown(code, proof) {
  const error = new BusinessError(code, 503);
  error.proofId = proof.proof_id;
  throw error;
}

// Await phases separately: a late connect/credential result can never continue to query().
async function within(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('DEADLINE')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function register(proof, { Client, credentials, timeoutMs = 5000 }, clock,binding) {
  const registrarHost=binding.registrarHost;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) deny('NOT_CONFIGURED',503);
  // Dedicated certificate-authenticated session; DB passwords and caller-supplied DSNs are forbidden.
  let client;
  let peerVerified = false;
  try {
    const material = await within(credentials(),timeoutMs);
    exact(material, ['ca', 'cert', 'key']);
    if (![material.ca, material.cert, material.key].every(v => typeof v === 'string' && v.length > 0))
      deny('NOT_CONFIGURED', 503);
    client = new Client({
      host: registrarHost, port: 5432, database: 'postgres', user: 'ecv_s3_registration_login',
      password: () => deny('REGISTRAR_UNAVAILABLE', 503),
      ssl: {
        ...material, minVersion: 'TLSv1.2', servername: registrarHost, rejectUnauthorized: true,
        checkServerIdentity: (name, cert) => {
          peerVerified = false;
          if (name !== registrarHost || cert?.subjectaltname !== 'DNS:' + registrarHost)
            return new Error('REGISTRAR_PEER_MISMATCH');
          const error = checkServerIdentity(registrarHost, cert);
          peerVerified = error === undefined;
          return error;
        }
      },
      options:'-c search_path=pg_catalog',
      connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs,
      application_name: 's33b-ticket-registrar'
    });
    await within(client.connect(),timeoutMs);
    if (!peerVerified) deny('REGISTRAR_UNAVAILABLE', 503);
  } catch {
    if (client) {
      try { await within(client.end(),timeoutMs); } catch { /* No registration query was issued. */ }
    }
    deny('REGISTRAR_UNAVAILABLE', 503);
  }

  let issued = false;
  try {
    if (checkedTime(clock) >= proof.expires_at) deny('INVALID_PROOF');
    // One implicit transaction, no pooled SET ROLE or caller-controlled SQL.
    issued = true;
    const response = await within(client.query(registerSQL, [JSON.stringify(proof)]),timeoutMs);
    if (response?.command !== 'SELECT' || response.rowCount !== 1 || response.rows?.length !== 1 ||
        response.rows[0]?.registered !== true) unknown('REGISTRATION_UNKNOWN', proof);
  } catch (e) {
    if (!issued) throw e;
    // Only explicit server ERROR responses from the registered function establish a rejection.
    if (e?.severity === 'ERROR') {
      if (e.code === '42501' && e.message === 'BUSINESS_DENIED') deny('BUSINESS_DENIED');
      if (e.code === 'PT409' && e.message === 'TICKET_ALREADY_REGISTERED') deny('TICKET_CONFLICT', 409);
      if (e.code === 'PT503' && e.message === 'NOT_CONFIGURED') deny('NOT_CONFIGURED', 503);
    }
    unknown('REGISTRATION_UNKNOWN', proof);
  } finally {
    try { await within(client.end(),timeoutMs); }
    catch { if (issued) unknown('REGISTRATION_UNKNOWN', proof); deny('REGISTRAR_UNAVAILABLE',503); }
  }
}

/**
 * No HTTP handler. The caller supplies an opaque verified account handle, and for issue
 * the opaque receipt of the same server-observed password login. An already-signed
 * internal envelope is the only proof input; this component cannot request a second one.
 * Key lookup and credentials must be protected server bindings, never request fields.
 * The authenticated user repository is separate from the TLS registrar connection.
 */
export function createRegisteredGrantService({
  binding, enabled = false, project, identity, lookupKey, registrar, repository, clock = () => Math.floor(Date.now() / 1000)
} = {}) {
  const scope=businessBinding(binding);const {project:PROJECT,authIssuer:issuer}=scope??{};
  const configured = !!scope && enabled === true && project === PROJECT && !!identity && typeof lookupKey === 'function' &&
    typeof registrar?.Client === 'function' && typeof registrar.credentials === 'function' &&
    typeof repository?.grant === 'function' && typeof clock === 'function';
  async function submit(action, handle, receipt, envelope) {
    if (!configured) deny('NOT_CONFIGURED', 503);
    const registration=Object.freeze({Client:registrar.Client,credentials:registrar.credentials,timeoutMs:registrar.timeoutMs});
    const who = boundAccountContext(handle, identity, issuer);
    if (action === 'issue') {
      if (loginContext(receipt).handle !== handle || spentLogins.has(receipt)) deny('FRESH_PASSWORD_LOGIN_REQUIRED');
      spentLogins.add(receipt);
    }
    const proof = await verify(envelope, who, action, lookupKey, clock,binding);
    boundAccountContext(handle, identity, issuer);
    if (action === 'issue') loginContext(receipt);
    await register(proof, registration, clock,binding);
    boundAccountContext(handle, identity, issuer);
    if (checkedTime(clock) >= proof.expires_at) deny('INVALID_PROOF');

    let result;
    try { result = await repository.grant(handle, { proof }); }
    catch (e) {
      if (e instanceof BusinessError) {
        if (e.code === 'BUSINESS_DENIED') deny('BUSINESS_DENIED');
        if (e.code === 'REQUEST_CONFLICT') deny('REQUEST_CONFLICT', 409);
        if (e.code === 'NOT_CONFIGURED') deny('NOT_CONFIGURED', 503);
      }
      unknown('COMMIT_UNKNOWN', proof);
    }
    if (!result || !uuid(result.grant_id) || result.status !== (action === 'revoke' ? 'revoked' : 'active') ||
        typeof result.expires_at !== 'string' || !Number.isFinite(Date.parse(result.expires_at))) unknown('COMMIT_UNKNOWN', proof);
    return { grant_id: result.grant_id, status: result.status, expires_at: result.expires_at };
  }
  const service = Object.freeze({
    issue: (handle, receipt, envelope) => submit('issue', handle, receipt, envelope),
    renew: (handle, envelope) => submit('renew', handle, null, envelope),
    revoke: (handle, envelope) => submit('revoke', handle, null, envelope)
  });
  if (configured) verifierIdentities.set(service, {identity,binding});
  return service;
}

/**
 * Single server-planned operation. The protected host pins the intent, including its ID,
 * before construction. The private intentNamespace performs a durable, project-scoped reservation
 * of that exact intent. A previously used ID, a lost response or a missing provider stops
 * signing. An in-memory flag alone cannot provide this guarantee across Worker isolates.
 */
export function createR3Issuer(options = {}) {
  const { binding, enabled = false, project, identity, intent, intentNamespace, lookupSigningKey, verifier,
    clock = () => Math.floor(Date.now() / 1000) } = options;
  const allowed = ['binding','enabled','project','identity','intent','intentNamespace','lookupSigningKey','verifier','clock'];
  const scope=businessBinding(binding);const {project:PROJECT,authIssuer:issuer}=scope??{};
  const configured = !!scope && Reflect.ownKeys(options).every(k => allowed.includes(k)) &&
    enabled === true && project === PROJECT && !!identity && typeof lookupSigningKey === 'function' &&
    typeof intentNamespace?.idFromName === 'function' && typeof intentNamespace.get === 'function' &&
    typeof clock === 'function' && verifierIdentities.get(verifier)?.identity === identity && verifierIdentities.get(verifier)?.binding === binding;
  const reserve = createIntentClaim(intentNamespace,binding);
  const plan = Object.freeze({ ...intent });
  let used = false;
  async function run(action, handle, receipt) {
    if (!configured) deny('NOT_CONFIGURED', 503);
    const who = boundAccountContext(handle, identity, issuer);
    exact(plan, ['project','action','uid','session_id','epoch','proof_id','key_id']);
    if (plan.project !== PROJECT || plan.action !== action || plan.uid !== who.uid ||
        plan.session_id !== who.session_id || !uuid(plan.proof_id) ||
        !Number.isSafeInteger(plan.epoch) || plan.epoch < 0 ||
        typeof plan.key_id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(plan.key_id)) deny('INVALID_INTENT');
    if (used) deny('INTENT_ALREADY_USED', 409);
    if (action === 'issue') {
      if (loginContext(receipt).handle !== handle || signedLogins.has(receipt)) deny('FRESH_PASSWORD_LOGIN_REQUIRED');
      signedLogins.add(receipt);
    }
    used = true;
    let reserved;
    try { reserved = await reserve(plan); }
    catch { unknown('INTENT_UNKNOWN', plan); }
    if (reserved === false) deny('INTENT_ALREADY_USED', 409);
    if (reserved?.proofId !== plan.proof_id || !Number.isSafeInteger(reserved.validFrom) ||
        !Number.isSafeInteger(reserved.expiresAt) || reserved.validFrom < 0 || reserved.expiresAt <= reserved.validFrom ||
        reserved.expiresAt - reserved.validFrom > 7200) unknown('INTENT_UNKNOWN', plan);
    const { validFrom, expiresAt } = reserved;
    const beforeKey = checkedTime(clock);
    if (beforeKey < validFrom || beforeKey >= expiresAt) deny('INTENT_EXPIRED');

    let key;
    try { key = await lookupSigningKey(plan.key_id); }
    catch { deny('SIGNER_UNAVAILABLE',503); }
    const now = checkedTime(clock);
    if (now < validFrom || now >= expiresAt) deny('INTENT_EXPIRED');
    const proof = { ...plan, version:1, purpose:'business', payload_digest:'',
      issued_at:now, expires_at:Math.min(now + 60, key?.verifyUntil ?? now, expiresAt),
      event:action === 'issue' ? 'password-login' : 'account-session' };
    proof.payload_digest = await sha256(grantBytes(proof));
    validateProof(proof,binding.project);
    checkWindow(proof, key, checkedTime(clock));
    boundAccountContext(handle, identity, issuer);
    if (action === 'issue') loginContext(receipt);
    const signature = hex(await nativeMac(key, proof));
    const envelope = Object.freeze({ proof:Object.freeze(proof), signature });
    return action === 'issue' ? verifier.issue(handle, receipt, envelope) : verifier[action](handle, envelope);
  }
  return Object.freeze({
    issue: (handle, receipt) => run('issue',handle,receipt),
    renew: handle => run('renew',handle,null),
    revoke: handle => run('revoke',handle,null)
  });
}

// Local isolated security test admission. No HTTP handler or database privilege changes.
// Allows independently measured registration, waiting, concurrency and RPC stages.
export async function verifySecurityEnvelope(action,handle,envelope,{binding,enabled=false,identity,lookupKey,clock=()=>Math.floor(Date.now()/1000)}) {
 const scope=businessBinding(binding);if(!scope||enabled!==true)deny('NOT_CONFIGURED',503);const issuer=scope.authIssuer;
 const who=boundAccountContext(handle,identity,issuer);
 return verify(envelope,who,action,lookupKey,clock,binding);
}
export async function admitSecurityEnvelope(action,handle,receipt,envelope,options={}) {
 const {binding,enabled=false,identity,lookupKey,clock=()=>Math.floor(Date.now()/1000),registrar}=options;
 const scope=businessBinding(binding);
 const registration=registrar&&Object.freeze({Client:registrar.Client,credentials:registrar.credentials,timeoutMs:registrar.timeoutMs});
 if(!scope||enabled!==true||typeof lookupKey!=='function'||typeof registration?.Client!=='function'||typeof registration.credentials!=='function')deny('NOT_CONFIGURED',503);
 if(action==='issue') {
  if(loginContext(receipt).handle!==handle||spentLogins.has(receipt))deny('FRESH_PASSWORD_LOGIN_REQUIRED');
  spentLogins.add(receipt);
 }
 const proof=await verifySecurityEnvelope(action,handle,envelope,{binding,enabled,identity,lookupKey,clock});
 boundAccountContext(handle,identity,scope.authIssuer);
 if(action==='issue')loginContext(receipt);
 await register(proof,registration,clock,binding);
 return proof;
}
