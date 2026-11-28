// Use the S3.6 wire contract without exposing any create, grant, or publication action.
import { accountContext } from './identity.mjs';
import { BusinessError, deny, exact, sha256, uuid } from './protocol.mjs';
import { textPayload } from './text-publication.mjs';
import { textDraftArgs } from './introduction-repository.mjs';

const revision = value => Number.isSafeInteger(value) && value >= 0;
const unknown = () => deny('COMMIT_UNKNOWN', 503);

export function createIntroductionService(repository) {
  async function mine(handle) {
    accountContext(handle);
    const result = await repository.mine(handle);
    if (result?.schema_version !== 1) unknown();
    if (result.site === null) return null;
    const site = result.site;
    if (!uuid(site?.id) || !revision(site.draft_revision) || result.capabilities?.read !== true ||
        result.capabilities?.edit !== false || result.capabilities?.publish !== false) unknown();
    return site.id;
  }

  async function introduction(handle, siteId) {
    const result = await repository.readIntroduction(handle, siteId);
    if (result?.schema_version !== 1 || result.site_id !== siteId || !revision(result.draft_revision) ||
        result.section_revision !== result.draft_revision) unknown();
    let entries;
    try { entries = textPayload({schema_version: 1, entries: result.entries}).entries; }
    catch { unknown(); }
    // The single-field editor cannot round-trip multiple entries.
    if (entries.length > 1) deny('UNSUPPORTED_INTRODUCTION', 422);
    let record = entries[0] ?? null;
    if (result.draft_revision === 0 && record?.position === 0 &&
        record.translations.zh === '请填写个人介绍。' && record.translations.en === 'Add your introduction.')
      record = {...record, translations: {}};
    return {state: 'ready', siteId, revision: result.draft_revision, record};
  }

  async function read(handle) {
    const siteId = await mine(handle);
    return siteId ? introduction(handle, siteId) : {state: 'no-site'};
  }

  async function operation(handle, value, reconcile) {
    exact(value, ['siteId', 'command']);
    const {siteId} = value;
    if (!uuid(siteId)) deny('INVALID_INPUT', 400);
    const {input, canonical_request} = textDraftArgs(siteId, value.command);
    const entry = input.payload.entries[0];
    if (input.payload.entries.length !== 1 || !Object.keys(entry.translations).length) deny('INVALID_INPUT', 400);
    if (await mine(handle) !== siteId) deny();

    async function prior() {
      const receipt = await repository.readTextDraftOperation(handle, siteId, input);
      if (receipt?.status === 'not_observed') return null;
      if (receipt?.status !== 'succeeded' || !receipt.result) unknown();
      return receipt.result;
    }

    let result;
    if (reconcile) {
      result = await prior();
      if (!result) unknown();
    } else {
      const current = await introduction(handle, siteId);
      if (current.revision !== input.expected_draft_revision) {
        result = await prior();
        if (!result) deny('REQUEST_CONFLICT', 409);
      } else {
        const recordId = current.record ? current.record.id : input.request_id;
        if (entry.id !== recordId || entry.position !== (current.record?.position ?? 0)) deny('INVALID_INPUT', 400);
        result = await repository.saveTextDraft(handle, siteId, input);
      }
    }
    if (result?.schema_version !== 1 || result.request_id !== input.request_id || result.site_id !== siteId ||
        typeof result.changed !== 'boolean' || !revision(result.draft_revision) ||
        result.draft_revision !== input.expected_draft_revision + Number(result.changed)) unknown();

    let saved;
    try { saved = await introduction(handle, siteId); }
    catch (error) {
      if (error instanceof BusinessError && error.status === 403) throw error;
      unknown();
    }
    if (saved.revision > result.draft_revision) deny('DRAFT_ADVANCED', 409);
    if (saved.revision !== result.draft_revision || saved.record?.id !== entry.id ||
        saved.record.position !== entry.position) unknown();
    return {
      state: 'saved', requestId: input.request_id, digest: await sha256(new TextEncoder().encode(canonical_request)),
      changed: result.changed, draft: saved,
    };
  }

  return Object.freeze({mine, read, save: (handle, value) => operation(handle, value, false),
    reconcile: (handle, value) => operation(handle, value, true)});
}
