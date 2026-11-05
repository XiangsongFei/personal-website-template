import { AUTH_COPY, RECOVERY_COPY } from './recovery-copy';
import { messages, type MessageCode } from './messages';

type Action = 'login' | 'register' | 'verify-email' | 'resend-confirmation' | 'session' | 'refresh' |
  'logout' | 'change-password' | 'recovery-progress' | 'recovery-otp-send' | 'recovery-otp-verify' |
  'recovery-session' | 'recovery-logout' | 'reset-password';
export type AccountResult = {
  ok: boolean; message: string; next?: string; step?: 'start' | 'verify' | 'reset'; retryAfter?: number;
  cleanup?: boolean; cleanupScope?: 'account' | 'recovery'; correctable?: boolean;
  user?: {id: string; email: string};
};
export async function sendAccountAction(action: Action, input?: Record<string, string>): Promise<AccountResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch('/api/account/' + action, {
      method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'X-Users-Language': document.documentElement.lang === 'en' ? 'en' : 'zh'},
      body: input === undefined ? undefined : JSON.stringify(input), redirect: 'error', signal: controller.signal
    });
    const data = await response.json() as Partial<AccountResult> & {code?: unknown};
    if (typeof data?.code !== 'string' || !Object.hasOwn(messages, data.code) || data.ok !== response.ok ||
        (data.next !== undefined && !['/account', '/login', '/verify-email', '/reset-password'].includes(data.next))) {
      throw Error('invalid_account_reply');
    }
    if (response.ok && (
        (action === 'reset-password' && data.code !== 'resetUpdated') ||
        (action === 'change-password' && data.code !== 'changed') ||
        (['verify-email','login'].includes(action) && (data.next !== '/account' || !data.user?.id)) ||
        (action === 'recovery-progress' && !['start','verify','reset'].includes(data.step ?? ''))
    )) throw Error('unexpected_account_receipt');
    return {...data, ok: response.ok, message: messages[data.code as MessageCode]};
  } catch {
    if (action === 'change-password' || action === 'reset-password') {
      return {ok: false, message: RECOVERY_COPY.updateUnknown, cleanup: true,
        cleanupScope: action === 'change-password' ? 'account' : 'recovery'};
    }
    const message = action === 'recovery-otp-send' ? RECOVERY_COPY.sendUnknown :
      action === 'recovery-otp-verify' ? RECOVERY_COPY.verifyUnknown : AUTH_COPY.network;
    return {ok: false, message};
  } finally {
    clearTimeout(timer);
  }
}
