import { useCallback, useEffect, useRef, useState } from "react";
import { RestoreMutationError, RestorePreviewError, type RestoreMutationRequest, type RestorePreview, type ResumeRepository, type VersionHistoryComparison, type VersionHistoryDomain, type VersionHistoryEntry, type VersionHistoryJson, type VersionHistoryPage as VersionHistoryPageResult } from "./data/resumeRepository";
import type { RestorePreviewDomain } from "./data/restorePreviewContract";
import type { RestoreMutationResult } from "./data/restoreMutationContract";
import { formatBeijingTimestamp } from "./overviewFormat";
import { useUiLocale } from "./uiLocale";
import { ProfileHistoryPhoto, ProfileHistoryPhotoPair, UNAVAILABLE_PROFILE_PHOTO_SIDES, isVersionHistoryProfilePhotoEntry, versionHistoryProfilePhotoSides } from "./ProfileHistoryImage";
import { validateProfileAggregate } from "./data/profileAggregate";

const PAGE_SIZE = 25;

const domainLabels: Record<VersionHistoryDomain, string> = {
  awards: "Awards", experience: "Experience", skills: "Skills", education: "Education",
  projects: "Projects", contact: "Contact", profile: "Profile", website_links: "Website & Links", files: "Files",
};

const operationLabels: Record<VersionHistoryEntry["operation"], string> = {
  create: "Created", update: "Updated", delete: "Deleted", reorder: "Reordered", upload: "Uploaded", remove: "Removed",
};

const entityLabels: Record<string, string> = {
  award_entry: "Award", award_list: "Awards", experience_entry: "Experience entry", experience_list: "Experience",
  skill_group: "Skill group", skill_group_list: "Skills", education_entry: "Education entry", education_list: "Education",
  project_entry: "Project", project_list: "Projects", contact_focus_item: "Contact focus", contact_status_item: "Contact status",
  contact_section: "Contact", profile_settings: "Profile details", profile_image: "Profile photo reference",
  public_link: "Public link", website_links_settings: "Website & Links", resume_file: "Resume file reference", resume_file_set: "Resume files",
};
const RESTORE_DOMAINS: readonly RestorePreviewDomain[] = ["awards", "experience", "skills", "education", "projects", "contact", "website_links"];

function canOfferRestore(entry: VersionHistoryEntry): boolean {
  return entry.payloadVersion === 2 && entry.operation === "update" && RESTORE_DOMAINS.includes(entry.domain as RestorePreviewDomain)
    && entry.comparison.kind === "aggregate";
}

function fieldLabel(value: string): string {
  if (value === "zh") return "Chinese";
  if (value === "en") return "English";
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function scalarText(value: string | number | boolean | null, t: (value: string) => string): string {
  if (value === null) return t("Not set");
  if (value === "") return t("Empty string");
  if (typeof value === "boolean") return t(value ? "Yes" : "No");
  return String(value);
}

function JsonValue({ value, t, path }: { value: VersionHistoryJson; t: (value: string) => string; path: string }) {
  if (value === null || typeof value !== "object") return <span>{scalarText(value, t)}</span>;
  if (Array.isArray(value)) {
    return <ol className="version-history-value-list">{value.map((item, index) => <li key={`${path}-${index}`}><JsonValue value={item} t={t} path={`${path}-${index}`} /></li>)}</ol>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <span>{t("No recorded fields")}</span>;
  return <dl className="version-history-value-object">{entries.map(([key, child]) => <div key={`${path}-${key}`}>
    <dt>{fieldLabel(key)}</dt><dd><JsonValue value={child} t={t} path={`${path}-${key}`} /></dd>
  </div>)}</dl>;
}

function Comparison({ comparison, event, resumeId, repository, t }: {
  comparison: VersionHistoryComparison; event: VersionHistoryEntry; resumeId: string | null; repository: ResumeRepository | null;
  t: (value: string) => string;
}) {
  if (isVersionHistoryProfilePhotoEntry(event)) {
    const sides = resumeId ? versionHistoryProfilePhotoSides(event) : null;
    if (event.payloadVersion === 1) return <ProfileHistoryPhotoPair resumeId={resumeId} eventId={event.eventId}
      occurredAt={event.occurredAt} sides={sides ?? UNAVAILABLE_PROFILE_PHOTO_SIDES} repository={repository} />;
    if (comparison.kind !== "aggregate" || !sides) {
      return <p className="version-history-unavailable">{t("Recorded change details are unavailable for this entry.")}</p>;
    }
    try {
      const before = validateProfileAggregate(comparison.before);
      const after = validateProfileAggregate(comparison.after);
      const beforeShared = { graduation_value: before.shared.graduation_value, avatar_initials: before.shared.avatar_initials,
        footer_name: before.shared.footer_name, copyright: before.shared.copyright };
      const afterShared = { graduation_value: after.shared.graduation_value, avatar_initials: after.shared.avatar_initials,
        footer_name: after.shared.footer_name, copyright: after.shared.copyright };
      return <div className="version-history-aggregate">
        <section><h3>{t("Before")}</h3><JsonValue value={{ ...before, shared: beforeShared }} t={t} path={`${event.eventId}-before`} />
          <ProfileHistoryPhoto resumeId={resumeId} eventId={event.eventId} occurredAt={event.occurredAt} side="before" value={sides.before} repository={repository} />
        </section>
        <section><h3>{t("After")}</h3><JsonValue value={{ ...after, shared: afterShared }} t={t} path={`${event.eventId}-after`} />
          <ProfileHistoryPhoto resumeId={resumeId} eventId={event.eventId} occurredAt={event.occurredAt} side="after" value={sides.after} repository={repository} />
        </section>
      </div>;
    } catch {
      return <p className="version-history-unavailable">{t("Recorded change details are unavailable for this entry.")}</p>;
    }
  }
  if (comparison.kind === "unavailable") return <p className="version-history-unavailable">{t("Recorded change details are unavailable for this entry.")}</p>;
  if (comparison.kind === "entity_fields") return <dl className="version-history-comparison">
    {Object.entries(comparison.changes).map(([field, change]) => <div className="version-history-field" key={field}>
      <dt>{fieldLabel(field)}</dt><dd><span><b>{t("Before")}</b><span>{scalarText(change.before, t)}</span></span><span><b>{t("After")}</b><span>{scalarText(change.after, t)}</span></span></dd>
    </div>)}
  </dl>;
  return <div className="version-history-aggregate">
    <section><h3>{t("Before")}</h3><JsonValue value={comparison.before} t={t} path={`${event.eventId}-before`} /></section>
    <section><h3>{t("After")}</h3><JsonValue value={comparison.after} t={t} path={`${event.eventId}-after`} /></section>
  </div>;
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
  const [restorePhase, setRestorePhase] = useState<"idle" | "loading" | "ready" | "no_change" | "submitting" | "outcome_unknown" | "stale" | "completed" | "error">("idle");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [pendingRestore, setPendingRestore] = useState<RestoreMutationRequest | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreMutationResult | null>(null);
  const restoreDialog = useRef<HTMLElement>(null);
  const restoreOpLock = useRef(false);
  const restoreTrigger = useRef<HTMLButtonElement | null>(null);
  const requestGeneration = useRef(0);

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
    try {
      const pending = repository.getPendingRestoreAttempt(resumeId, entry.eventId);
      if (pending) {
        setPendingRestore(pending); setRestorePhase("outcome_unknown");
        setRestoreMessage("A previous Restore request has an unresolved outcome. Retry that exact request before starting another Restore attempt.");
        return;
      }
      setRestorePhase("loading");
      const preview = await repository.previewRestore({ resumeId, sourceEventId: entry.eventId });
      setRestorePreview(preview); setRestorePhase(preview.status === "ready" ? "ready" : "no_change");
    } catch (error) {
      setRestorePhase("error");
      setRestoreMessage(error instanceof RestorePreviewError ? error.message : "Restore Preview could not be prepared.");
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
        setRestoreMessage("The current domain already matches the selected historical state. Nothing was changed.");
      } else {
        setRestorePhase("completed");
        setRestoreMessage("This domain was restored. A new Version History entry was recorded.");
        try { await onRestoreApplied?.(result.domain, result); }
        catch { setRestoreMessage("Restore completed, but the current view could not be refreshed. Reload this domain before editing it."); }
        void loadFirstPage();
      }
    } catch (error) {
      if (error instanceof RestoreMutationError) {
        if (error.code === "stale_preview") {
          setPendingRestore(null); setRestorePhase("stale"); setRestoreMessage(error.message);
        } else if (error.uncertain || error.code === "restore_request_pending" || error.code === "pending_conflict" || error.code === "idempotency_conflict") {
          setRestorePhase("outcome_unknown"); setRestoreMessage(error.message);
          try { setPendingRestore(repository.getPendingRestoreAttempt?.(request.resumeId, request.sourceEventId) ?? request); }
          catch { setPendingRestore(request); }
        } else {
          setPendingRestore(null); setRestorePhase("error"); setRestoreMessage(error.message);
        }
      } else {
        setRestorePhase("outcome_unknown"); setRestoreMessage("The Restore result is unknown. Retry only the exact same request."); setPendingRestore(request);
      }
    } finally { restoreOpLock.current = false; }
  };

  const confirmRestore = async () => {
    if (!resumeId || !restorePreview || restorePreview.status !== "ready" || !restoreEntry || restorePhase !== "ready") return;
    if (restoreOpLock.current) return;
    if (!repository?.restoreDomain) { setRestorePhase("error"); setRestoreMessage("Restore submission is unavailable. No change was made."); return; }
    const guard = canRestoreDomain?.(restorePreview.domain, resumeId);
    if (guard && !guard.allowed) { setRestoreMessage(guard.message ?? "Save or discard this domain's unsaved changes before restoring."); return; }
    if (!globalThis.crypto?.randomUUID) { setRestorePhase("error"); setRestoreMessage("Secure Restore requests are unavailable in this browser."); return; }
    let requestId: string;
    try { requestId = globalThis.crypto.randomUUID().toLowerCase(); }
    catch { setRestorePhase("error"); setRestoreMessage("Secure Restore requests are unavailable in this browser."); return; }
    restoreOpLock.current = true;
    await settleRestore({ resumeId, sourceEventId: restoreEntry.eventId, expectedCurrentDigest: restorePreview.expectedCurrentDigest,
      requestId }, "new", true);
  };

  const retryPendingRestore = async () => {
    if (!resumeId || !pendingRestore || !restoreEntry || restoreOpLock.current) return;
    const guard = canRestoreDomain?.(restoreEntry.domain as RestorePreviewDomain, resumeId);
    if (guard && !guard.allowed) { setRestoreMessage(guard.message ?? "Save or discard this domain's unsaved changes before restoring."); return; }
    await settleRestore(pendingRestore, "retry");
  };

  const refreshRestorePreview = async () => {
    if (!restoreEntry || !resumeId || !repository?.previewRestore) return;
    setRestorePhase("loading"); setRestoreMessage("");
    try {
      const preview = await repository.previewRestore({ resumeId, sourceEventId: restoreEntry.eventId });
      setRestorePreview(preview); setRestorePhase(preview.status === "ready" ? "ready" : "no_change");
    } catch (error) {
      setRestorePhase("stale");
      setRestoreMessage(error instanceof RestorePreviewError ? error.message : "A fresh Restore Preview could not be prepared.");
    }
  };

  const closeRestore = useCallback(() => {
    if (restorePhase === "submitting") return;
    setRestoreEntry(null); setRestorePreview(null); setPendingRestore(null); setRestorePhase("idle"); setRestoreMessage("");
    restoreTrigger.current?.focus();
  }, [restorePhase]);

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
            <ol className="version-history-list">{entries.map(entry => <li className="version-history-entry" key={entry.eventId}>
              <article aria-labelledby={`version-history-${entry.eventId}`}>
                <header className="version-history-entry-heading"><div><h2 id={`version-history-${entry.eventId}`}>{t(domainLabels[entry.domain])}</h2>
                  <p>{t(operationLabels[entry.operation])} · {entry.actorAccountLabel} · {t(entry.actorRole === "qa" ? "QA" : "Owner")}</p>
                  <p className="version-history-entity">{t(entityLabels[entry.entityType] ?? "Recorded item")}</p>
                </div><time dateTime={entry.occurredAt}>{formatBeijingTimestamp(entry.occurredAt)}</time></header>
                {(entry.domain === "files" || entry.entityType === "profile_image") && <p className="version-history-reference-note">{t(entry.domain === "files" ? "Historical file reference recorded; file availability is unknown." : "Historical photo reference recorded; file availability is unknown.")}</p>}
                <Comparison comparison={entry.comparison} event={entry} resumeId={resumeId} repository={repository} t={t} />
                {canOfferRestore(entry) && <button className="button secondary version-history-restore-preview" type="button"
                  onClick={event => void openRestorePreview(entry, event.currentTarget)}>{t("Preview restore")}</button>}
              </article>
            </li>)}</ol>
            {moreError && <div className="version-history-state" role="alert"><p>{t("Unable to load more Version History entries.")}</p><button className="button secondary" type="button" onClick={() => void loadMore()}>{t("Retry loading more")}</button></div>}
            {hasMore && <button className="button secondary version-history-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("Loading…") : t("Load more")}</button>}
          </>}
    {restoreEntry && <div className="restore-dialog-backdrop"><section className="restore-dialog" role="dialog" aria-modal="true"
      aria-labelledby="restore-dialog-title" aria-describedby="restore-dialog-description" tabIndex={-1} ref={restoreDialog}>
      <header><h2 id="restore-dialog-title">{t("Restore one domain")}</h2><button type="button" className="button secondary" onClick={closeRestore} disabled={restorePhase === "submitting"}>{t("Close")}</button></header>
      <p id="restore-dialog-description">{restorePreview ? `${t(domainLabels[restorePreview.domain])} · ${formatBeijingTimestamp(restorePreview.sourceOccurredAt)}` : t(domainLabels[restoreEntry.domain])}</p>
      <p>{t("Only this domain will change. The current state will be replaced with the historical state recorded before this event. Other domains and files will not be restored.")}</p>
      {restorePreview && <div className="restore-dialog-comparison" aria-label={t("Current and historical target state")}>
        <section><h3>{t("Current state")}</h3><JsonValue value={restorePreview.currentState} t={t} path="restore-current" /></section>
        <section><h3>{t("Historical target state — before this event")}</h3><JsonValue value={restorePreview.historicalState} t={t} path="restore-target" /></section>
      </div>}
      {restorePhase === "loading" && <p role="status">{t("Preparing Restore Preview…")}</p>}
      {restorePhase === "submitting" && <p role="status">{t("Applying Restore…")}</p>}
      {restoreMessage && <p role={restorePhase === "error" || restorePhase === "stale" || restorePhase === "outcome_unknown" ? "alert" : "status"}>{t(restoreMessage)}</p>}
      {restorePhase === "ready" && restorePreview?.status === "ready" && <div className="restore-dialog-actions">
        <button type="button" className="button secondary" onClick={closeRestore}>{t("Cancel")}</button>
        <button type="button" className="button danger" onClick={() => void confirmRestore()}>{t("Restore this domain")}</button>
      </div>}
      {restorePhase === "outcome_unknown" && pendingRestore && <button type="button" className="button primary" onClick={() => void retryPendingRestore()}>
        {t("Retry the same Restore request")}</button>}
      {restorePhase === "stale" && <button type="button" className="button secondary" onClick={() => void refreshRestorePreview()}>
        {t("Get a fresh Preview")}</button>}
      {restorePhase === "no_change" && restorePreview?.status === "no_change" && <p role="status">{t("This domain already matches the historical state. Nothing was changed.")}</p>}
      {restorePhase === "completed" && restoreResult?.status === "restored" && <p className="restore-complete-detail">{t("Restore completed for this domain only.")}</p>}
    </section></div>}
  </section>;
}
