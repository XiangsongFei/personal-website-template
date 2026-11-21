import {createSiteService as legacyService} from '../../../lib/business/service.mjs';
import {deny, uuid} from '../../../lib/business/protocol.mjs';
import {accountContext} from '../../../lib/business/identity.mjs';
import {textPayload} from '../../../lib/business/text-publication.mjs';
import {textCommand} from './command.mjs';
import {isPublicationOperation} from './private-rpc.mjs';

const revision = n => Number.isSafeInteger(n) && n >= 0;

function validatedResult(operation, result, input, target, publicationSite) {
  const p = result?.publication;
  if (result?.schema_version!==1 || result.request_id!==input.request_id || result.site_id!==target ||
      typeof result.changed!=='boolean' || !revision(result.draft_revision) || p?.site_id!==target ||
      !revision(p.publication_revision) || !['published','unpublished'].includes(p.state) ||
      (p.state==='published' ? !uuid(p.snapshot_id) : p.snapshot_id!==null) ||
      (p.publication_revision===0
        ? p.state!=='unpublished' || p.changed_at!==null || p.changed_by!==null
        : !uuid(p.changed_by) || !revision(p.changed_at)))
    deny('COMMIT_UNKNOWN',503);
  if (operation==='save_text_draft') {
    if (result.draft_revision!==input.expected_draft_revision+Number(result.changed) ||
        (target!==publicationSite && p.publication_revision!==0)) deny('COMMIT_UNKNOWN',503);
  } else {
    if (p.publication_revision!==input.expected_publication_revision+Number(result.changed) ||
        (operation==='publish_site'
          ? p.state!=='published' || result.draft_revision!==input.expected_draft_revision ||
            (input.snapshot_id!==null && p.snapshot_id!==input.snapshot_id)
          : p.state!=='unpublished'))
      deny('COMMIT_UNKNOWN',503);
  }
  return {schema_version:1,request_id:result.request_id,site_id:target,changed:result.changed,
    draft_revision:result.draft_revision,publication:{site_id:target,state:p.state,snapshot_id:p.snapshot_id,
      publication_revision:p.publication_revision,changed_at:p.changed_at,changed_by:p.changed_by}};
}

export function createSiteService({repository,publicationSite}) {
  function inputFor(operation,handle,target,value) {
    accountContext(handle);
    if (!uuid(target)) deny('INVALID_INPUT',400);
    if(isPublicationOperation(operation)) {
      if(!publicationSite) deny('NOT_CONFIGURED',503);
      if(target!==publicationSite) deny();
    }
    return textCommand(operation,value);
  }
  async function mutate(operation,method,handle,target,value) {
    const input=inputFor(operation,handle,target,value);
    return validatedResult(operation,await repository[method](handle,target,input),input,target,publicationSite);
  }
  async function reconcile(operation,handle,target,value) {
    const input=inputFor(operation,handle,target,value);
    const receipt=operation==='save_text_draft'
      ? await repository.readTextDraftOperation(handle,target,input)
      : await repository.readTextOperation(handle,operation,target,input);
    if (receipt?.status==='not_observed') return {status:'UNKNOWN',request_id:input.request_id,retry_with_new_id:false};
    if (receipt?.status!=='succeeded') deny('COMMIT_UNKNOWN',503);
    return {status:'succeeded',result:validatedResult(operation,receipt.result,input,target,publicationSite)};
  }
  return Object.freeze({
    ...legacyService({repository}),
    async introduction(handle,target) {
      accountContext(handle);
      if (!uuid(target)) deny('INVALID_INPUT',400);
      const r=await repository.readIntroduction(handle,target);
      if(r?.schema_version!==1 || r.site_id!==target || !revision(r.draft_revision) || r.section_revision!==r.draft_revision)
        deny('COMMIT_UNKNOWN',503);
      let payload;
      try { payload=textPayload({schema_version:1,entries:r.entries}); }
      catch { deny('COMMIT_UNKNOWN',503); }
      return {schema_version:1,site_id:target,section_revision:r.section_revision,draft_revision:r.draft_revision,entries:payload.entries};
    },
    saveTextDraft: (...args)=>mutate('save_text_draft','saveTextDraft',...args),
    publish: (...args)=>mutate('publish_site','publish',...args),
    unpublish: (...args)=>mutate('unpublish_site','unpublish',...args),
    readTextDraftOperation: (...args)=>reconcile('save_text_draft',...args),
    readPublicationOperation(operation,...args) {
      if(!isPublicationOperation(operation)) deny('INVALID_INPUT',400);
      return reconcile(operation,...args);
    },
  });
}
