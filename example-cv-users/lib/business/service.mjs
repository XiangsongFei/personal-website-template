import { BusinessError, createInput, deny, parseCreate, uuid, validateResult } from './protocol.mjs';
import { accountContext } from './identity.mjs';
export function createSiteService({ repository }) {
  return Object.freeze({
    async create(handle, value) {
      accountContext(handle); const input = createInput(value);
      try { return validateResult(await repository.create(handle, input), input); }
      catch (e) { if (e instanceof BusinessError) throw e; deny('COMMIT_UNKNOWN', 503); }
    },
    async readOperation(handle, value) {
      accountContext(handle); const input = createInput(value);
      const r = await repository.readOperation(handle, input);
      if (r?.status === 'not_observed') return { status: 'UNKNOWN', request_id: input.request_id, retry_with_new_id: false };
      if (r?.status !== 'succeeded') deny('COMMIT_UNKNOWN', 503);
      return { status: 'succeeded', result: validateResult(r?.result, input) };
    },
    async mine(handle) { accountContext(handle); const r = await repository.mine(handle);
      if (r?.schema_version !== 1 || !(r.site === null || (r.site && uuid(r.site.id) && r.site.draft_revision === 0 &&
          r.capabilities?.read === true && r.capabilities?.edit === false && r.capabilities?.publish === false))) deny('COMMIT_UNKNOWN', 503);
      return r.site === null ? { schema_version: 1, site: null } : { schema_version: 1,
        site: { id: r.site.id, draft_revision: 0 }, capabilities: { read: true, edit: false, publish: false } }; },
    async introduction(handle, target) { accountContext(handle); if (!uuid(target)) deny('INVALID_INPUT', 400);
      const r = await repository.readIntroduction(handle, target);
      if (r?.schema_version !== 1 || r.site_id !== target || r.section_revision !== 0 || r.draft_revision !== 0 ||
          !Array.isArray(r.entries) || r.entries.length > 100 || !r.entries.every(e => uuid(e.id) && Number.isSafeInteger(e.position) &&
          e.position >= 0 && e.translations && Object.entries(e.translations).every(([k,v]) => ['zh','en'].includes(k) && typeof v === 'string' && v.length <= 20000))) deny('COMMIT_UNKNOWN', 503);
      return { schema_version: 1, site_id: target, section_revision: 0, draft_revision: 0,
        entries: r.entries.map(e => ({ id: e.id, position: e.position, translations: { ...e.translations } })) }; }
  });
}
// Not wired to worker/index.ts. resolveAccount is an injected server dependency.
export function createCandidateHandler({ origin, resolveAccount, service }) {
  return async request => {
    const headers = { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' };
    try {
      const url = new URL(request.url), read = url.pathname === '/api/sites/mine' && request.method === 'GET';
      const intro = request.method === 'GET' && /^\/api\/sites\/([0-9a-f-]{36})\/introduction$/.exec(url.pathname);
      const create = url.pathname === '/api/sites' && request.method === 'POST';
      const operation = url.pathname === '/api/sites/operations/read' && request.method === 'POST';
      if (url.origin !== origin || url.search || (!read && !intro && !create && !operation)) deny('NOT_FOUND', 404);
      if (request.headers.get('sec-fetch-site') === 'cross-site' || ((!read && !intro) &&
          (request.headers.get('origin') !== origin || request.headers.get('content-type')?.split(';')[0] !== 'application/json'))) deny();
      const handle = await resolveAccount(request); accountContext(handle);
      if (read) return Response.json(await service.mine(handle), { headers });
      if (intro) return Response.json(await service.introduction(handle, intro[1]), { headers });
      const reader = request.body?.getReader(); if (!reader) deny('INVALID_INPUT', 400);
      const chunks = []; let size = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 2048) deny('INVALID_INPUT', 400); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const raw = new Uint8Array(size); let offset = 0; for (const c of chunks) { raw.set(c, offset); offset += c.length; }
      let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { deny('INVALID_INPUT', 400); }
      const input = parseCreate(text), result = create ? await service.create(handle, input) : await service.readOperation(handle, input);
      return Response.json(result, { status: 200, headers });
    } catch (e) {
      const known = e instanceof BusinessError;
      return Response.json({ code: known ? e.code : 'BUSINESS_UNAVAILABLE' }, { status: known ? e.status : 503, headers });
    }
  };
}
