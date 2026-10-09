import { useEffect, useMemo, useState } from "react";
import { validateProfileAggregate } from "./data/profileAggregate";
import type { ActivityLogV13CEvent, ProfileHistoryImageRequest, ResumeRepository, VersionHistoryEntry } from "./data/resumeRepository";
import { useUiLocale } from "./uiLocale";

export type ProfileHistoryPhotoValue = { kind: "none" | "reference" | "unsupported" };
export type ProfileHistoryPhotoSides = { before: ProfileHistoryPhotoValue; after: ProfileHistoryPhotoValue };
export const UNAVAILABLE_PROFILE_PHOTO_SIDES: ProfileHistoryPhotoSides = { before: { kind: "unsupported" }, after: { kind: "unsupported" } };

const NONE: ProfileHistoryPhotoValue = { kind: "none" };
const UNSUPPORTED: ProfileHistoryPhotoValue = { kind: "unsupported" };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sideValue(value: unknown): ProfileHistoryPhotoValue {
  if (value === null) return NONE;
  // The event/domain/field shape selects this resolver. The Worker validates the
  // authoritative historical reference; the browser never interprets its path.
  return typeof value === "string" && value.length > 0 ? { kind: "reference" } : UNSUPPORTED;
}

function v2Sides(before: unknown, after: unknown): ProfileHistoryPhotoSides | null {
  try {
    const beforeProfile = validateProfileAggregate(before);
    const afterProfile = validateProfileAggregate(after);
    return {
      before: sideValue(beforeProfile.shared.photo_url),
      after: sideValue(afterProfile.shared.photo_url),
    };
  } catch { return null; }
}

function v1Sides(change: unknown): ProfileHistoryPhotoSides | null {
  if (!isRecord(change) || Object.keys(change).sort().join(",") !== "after,before"
    || ![change.before, change.after].every(value => value === null || typeof value === "string")) return null;
  return {
    before: sideValue(change.before),
    after: sideValue(change.after),
  };
}

export function isVersionHistoryProfilePhotoEntry(entry: VersionHistoryEntry): boolean {
  return entry.domain === "profile" && entry.operation === "update"
    && ((entry.payloadVersion === 1 && entry.entityType === "profile_image")
      || (entry.payloadVersion === 2 && entry.entityType === "profile_settings"));
}

export function versionHistoryProfilePhotoSides(entry: VersionHistoryEntry): ProfileHistoryPhotoSides | null {
  if (!isVersionHistoryProfilePhotoEntry(entry)) return null;
  if (entry.payloadVersion === 1 && entry.comparison.kind === "entity_fields") {
    const changes = entry.comparison.changes;
    return Object.keys(changes).length === 1 && Object.hasOwn(changes, "object_key")
      ? v1Sides(changes.object_key) : null;
  }
  if (entry.payloadVersion === 2 && entry.comparison.kind === "aggregate") {
    return v2Sides(entry.comparison.before, entry.comparison.after);
  }
  return null;
}

export function isActivityLogProfilePhotoEvent(event: ActivityLogV13CEvent): boolean {
  return event.eventSource === "activity" && event.operation === "update"
    && ((event.payloadVersion === 1 && event.section === "files" && event.entityType === "profile_image")
      || (event.payloadVersion === 2 && event.section === "profile" && event.entityType === "profile_settings"));
}

export function activityLogProfilePhotoSides(event: ActivityLogV13CEvent): ProfileHistoryPhotoSides | null {
  if (!isActivityLogProfilePhotoEvent(event) || event.eventSource !== "activity") return null;
  if (event.payloadVersion === 1) {
    return Object.keys(event.changes).length === 1 && Object.hasOwn(event.changes, "object_key")
      ? v1Sides(event.changes.object_key) : null;
  }
  const change = event.changes.profile;
  if (!isRecord(change) || Object.keys(change).sort().join(",") !== "after,before") return null;
  return v2Sides(change.before, change.after);
}

function previewRequestKey(request: ProfileHistoryImageRequest): string {
  return `${request.resumeId}:${request.eventId}:${request.occurredAt}:${request.side}`;
}

type PreviewState = { key: string; kind: "loading" | "loaded" | "unavailable" | "unauthenticated"; url?: string };

export function ProfileHistoryPhoto({
  resumeId, eventId, occurredAt, side, value, repository,
}: {
  resumeId: string | null; eventId: string; occurredAt: string; side: "before" | "after";
  value: ProfileHistoryPhotoValue; repository: ResumeRepository | null;
}) {
  const { t } = useUiLocale();
  const request = useMemo(() => resumeId ? { resumeId, eventId, occurredAt, side } satisfies ProfileHistoryImageRequest : null,
    [resumeId, eventId, occurredAt, side]);
  const key = request ? previewRequestKey(request) : "";
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!request || value.kind !== "reference" || !repository?.resolveProfileHistoryImage) return;
    const controller = new AbortController();
    let active = true;
    let objectUrl: string | null = null;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setState({ key, kind: "loading" });
    void repository.resolveProfileHistoryImage(request, controller.signal).then(blob => {
      if (!active || controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ key, kind: "loaded", url: objectUrl });
    }).catch(error => {
      if (!active) return;
      const unauthenticated = Boolean(error && typeof error === "object" && "code" in error && error.code === "unauthenticated");
      setState({ key, kind: unauthenticated ? "unauthenticated" : "unavailable" });
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, repository, request, value.kind]);

  if (value.kind === "none") return <span className="profile-history-photo-empty">{t("Not set")}</span>;
  if (value.kind === "unsupported" || !request || !repository?.resolveProfileHistoryImage) {
    return <span className="profile-history-photo-state">{t("Preview unavailable")}</span>;
  }
  const current = state?.key === key ? state : null;
  if (!current || current.kind === "loading") return <span className="profile-history-photo-state" role="status">{t("Loading preview…")}</span>;
  if (current.kind === "unauthenticated") return <span className="profile-history-photo-state" role="alert">{t("Sign in again to view this preview.")}</span>;
  if (current.kind === "unavailable" || !current.url) return <span className="profile-history-photo-state">{t("Preview unavailable")}</span>;

  return <span className="profile-history-photo-preview">
    <img src={current.url} alt={t("Historical profile photo")} onError={() => {
      URL.revokeObjectURL(current.url!);
      setState({ key, kind: "unavailable" });
    }} />
    <span>{t("Historical profile photo")}</span>
  </span>;
}

export function ProfileHistoryPhotoPair({
  resumeId, eventId, occurredAt, sides, repository,
}: {
  resumeId: string | null; eventId: string; occurredAt: string; sides: ProfileHistoryPhotoSides; repository: ResumeRepository | null;
}) {
  const { t } = useUiLocale();
  return <div className="profile-history-photo-pair">
    {(["before", "after"] as const).map(side => <div key={side}>
      <b>{t(side === "before" ? "Before" : "After")}</b>
      <ProfileHistoryPhoto resumeId={resumeId} eventId={eventId} occurredAt={occurredAt} side={side}
        value={sides[side]} repository={repository} />
    </div>)}
  </div>;
}
