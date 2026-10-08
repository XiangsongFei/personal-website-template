import { isRestorePreviewTimestamp, type RestorePreviewDomain } from "./restorePreviewContract";

export type RestoreMutationResult =
  | { status: "restored"; domain: RestorePreviewDomain; source_event_id: string; result_event_id: string; occurred_at: string }
  | { status: "no_change"; domain: RestorePreviewDomain; source_event_id: string; result_event_id: null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAINS: readonly RestorePreviewDomain[] = ["awards", "experience", "skills", "education", "projects", "contact", "website_links"];
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"
  && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function validateRestoreMutationResult(value: unknown, expectedSourceEventId: string): RestoreMutationResult | null {
  if (!isRecord(value) || !DOMAINS.includes(value.domain as RestorePreviewDomain)
    || typeof value.source_event_id !== "string" || !UUID.test(value.source_event_id)
    || value.source_event_id.toLowerCase() !== expectedSourceEventId.toLowerCase()) return null;
  if (value.status === "restored") {
    if (Object.keys(value).length !== 5 || !["status", "domain", "source_event_id", "result_event_id", "occurred_at"].every(key => key in value)
      || typeof value.result_event_id !== "string" || !UUID.test(value.result_event_id)
      || !isRestorePreviewTimestamp(value.occurred_at)) return null;
    return { status: "restored", domain: value.domain as RestorePreviewDomain, source_event_id: value.source_event_id.toLowerCase(),
      result_event_id: value.result_event_id.toLowerCase(), occurred_at: value.occurred_at };
  }
  if (value.status === "no_change") {
    if (Object.keys(value).length !== 4 || !["status", "domain", "source_event_id", "result_event_id"].every(key => key in value)
      || value.result_event_id !== null) return null;
    return { status: "no_change", domain: value.domain as RestorePreviewDomain, source_event_id: value.source_event_id.toLowerCase(), result_event_id: null };
  }
  return null;
}
