import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityLogCursor, ActivityLogEvent, ActivityLogFilters, ResumeRepository } from "./data/resumeRepository";
import { formatBeijingTimestamp } from "./overviewFormat";
import { useUiLocale } from "./uiLocale";

const PAGE_SIZE = 25;
const EMPTY_FILTERS: ActivityLogFilters = { section: "", operation: "", actorEmail: "", dateFrom: null, dateToExclusive: null, search: "" };
const EMPTY_DRAFT = { section: "", operation: "", actorEmail: "", from: "", through: "", search: "" };
const fields: Record<string, string> = { text_zh: "Chinese text", text_en: "English text", position: "Order" };
const sections: Record<string, string> = {
  introduction: "Introduction", education: "Education", experience: "Experience", awards: "Awards", skills: "Skills",
  contact: "Contact", projects: "Projects", website_links: "Website & Links", profile: "Profile", files: "Files",
};
const operations: Record<ActivityLogEvent["operation"], string> = {
  create: "Create", update: "Update", delete: "Delete", reorder: "Reorder", upload: "Upload", remove: "Remove",
};

export function beijingDateStartUtc(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [, year, month, day] = match;
  const yearNumber = Number(year);
  if (yearNumber < 2) return null;
  const check = new Date(0);
  check.setUTCHours(0, 0, 0, 0);
  check.setUTCFullYear(yearNumber, Number(month) - 1, Number(day));
  const utc = check.getTime();
  if (check.getUTCFullYear() !== yearNumber || check.getUTCMonth() !== Number(month) - 1 || check.getUTCDate() !== Number(day)) return null;
  return new Date(utc - 8 * 60 * 60 * 1000).toISOString();
}

export function beijingDateRange(from: string, through: string): { dateFrom: string | null; dateToExclusive: string | null } | null {
  const dateFrom = from ? beijingDateStartUtc(from) : null;
  const throughStart = through ? beijingDateStartUtc(through) : null;
  if ((from && !dateFrom) || (through && !throughStart)) return null;
  let dateToExclusive: string | null = null;
  if (throughStart) {
    const nextDay = new Date(throughStart);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    dateToExclusive = nextDay.toISOString();
  }
  if (dateFrom && dateToExclusive && dateToExclusive <= dateFrom) return null;
  return { dateFrom, dateToExclusive };
}

function fieldValues(value: unknown, t: (text: string) => string) {
  if (!Array.isArray(value)) return String(value ?? t("Empty"));
  if (value.length === 0) return t("Empty");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || !("value" in entry)) return "";
    return `${t("Paragraph")} ${index + 1}: ${String((entry as { value: unknown }).value ?? t("Empty"))}`;
  }).filter(Boolean).join("; ");
}

function approximateIpLocation(event: ActivityLogEvent): string | null {
  const geographicParts = [event.city, event.region, event.countryCode].map(value => value?.trim() ?? "").filter(Boolean);
  const network = event.ipNetwork?.trim() ?? "";
  const location = geographicParts.join(", ");
  if (location && network) return `${location} · ${network}`;
  return location || network || null;
}

export function ActivityLogPage({ resumeId, repository }: { resumeId: string | null; repository: ResumeRepository | null }) {
  const { t } = useUiLocale();
  const [events, setEvents] = useState<ActivityLogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [appliedFilters, setAppliedFilters] = useState<ActivityLogFilters>(EMPTY_FILTERS);
  const [filterError, setFilterError] = useState(false);
  const authorizedTargetChecked = useRef(false);
  const cursorRef = useRef<ActivityLogCursor | undefined>(undefined);
  const generationRef = useRef(0);
  const activeFiltersRef = useRef<ActivityLogFilters>(EMPTY_FILTERS);

  const load = useCallback(async (append: boolean, filters = activeFiltersRef.current) => {
    const generation = generationRef.current;
    if (!resumeId || !repository?.loadActivityLogAuthorizedTargets || !repository.loadActivityLogPageV12) {
      setError(true); setLoading(false); return;
    }
    if (append) setLoadingMore(true);
    else { setLoading(true); setLoadingMore(false); }
    setError(false);
    try {
      if (!authorizedTargetChecked.current) {
        const targets = await repository.loadActivityLogAuthorizedTargets();
        if (generation !== generationRef.current) return;
        if (!targets.some(target => target.resumeId === resumeId)) throw new Error("Activity Log target is not authorized");
        authorizedTargetChecked.current = true;
      }
      const cursor = append ? cursorRef.current : undefined;
      const page = await repository.loadActivityLogPageV12(resumeId, PAGE_SIZE, filters, cursor);
      if (generation !== generationRef.current) return;
      setEvents(current => append ? [...current, ...page] : page);
      setHasMore(page.length === PAGE_SIZE);
      const last = page.at(-1);
      cursorRef.current = last ? { occurredAt: last.occurredAt, id: last.id } : undefined;
    } catch {
      if (generation === generationRef.current) setError(true);
    } finally {
      if (generation === generationRef.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [resumeId, repository]);

  useEffect(() => {
    generationRef.current += 1;
    activeFiltersRef.current = EMPTY_FILTERS;
    cursorRef.current = undefined;
    authorizedTargetChecked.current = false;
    setDraft(EMPTY_DRAFT); setAppliedFilters(EMPTY_FILTERS); setFilterError(false);
    setEvents([]); setHasMore(false);
    void load(false, EMPTY_FILTERS);
    return () => { generationRef.current += 1; };
  }, [load]);

  const apply = (next: ActivityLogFilters) => {
    generationRef.current += 1;
    activeFiltersRef.current = next;
    cursorRef.current = undefined;
    setAppliedFilters(next); setFilterError(false); setEvents([]); setHasMore(false);
    void load(false, next);
  };
  const applyDraft = () => {
    const dates = beijingDateRange(draft.from, draft.through);
    if (!dates) { setFilterError(true); return; }
    apply({ section: draft.section, operation: draft.operation as ActivityLogFilters["operation"], actorEmail: draft.actorEmail.trim(), ...dates, search: draft.search.trim() });
  };
  const clear = () => {
    setDraft(EMPTY_DRAFT);
    apply(EMPTY_FILTERS);
  };
  const filtered = Boolean(appliedFilters.section || appliedFilters.operation || appliedFilters.actorEmail || appliedFilters.dateFrom || appliedFilters.dateToExclusive || appliedFilters.search);

  return <section className="page-section activity-log-page">
    <div className="page-heading"><p className="eyebrow">{t("Admin tools")}</p><h1>{t("Activity Log")}</h1><p>{t("Review recorded changes to this resume.")}</p></div>
    <form className="activity-log-filters" onSubmit={event => { event.preventDefault(); applyDraft(); }}>
      <label>{t("Section")}<select value={draft.section} onChange={event => setDraft(current => ({ ...current, section: event.target.value }))}>
        <option value="">{t("All sections")}</option>{Object.entries(sections).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
      </select></label>
      <label>{t("Operation")}<select value={draft.operation} onChange={event => setDraft(current => ({ ...current, operation: event.target.value }))}>
        <option value="">{t("All operations")}</option>{Object.entries(operations).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
      </select></label>
      <label>{t("Actor")}<input type="email" value={draft.actorEmail} onChange={event => setDraft(current => ({ ...current, actorEmail: event.target.value }))} /></label>
      <label>{t("From")}<input type="date" value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></label>
      <label>{t("Through")}<input type="date" value={draft.through} onChange={event => setDraft(current => ({ ...current, through: event.target.value }))} /></label>
      <label className="activity-log-search">{t("Search")}<input type="search" value={draft.search} maxLength={128} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} /></label>
      <div className="activity-log-filter-actions"><button className="button primary" type="submit">{t("Apply")}</button><button className="button secondary" type="button" onClick={clear}>{t("Clear")}</button></div>
      {filterError && <p className="activity-log-filter-error" role="alert">{t("Invalid date range.")}</p>}
    </form>
    {loading ? <p className="activity-log-state" role="status">{t("Loading Activity Log…")}</p>
      : error ? <div className="activity-log-state" role="alert"><p>{t("Unable to load Activity Log.")}</p><button className="button secondary" type="button" onClick={() => void load(false)}>{t("Retry")}</button></div>
        : events.length === 0 ? <p className="activity-log-state">{t(filtered ? "No activity matches these filters." : "No activity has been recorded yet.")}</p>
          : <>
            <ol className="activity-log-list">{events.map(event => <li className="activity-log-event" key={event.id}>
              <div className="activity-log-event-heading"><div><h2>{t(sections[event.section] ?? "Unknown section")}</h2><p>{t(operations[event.operation] ?? "Update")} {t("by")} {t(event.actorRole === "qa" ? "QA" : "Owner")} · {event.actorEmail ?? t("Unknown account")}</p></div>
                <time dateTime={event.occurredAt}>{formatBeijingTimestamp(event.occurredAt)}</time></div>
              {approximateIpLocation(event) && <p className="activity-log-location" title={t("Approximate IP-derived location from the event-time network; not precise or GPS location.")}>
                <span>{t("IP location: ")}</span>{approximateIpLocation(event)}<span className="visually-hidden"> {t("Approximate IP-derived location")}</span>
              </p>}
              {Object.keys(event.changes).length > 0 && <details><summary>{t("View changed fields")} ({Object.keys(event.changes).length})</summary>
                <dl>{Object.entries(event.changes).map(([key, change]) => <div className="activity-log-change" key={key}>
                  <dt>{t(fields[key] ?? key)}</dt><dd><span>{t("Before")}: {fieldValues(change.before, t)}</span><span>{t("After")}: {fieldValues(change.after, t)}</span></dd>
                </div>)}</dl></details>}
            </li>)}</ol>
            {hasMore && <button className="button secondary activity-log-more" type="button" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? t("Loading…") : t("Load more")}</button>}
          </>}
  </section>;
}
