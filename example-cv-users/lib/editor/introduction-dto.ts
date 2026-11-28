import {textPayload} from '../business/text-publication.mjs';
import {sha256, uuid} from '../business/protocol.mjs';
import type {LocalDraft} from './draft.ts';

export const introductionPath = '/api/sites/introduction';
export const workspaceScopeHeader = 'X-Workspace-Draft-Scope';
type Text = LocalDraft['introduction'];
export const introductionLocales = ['zh', 'en'] as const;
type Entry = {id: string; position: number; translations: Partial<Text>};
export type Introduction = {state: 'ready'; siteId: string; revision: number; record: Entry | null};
export type SaveAttempt = ReturnType<typeof prepareIntroduction>;

export function parseIntroduction(value: unknown): Introduction | undefined {
  if (!value || typeof value !== 'object') return;
  const draft = value as Introduction;
  if (draft.state !== 'ready' || !uuid(draft.siteId) || !Number.isSafeInteger(draft.revision) || draft.revision < 0) return;
  try {
    const {entries} = textPayload({schema_version: 1, entries: draft.record === null ? [] : [draft.record]});
    return {state: 'ready', siteId: draft.siteId, revision: draft.revision, record: entries[0] ?? null};
  } catch { return undefined; }
}

export function introductionText(draft: Introduction): Text {
  return {zh: draft.record?.translations.zh ?? '', en: draft.record?.translations.en ?? ''};
}

export function prepareIntroduction(draft: Introduction, text: Text, requestId: string) {
  const translations = {...draft.record?.translations};
  for (const locale of introductionLocales) {
    if ((translations[locale] ?? '') !== text[locale]) translations[locale] = text[locale];
  }
  const payload = textPayload({schema_version: 1, entries: [
    {id: draft.record?.id ?? requestId, position: draft.record?.position ?? 0, translations},
  ]});
  const command = {schema_version: 1, request_id: requestId, expected_draft_revision: draft.revision, payload};
  const digest = sha256(new TextEncoder().encode(JSON.stringify({operation: 'save_text_draft', ...command})));
  return {body: {siteId: draft.siteId, command}, submitted: {...text}, digest};
}

export function mergeSavedIntroduction(current: Text, submitted: Text, saved: Text): Text {
  return {
    zh: current.zh === submitted.zh ? saved.zh : current.zh,
    en: current.en === submitted.en ? saved.en : current.en,
  };
}

export async function parseSaveReceipt(value: unknown, attempt: SaveAttempt) {
  if (!value || typeof value !== 'object') return;
  const receipt = value as {state?: string; requestId?: string; digest?: string; changed?: boolean; draft?: unknown};
  const {siteId, command} = attempt.body;
  const draft = parseIntroduction(receipt.draft);
  if (receipt.state === 'saved' && receipt.requestId === command.request_id && receipt.digest === await attempt.digest &&
      typeof receipt.changed === 'boolean' && draft?.siteId === siteId &&
      draft.revision === command.expected_draft_revision + Number(receipt.changed) &&
      draft.record?.id === command.payload.entries[0].id && draft.record?.position === command.payload.entries[0].position)
    return draft;
}
