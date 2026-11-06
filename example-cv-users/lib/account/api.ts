import { configuration, COOKIE, accountKey, digest, normalizeEmail, safeReturn, type UsersEnv } from '../config';
import { createSession, readCookies, cookieLine } from '../auth/session';
import { AUTH_COPY, RECOVERY_COPY } from './recovery-copy';
import { messages, codeOf, translate } from './messages';
import {
    ATTEMPT_SECONDS, EMAIL_MAX_LENGTH, GRANT_SECONDS, OTP_SECONDS, RESEND_SECONDS, TRANSACTION_SECONDS,
    isExistingPassword, isNewPassword, isOtp, isRealEmail, passwordIssue
} from './policy';

export function reply(request: Request, status: number, message: string, extra: Record<string, unknown> = {}) {
    const code = codeOf(message);
    const locale = request.headers.get('x-users-language') === 'en' ? 'en' : 'zh';
    return Response.json({ok: status >= 200 && status < 300, code, message: translate(messages[code], locale), ...extra}, {
        status, headers: {'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'Vary': 'Cookie, X-Users-Language',
            'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'}
    });
}
const keys: Record<string, string[]> = {
    login: ['email','password','returnTo'], register: ['email','password','confirmPassword'],
    'resend-confirmation': ['email'], 'verify-email': ['email','token'],
    'recovery-otp-send': ['email'], 'recovery-otp-verify': ['email','token'],
    'reset-password': ['newPassword','confirmNewPassword'],
    'change-password': ['currentPassword','newPassword','confirmNewPassword','operation'],
    logout: [], 'recovery-logout': [], refresh: [],
};
function inputIssue(action: string, input: Record<string, unknown>) {
    const fields = keys[action];
    if (!fields || Object.entries(input).some(([k,v]) => !fields.includes(k) || typeof v !== 'string')) return messages.invalidInput;
    if (fields.includes('email') && (typeof input.email !== 'string' || input.email.length > EMAIL_MAX_LENGTH || !isRealEmail(normalizeEmail(input.email)))) return messages.invalidInput;
    if (fields.includes('token') && !isOtp(input.token)) return RECOVERY_COPY.invalid;
    if (!safeReturn(input.returnTo)) return messages.invalidInput;
    if (action === 'register') return passwordIssue(input.password, input.confirmPassword);
    if (action === 'login' && !isExistingPassword(input.password)) return messages.invalidInput;
    if (fields.includes('newPassword')) {
        if (!isNewPassword(input.newPassword)) return messages.weakPassword;
        if (input.confirmNewPassword !== undefined && input.confirmNewPassword !== input.newPassword) return messages.mismatch;
        if (action === 'change-password' && !isExistingPassword(input.currentPassword)) return messages.invalidInput;
        if (input.currentPassword === input.newPassword) return messages.samePassword;
        if (input.operation !== undefined && !/^[0-9a-f-]{36}$/.test(input.operation as string)) return messages.invalidInput;
    }
    return null;
}
async function body(request: Request) {
    const reader = request.body?.getReader();
    if (!reader)
        throw Error('body_missing');
    let text = '', size = 0;
    const decoder = new TextDecoder();
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > 4096)
                throw Error('body_size');
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        const v = JSON.parse(text);
        if (!v || Array.isArray(v) || typeof v !== 'object')
            throw Error('body_invalid');
        return v;
    }
    finally {
        await reader.cancel().catch(() => { });
    }
}
const opaque = () => crypto.randomUUID() + crypto.randomUUID();
export async function accountAPI(request: Request, env: UsersEnv) {
    const path = new URL(request.url).pathname, action = path.slice('/api/account/'.length), raw = request.headers.get('cookie') ?? '';
    const respond = (status: number, message: string, extra: Record<string, unknown> = {}) => reply(request, status, message, extra);
    if (!['session', 'recovery-session', 'recovery-progress', ...Object.keys(keys)].includes(action))
        return respond(404, messages.endpoint);
    const get = ['session', 'recovery-session', 'recovery-progress'].includes(action);
    if (request.method !== (get ? 'GET' : 'POST'))
        return respond(405, messages.endpoint);
    let config;
    try {
        config = configuration(env);
    }
    catch {
        return respond(503, messages.unavailable);
    }
    if (new URL(request.url).origin !== config.origin || (!get && (request.headers.get('origin') !== config.origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json')) || request.headers.get('sec-fetch-site') === 'cross-site')
        return respond(403, messages.restart);
    let input: Record<string, string> = {};
    if (!get) {
        try {
            input = await body(request);
            const issue = inputIssue(action, input);
            if (issue) return respond(400, issue);
        }
        catch {
            return respond(400, messages.invalidInput);
        }
    }
    const email = normalizeEmail(input.email ?? '');
    const cookies = readCookies(raw), getCookie = (n: string) => cookies.find(c => c.name === n)?.value ?? '';
    const recoveryActive = cookies.some(c => c.name === COOKIE.recovery || c.name.startsWith(COOKIE.recovery + '.'));
    const scope = action.startsWith('recovery-') || action === 'reset-password' ? 'recovery' : 'account';
    // Fresh login and code verification can never borrow an existing account session.
    const fresh = ['login', 'register', 'verify-email', 'recovery-otp-send', 'recovery-otp-verify', 'resend-confirmation'].includes(action);
    const session = createSession(env, fresh ? '' : raw, scope);
    const out = (status: number, message: string, extra: Record<string, unknown> = {}) => session.apply(respond(status, message, extra));
    // Never attach cookies from a fresh upstream session to a failed identity check.
    const identityDenied = async () => {
        const problem = session.transient();
        const closed = await session.logout();
        if (!closed) console.info(JSON.stringify({event: 'users_auth', stage: 'unverified_session_cleanup_unconfirmed'}));
        if (problem === 'limited') return respond(429, AUTH_COPY.limited);
        if (problem === 'network') return respond(503, AUTH_COPY.network);
        return respond(403, RECOVERY_COPY.restart);
    };
    const noIdentity = (scoped = false) => {
        const problem = session.transient();
        if (problem === 'limited') return out(429, AUTH_COPY.limited);
        if (problem === 'network') return out(503, AUTH_COPY.network);
        return out(401, scoped ? RECOVERY_COPY.restart : messages.expiredSession);
    };
    const object = (key: string) => env.USERS_RECOVERY_STATE.get(env.USERS_RECOVERY_STATE.idFromName('account:v1:' + key));
    const limit = async () => { const key = await accountKey(config.project, email || 'ip:' + request.headers.get('cf-connecting-ip')); return object(key).rate(action, action === 'login' ? 10 : 20, ATTEMPT_SECONDS * 1000); };
    try {
        if (!get && !['logout', 'recovery-logout'].includes(action)) {
            const ipKey = await digest(config.project + '\0ip:' + (request.headers.get('cf-connecting-ip') ?? 'local'));
            if (!await object(ipKey).rate('ip', 60, ATTEMPT_SECONDS * 1000))
                return out(429, AUTH_COPY.limited);
        }
        if (['login','verify-email'].includes(action) && recoveryActive)
            return out(409, RECOVERY_COPY.active, {cleanup: true, cleanupScope: 'recovery'});
        if (['login', 'register', 'verify-email'].includes(action) && !await limit())
            return out(429, AUTH_COPY.limited);
        if (action === 'session') {
            const who = await session.identity();
            return who ? out(200, messages.signedIn, { user: { id: who.id, email: who.email } }) : noIdentity();
        }
        if (action === 'logout' || action === 'recovery-logout') {
            if (action === 'recovery-logout') {
                const tx = getCookie(COOKIE.tx);
                if (/^[a-f0-9]{64}\.[a-f0-9-]{36}$/.test(tx))
                    await object(tx.split('.')[0]).cancelTransaction(tx.split('.')[1]);
            }
            const confirmed = await session.logout();
            const response = out(confirmed ? 200 : 503, confirmed ? messages.signedOut : messages.logoutUnknown, { cleanup: !confirmed, cleanupScope: scope, next: confirmed ? '/login' : undefined });
            if (confirmed && scope === 'recovery')
                for (const n of [COOKIE.tx, COOKIE.grant])
                    response.headers.append('Set-Cookie', cookieLine(n, ''));
            return response;
        }
        if (action === 'refresh') {
            const { error } = await session.client.auth.refreshSession();
            const who = !error && await session.identity();
            return who ? out(200, messages.refreshed, {user: {id: who.id, email: who.email}}) : noIdentity();
        }
        if (action === 'login') {
            const { data, error } = await session.client.auth.signInWithPassword({ email, password: input.password });
            if (error) {
                if (error.status === 429) return respond(429, AUTH_COPY.limited);
                if (error.code === 'invalid_credentials') return respond(400, AUTH_COPY.invalidCredentials);
                if (error.code === 'email_not_confirmed') return respond(400, messages.unconfirmed, {next: '/verify-email'});
                return respond(503, AUTH_COPY.network);
            }
            const who = await session.identity();
            if (!who || who.email !== email || who.id !== data.user?.id || who.id !== data.session?.user.id) {
                return identityDenied();
            }
            session.retirePriorChunks(raw);
            return out(200, messages.signedIn, { next: '/account', user: { id: who.id, email: who.email } });
        }
        if (action === 'register' || action === 'resend-confirmation') {
            const state = object(await accountKey(config.project, email));
            if (!await state.rate('signup-resend', 1, RESEND_SECONDS * 1000))
                return out(429, AUTH_COPY.limited);
            const result = action === 'register' ? await session.client.auth.signUp({ email, password: input.password }) : await session.client.auth.resend({ type: 'signup', email });
            if ('session' in (result.data ?? {}) && (result.data as {
                session: unknown;
            }).session) {
                await session.logout();
                return respond(503, messages.unavailable);
            }
            session.clear();
            if (result.error?.code === 'weak_password') return respond(422, messages.weakPassword);
            if (action === 'register' && !result.error && !(result.data && 'user' in result.data && result.data.user)) return respond(503, messages.unavailable);
            if (result.error && !['user_already_exists', 'email_exists'].includes(result.error.code ?? ''))
                return out(result.error.status === 429 ? 429 : 503, result.error.status === 429 ? AUTH_COPY.limited : AUTH_COPY.network);
            return respond(200, messages.confirmationSent, { next: '/verify-email', retryAfter: RESEND_SECONDS });
        }
        if (action === 'verify-email') {
            // GoTrue 2.197.0's general email verification accepts recovery tokens too.
            // A signup confirmation establishes an ordinary session only from the confirmation slot.
            const {data, error} = await session.client.auth.verifyOtp({email, token: input.token, type: 'signup'});
            if (error)
                return out(error.status === 429 ? 429 : error.code === 'otp_expired' ? 400 : 503, error.status === 429 ? AUTH_COPY.limited : error.code === 'otp_expired' ? RECOVERY_COPY.invalid : AUTH_COPY.network);
            const who = await session.identity();
            if (!who || who.email !== email || who.id !== data.user?.id || who.id !== data.session?.user.id) {
                return identityDenied();
            }
            session.retirePriorChunks(raw);
            return out(200, messages.confirmed, {next: '/account', user: {id: who.id, email: who.email}});
        }
        if (action === 'change-password') {
            // This deployment acknowledgement is set only after checking the project policy.
            if (env.USERS_CURRENT_PASSWORD_POLICY !== 'ON') return out(503, messages.unavailable);
            const who = await session.identity();
            if (!who) return noIdentity();
            const state = object(await accountKey(config.project, who.email));
            const sessionHash = await digest(who.sessionId);
            const operation = input.operation ?? 'legacy';
            if (!await state.claimChange(sessionHash, operation)) return out(409, messages.duplicate);

            const {data, error} = await session.client.auth.updateUser({
                password: input.newPassword, current_password: input.currentPassword
            });
            if (error && [400, 403, 422, 429].includes(error.status ?? 0)) {
                const rejected = {invalid_credentials: messages.wrongCurrent, current_password_required: messages.wrongCurrent,
                    current_password_mismatch: messages.wrongCurrent, weak_password: messages.weakPassword, same_password: messages.samePassword};
                const reason = error.status === 429 ? AUTH_COPY.limited : rejected[error.code as keyof typeof rejected];
                if (reason) {
                    await state.finishKnownChange(sessionHash, operation);
                    return out(error.status === 429 ? 429 : 422, reason, {correctable: true});
                }
            }
            if (!error && data.user?.id === who.id) {
                const after = await session.identity();
                if (after?.id === who.id && after.sessionId === who.sessionId && after.email === who.email) {
                    await state.finishKnownChange(sessionHash, operation);
                    return out(200, messages.changed);
                }
            }
            // No definitive receipt. Keep the durable fence, end this session before an independent login.
            const closed = await session.logout();
            return out(503, RECOVERY_COPY.updateUnknown, {cleanup: !closed, cleanupScope: 'account', next: closed ? '/login' : undefined});
        }
        // Recovery is bound to the initiating browser's transaction and its own SDK jar.
        let tx = getCookie(COOKIE.tx), key = tx.split('.')[0], id = tx.split('.')[1];
        const grant = getCookie(COOKIE.grant), hash = grant ? await digest(grant) : '';
        const txValid = /^[a-f0-9]{64}\.[a-f0-9-]{36}$/.test(tx), grantValid = /^[a-f0-9-]{72}$/.test(grant);
        if (action === 'recovery-otp-send') {
            if (recoveryActive)
                return out(409, RECOVERY_COPY.active, {cleanup: true, cleanupScope: 'recovery'});
            key = await accountKey(config.project, email);
            id = crypto.randomUUID();
            const state = object(key);
            if (!await state.beginSend(id))
                return out(429, AUTH_COPY.limited);
            let accepted = false;
            try {
                const { error } = await session.client.auth.resetPasswordForEmail(email);
                accepted = !error || ['user_not_found', 'user_banned', 'email_address_not_authorized'].includes(error.code ?? '');
                if (!accepted)
                    return out(error?.status === 429 ? 429 : 503, error?.status === 429 ? AUTH_COPY.limited : RECOVERY_COPY.sendUnknown, { retryAfter: RESEND_SECONDS });
                if (!await state.finishSend(id, true))
                    return out(503, RECOVERY_COPY.sendUnknown);
                const response = respond(200, messages.recoverySent, { retryAfter: RESEND_SECONDS, expiresIn: OTP_SECONDS });
                response.headers.append('Set-Cookie', cookieLine(COOKIE.tx, key + '.' + id, TRANSACTION_SECONDS));
                response.headers.append('Set-Cookie', cookieLine(COOKIE.grant, ''));
                return response;
            }
            finally {
                session.clear();
                if (!accepted)
                    await state.finishSend(id, false);
            }
        }
        if (action === 'recovery-progress' && !tx && !grant && !recoveryActive)
            return respond(200, messages.recoverySent, {step: 'start'});
        if (!txValid)
            return out(401, RECOVERY_COPY.restart);
        const state = object(key);
        if (action === 'recovery-progress') {
            const progress = await state.progress(id);
            if (!progress) return out(401, RECOVERY_COPY.restart, {cleanup: recoveryActive, cleanupScope: 'recovery'});
            if (progress.phase === 'ready' && !grant && !recoveryActive)
                return respond(200, messages.recoverySent, {step: 'verify', retryAfter: progress.retryAfter});
            if (progress.phase === 'verifying' || progress.phase === 'sending') return respond(409, messages.busy);
            // Only verified + valid grant + matching session below may resume the reset page.
        }
        if (action === 'recovery-otp-verify') {
            if (recoveryActive || key !== await accountKey(config.project, email))
                return out(401, RECOVERY_COPY.restart);
            const attempt = await state.beginVerify(id);
            if (attempt !== 'accepted')
                return out(attempt === 'limited' ? 429 : 401, attempt === 'limited' ? AUTH_COPY.limited : RECOVERY_COPY.restart);
            let issued = false, eventToken: string | undefined;
            const sub = session.client.auth.onAuthStateChange((event, s) => { if (event === 'PASSWORD_RECOVERY')
                eventToken = s?.access_token; });
            try {
                const { data, error } = await session.client.auth.verifyOtp({ email, token: input.token, type: 'recovery' });
                if (error && !data.session) {
                    if (error.code === 'otp_expired' || error.status === 429) {
                        await state.finishVerify(id, true);
                        return out(error.status === 429 ? 429 : 400, error.status === 429 ? AUTH_COPY.limited : RECOVERY_COPY.invalid);
                    }
                    return out(503, RECOVERY_COPY.verifyUnknown);
                }
                const received = data.session;
                const who = !error && received?.access_token && received.access_token === eventToken && received?.user.id === data.user?.id && normalizeEmail(data.user?.email ?? '') === email ? await session.identity(received.access_token) : null;
                if (!who || who.id !== data.user?.id || who.email !== email) {
                    return await identityDenied();
                }
                const newGrant = opaque();
                if (!await state.issue(id, await digest(newGrant), who.id, who.sessionId)) {
                    return await identityDenied();
                }
                issued = true;
                session.retirePriorChunks(raw);
                const response = out(200, messages.resetReady, { next: '/reset-password', expiresIn: GRANT_SECONDS });
                response.headers.append('Set-Cookie', cookieLine(COOKIE.grant, newGrant));
                response.headers.append('Set-Cookie', cookieLine(COOKIE.tx, tx));
                return response;
            }
            finally {
                sub.data.subscription.unsubscribe();
                if (!issued)
                    await state.finishVerify(id, false);
            }
        }
        if (!grantValid || !await state.grant(hash, id))
            return out(401, RECOVERY_COPY.restart);
        const who = await session.identity();
        if (!who) return noIdentity(true);
        if (await accountKey(config.project, who.email) !== key || !await state.grant(hash, id, who.id, who.sessionId))
            return out(401, RECOVERY_COPY.restart);
        if (action === 'recovery-progress') return out(200, messages.resetReady, {step: 'reset'});
        if (action === 'recovery-session')
            return out(200, messages.resetReady);
        if (action !== 'reset-password' || !await state.grant(hash, id, who.id, who.sessionId, true))
            return out(401, RECOVERY_COPY.restart);
        // The durable claim is complete before entering the external operation. No refund.
        let outcome: 'updated' | 'rejected' | 'unknown' = 'unknown', status = 503, message: string = RECOVERY_COPY.updateUnknown;
        try {
            const { data, error } = await session.client.auth.updateUser({ password: input.newPassword });
            if (!error && data.user?.id === who.id) {
                outcome = 'updated';
                status = 200;
                message = RECOVERY_COPY.updated;
            }
            else if (error?.status === 429) {
                outcome = 'rejected';
                status = 429;
                message = AUTH_COPY.limited;
            }
            else if (error && ['weak_password', 'same_password', 'current_password_required', 'current_password_mismatch', 'reauthentication_needed', 'reauthentication_not_valid', 'validation_failed'].includes(error.code ?? '') && [400, 403, 422].includes(error.status ?? 0)) {
                outcome = 'rejected';
                status = 422;
                message = RECOVERY_COPY.rejected;
            }
        }
        catch { /* Receipt unknown, claim remains consumed. */ }
        try {
            await state.finish(hash, outcome);
        }
        catch {
            console.info(JSON.stringify({ event: 'users_recovery', stage: 'outcome_storage_unconfirmed' }));
        }
        const closed = await session.logout();
        const response = out(status, message, { next: closed ? '/login' : undefined, cleanup: !closed });
        response.headers.append('Set-Cookie', cookieLine(COOKIE.grant, ''));
        if (closed)
            response.headers.append('Set-Cookie', cookieLine(COOKIE.tx, ''));
        return response;
    }
    catch {
        if (action === 'reset-password' || action === 'change-password') {
            return out(503, RECOVERY_COPY.updateUnknown, {cleanup: true, cleanupScope: scope});
        }
        return fresh ? respond(503, AUTH_COPY.network) : out(503, AUTH_COPY.network);
    }
}
