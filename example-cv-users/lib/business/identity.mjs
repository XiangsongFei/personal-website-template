import { deny, exact, uuid } from './protocol.mjs';
const contexts = new WeakMap(), logins = new WeakMap();
export function accountContext(handle) {
  const c = contexts.get(handle);
  if (!c || c.expires <= c.clock()) deny('IDENTITY_REQUIRED', 401);
  if (!c.passwordPurpose) deny('BUSINESS_DENIED');
  return { uid: c.uid, session_id: c.session_id };
}
// A proof registrar accepts only handles minted by its own configured, fixed-issuer adapter.
export function boundAccountContext(handle, adapter, issuer) {
  const context = contexts.get(handle);
  if (!context || context.adapter !== adapter || context.issuer !== issuer) deny('IDENTITY_REQUIRED', 401);
  return accountContext(handle);
}
export function loginContext(receipt) {
  const r = logins.get(receipt);
  if (!r || r.clock() - r.observed > 60 || r.clock() < r.observed) deny('FRESH_PASSWORD_LOGIN_REQUIRED');
  return { ...accountContext(r.handle), handle: r.handle };
}
// Only trusted server adapters receive the verified token; no DTO contains it.
export function withCredential(handle, callback) {
  accountContext(handle); return callback(contexts.get(handle).token);
}
export function createIdentityAdapter({ auth, issuer, clock = () => Math.floor(Date.now() / 1000) }) {
  if (!auth || !issuer) deny('NOT_CONFIGURED', 503);
  async function verify(token) {
    if (typeof token !== 'string' || !token || token.length > 16384) deny('IDENTITY_REQUIRED', 401);
    let a, b;
    try {
      if (typeof auth.verifyTokenAndUser === 'function') {
        const verified = await auth.verifyTokenAndUser(token);
        a = {data:{claims:verified?.data?.claims},error:verified?.error};
        b = {data:{user:verified?.data?.user},error:verified?.error};
      } else { a = await auth.getClaims(token); b = await auth.getUser(token); }
    }
    catch { deny('IDENTITY_UNAVAILABLE', 503); }
    const c = a?.data?.claims, u = b?.data?.user;
    if (a?.error || b?.error || !c || c.iss !== issuer || c.aud !== 'authenticated' || c.role !== 'authenticated' ||
        !uuid(c.sub) || !uuid(c.session_id) || !Number.isSafeInteger(c.exp) || c.exp <= clock() ||
        (c.nbf !== undefined && (!Number.isSafeInteger(c.nbf) || c.nbf > clock())) ||
        c.is_anonymous !== false || !u || u.id !== c.sub || u.is_anonymous !== false ||
        !u.email_confirmed_at || !Number.isFinite(Date.parse(u.email_confirmed_at)) ||
        (u.banned_until && (!Number.isFinite(Date.parse(u.banned_until)) || Date.parse(u.banned_until) > clock() * 1000))) deny('IDENTITY_REQUIRED', 401);
    const handle = Object.freeze({});
    const passwordPurpose = Array.isArray(c.amr) && c.amr.some(a => a?.method === 'password') &&
      !c.amr.some(a => ['otp','recovery'].includes(a?.method));
    contexts.set(handle, { adapter, issuer, uid: c.sub, session_id: c.session_id, token, expires: c.exp, clock, passwordPurpose });
    return { handle, claims: c, user: u };
  }
  const adapter = Object.freeze({
    async verifyAccount(token) { return (await verify(token)).handle; },
    async passwordLogin(credentials) {
      exact(credentials, ['email','password']);
      if (typeof credentials.email !== 'string' || credentials.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email) || typeof credentials.password !== 'string' ||
          credentials.password.length < 1 || credentials.password.length > 1024) deny('INVALID_INPUT', 400);
      // Actual server-observed password grant; existing-cookie verification cannot mint this receipt.
      let r;
      try { r = await auth.signInWithPassword(credentials); } catch { deny('IDENTITY_UNAVAILABLE', 503); }
      if (r?.error || !r?.data?.session?.access_token) deny('IDENTITY_REQUIRED', 401);
      const { handle, claims, user } = await verify(r.data.session.access_token);
      if (r.data.user?.id !== claims.sub || r.data.session.user?.id !== claims.sub ||
          typeof user.email !== 'string' || user.email.trim().toLowerCase() !== credentials.email.trim().toLowerCase() ||
          !Array.isArray(claims.amr) || !claims.amr.some(a => a?.method === 'password') ||
          claims.amr.some(a => ['otp','recovery'].includes(a?.method))) deny('FRESH_PASSWORD_LOGIN_REQUIRED');
      const receipt = Object.freeze({});
      logins.set(receipt, { handle, observed: clock(), clock });
      return Object.freeze({ handle, receipt });
    }
  });
  return adapter;
}
