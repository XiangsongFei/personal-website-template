import {createSession, type Session} from '../auth/session';
import {configuration, digest, type UsersEnv} from '../config';
import {accountContext, createIdentityAdapter} from '../business/identity.mjs';
import {createIntroductionRepository} from '../business/introduction-repository.mjs';
import {createIntroductionService} from '../business/introduction-service.mjs';
import {BusinessError, deny} from '../business/protocol.mjs';
import {readWithSiteAdapter} from './server.ts';
import {siteUnavailable, type SiteViewModel} from './model.ts';
import {introductionPath, workspaceScopeHeader} from '../editor/introduction-dto.ts';

const endpoint = 'https://users.draft.example.invalid';
export {introductionPath};
export const workspaceScope = (uid: string, sid: string) => digest(JSON.stringify(['workspace-draft', uid, sid]));

export function introductionEnabled(env: UsersEnv) {
  return env.USERS_MODE === 'isolated' && env.USERS_INTRODUCTION_MODE === 'synthetic' &&
    typeof env.USERS_INTRODUCTION_RPC?.fetch === 'function';
}

async function authorize(env: UsersEnv, session: Session) {
  const config = configuration(env);
  const {data, error} = await session.client.auth.getSession();
  if (session.refreshRequired()) deny('SESSION_REFRESH_REQUIRED', 503);
  if (session.transient()) deny('IDENTITY_UNAVAILABLE', 503);
  if (error || !data.session?.access_token) deny('IDENTITY_REQUIRED', 401);
  const authIssuer = config.url + '/auth/v1';
  const identity = createIdentityAdapter({auth: session.client.auth, issuer: authIssuer});
  let handle;
  try { handle = await identity.verifyAccount(data.session!.access_token); }
  catch (error) {
    if (session.transient()) deny('IDENTITY_UNAVAILABLE', 503);
    throw error;
  }
  const {uid, session_id: sid} = accountContext(handle);
  const scope = await workspaceScope(uid, sid);
  const repository = createIntroductionRepository({project: config.project, authIssuer, endpoint,
    mtls: env.USERS_INTRODUCTION_RPC!, identity});
  return {service: createIntroductionService(repository), handle, uid, scope};
}

export async function readIntroductionSite(env: UsersEnv, session: Session, uid: string, scope: string): Promise<SiteViewModel> {
  try {
    const context = await authorize(env, session);
    if (context.uid !== uid || context.scope !== scope) return siteUnavailable('trusted-service', 'temporary');
    return readWithSiteAdapter(uid, {async readForCurrentAccount() {
      const base = {version: 1, accountId: uid, complete: true};
      try {
        const siteId = await context.service.mine(context.handle);
        return siteId ? {...base, state: 'ready', sites: [{siteId}]} : {...base, state: 'empty', sites: []};
      } catch (error) {
        if (error instanceof BusinessError && error.status === 403) return {...base, state: 'denied'};
        throw error;
      }
    }});
  } catch {
    return siteUnavailable('trusted-service', 'temporary');
  }
}

async function readCommand(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return deny('INVALID_INPUT', 400);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let raw = '', bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 66000) return deny('INVALID_INPUT', 400);
      raw += decoder.decode(value, {stream: true});
    }
    raw += decoder.decode();
    const value = JSON.parse(raw);
    // The editor sends JSON.stringify. Round-trip equality rejects duplicate keys.
    if (JSON.stringify(value) !== raw) return deny('INVALID_INPUT', 400);
    return value;
  } catch {
    return deny('INVALID_INPUT', 400);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function introductionAPI(request: Request, env: UsersEnv) {
  const headers = new Headers({'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', Vary: 'Cookie'});
  try {
    const url = new URL(request.url);
    const save = request.method === 'POST' && url.pathname === introductionPath;
    const reconcile = request.method === 'POST' && url.pathname === introductionPath + '/operation';
    const read = ['GET','HEAD'].includes(request.method) && url.pathname === introductionPath;
    if (!introductionEnabled(env) || url.origin !== env.USERS_APP_ORIGIN || url.search || !(save || reconcile || read))
      return deny('NOT_FOUND', 404);
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (!read &&
        (request.headers.get('origin') !== url.origin || request.headers.get('content-type') !== 'application/json')))
      return deny();
    const session = createSession(env, request.headers.get('cookie') ?? '', 'account', {allowRefresh: false});
    const {service, handle, scope} = await authorize(env, session);
    if (request.headers.get(workspaceScopeHeader) !== scope) return deny('WORKSPACE_CHANGED', 409);
    headers.set(workspaceScopeHeader, scope);
    // Avoid late Set-Cookie writes overwriting a switched account.
    if (request.method === 'HEAD') return new Response(null, {headers});
    if (read) return Response.json(await service.read(handle), {headers});
    const command = await readCommand(request);
    return Response.json(await (save ? service.save(handle, command) : service.reconcile(handle, command)), {headers});
  } catch (error) {
    const status = error instanceof BusinessError ? error.status : 503;
    const code = error instanceof BusinessError ? error.code : 'BUSINESS_UNAVAILABLE';
    if (code === 'SESSION_REFRESH_REQUIRED') headers.set('X-Workspace-Session-Renewal', 'required');
    return request.method === 'HEAD' ? new Response(null, {status, headers}) : Response.json({code}, {status, headers});
  }
}
