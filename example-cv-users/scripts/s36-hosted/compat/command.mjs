import {exact,uuid,deny} from '../../../lib/business/protocol.mjs';
import {textPayload} from '../../../lib/business/text-publication.mjs';

export function textCommand(operation,value) {
  exact(value,['schema_version','request_id','expected_draft_revision','payload']);
  if (operation!=='save_text_draft' || value.schema_version!==1 || !uuid(value.request_id) ||
      !Number.isSafeInteger(value.expected_draft_revision) || value.expected_draft_revision<0)
    deny('INVALID_INPUT',400);
  return Object.freeze({schema_version:1,request_id:value.request_id,
    expected_draft_revision:value.expected_draft_revision,payload:textPayload(value.payload)});
}
