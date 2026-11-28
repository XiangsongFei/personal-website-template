import handler from 'vinext/server/app-router-entry';
import { accountAPI } from '../lib/account/api';
import { configuration, type UsersEnv } from '../lib/config';
import { createSession } from '../lib/auth/session';
import {introductionAPI, introductionEnabled, introductionPath, readIntroductionSite, workspaceScope} from '../lib/site/introduction-server';
import {resumeTextAPI, resumeTextEnabled, resumeTextPath} from '../lib/site/resume-text-server';
import { requestContext } from '../lib/context';
export { RecoveryState } from './recovery-state';

const reservedFilePaths = ['/api/assets', '/api/files', '/public/assets', '/private/s35', '/storage/v1'];
const assetAliases = ['/_next/image', '/_vinext/image'];
const staticModulePath = /^\/_next\/static\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/;

function closedFileRoute(status = 404) {
    return new Response(null, { status, headers: {
        'Cache-Control': 'private, no-store',
        'CDN-Cache-Control': 'no-store',
        'Cloudflare-CDN-Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
    } });
}

export default {
    async fetch(request: Request, env: UsersEnv, ctx: ExecutionContext) {
        const url = new URL(request.url);
        if (url.origin !== env.USERS_APP_ORIGIN)
            return closedFileRoute(421);
        // File access requires the scoped Users handler. Until it is wired,
        // reserve these paths before the static binding or app router.
        let pagePath: string;
        try { pagePath = decodeURIComponent(url.pathname).replace(/[\\/]+/g, '/'); }
        catch { return closedFileRoute(); }
        // A later decode or dot-segment normalization must not hand a
        // different route to the static binding or the app router.
        const namespace = pagePath.toLowerCase().replace(/;[^/]*/g, '').replace(/\/{2,}/g, '/');
        // eslint-disable-next-line no-control-regex -- Decoded route paths explicitly reject ASCII control characters.
        if (/%[\da-f]{2}/i.test(pagePath) || /[\u0000-\u001f\u007f]/.test(pagePath) ||
            /(?:^|\/)\.{1,2}(?:\/|$)/.test(namespace) ||
            [...reservedFilePaths, ...assetAliases].some(prefix => namespace === prefix || namespace.startsWith(prefix + '/')))
            return closedFileRoute();
        // Serve only canonical build assets via the static binding. The image
        // optimizer aliases above can resolve paths without this route guard.
        if (namespace === '/_next/static' || namespace.startsWith('/_next/static/')) {
            if (!staticModulePath.test(url.pathname) || pagePath !== url.pathname)
                return closedFileRoute();
            if (request.method === 'GET' || request.method === 'HEAD')
                return env.ASSETS.fetch(request);
        }
        if (url.pathname === '/')
            return new Response(null, { status: 307, headers: { Location: '/login', 'Cache-Control': 'private, no-store' } });
        if (url.pathname === '/user' || url.pathname.startsWith('/user/'))
            return new Response('Not found', { status: 404 });
        if (url.pathname === '/api/admin/v1' || url.pathname.startsWith('/api/admin/v1/'))
            return Response.json({ ok: false, message: '接口不可用。' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
        if (url.pathname.startsWith('/api/account/'))
            return accountAPI(request, env);
        const introduction = introductionEnabled(env);
        if (introduction && (url.pathname === introductionPath || url.pathname === introductionPath + '/operation'))
            return introductionAPI(request, env);
        const resumeText = resumeTextEnabled(env);
        if (resumeText && url.pathname.startsWith(resumeTextPath+'/'))
            return resumeTextAPI(request, env);
        if (url.pathname.startsWith('/api/'))
            return Response.json({ ok: false, message: '接口不可用。' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
        if (['/reset-password', '/auth/callback'].includes(url.pathname) && url.search)
            return new Response(null, { status: 303, headers: { Location: url.pathname === '/' ? '/login' : url.pathname, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
        if (!['GET','HEAD'].includes(request.method)) {
            return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD', 'Cache-Control':'private, no-store'}});
        }
        let user, session, failure: 'network' | 'limited' | 'unavailable' | undefined;
        const dashboard = pagePath === '/dashboard' || pagePath.startsWith('/dashboard/');
        const accountWorkspace = ['/account', '/change-password'].includes(url.pathname);
        if (dashboard || accountWorkspace) {
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
        // This presentation key scopes in-memory edits. It is never an authorization input.
        const workspaceDraftScope = user ? await workspaceScope(user.id, user.sessionId) : undefined;
        const siteSession = session;
        const readSite = introduction && user && siteSession && workspaceDraftScope && pagePath === '/dashboard/website' && request.method === 'GET'
            ? () => readIntroductionSite(env, siteSession, user.id, workspaceDraftScope) : undefined;
        const rendered = await requestContext.run({ dashboard, accountWorkspace, failure, workspaceDraftScope, introduction, resumeText, readSite, workspacePath: dashboard || accountWorkspace ? pagePath : undefined,
            user: user ? { id: user.id, email: user.email } : undefined }, () => handler.fetch(request, env, ctx));
        const response = new Response(rendered.body, {headers: rendered.headers, status: failure ? failure === 'limited' ? 429 : 503 : rendered.status});
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        if (request.method === 'HEAD' && response.status === 200 && workspaceDraftScope)
            response.headers.set('X-Workspace-Draft-Scope', workspaceDraftScope);
        response.headers.set('X-Content-Type-Options', 'nosniff');
        response.headers.append('Vary', 'Cookie');
        return session ? session.apply(response) : response;
    }
};
