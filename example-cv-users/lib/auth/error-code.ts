// Auth v2.197.0 can return {code: 403, error_code: 'otp_expired'}.
// Fixtures/other API versions also use a symbolic code. Conflicts fail closed.
export function authErrorCode(data: unknown, status: number) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return undefined;
    const { code, error_code } = data as {
        code?: unknown;
        error_code?: unknown;
    };
    if (code !== undefined && typeof code !== 'string' && code !== status)
        return undefined;
    if (error_code !== undefined && (typeof error_code !== 'string' || typeof code === 'string' && code !== error_code))
        return undefined;
    return typeof error_code === 'string' ? error_code : typeof code === 'string' ? code : undefined;
}
