import { presentVersionHistoryChange, type HistoryChangePresentation } from "./versionHistoryPresenter";
import type { RestorePreview } from "./resumeRepository";
import { validateRestorePreviewContract } from "./restorePreviewContract";

export type RestorePreviewPresentation =
  | { state: "no_change"; domain: RestorePreview["domain"] }
  | { state: "changes"; domain: RestorePreview["domain"]; comparison: HistoryChangePresentation }
  | { state: "unavailable"; domain: RestorePreview["domain"] | null };

const entityTypeByDomain: Record<RestorePreview["domain"], string> = {
  awards: "award_list", experience: "experience_list", skills: "skill_group_list", education: "education_list",
  projects: "project_list", contact: "contact_section", website_links: "website_links_settings",
};

/** Present only the already-authoritative Preview response; never fetch or enrich current content. */
export function presentRestorePreview(value: RestorePreview, expectedEventId: string): RestorePreviewPresentation {
  try {
    const raw = {
      status: value.status,
      source_event_id: value.sourceEventId,
      source_occurred_at: value.sourceOccurredAt,
      domain: value.domain,
      historical_state: value.historicalState,
      current_state: value.currentState,
      comparison: { before: value.comparison.before, after: value.comparison.after },
      expected_current_digest: value.expectedCurrentDigest,
    };
    const serialized = JSON.stringify(raw);
    if (new TextEncoder().encode(serialized).byteLength > 256 * 1024) return { state: "unavailable", domain: null };
    const preview = validateRestorePreviewContract(JSON.parse(serialized) as unknown, expectedEventId);
    if (!preview) return { state: "unavailable", domain: null };
    if (preview.status === "no_change") return { state: "no_change", domain: preview.domain };

    const entry = {
      eventId: preview.source_event_id,
      occurredAt: preview.source_occurred_at,
      actorAccountLabel: "Preview",
      actorRole: "owner" as const,
      domain: preview.domain,
      operation: "update" as const,
      payloadVersion: 2 as const,
      entityType: entityTypeByDomain[preview.domain],
      entityId: null,
      comparison: { kind: "aggregate" as const, before: preview.current_state, after: preview.historical_state },
    };
    const comparison = presentVersionHistoryChange(entry);
    if (comparison.state !== "changes") return { state: "unavailable", domain: preview.domain };
    return { state: "changes", domain: preview.domain, comparison };
  } catch {
    return { state: "unavailable", domain: null };
  }
}
