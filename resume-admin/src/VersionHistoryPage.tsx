import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeRepository, VersionHistoryComparison, VersionHistoryDomain, VersionHistoryEntry, VersionHistoryJson, VersionHistoryPage as VersionHistoryPageResult } from "./data/resumeRepository";
import { formatBeijingTimestamp } from "./overviewFormat";
import { useUiLocale } from "./uiLocale";

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

function Comparison({ comparison, event, t }: { comparison: VersionHistoryComparison; event: VersionHistoryEntry; t: (value: string) => string }) {
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

export function VersionHistoryPage({ resumeId, repository }: { resumeId: string | null; repository: ResumeRepository | null }) {
  const { t } = useUiLocale();
  const [entries, setEntries] = useState<VersionHistoryEntry[]>([]);
  const [nextPage, setNextPage] = useState<VersionHistoryPageResult["nextCursor"]>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [moreError, setMoreError] = useState(false);
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
                <Comparison comparison={entry.comparison} event={entry} t={t} />
              </article>
            </li>)}</ol>
            {moreError && <div className="version-history-state" role="alert"><p>{t("Unable to load more Version History entries.")}</p><button className="button secondary" type="button" onClick={() => void loadMore()}>{t("Retry loading more")}</button></div>}
            {hasMore && <button className="button secondary version-history-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("Loading…") : t("Load more")}</button>}
          </>}
  </section>;
}
