import {createSiteService as legacyService} from '../../../lib/business/service.mjs';
import { deny, uuid } from '../../../lib/business/protocol.mjs';
import { accountContext } from '../../../lib/business/identity.mjs';
import {textPayload} from '../../../lib/business/text-publication.mjs';
import {textCommand} from './command.mjs';
const revision = n => Number.isSafeInteger(n) && n >= 0;
function validatedSave(result, input, target) {
  const publication = result?.publication;
  if (result?.schema_version !== 1 || result.request_id !== input.request_id || result.site_id !== target ||
      typeof result.changed !== 'boolean' || !revision(result.draft_revision) ||
      result.draft_revision !== input.expected_draft_revision + Number(result.changed) ||
      publication?.site_id !== target || publication.state !== 'unpublished' || publication.snapshot_id !== null ||
      publication.publication_revision !== 0 || publication.changed_at !== null || publication.changed_by !== null)
    deny('COMMIT_UNKNOWN', 503);
  return {schema_version:1, request_id:result.request_id, site_id:target, changed:result.changed,
    draft_revision:result.draft_revision, publication:{site_id:target,state:'unpublished',snapshot_id:null,
      publication_revision:0,changed_at:null,changed_by:null}};
}
export function createSiteService({ repository }) {
  return Object.freeze({
    ...legacyService({repository}),
    async introduction(handle, target) { accountContext(handle); if (!uuid(target)) deny('INVALID_INPUT', 400);
      const r = await repository.readIntroduction(handle, target);
      if (r?.schema_version !== 1 || r.site_id !== target || !revision(r.draft_revision) || r.section_revision !== r.draft_revision)
        deny('COMMIT_UNKNOWN',503);
      let payload;
      try { payload = textPayload({schema_version:1, entries:r.entries}); }
      catch { deny('COMMIT_UNKNOWN',503); }
      return {schema_version:1,site_id:target,section_revision:r.section_revision,draft_revision:r.draft_revision,entries:payload.entries};
    },
    async saveTextDraft(handle, target, value) {
      accountContext(handle); if (!uuid(target)) deny('INVALID_INPUT',400);
      const input = textCommand('save_text_draft', value);
      return validatedSave(await repository.saveTextDraft(handle,target,input),input,target);
    },
    async readTextDraftOperation(handle, target, value) {
      accountContext(handle); if (!uuid(target)) deny('INVALID_INPUT',400);
      const input = textCommand('save_text_draft', value);
      const receipt = await repository.readTextDraftOperation(handle,target,input);
      if (receipt?.status === 'not_observed') return {status:'UNKNOWN',request_id:input.request_id,retry_with_new_id:false};
      if (receipt?.status !== 'succeeded') deny('COMMIT_UNKNOWN',503);
      return {status:'succeeded',result:validatedSave(receipt.result,input,target)};
    }
  });
}
