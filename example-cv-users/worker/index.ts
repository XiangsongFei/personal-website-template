import handler from 'vinext/server/app-router-entry';
import { accountAPI } from '../lib/account/api';
import { configuration, type UsersEnv } from '../lib/config';
import { createSession } from '../lib/auth/session';
import { requestContext } from '../lib/context';
export { RecoveryState } from './recovery-state';
export default {
    async fetch(request: Request, env: UsersEnv, ctx: ExecutionContext) {
        const url = new URL(request.url);
        if (url.origin !== env.USERS_APP_ORIGIN)
            return new Response('Invalid host', { status: 421 });
        if (url.pathname.startsWith('/_next/static/') && ['GET', 'HEAD'].includes(request.method))
            return env.ASSETS.fetch(request);
        if (url.pathname === '/')
            return new Response(null, { status: 307, headers: { Location: '/login', 'Cache-Control': 'private, no-store' } });
        if (url.pathname === '/user' || url.pathname.startsWith('/user/'))
            return new Response('Not found', { status: 404 });
        if (url.pathname === '/api/admin/v1' || url.pathname.startsWith('/api/admin/v1/'))
            return Response.json({ ok: false, message: '接口不可用。' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
        if (url.pathname.startsWith('/api/account/'))
            return accountAPI(request, env);
        if (url.pathname.startsWith('/api/'))
            return Response.json({ ok: false, message: '接口不可用。' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
        if (['/reset-password', '/auth/callback'].includes(url.pathname) && url.search)
            return new Response(null, { status: 303, headers: { Location: url.pathname === '/' ? '/login' : url.pathname, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
        if (!['GET','HEAD'].includes(request.method)) {
            return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD', 'Cache-Control':'private, no-store'}});
        }
        let user, session, failure: 'network' | 'limited' | 'unavailable' | undefined;
        if (['/account', '/change-password'].includes(url.pathname)) {
            try {
                configuration(env);
                session = createSession(env, request.headers.get('cookie') ?? '');
                user = await session.identity();
            }
            catch { failure = 'unavailable'; }
            if (!user) failure ??= session?.transient();
            if (!user && !failure) {
                const response = new Response(null, { status: 303, headers: { Location: '/login', 'Cache-Control': 'private, no-store' } });
                return session ? session.apply(response) : response;
            }
        }
        const rendered = await requestContext.run({ failure, user: user ? { id: user.id, email: user.email } : undefined }, () => handler.fetch(request, env, ctx));
        const response = new Response(rendered.body, {headers: rendered.headers, status: failure ? failure === 'limited' ? 429 : 503 : rendered.status});
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.append('Vary', 'Cookie');
        return session ? session.apply(response) : response;
    }
};
