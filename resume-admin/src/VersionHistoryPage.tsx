import { useCallback, useEffect, useId, useRef, useState } from "react";
import { RestoreMutationError, RestorePreviewError, type RestoreMutationRequest, type RestorePreview, type ResumeRepository, type VersionHistoryDomain, type VersionHistoryEntry, type VersionHistoryPage as VersionHistoryPageResult } from "./data/resumeRepository";
import { presentVersionHistoryChange, type HistoryChangePresentation, type HistoryFieldChange, type HistoryFieldValue, type HistoryItemChange } from "./data/versionHistoryPresenter";
import { presentRestorePreview, type RestorePreviewPresentation } from "./data/restorePreviewPresenter";
import type { RestorePreviewDomain } from "./data/restorePreviewContract";
import type { RestoreMutationResult } from "./data/restoreMutationContract";
import { formatBeijingTimestamp } from "./overviewFormat";
import { useUiLocale } from "./uiLocale";
import { ProfileHistoryPhotoPair, UNAVAILABLE_PROFILE_PHOTO_SIDES, isVersionHistoryProfilePhotoEntry, versionHistoryProfilePhotoSides } from "./ProfileHistoryImage";

const PAGE_SIZE = 25;

const domainLabels: Record<VersionHistoryDomain, string> = {
  awards: "Awards", experience: "Experience", skills: "Skills", education: "Education",
  projects: "Projects", contact: "Contact", profile: "Profile", website_links: "Website & Links", files: "Files",
};

const operationLabels: Record<VersionHistoryEntry["operation"], string> = {
  create: "Added", update: "Updated", delete: "Removed", reorder: "Order changed", upload: "Added", remove: "Removed",
};

const itemTypeLabels: Record<string, string> = {
  award: "Award entry", awards: "Awards", experience_entry: "Experience entry", experience: "Experience",
  skill_group: "Skill group", skills: "Skills", education_entry: "Education entry", education: "Education",
  project: "Project", projects: "Projects", contact_focus: "Contact focus", contact_status: "Contact status",
  contact: "Contact information", profile_details: "Profile details", profile_photo: "Profile photo",
  public_link: "Public link", website_links: "Website & Links", navigation_item: "Navigation link", project_method: "Method",
  recorded_item: "Recorded item",
};
const RESTORE_DOMAINS: readonly RestorePreviewDomain[] = ["awards", "experience", "skills", "education", "projects", "contact", "website_links"];
const MAX_COLLAPSED_FIELDS = 3;
const LONG_VALUE_LENGTH = 240;

function canOfferRestore(entry: VersionHistoryEntry): boolean {
  return entry.payloadVersion === 2 && entry.operation === "update" && RESTORE_DOMAINS.includes(entry.domain as RestorePreviewDomain)
    && entry.comparison.kind === "aggregate";
}

function scalarText(value: string | number | boolean | null, t: (value: string) => string): string {
  if (value === null) return t("Not set");
  if (value === "") return t("Empty string");
  if (typeof value === "boolean") return t(value ? "Yes" : "No");
  return String(value);
}

function fieldLabelFor(domain: VersionHistoryDomain, itemType: string, key: string): string {
  if (key === "value" && itemType === "project_method") return "Method";
  if (key === "name" && domain === "awards") return "Award name";
  if (key === "title" && itemType === "contact_focus") return "Focus";
  if (key === "title" && itemType === "contact_status") return "Status";
  if (key === "title" && domain === "experience") return "Role";
  if (key === "title" && domain === "education") return "Education title";
  if (key === "title" && domain === "projects") return "Project name";
  if (key === "title" && domain === "skills") return "Skill group title";
  const labels: Record<string, string> = {
    name: "Name", year: "Year", organization: "Organization", role: "Role", period: "Period", location: "Location",
    description: "Description", items: "Skill content", institution: "Institution", program: "Program", date: "Date", grade: "Grade",
    course_title: "Course title", course_name: "Course title", course_description: "Course description", custom_category_label: "Category",
    education_category: "Category", entry_type: "Education type", subtitle: "Subtitle", href: "URL", url: "URL", methods: "Method",
    title: "Title",
    status_type: "Status type", detail: itemType === "contact_focus" ? "Focus detail" : "Contact detail", contact_label: "Contact label",
    availability: "Availability", email: "Email address", email_address: "Email address", github: "GitHub address", github_url: "GitHub address", github_label: "GitHub label",
    email_label: "Email label", linkedin_label: "LinkedIn label", linkedin_homepage_label: "LinkedIn label", linkedin_display_name: "LinkedIn display name",
    linkedin_href: "LinkedIn address", linkedin_url: "LinkedIn address", portfolio_label: "Portfolio label", updated_at_label: "Updated label", label: "Label",
    nav_about_label: "About navigation label", email_action_label: "Email action label", graduation_label: "Graduation label",
    avatar_label: "Avatar label", contact_focus_heading: "Contact focus heading", contact_status_heading: "Contact status heading",
    graduation_value: "Graduation information", avatar_initials: "Avatar initials", footer_name: "Footer name", copyright: "Copyright", photo: "Profile photo",
  };
  return labels[key] ?? "Recorded change";
}

function localeLabel(locale: HistoryFieldChange["locale"]): string {
  if (locale === "en") return "English";
  if (locale === "zh") return "Chinese";
  return "General";
}

function itemStateLabel(state: HistoryItemChange["state"], restoreMode = false): string {
  if (restoreMode) {
    if (state === "added") return "Will be added";
    if (state === "removed") return "Will be removed";
    if (state === "reordered") return "Order will change";
    return "Will change";
  }
  if (state === "added") return "Added";
  if (state === "removed") return "Removed";
  if (state === "reordered") return "Order changed";
  return "Updated";
}

function displayValue(value: HistoryFieldValue, t: (value: string) => string): string | null {
  if (!("recorded" in value) || !value.recorded) return null;
  return scalarText(value.value, t);
}

function presentationNeedsExpansion(presentation: HistoryChangePresentation): boolean {
  let fieldCount = 0, itemCount = 0, hasLongValue = false, hasCollapsedAddRemoveDetails = false;
  const visit = (item: HistoryItemChange) => {
    itemCount += 1;
    if ((item.state === "added" || item.state === "removed") && item.fields.length > 0) hasCollapsedAddRemoveDetails = true;
    for (const change of item.fields) {
      if ("recorded" in change.before && change.before.recorded && typeof change.before.value === "string" && change.before.value.length > LONG_VALUE_LENGTH) hasLongValue = true;
      if ("recorded" in change.after && change.after.recorded && typeof change.after.value === "string" && change.after.value.length > LONG_VALUE_LENGTH) hasLongValue = true;
      if (!(("redacted" in change.before) || ("redacted" in change.after))) fieldCount += 1;
    }
    item.children.forEach(visit);
  };
  presentation.items.forEach(visit);
  return fieldCount > MAX_COLLAPSED_FIELDS || itemCount > 4 || hasLongValue || hasCollapsedAddRemoveDetails;
}

function ChangeField({ domain, itemType, change, expanded, restoreMode = false, t }: {
  domain: VersionHistoryDomain; itemType: string; change: HistoryFieldChange; expanded: boolean; restoreMode?: boolean; t: (value: string) => string;
}) {
  const before = displayValue(change.before, t), after = displayValue(change.after, t);
  if (before === null && after === null) return null;
  const isLong = (before?.length ?? 0) > LONG_VALUE_LENGTH || (after?.length ?? 0) > LONG_VALUE_LENGTH;
  return <div className="version-history-change-field">
    <div className="version-history-change-context">
      <span className="version-history-field-label">{t(fieldLabelFor(domain, itemType, change.key))}</span>
      <span className="version-history-field-locale">{t(localeLabel(change.locale))}</span>
    </div>
    {before !== null && <div className="version-history-field-value version-history-before">
      <span className="version-history-value-side-label">{t(restoreMode ? "Current" : "Before")}</span>
      <span className={isLong && !expanded ? "version-history-long-value is-clamped" : "version-history-long-value"}>{before}</span>
    </div>}
    {before !== null && after !== null && <span className="version-history-direction" aria-hidden="true">→</span>}
    {after !== null && <div className="version-history-field-value version-history-after">
      <span className="version-history-value-side-label">{t(restoreMode ? "After restore" : "After")}</span>
      <span className={isLong && !expanded ? "version-history-long-value is-clamped" : "version-history-long-value"}>{after}</span>
    </div>}
  </div>;
}

function ChangeItem({ item, domain, expanded, visibleFields, t, path = "0", restoreMode = false }: {
  item: HistoryItemChange; domain: VersionHistoryDomain; expanded: boolean; visibleFields: { count: number }; t: (value: string) => string; path?: string; restoreMode?: boolean;
}) {
  const hideDetails = !expanded && (item.state === "added" || item.state === "removed");
  const candidates = hideDetails ? [] : item.fields.filter(change => !("redacted" in change.before) && !("redacted" in change.after));
  const visibleChanges = expanded ? candidates : candidates.slice(0, Math.max(0, MAX_COLLAPSED_FIELDS - visibleFields.count));
  visibleFields.count += visibleChanges.length;
  if (item.state === "updated" && visibleChanges.length === 0 && item.children.length === 0) return null;
  const label = item.label?.trim() || t(itemTypeLabels[item.itemType] || itemTypeLabels.recorded_item);
  return <section className={`version-history-change-item${item.state === "added" ? " is-added" : ""}${item.state === "removed" ? " is-removed" : ""}`}>
    <h3>{label}<span className="version-history-change-state">{t(itemStateLabel(item.state, restoreMode))}</span></h3>
    {visibleChanges.length > 0 && <div className="version-history-change-fields">
      {visibleChanges.map((change, index) => <ChangeField key={`${path}-field-${index}`} domain={domain} itemType={item.itemType} change={change} expanded={expanded} restoreMode={restoreMode} t={t} />)}
    </div>}
    {!hideDetails && item.children.length > 0 && <div className="version-history-change-children">
      {item.children.map((child, index) => <ChangeItem key={`${path}-child-${index}`} item={child} domain={domain} expanded={expanded}
        visibleFields={visibleFields} t={t} path={`${path}-${index}`} restoreMode={restoreMode} />)}
    </div>}
  </section>;
}

function HistoryChanges({ entry, resumeId, repository, t }: {
  entry: VersionHistoryEntry; resumeId: string | null; repository: ResumeRepository | null; t: (value: string) => string;
}) {
  const presentation = presentVersionHistoryChange(entry);
  const [expanded, setExpanded] = useState(false);
  const disclosureId = useId();
  const isPhoto = isVersionHistoryProfilePhotoEntry(entry);
  const shouldExpand = presentation.state === "changes" && presentationNeedsExpansion(presentation);
  const photoSides = isPhoto && resumeId ? versionHistoryProfilePhotoSides(entry) : null;
  const visibleFields = { count: 0 };
  return <div className="version-history-change-body">
    {presentation.state === "generic" ? <p className="version-history-unavailable">{t("Change details aren’t available.")}</p>
      : <div className="version-history-change-items" id={disclosureId}>
        {presentation.items.map((item, index) => <ChangeItem key={`item-${index}`} item={item} domain={presentation.domain} expanded={expanded}
          visibleFields={visibleFields} t={t} path={`${index}`} />)}
      </div>}
    {isPhoto && <div className="version-history-photo-reference">
      <p className="version-history-reference-note">{t("Historical photo reference recorded; file availability is unknown.")}</p>
      <ProfileHistoryPhotoPair resumeId={resumeId} eventId={entry.eventId} occurredAt={entry.occurredAt}
        sides={photoSides ?? UNAVAILABLE_PROFILE_PHOTO_SIDES} repository={repository} />
    </div>}
    {entry.domain === "files" && <p className="version-history-reference-note">{t("Historical file reference recorded; file availability is unknown.")}</p>}
    {shouldExpand && <button className="button secondary version-history-disclosure" type="button" aria-expanded={expanded} aria-controls={disclosureId}
      onClick={() => setExpanded(value => !value)}>{t(expanded ? "Show fewer changes" : "Show more changes")}</button>}
  </div>;
}

function RestorePreviewChanges({ presentation, t }: { presentation: Extract<RestorePreviewPresentation, { state: "changes" }>; t: (value: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const disclosureId = useId();
  const visibleFields = { count: 0 };
  return <div className="restore-preview-changes">
    <div className="version-history-change-items" id={disclosureId}>
      {presentation.comparison.items.map((item, index) => <ChangeItem key={`restore-item-${index}`} item={item} domain={presentation.domain}
        expanded={expanded} visibleFields={visibleFields} t={t} restoreMode path={`restore-${index}`} />)}
    </div>
    {presentationNeedsExpansion(presentation.comparison) && <button className="button secondary version-history-disclosure" type="button"
      aria-expanded={expanded} aria-controls={disclosureId} onClick={() => setExpanded(value => !value)}>
      {t(expanded ? "Show fewer changes" : "Show more changes")}
    </button>}
  </div>;
}

function previewFailureMessage(error: unknown): string {
  if (!(error instanceof RestorePreviewError)) return "Restore preview could not be prepared. Restore has not been started.";
  switch (error.code) {
    case "unauthenticated": return "Your session has expired. Sign in again to continue.";
    case "target_not_authorized": return "You don’t have permission to restore this section.";
    case "activity_log_disabled": return "Version History is not available for this resume.";
    case "restore_disabled": return "Restore is currently turned off for this resume.";
    case "restore_configuration_disabled":
    case "source_ineligible": return "This change can’t be restored from Version History.";
    case "current_state_ineligible": return "This earlier version can no longer be restored safely.";
    case "invalid_response": return "Preview details aren’t available. Restore has not been started.";
    default: return "Restore preview could not be prepared. Restore has not been started.";
  }
}

function mutationFailureMessage(error: RestoreMutationError): string {
  switch (error.code) {
    case "unauthenticated": return "Your session has expired. Sign in again to continue.";
    case "target_not_authorized": return "You don’t have permission to restore this section.";
    case "restore_disabled": return "Restore is not enabled for this target.";
    case "restore_configuration_disabled": return "This section can’t be restored from Version History.";
    case "restore_ineligible": return "This earlier version can no longer be restored safely.";
    case "stale_preview": return "This section changed after the preview. Review a fresh preview before restoring.";
    case "restore_request_expired": return "This restore can no longer be safely continued. Review a fresh preview before continuing.";
    case "storage_unavailable": return "This browser could not safely prepare the restore. Nothing was submitted.";
    case "restore_signing_unavailable": return "This earlier version could not be confirmed as safe to restore. Your current content was not replaced.";
    case "restore_unavailable":
    case "invalid_response": return "Restore couldn’t be completed. Your current content was not replaced.";
    default: return "We couldn’t confirm the restore result. Retry this restore to safely check the same operation. Don’t start a different restore until the result is confirmed.";
  }
}

function draftGuardMessage(message: string | undefined): string {
  if (message?.includes("currently being saved")) return "This section is being saved. Wait for the save to finish before restoring.";
  if (message?.includes("unresolved save")) return "This section has a save that still needs attention. Resolve it before restoring.";
  if (message?.includes("unsaved section text")) return "Save or discard your unsaved section text before restoring.";
  if (message?.includes("unsaved changes")) return "Save or discard your unsaved changes in this section before restoring.";
  return "Restore is paused because this section’s editing state couldn’t be verified.";
}

export type RestoreGuard = (domain: RestorePreviewDomain, resumeId: string) => { allowed: boolean; message?: string };

export function VersionHistoryPage({ resumeId, repository, canRestoreDomain, onRestoreApplied }: {
  resumeId: string | null; repository: ResumeRepository | null; canRestoreDomain?: RestoreGuard;
  onRestoreApplied?: (domain: RestorePreviewDomain, result: RestoreMutationResult) => Promise<void> | void;
}) {
  const { t } = useUiLocale();
  const [entries, setEntries] = useState<VersionHistoryEntry[]>([]);
  const [nextPage, setNextPage] = useState<VersionHistoryPageResult["nextCursor"]>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [restoreEntry, setRestoreEntry] = useState<VersionHistoryEntry | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restorePhase, setRestorePhase] = useState<"idle" | "loading" | "ready" | "no_change" | "submitting" | "outcome_unknown" | "pending_unavailable" | "stale" | "completed" | "error">("idle");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [pendingRestore, setPendingRestore] = useState<RestoreMutationRequest | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreMutationResult | null>(null);
  const restoreDialog = useRef<HTMLElement>(null);
  const restoreOpLock = useRef(false);
  const restoreTrigger = useRef<HTMLButtonElement | null>(null);
  const requestGeneration = useRef(0);
  const acceptPreview = (preview: RestorePreview, expectedEventId: string) => {
    const presentation = presentRestorePreview(preview, expectedEventId);
    if (presentation.state === "unavailable") {
      setRestorePreview(null); setRestorePhase("error");
      setRestoreMessage("Preview details aren’t available. Restore has not been started.");
      return;
    }
    setRestorePreview(preview);
    setRestorePhase(presentation.state === "no_change" ? "no_change" : "ready");
    setRestoreMessage("");
  };

  const loadFirstPage = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true); setError(false); setMoreError(false); setEntries([]); setNextPage(null); setHasMore(false);
    try {
      if (!resumeId || !repository?.loadVersionHistoryPage) throw new Error("Unavailable");
      const page = await repository.loadVersionHistoryPage(resumeId, PAGE_SIZE);
      if (generation !== requestGeneration.current) return;
      setEntries(page.entries); setHasMore(page.hasMore); setNextPage(page.nextCursor);
    } catch {
      if (generation === requestGeneration.current) setError(true);
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [repository, resumeId]);

  useEffect(() => {
    void loadFirstPage();
    return () => { requestGeneration.current += 1; };
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (!resumeId || !repository?.loadVersionHistoryPage || !hasMore || !nextPage || loadingMore) return;
    const generation = requestGeneration.current;
    setLoadingMore(true); setMoreError(false);
    try {
      const page = await repository.loadVersionHistoryPage(resumeId, PAGE_SIZE, nextPage);
      if (generation !== requestGeneration.current) return;
      setEntries(current => [...current, ...page.entries]); setHasMore(page.hasMore); setNextPage(page.nextCursor);
    } catch {
      if (generation === requestGeneration.current) setMoreError(true);
    } finally {
      if (generation === requestGeneration.current) setLoadingMore(false);
    }
  };

  const openRestorePreview = async (entry: VersionHistoryEntry, trigger: HTMLButtonElement) => {
    if (!resumeId || !repository?.previewRestore || !repository.getPendingRestoreAttempt) return;
    restoreTrigger.current = trigger;
    setRestoreEntry(entry); setRestorePreview(null); setRestoreResult(null); setRestoreMessage(""); setPendingRestore(null);
    let pending: RestoreMutationRequest | null;
    try {
      pending = repository.getPendingRestoreAttempt(resumeId, entry.eventId);
    } catch {
      setRestorePhase("pending_unavailable");
      return;
    }
    if (pending) {
      setPendingRestore(pending); setRestorePhase("outcome_unknown");
      return;
    }
    try {
      setRestorePhase("loading");
      const preview = await repository.previewRestore({ resumeId, sourceEventId: entry.eventId });
      acceptPreview(preview, entry.eventId);
    } catch (error) {
      setRestorePhase("error");
      setRestoreMessage(previewFailureMessage(error));
    }
  };

  const settleRestore = async (request: RestoreMutationRequest, mode: "new" | "retry", alreadyLocked = false) => {
    if (!repository?.restoreDomain || (restoreOpLock.current && !alreadyLocked)) return;
    restoreOpLock.current = true; setRestorePhase("submitting"); setRestoreMessage("");
    try {
      const result = await repository.restoreDomain(request, mode);
      setPendingRestore(null); setRestoreResult(result);
      if (result.status === "no_change") {
        setRestorePhase("no_change");
        setRestoreMessage("");
      } else {
        setRestorePhase("completed");
        setRestoreMessage("");
        try { await onRestoreApplied?.(result.domain, result); }
        catch { setRestoreMessage("This section was restored, but the current view could not be refreshed. Reload this section before editing it."); }
        void loadFirstPage();
      }
    } catch (error) {
      if (error instanceof RestoreMutationError) {
        if (error.code === "stale_preview") {
          setPendingRestore(null); setRestorePhase("stale"); setRestoreMessage(mutationFailureMessage(error));
        } else if (error.uncertain || error.code === "restore_request_pending" || error.code === "pending_conflict" || error.code === "idempotency_conflict") {
          setRestorePhase("outcome_unknown"); setRestoreMessage("");
          try { setPendingRestore(repository.getPendingRestoreAttempt?.(request.resumeId, request.sourceEventId) ?? request); }
          catch { setPendingRestore(request); }
        } else if (error.code === "restore_request_expired") {
          setPendingRestore(null); setRestorePhase("stale"); setRestoreMessage(mutationFailureMessage(error));
        } else {
          setPendingRestore(null); setRestorePhase("error"); setRestoreMessage(mutationFailureMessage(error));
        }
      } else {
        setRestorePhase("outcome_unknown"); setRestoreMessage(""); setPendingRestore(request);
      }
    } finally { restoreOpLock.current = false; }
  };

  const confirmRestore = async () => {
    if (!resumeId || !restorePreview || restorePreview.status !== "ready" || !restoreEntry || restorePhase !== "ready"
      || presentRestorePreview(restorePreview, restoreEntry.eventId).state !== "changes") return;
    if (restoreOpLock.current) return;
    if (!repository?.restoreDomain) { setRestorePhase("error"); setRestoreMessage("Restore can’t be started right now. No change was made."); return; }
    const guard = canRestoreDomain?.(restorePreview.domain, resumeId);
    if (guard && !guard.allowed) { setRestoreMessage(draftGuardMessage(guard.message)); return; }
    if (!globalThis.crypto?.randomUUID) { setRestorePhase("error"); setRestoreMessage("This browser can’t start Restore safely. No changes were submitted."); return; }
    let requestId: string;
    try { requestId = globalThis.crypto.randomUUID().toLowerCase(); }
    catch { setRestorePhase("error"); setRestoreMessage("This browser can’t start Restore safely. No changes were submitted."); return; }
    restoreOpLock.current = true;
    await settleRestore({ resumeId, sourceEventId: restoreEntry.eventId, expectedCurrentDigest: restorePreview.expectedCurrentDigest,
      requestId }, "new", true);
  };

  const retryPendingRestore = async () => {
    if (!resumeId || !pendingRestore || !restoreEntry || restoreOpLock.current) return;
    const guard = canRestoreDomain?.(restoreEntry.domain as RestorePreviewDomain, resumeId);
    if (guard && !guard.allowed) { setRestoreMessage(draftGuardMessage(guard.message)); return; }
    await settleRestore(pendingRestore, "retry");
  };

  const retryPendingStateInspection = async () => {
    if (!restoreEntry || !restoreTrigger.current) return;
    await openRestorePreview(restoreEntry, restoreTrigger.current);
  };

  const refreshRestorePreview = async () => {
    if (!restoreEntry || !resumeId || !repository?.previewRestore) return;
    setRestorePhase("loading"); setRestoreMessage("");
    try {
      const preview = await repository.previewRestore({ resumeId, sourceEventId: restoreEntry.eventId });
      acceptPreview(preview, restoreEntry.eventId);
    } catch (error) {
      setRestorePhase("stale");
      setRestoreMessage(previewFailureMessage(error));
    }
  };

  const closeRestore = useCallback(() => {
    if (restorePhase === "submitting") return;
    setRestoreEntry(null); setRestorePreview(null); setPendingRestore(null); setRestorePhase("idle"); setRestoreMessage("");
    restoreTrigger.current?.focus();
  }, [restorePhase]);

  const restorePresentation = restoreEntry && restorePreview
    ? presentRestorePreview(restorePreview, restoreEntry.eventId) : null;

  useEffect(() => {
    if (!restoreEntry) return;
    const initialControl = restoreDialog.current?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (initialControl) initialControl.focus(); else restoreDialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && restorePhase !== "submitting") { event.preventDefault(); closeRestore(); }
      if (event.key !== "Tab" || !restoreDialog.current) return;
      const controls = Array.from(restoreDialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [restoreEntry, restorePhase, closeRestore]);

  return <section className="page-section version-history-page" aria-busy={loading || loadingMore}>
    <header className="page-heading"><div><p className="eyebrow">{t("Resume history")}</p><h1>{t("Version History")}</h1>
      <p className="version-history-intro">{t("A chronological record of successful, supported content changes.")}</p></div></header>
    {loading ? <p className="version-history-state" role="status">{t("Loading Version History…")}</p>
      : error ? <div className="version-history-state" role="alert"><p>{t("Unable to load Version History.")}</p><button className="button secondary" type="button" onClick={() => void loadFirstPage()}>{t("Retry")}</button></div>
        : entries.length === 0 ? <p className="version-history-state">{t("No Version History entries have been recorded yet.")}</p>
          : <>
            <ol className="version-history-list">{entries.map((entry, index) => <li className="version-history-entry" key={entry.eventId}>
              <article className="version-history-card" aria-labelledby={`version-history-entry-${index}`}>
                <header className="version-history-entry-heading"><div className="version-history-heading-context">
                  <h2 id={`version-history-entry-${index}`}>{t(domainLabels[entry.domain])}<span aria-hidden="true"> · </span>{t(operationLabels[entry.operation])}</h2>
                  <p className="version-history-entry-meta"><time dateTime={entry.occurredAt}>{formatBeijingTimestamp(entry.occurredAt)}</time>
                    <span aria-hidden="true"> · </span><span>{entry.actorAccountLabel === "Unknown account" ? t("Unknown account") : entry.actorAccountLabel}</span><span aria-hidden="true"> · </span>
                    <span>{t(entry.actorRole === "qa" ? "QA administrator" : "Owner")}</span></p>
                </div></header>
                <HistoryChanges entry={entry} resumeId={resumeId} repository={repository} t={t} />
                {canOfferRestore(entry) && <footer className="version-history-card-footer"><button className="button secondary version-history-restore-preview" type="button"
                  onClick={event => void openRestorePreview(entry, event.currentTarget)}>{t("Preview what would be restored")}</button></footer>}
              </article>
            </li>)}</ol>
            {moreError && <div className="version-history-state" role="alert"><p>{t("Unable to load more Version History entries.")}</p><button className="button secondary" type="button" onClick={() => void loadMore()}>{t("Retry loading more")}</button></div>}
            {hasMore && <button className="button secondary version-history-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("Loading…") : t("Load more")}</button>}
          </>}
    {restoreEntry && <div className="restore-dialog-backdrop"><section className="restore-dialog" role="dialog" aria-modal="true"
      aria-labelledby="restore-dialog-title" aria-describedby="restore-dialog-description" tabIndex={-1} ref={restoreDialog}>
      <header className="restore-dialog-heading"><div><p className="eyebrow">{t("Restore preview")}</p><h2 id="restore-dialog-title">{t(domainLabels[restorePresentation?.domain ?? restoreEntry.domain])}</h2></div>
        <button type="button" className="button secondary" onClick={closeRestore} disabled={restorePhase === "submitting"}>{t("Cancel")}</button></header>
      <p id="restore-dialog-description">{t("This preview shows how this section would look after restoring its earlier content. Only this section will change. Other sections will stay as they are.")}</p>
      {restorePhase === "loading" && <p role="status">{t("Preparing restore preview…")}</p>}
      {restorePhase === "submitting" && <p role="status">{t("Restoring this section…")}</p>}
      {restorePresentation?.state === "changes" && restorePhase === "ready" && <>
        <div className="restore-dialog-safety"><p>{t("Only this section will be changed.")}</p><p>{t("Earlier Version History entries will not be changed.")}</p></div>
        <div className="restore-dialog-comparison" aria-label={t("Proposed section changes")}>
          <RestorePreviewChanges presentation={restorePresentation} t={t} />
        </div>
        {restoreMessage && <p role="status">{t(restoreMessage)}</p>}
        <div className="restore-dialog-actions"><button type="button" className="button secondary" onClick={closeRestore}>{t("Cancel")}</button>
          <button type="button" className="button danger" onClick={() => void confirmRestore()}>{t("Restore this section")}</button></div>
      </>}
      {restorePhase === "no_change" && restorePresentation?.state === "no_change" && <div className="restore-dialog-result" role="status">
        <h3>{t("No changes were needed")}</h3><p>{t("This section already matches the earlier content. Nothing needs to be restored.")}</p>
      </div>}
      {restorePhase === "completed" && restoreResult?.status === "restored" && <div className="restore-dialog-result" role="status">
        <h3>{t("Section restored")}</h3><p>{t(restoreMessage || "This section was restored. A new entry was added to Version History; earlier history remains unchanged.")}</p>
      </div>}
      {restorePhase === "no_change" && restoreResult?.status === "no_change" && <div className="restore-dialog-result" role="status">
        <h3>{t("No changes were needed")}</h3><p>{t("This section already matched the earlier content. Nothing was changed.")}</p>
      </div>}
      {restorePhase === "outcome_unknown" && <div className="restore-dialog-result" role="alert">
        <h3>{t("We couldn’t confirm the restore result")}</h3><p>{t("Retry this restore to safely check the same operation. Don’t start a different restore until the result is confirmed.")}</p>
        {restoreMessage && <p role="status">{t(restoreMessage)}</p>}
        {pendingRestore && <button type="button" className="button primary" onClick={() => void retryPendingRestore()}>{t("Retry this restore")}</button>}
      </div>}
      {restorePhase === "pending_unavailable" && <div className="restore-dialog-result" role="alert">
        <h3>{t("We couldn’t confirm the previous restore result")}</h3>
        <p>{t("We can’t safely determine the result of an earlier restore attempt right now. Don’t start another restore until this is resolved.")}</p>
        <button type="button" className="button secondary" onClick={() => void retryPendingStateInspection()}>{t("Try again")}</button>
      </div>}
      {restorePhase === "stale" && <div className="restore-dialog-result" role="alert">
        <p>{t(restoreMessage || "This section changed after the preview. Review a fresh preview before restoring.")}</p>
        <button type="button" className="button secondary" onClick={() => void refreshRestorePreview()}>{t("Refresh preview")}</button>
      </div>}
      {restorePhase === "error" && <div className="restore-dialog-result" role="alert"><p>{t(restoreMessage || "Restore couldn’t be completed. Your current content was not replaced.")}</p></div>}
    </section></div>}
  </section>;
}
