import type { RecoveryState } from '../worker/recovery-state';
import { normalizeEmail } from './account/policy';
export { normalizeEmail } from './account/policy';
export interface UsersEnv {
    USERS_MODE: string;
    USERS_PROJECT_REF: string;
    USERS_SUPABASE_URL: string;
    USERS_APP_ORIGIN: string;
    USERS_PUBLISHABLE_KEY?: string;
    USERS_CURRENT_PASSWORD_POLICY?: string;
    // Trusted startup bindings only; never populated from a request or browser cookie.
    USERS_CONTROLLED_EXECUTOR?: string;
    USERS_CONTROLLED_BATCH?: string;
    USERS_CONTROLLED_BUILD?: string;
    USERS_CONTROLLED_APPROVAL?: string;
    USERS_CONTROLLED_EXPIRES_AT?: string;
    USERS_CONTROLLED_EGRESS?: Fetcher;
    USERS_RECOVERY_STATE: DurableObjectNamespace<RecoveryState>;
    ASSETS: Fetcher;
}
export const TARGET = 'makwjnbubmrmopjhzror';
export const COOKIE = { account: '__Host-ecv-users-session', recovery: '__Host-ecv-users-recovery', tx: '__Host-ecv-users-tx', grant: '__Host-ecv-users-grant' } as const;
export const POLICY = { path: '/', secure: true, httpOnly: true, sameSite: 'lax' as const };
export function configuration(env: UsersEnv) {
    if (env.USERS_MODE === 'production') {
        if (env.USERS_PROJECT_REF !== TARGET || env.USERS_SUPABASE_URL !== `https://${TARGET}.supabase.co` || env.USERS_APP_ORIGIN !== 'https://admin.example-cv.com')
            throw Error('configuration_denied');
    }
    else if (env.USERS_MODE === 'isolated') {
        const origin = new URL(env.USERS_APP_ORIGIN);
        if (env.USERS_PROJECT_REF !== 'isolated-users' || env.USERS_SUPABASE_URL !== 'https://users.auth.example.invalid' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.origin !== env.USERS_APP_ORIGIN || !['http:', 'https:'].includes(origin.protocol))
            throw Error('configuration_denied');
    }
    else if (env.USERS_MODE === 'controlled-real') {
        const until = Number(env.USERS_CONTROLLED_EXPIRES_AT);
        if (env.USERS_PROJECT_REF !== TARGET || env.USERS_SUPABASE_URL !== `https://${TARGET}.supabase.co`
            || env.USERS_APP_ORIGIN !== 'https://127.0.0.1:8787'
            || env.USERS_CONTROLLED_EXECUTOR !== 's2-users-real-v1'
            || !/^S2-USERS-REAL-[A-Za-z0-9-]{8,80}$/.test(env.USERS_CONTROLLED_BATCH ?? '')
            || !/^[a-f0-9]{64}$/.test(env.USERS_CONTROLLED_BUILD ?? '')
            || !/^[a-f0-9]{64}$/.test(env.USERS_CONTROLLED_APPROVAL ?? '')
            || !Number.isSafeInteger(until) || until <= Date.now() || until > Date.now() + 40 * 60_000
            || typeof env.USERS_CONTROLLED_EGRESS?.fetch !== 'function')
            throw Error('configuration_denied');
    }
    else
        throw Error('configuration_disabled');
    if (!env.USERS_PUBLISHABLE_KEY || !env.USERS_PUBLISHABLE_KEY.startsWith('sb_publishable_'))
        throw Error('configuration_key_denied');
    return { url: env.USERS_SUPABASE_URL, key: env.USERS_PUBLISHABLE_KEY, origin: env.USERS_APP_ORIGIN, project: env.USERS_PROJECT_REF };
}
export async function digest(s: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export async function accountKey(project: string, email: string) { return digest(project + '\0' + normalizeEmail(email)); }
export function safeReturn(value: unknown) { return value === undefined || value === '/account'; }
