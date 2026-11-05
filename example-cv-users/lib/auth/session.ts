import { createServerClient } from '@supabase/ssr';
import { COOKIE, POLICY, configuration, type UsersEnv, normalizeEmail } from '../config';
import { authErrorCode } from './error-code';
import { GRANT_SECONDS } from '../account/policy';
function hasVerifiedOtpMethod(amr: unknown) {
    if (!Array.isArray(amr))
        return false;
    if (amr.every(method => typeof method === 'string'))
        return amr.includes('otp');
    return amr.every(entry => entry && typeof entry === 'object' && typeof entry.method === 'string' && Number.isSafeInteger(entry.timestamp) && entry.timestamp > 0) && amr.some(entry => entry.method === 'otp');
}
export function readCookies(raw: string) {
    const map = new Map<string, string>();
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i < 0)
            continue;
        const name = part.slice(0, i).trim();
        try {
            if (map.has(name))
                throw Error('duplicate_cookie');
            map.set(name, decodeURIComponent(part.slice(i + 1).trim()));
        }
        catch {
            map.set(name, '');
        }
    }
    return [...map].map(([name, value]) => ({ name, value }));
}
export const cookieLine = (name: string, value: string, age = GRANT_SECONDS) => `${name}=${encodeURIComponent(value)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${value ? age : 0}`;
export function createSession(env: UsersEnv, raw = '', scope: 'account' | 'recovery' = 'account') {
    const config = configuration(env), name = COOKIE[scope];
    const owned = (n: string) => n === name || n.startsWith(name + '.') || n.startsWith(name + '-');
    const jar = new Map(readCookies(raw).filter(c => owned(c.name)).map(c => [c.name, c.value]));
    const writes = new Map<string, string>(), seen = new Set<string>();
    let transient: 'network' | 'limited' | undefined;
    let refreshUnconfirmed = false;
    const transport: typeof fetch = async (input, init) => {
        const request = new Request(input, init), url = new URL(request.url), start = Date.now();
        const route = request.method + ' ' + url.pathname + url.search;
        const allowed = ['POST /auth/v1/signup', 'POST /auth/v1/resend', 'POST /auth/v1/recover', 'POST /auth/v1/verify', 'POST /auth/v1/token?grant_type=password', 'POST /auth/v1/token?grant_type=refresh_token', 'POST /auth/v1/logout?scope=local', 'GET /auth/v1/user', 'PUT /auth/v1/user', 'GET /auth/v1/.well-known/jwks.json'];
        if (url.origin !== config.url || !allowed.includes(route) || request.headers.get('apikey') !== config.key || request.headers.has('cookie'))
            throw Error('auth_target_denied');
        // SDK refresh retries must never produce a second upstream mutation in a request.
        if (request.method !== 'GET') {
            if (seen.has(route))
                return Response.json({ code: 'request_already_attempted', message: 'Request unavailable' }, { status: 409 });
            seen.add(route);
        }
        const controller = new AbortController(), timeout = request.method === 'PUT' ? 18000 : 20000;
        const timer = setTimeout(() => controller.abort(), timeout);
        let status = 0;
        try {
            const options = { signal: AbortSignal.any([controller.signal, request.signal]), redirect: 'manual' as const };
            // This local-only service binding owns pre-dispatch scope and budget checks.
            // Production and synthetic transports retain their existing fetch path.
            const response = env.USERS_MODE === 'controlled-real'
                ? await env.USERS_CONTROLLED_EGRESS!.fetch(request, options)
                : await fetch(request, options);
            status = response.status;
            if (route.endsWith('?grant_type=refresh_token') && (status === 429 || status >= 500 || status === 408)) refreshUnconfirmed = true;
            if (status === 429) transient = 'limited';
            else if (status >= 500 || status === 408) transient = 'network';
            if (status >= 300 && status < 400)
                throw Error('auth_redirect_denied');
            const text = await response.text();
            if (text.length > 262144)
                throw Error('auth_response_size');
            if (!response.ok) {
                let data;
                try {
                    data = JSON.parse(text);
                }
                catch { }
                const code = authErrorCode(data, status);
                return Response.json({ code: code ?? 'auth_response_error', message: 'Authentication request failed' }, { status, headers: { 'X-Supabase-Api-Version': '2024-01-01' } });
            }
            return new Response(status === 204 ? null : text, { status, headers: { 'Content-Type': 'application/json' } });
        }
        catch {
            transient = 'network';
            if (route.endsWith('?grant_type=refresh_token')) refreshUnconfirmed = true;
            return Response.json({ code: 'transport_unconfirmed', message: 'Connection unavailable' }, { status: 503 });
        }
        finally {
            clearTimeout(timer);
            console.info(JSON.stringify({ event: 'users_auth', stage: request.method === 'PUT' ? 'password_update' : url.pathname.split('/').pop(), status, elapsedMs: Date.now() - start }));
        }
    };
    const client = createServerClient(config.url, config.key, { global: { fetch: transport }, cookieOptions: { name, ...POLICY }, auth: { detectSessionInUrl: false, autoRefreshToken: false }, cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll(items) { for (const item of items) {
                const suffix = item.name.slice(name.length);
                if (!owned(item.name) || !/^(?:[.][0-9]+|-code-verifier|-flows-code-verifier|-flow-[a-zA-Z0-9_-]{8,64}-code-verifier)?$/.test(suffix) || item.options.domain || item.options.path !== '/' || !item.options.secure || !item.options.httpOnly || item.options.sameSite !== 'lax')
                    throw Error('cookie_policy_denied');
                if (item.options.maxAge === 0)
                    jar.delete(item.name);
                else
                    jar.set(item.name, item.value);
                writes.set(item.name, cookieLine(item.name, item.value, item.options.maxAge === 0 ? 0 : scope === 'recovery' ? GRANT_SECONDS : item.options.maxAge ?? 3600));
            } } } });
    async function identity(token?: string) {
        try {
            const result = await client.auth.getClaims(token);
            const c = result.data?.claims;
            if (result.error || !c || c.iss !== config.url + '/auth/v1' || c.aud !== 'authenticated' || typeof c.sub !== 'string' || typeof c.session_id !== 'string' || !c.session_id)
                return null;
            if (token !== undefined && !hasVerifiedOtpMethod(c.amr))
                return null;
            const { data, error } = await client.auth.getUser(token);
            const user = data.user;
            if (error || !user?.email || user.id !== c.sub || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at)))
                return null;
            return { id: user.id, email: normalizeEmail(user.email), sessionId: c.session_id as string };
        }
        catch {
            return null;
        }
    }
    function clear() { for (const key of jar.keys())
        writes.set(key, cookieLine(key, '')); jar.clear(); }
    async function logout() {
        // auth-js removes its local session even on a failed sign-out. Retain only
        // the HttpOnly jar for an explicit scoped cleanup retry, never for recovery authorization.
        try {
            const current = await client.auth.getSession();
            if (current.error)
                return false;
            const before = new Map(jar), beforeWrites = new Map(writes);
            const { error } = await client.auth.signOut({ scope: 'local' });
            if (error) {
                jar.clear();
                writes.clear();
                for (const [key, value] of before)
                    jar.set(key, value);
                for (const [key, value] of beforeWrites)
                    writes.set(key, value);
                return false;
            }
            clear();
            return true;
        }
        catch {
            return false;
        }
    }
    function retirePriorChunks(rawCookies: string) {
        for (const cookie of readCookies(rawCookies)) {
            const chunk = cookie.name.startsWith(name + '.') && /^\.[0-9]+$/.test(cookie.name.slice(name.length));
            if ((cookie.name === name || chunk) && !jar.has(cookie.name)) {
                writes.set(cookie.name, cookieLine(cookie.name, ''));
            }
        }
    }
    return { client, identity, logout, clear, retirePriorChunks, transient: () => transient, apply(response: Response) {
        // An inconclusive refresh is not evidence that the original cookie expired.
        if (!refreshUnconfirmed) {
            for (const line of writes.values()) response.headers.append('Set-Cookie', line);
        }
        return response;
    } };
}
export type Session = ReturnType<typeof createSession>;
