// Product limits shared by the form, Worker and account Durable Object.
export const OTP_DIGITS = 6;
export const OTP_SECONDS = 120;
export const RESEND_SECONDS = 60;
export const GRANT_SECONDS = 600;
export const TRANSACTION_SECONDS = 600;
export const ATTEMPT_SECONDS = 600;
export const MAX_ATTEMPTS = 5;
export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_MAX_LENGTH = 128;
export const EXISTING_PASSWORD_MAX_LENGTH = 1024;
export const EMAIL_MAX_LENGTH = 64;
export const PASSWORD_RANGE = `${NEW_PASSWORD_MIN_LENGTH}–${NEW_PASSWORD_MAX_LENGTH}`;
export const PASSWORD_LENGTH_TEXT = `密码需为 ${PASSWORD_RANGE} 个字符。`;
export const PASSWORD_MISMATCH_TEXT = '两次输入的密码不一致。';
export const SAME_PASSWORD_TEXT = '新密码不能与当前密码相同。';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const isExistingPassword = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= EXISTING_PASSWORD_MAX_LENGTH;
export const isNewPassword = (value: unknown) =>
  typeof value === 'string' && value.length >= NEW_PASSWORD_MIN_LENGTH && value.length <= NEW_PASSWORD_MAX_LENGTH;

// Preserve the reviewed real-address rules. Never canonicalize provider aliases.
export function isRealEmail(email: string) {
  return email.length <= EMAIL_MAX_LENGTH &&
    /^[a-z0-9][a-z0-9._%+\-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) &&
    !email.split('@')[0].includes('..') && !email.split('@')[0].endsWith('.');
}
export const isOtp = (value: unknown) =>
  typeof value === 'string' && value.length === OTP_DIGITS && /^[0-9]+$/.test(value);

// The probe converts full-width digits. Only presentation separators may be
// discarded: never turn letters or an overlong paste into a valid credential.
export function normalizeOtp(value: string) {
  return value.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '');
}

export function passwordIssue(password: unknown, confirmation: unknown, current?: unknown) {
  if (!isNewPassword(password)) return PASSWORD_LENGTH_TEXT;
  if (password !== confirmation) return PASSWORD_MISMATCH_TEXT;
  if (current === password) return SAME_PASSWORD_TEXT;
  return null;
}
