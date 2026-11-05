// Local session diagnostic boundary. No authentication decisions or cookie values in logs.
export const HTTPS_ORIGIN = 'https://127.0.0.1:8787';
export const HTTPS_AUTHORITY = '127.0.0.1:8787';
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);
const FORGED = /^(forwarded|via|x-forwarded(?:-.*)?|x-real-ip|x-original-url|x-rewrite-url|cf-.*|x-miniflare-.*)$/i;
const OWN_COOKIE = /^__Host-ecv-users-(?:session|recovery|tx|grant)(?:\.\d+|-code-verifier|-flows-code-verifier|-flow-[a-f0-9]{32}-code-verifier)?$/;
const POST_PATHS = new Set(['/api/account/login', '/api/account/refresh', '/api/account/logout', '/api/account/recovery-logout']);
export function cookieNames(raw = '') {
  return [...new Set(raw.split(';').map(p => p.trim().split('=')[0]).filter(n => OWN_COOKIE.test(n)))].sort();
}
export function cookieMetadata(line) {
  const [pair, ...parts] = line.split(';');
  const name = pair.slice(0, pair.indexOf('='));
  if (!OWN_COOKIE.test(name)) throw Error('unexpected_response_cookie');
  const attrs = Object.fromEntries(parts.map(p => {
    const [key, ...value] = p.trim().split('=');
    return [key.toLowerCase(), value.join('=')];
  }));
  return {name, valuePresent: pair.slice(pair.indexOf('=') + 1).length > 0,
    secure: Object.hasOwn(attrs, 'secure'), httpOnly: Object.hasOwn(attrs, 'httponly'),
    path: attrs.path ?? null, sameSite: attrs.samesite ?? null, domainPresent: Object.hasOwn(attrs, 'domain'),
    maxAge: /^-?\d+$/.test(attrs['max-age'] ?? '') ? Number(attrs['max-age']) : null};
}
export function authorizeLocalRequest(req, postPaths = POST_PATHS) {
  if (req.socket?.remoteAddress !== '127.0.0.1' || req.socket?.encrypted !== true) throw Error('tls_loopback_required');
  if (req.headers.host !== HTTPS_AUTHORITY) throw Error('host_denied');
  if (Object.keys(req.headers).some(k => FORGED.test(k)) || req.headers.authorization || req.headers['proxy-authorization']) throw Error('untrusted_header');
  if (req.headers.origin !== undefined && req.headers.origin !== HTTPS_ORIGIN || req.headers['sec-fetch-site'] === 'cross-site') throw Error('origin_denied');
  const raw = req.url;
  if (typeof raw !== 'string' || raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x20#]/.test(raw)) throw Error('target_denied');
  const url = new URL(raw, HTTPS_ORIGIN);
  if (url.origin !== HTTPS_ORIGIN || url.pathname !== raw.split('?')[0] || /%(?:2f|5c|00|2e)/i.test(url.pathname)) throw Error('target_denied');
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw Error('method_denied');
  if (req.method === 'POST' && (!postPaths.has(url.pathname) || url.search || req.headers.origin !== HTTPS_ORIGIN || req.headers['content-type']?.split(';')[0] !== 'application/json')) throw Error('session_diagnostic_scope');
  if (req.headers.expect || req.headers.upgrade || req.headers['content-encoding']) throw Error('framing_denied');
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP.has(name) || value === undefined) continue;
    if (Array.isArray(value)) throw Error('duplicate_header');
    if (name === 'cookie') {
      // Do not pass old probe/CMS or other site's cookie identities to this package.
      const own = value.split(';').map(p => p.trim()).filter(p => OWN_COOKIE.test(p.split('=')[0]));
      if (own.length) headers.set(name, own.join('; '));
    } else headers.set(name, value);
  }
  return {url: url.href, path: url.pathname, method: req.method, headers};
}
export function outgoingHeaders(response) {
  const result = {};
  for (const [name, value] of response.headers) if (!HOP.has(name) && name !== 'set-cookie' && !FORGED.test(name)) result[name] = value;
  const cookies = response.headers.getSetCookie();
  if (cookies.length) { cookies.forEach(cookieMetadata); result['set-cookie'] = cookies; }
  if (result.location) {
    if (/^[\/]{2}|[\\\x00-\x20]/.test(result.location) || new URL(result.location, HTTPS_ORIGIN).origin !== HTTPS_ORIGIN) throw Error('redirect_denied');
  }
  // Never cache this diagnostic origin; preserve each Set-Cookie as a distinct field.
  result['cache-control'] = 'private, no-store'; result.pragma = 'no-cache';
  return result;
}
export function browserFamily(ua = '') {
  return /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'local-check';
}
