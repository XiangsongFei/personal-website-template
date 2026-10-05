import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityLogEvent, ActivityLogFilters, ActivityLogV13CCursor, ActivityLogV13CEvent, ActivityLogV13CFilters, ResumeRepository } from "./data/resumeRepository";
import { formatBeijingTimestamp } from "./overviewFormat";
import { useUiLocale } from "./uiLocale";

const PAGE_SIZE = 25;
const EMPTY_FILTERS: ActivityLogV13CFilters = { eventFilter: "all", section: "", operation: "", actorEmail: "", dateFrom: null, dateToExclusive: null, search: "" };
type ActivityLogDraft = { eventFilter: ActivityLogV13CFilters["eventFilter"]; section: string; operation: string; actorEmail: string; from: string; through: string; search: string };
const EMPTY_DRAFT: ActivityLogDraft = { eventFilter: "all", section: "", operation: "", actorEmail: "", from: "", through: "", search: "" };
const fields: Record<string, string> = { text_zh: "Chinese text", text_en: "English text", position: "Order" };
const sections: Record<string, string> = {
  introduction: "Introduction", education: "Education", experience: "Experience", awards: "Awards", skills: "Skills",
  contact: "Contact", projects: "Projects", website_links: "Website & Links", profile: "Profile", files: "Files",
};
const operations: Record<ActivityLogEvent["operation"], string> = {
  create: "Create", update: "Update", delete: "Delete", reorder: "Reorder", upload: "Upload", remove: "Remove",
};
const failureStages: Record<string, string> = {
  trusted_context_validation: "Trusted context validation",
  idempotency: "Idempotency",
  database_validation: "Database validation",
  write_configuration: "Write configuration",
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

type AwardV2 = { id: string; position: number; zh: { name: string; year: string }; en: { name: string; year: string } };
export type AwardActivityLine = { kind: "Added" | "Updated" | "Removed" | "Reordered"; label: string; locale?: "Chinese" | "English"; field?: "Award name" | "Year"; before?: string; after?: string };
function awardRows(value: unknown): AwardV2[] | null {
  if (!Array.isArray(value)) return null;
  return value as AwardV2[];
}
export function describeAwardsActivity(event: ActivityLogV13CEvent): AwardActivityLine[] {
  if (event.eventSource !== "activity" || event.payloadVersion !== 2 || event.entityType !== "award_list") return [];
  const raw = event.changes.awards as { before?: unknown; after?: unknown } | undefined;
  const before = awardRows(raw?.before); const after = awardRows(raw?.after);
  if (!before || !after) return [];
  const beforeById = new Map(before.map(item => [item.id, item])); const afterById = new Map(after.map(item => [item.id, item]));
  const label = (item: AwardV2) => item.zh.name || item.en.name || "Award";
  const lines: AwardActivityLine[] = [];
  for (const item of after) if (!beforeById.has(item.id)) lines.push({ kind: "Added", label: label(item) });
  for (const item of before) if (!afterById.has(item.id)) lines.push({ kind: "Removed", label: label(item) });
  for (const item of after) {
    const old = beforeById.get(item.id);
    if (!old) continue;
    for (const locale of ["zh", "en"] as const) for (const field of ["name", "year"] as const) {
      if (old[locale][field] !== item[locale][field]) lines.push({ kind: "Updated",
        label: label(item), locale: locale === "zh" ? "Chinese" : "English", field: field === "name" ? "Award name" : "Year",
        before: old[locale][field], after: item[locale][field] });
    }
  }
  const shared = new Set([...beforeById.keys()].filter(id => afterById.has(id)));
  const priorSequence = before.filter(item => shared.has(item.id)).map(item => item.id);
  const nextSequence = after.filter(item => shared.has(item.id)).map(item => item.id);
  if (priorSequence.some((id, index) => id !== nextSequence[index])) lines.push({ kind: "Reordered", label: "Awards" });
  return lines;
}

export type CollectionActivityLine = { kind: "Added" | "Updated" | "Removed" | "Reordered"; label: string; locale?: "Chinese" | "English"; field?: string; before?: string; after?: string };
type AggregateRow = { id: string; position: number; zh: Record<string, unknown>; en: Record<string, unknown>; entry_type?: string; education_category?: string | null };
function aggregateRows(value: unknown): AggregateRow[] | null {
  if (!Array.isArray(value) || value.length > 16 || value.some(item => !item || typeof item !== "object"
    || typeof (item as Record<string, unknown>).id !== "string" || !Number.isInteger((item as Record<string, unknown>).position)
    || !(item as Record<string, unknown>).zh || !(item as Record<string, unknown>).en)) return null;
  return value as AggregateRow[];
}
export function describeExperienceSkillsActivity(event: ActivityLogV13CEvent): CollectionActivityLine[] {
  const domain = event.section === "experience" && event.entityType === "experience_list" ? "experience"
    : event.section === "skills" && event.entityType === "skill_group_list" ? "skills"
      : event.section === "education" && event.entityType === "education_list" ? "education" : null;
  if (event.eventSource !== "activity" || event.payloadVersion !== 2 || !domain) return [];
  const change = event.changes[domain] as { before?: unknown; after?: unknown } | undefined;
  const before = aggregateRows(change?.before); const after = aggregateRows(change?.after);
  if (!before || !after) return [];
  const beforeById = new Map(before.map(item => [item.id, item])); const afterById = new Map(after.map(item => [item.id, item]));
  const label = (item: AggregateRow) => domain === "experience"
    ? String(item.zh.organization || item.en.organization || "Experience")
    : domain === "education" ? String(item.zh.title || item.en.title || "Education")
      : String(item.zh.title || item.en.title || "Skill group");
  const fieldNames = domain === "experience"
    ? ["organization", "title", "period", "description", "location"]
    : domain === "education" ? ["title", "program", "period", "grade", "course_title", "course_description", "custom_category_label"]
      : ["title", "items"];
  const displayNames: Record<string, string> = domain === "experience"
    ? { organization: "Experience organization", title: "Experience title", period: "Experience period", description: "Experience description", location: "Experience location" }
    : domain === "education"
      ? { title: "Education title", program: "Education program", period: "Education period", grade: "Education grade",
        course_title: "Education course title", course_description: "Education course description", custom_category_label: "Education custom category" }
      : { title: "Skill group title", items: "Skill group items" };
  const lines: CollectionActivityLine[] = [];
  for (const item of after) if (!beforeById.has(item.id)) lines.push({ kind: "Added", label: label(item) });
  for (const item of before) if (!afterById.has(item.id)) lines.push({ kind: "Removed", label: label(item) });
  for (const item of after) {
    const old = beforeById.get(item.id);
    if (!old) continue;
    for (const locale of ["zh", "en"] as const) for (const field of fieldNames) {
      const oldValue = old[locale][field]; const newValue = item[locale][field];
      if (oldValue !== newValue) lines.push({ kind: "Updated", label: label(item), locale: locale === "zh" ? "Chinese" : "English",
        field: displayNames[field], before: oldValue === null ? "null" : String(oldValue ?? ""), after: newValue === null ? "null" : String(newValue ?? "") });
    }
  }
  const shared = new Set([...beforeById.keys()].filter(id => afterById.has(id)));
  const priorSequence = before.filter(item => shared.has(item.id)).map(item => item.id);
  const nextSequence = after.filter(item => shared.has(item.id)).map(item => item.id);
  if (priorSequence.some((id, index) => id !== nextSequence[index])) lines.push({ kind: "Reordered", label: domain === "experience" ? "Experience" : domain === "education" ? "Education" : "Skills" });
  if (domain === "education" && before.some(old => afterById.has(old.id) && old.education_category !== afterById.get(old.id)?.education_category)) {
    lines.push({ kind: "Updated", label: "Education", field: "Education category" });
  }
  if (domain === "education" && before.some(old => afterById.has(old.id) && old.entry_type !== afterById.get(old.id)?.entry_type)) {
    lines.push({ kind: "Updated", label: "Education", field: "Education entry type" });
  }
  return lines;
}

type ProjectV2Row = { id: string; position: number; zh: Record<string, unknown>; en: Record<string, unknown>; methods: { zh: Array<{ id: string; position: number; value: string }>; en: Array<{ id: string; position: number; value: string }> } };
function projectRows(value: unknown): ProjectV2Row[] | null {
  if (!Array.isArray(value) || value.length > 16 || value.some(item => !item || typeof item !== "object")) return null;
  return value as ProjectV2Row[];
}
export function describeProjectsActivity(event: ActivityLogV13CEvent): CollectionActivityLine[] {
  if (event.eventSource !== "activity" || event.payloadVersion !== 2 || event.section !== "projects" || event.entityType !== "project_list") return [];
  const change = event.changes.projects as { before?: unknown; after?: unknown } | undefined;
  const before = projectRows(change?.before); const after = projectRows(change?.after);
  if (!before || !after) return [];
  const beforeById = new Map(before.map(item => [item.id, item])); const afterById = new Map(after.map(item => [item.id, item]));
  const label = (item: ProjectV2Row) => String(item.zh.title || item.en.title || "Project");
  const lines: CollectionActivityLine[] = [];
  for (const item of after) if (!beforeById.has(item.id)) lines.push({ kind: "Added", label: label(item) });
  for (const item of before) if (!afterById.has(item.id)) lines.push({ kind: "Removed", label: label(item) });
  const names: Record<string, string> = { title: "Project title", subtitle: "Project subtitle", period: "Project period", description: "Project description", href: "Project URL" };
  for (const item of after) {
    const old = beforeById.get(item.id); if (!old) continue;
    for (const locale of ["zh", "en"] as const) for (const field of Object.keys(names)) if (old[locale]?.[field] !== item[locale]?.[field])
      lines.push({ kind: "Updated", label: label(item), locale: locale === "zh" ? "Chinese" : "English", field: names[field], before: String(old[locale]?.[field] ?? ""), after: String(item[locale]?.[field] ?? "") });
    for (const locale of ["zh", "en"] as const) {
      const oldMethods = old.methods[locale] ?? []; const nextMethods = item.methods[locale] ?? [];
      const oldById = new Map(oldMethods.map(method => [method.id, method])); const nextById = new Map(nextMethods.map(method => [method.id, method]));
      for (const method of nextMethods) if (!oldById.has(method.id)) lines.push({ kind: "Added", label: `${label(item)} · ${locale === "zh" ? "Chinese" : "English"} · Project method`, after: method.value });
      for (const method of oldMethods) if (!nextById.has(method.id)) lines.push({ kind: "Removed", label: `${label(item)} · ${locale === "zh" ? "Chinese" : "English"} · Project method`, before: method.value });
      for (const method of nextMethods) { const prior = oldById.get(method.id); if (prior && prior.value !== method.value) lines.push({ kind: "Updated", label: label(item), locale: locale === "zh" ? "Chinese" : "English", field: "Project method", before: prior.value, after: method.value }); }
      const shared = new Set([...oldById.keys()].filter(id => nextById.has(id)));
      if (oldMethods.filter(method => shared.has(method.id)).some((method, index) => nextMethods.filter(value => shared.has(value.id))[index]?.id !== method.id))
        lines.push({ kind: "Reordered", label: `${label(item)} · ${locale === "zh" ? "Chinese" : "English"} · Project methods` });
    }
  }
  const shared = new Set([...beforeById.keys()].filter(id => afterById.has(id)));
  if (before.filter(item => shared.has(item.id)).some((item, index) => after.filter(value => shared.has(value.id))[index]?.id !== item.id)) lines.push({ kind: "Reordered", label: "Projects" });
  return lines;
}

type ContactV2Item = { id: string; position: number; status_type?: string; zh: { title: string; detail: string }; en: { title: string; detail: string } };
type ContactV2Aggregate = { translations: { zh: { contact_label: string; availability: string }; en: { contact_label: string; availability: string } }; focus: ContactV2Item[]; status: ContactV2Item[] };
export function describeContactActivity(event: ActivityLogV13CEvent): CollectionActivityLine[] {
  if (event.eventSource !== "activity" || event.payloadVersion !== 2 || event.section !== "contact" || event.entityType !== "contact_section") return [];
  const change = event.changes.contact as { before?: unknown; after?: unknown } | undefined;
  if (!change?.before || typeof change.before !== "object" || !change.after || typeof change.after !== "object") return [];
  const before = change.before as ContactV2Aggregate; const after = change.after as ContactV2Aggregate;
  const lines: CollectionActivityLine[] = [];
  for (const locale of ["zh", "en"] as const) for (const field of ["contact_label", "availability"] as const) {
    const oldValue = before.translations?.[locale]?.[field]; const newValue = after.translations?.[locale]?.[field];
    if (oldValue !== newValue && typeof oldValue === "string" && typeof newValue === "string") lines.push({ kind: "Updated",
      label: "Contact", locale: locale === "zh" ? "Chinese" : "English", field: field === "contact_label" ? "Contact label" : "Availability", before: oldValue, after: newValue });
  }
  for (const kind of ["focus", "status"] as const) {
    const oldItems = before[kind]; const nextItems = after[kind];
    if (!Array.isArray(oldItems) || !Array.isArray(nextItems)) return [];
    const oldById = new Map(oldItems.map(item => [item.id, item])); const nextById = new Map(nextItems.map(item => [item.id, item]));
    const label = (item: ContactV2Item) => String(item.zh.title || item.en.title || (kind === "focus" ? "Focus" : "Status"));
    for (const item of nextItems) if (!oldById.has(item.id)) lines.push({ kind: "Added", field: kind === "focus" ? "Focus entry" : "Status entry", label: label(item) });
    for (const item of oldItems) if (!nextById.has(item.id)) lines.push({ kind: "Removed", field: kind === "focus" ? "Focus entry" : "Status entry", label: label(item) });
    for (const item of nextItems) {
      const prior = oldById.get(item.id); if (!prior) continue;
      for (const locale of ["zh", "en"] as const) for (const field of ["title", "detail"] as const) {
        if (prior[locale]?.[field] !== item[locale]?.[field]) lines.push({ kind: "Updated", label: label(item), locale: locale === "zh" ? "Chinese" : "English",
          field: kind === "focus" ? field === "title" ? "Focus title" : "Focus detail" : field === "title" ? "Status title" : "Status detail",
          before: prior[locale]?.[field] ?? "", after: item[locale]?.[field] ?? "" });
      }
      if (kind === "status" && prior.status_type !== item.status_type) lines.push({ kind: "Updated", label: label(item), field: "Status type", before: prior.status_type ?? "", after: item.status_type ?? "" });
    }
    const shared = new Set([...oldById.keys()].filter(id => nextById.has(id)));
    const oldOrder = oldItems.filter(item => shared.has(item.id)).map(item => item.id);
    const nextOrder = nextItems.filter(item => shared.has(item.id)).map(item => item.id);
    if (oldOrder.some((id, index) => id !== nextOrder[index])) lines.push({ kind: "Reordered", label: kind === "focus" ? "Current Focus" : "Current Status" });
  }
  return lines;
}

function approximateIpLocation(event: Pick<ActivityLogEvent, "city" | "region" | "countryCode" | "ipNetwork">): string | null {
  const geographicParts = [event.city, event.region, event.countryCode].map(value => value?.trim() ?? "").filter(Boolean);
  const network = event.ipNetwork?.trim() ?? "";
  const location = geographicParts.join(", ");
  if (location && network) return `${location} · ${network}`;
  return location || network || null;
}

export function ActivityLogPage({ resumeId, repository }: { resumeId: string | null; repository: ResumeRepository | null }) {
  const { t } = useUiLocale();
  const [events, setEvents] = useState<ActivityLogV13CEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState<ActivityLogDraft>(EMPTY_DRAFT);
  const [appliedFilters, setAppliedFilters] = useState<ActivityLogV13CFilters>(EMPTY_FILTERS);
  const [filterError, setFilterError] = useState(false);
  const authorizedTargetChecked = useRef(false);
  const cursorRef = useRef<ActivityLogV13CCursor | undefined>(undefined);
  const generationRef = useRef(0);
  const activeFiltersRef = useRef<ActivityLogV13CFilters>(EMPTY_FILTERS);

  const load = useCallback(async (append: boolean, filters = activeFiltersRef.current) => {
    const generation = generationRef.current;
    if (!resumeId || !repository?.loadActivityLogAuthorizedTargets || !repository.loadActivityLogPageV13C) {
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
      const page = await repository.loadActivityLogPageV13C(resumeId, PAGE_SIZE, filters, cursor);
      if (generation !== generationRef.current) return;
      setEvents(current => append ? [...current, ...page] : page);
      setHasMore(page.length === PAGE_SIZE);
      const last = page.at(-1);
      cursorRef.current = last ? { occurredAt: last.occurredAt, id: last.id, sourceRank: last.sourceRank } : undefined;
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

  const apply = (next: ActivityLogV13CFilters) => {
    generationRef.current += 1;
    activeFiltersRef.current = next;
    cursorRef.current = undefined;
    setAppliedFilters(next); setFilterError(false); setEvents([]); setHasMore(false);
    void load(false, next);
  };
  const applyDraft = () => {
    const dates = beijingDateRange(draft.from, draft.through);
    if (!dates) { setFilterError(true); return; }
    apply({ eventFilter: draft.eventFilter, section: draft.section, operation: draft.operation as ActivityLogFilters["operation"], actorEmail: draft.actorEmail.trim(), ...dates, search: draft.search.trim() });
  };
  const clear = () => {
    setDraft(EMPTY_DRAFT);
    apply(EMPTY_FILTERS);
  };
  const filtered = Boolean(appliedFilters.eventFilter !== "all" || appliedFilters.section || appliedFilters.operation || appliedFilters.actorEmail || appliedFilters.dateFrom || appliedFilters.dateToExclusive || appliedFilters.search);

  return <section className="page-section activity-log-page">
    <div className="page-heading"><p className="eyebrow">{t("Admin tools")}</p><h1>{t("Activity Log")}</h1><p>{t("Review recorded changes to this resume.")}</p></div>
    <form className="activity-log-filters" onSubmit={event => { event.preventDefault(); applyDraft(); }}>
      <label>{t("Event type")}<select value={draft.eventFilter} onChange={event => setDraft(current => ({ ...current, eventFilter: event.target.value as ActivityLogV13CFilters["eventFilter"] }))}>
        <option value="all">{t("All events")}</option><option value="successful">{t("Successful activity")}</option><option value="rejected">{t("Rejected operations")}</option>
      </select></label>
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
            <ol className="activity-log-list">{events.map(event => <li className={`activity-log-event${event.eventSource === "system" ? " activity-log-rejected" : ""}`} key={`${event.eventSource}:${event.id}`}>
              <div className="activity-log-event-heading"><div><h2>{t(sections[event.section] ?? "Unknown section")}</h2><p>{t(operations[event.operation] ?? "Update")} {t("by")} {t(event.actorRole === "qa" ? "QA" : "Owner")} · {event.actorEmail ?? t("Unknown account")}</p></div>
                <time dateTime={event.occurredAt}>{formatBeijingTimestamp(event.occurredAt)}</time></div>
              {event.eventSource === "system" && <>
                <p className="activity-log-outcome">{t("Rejected operation")}</p>
                <dl className="activity-log-failure-metadata">
                  <div><dt>{t("Failure stage")}</dt><dd>{t(failureStages[event.failureStage] ?? event.failureStage)}</dd></div>
                  <div><dt>{t("Failure code")}</dt><dd><code>{event.failureCode}</code></dd></div>
                  <div><dt>{t("Request ID")}</dt><dd><code>{event.requestId}</code></dd></div>
                </dl>
              </>}
              {approximateIpLocation(event) && <p className="activity-log-location" title={t("Approximate IP-derived location from the event-time network; not precise or GPS location.")}>
                <span>{t("Approximate IP location: ")}</span>{approximateIpLocation(event)}<span className="visually-hidden"> {t("Approximate IP-derived location")}</span>
              </p>}
              {event.eventSource === "activity" && Object.keys(event.changes).length > 0 && <details><summary>{t("View changed fields")} ({Object.keys(event.changes).length})</summary>
                {event.payloadVersion === 2 && event.entityType === "award_list" ? <dl>{describeAwardsActivity(event).map((line,index) => <div className="activity-log-change" key={`${line.kind}-${index}`}>
                  <dt>{t(line.kind)}</dt><dd><span>{line.locale ? `${t(line.locale)} · ${t(line.field ?? "Award name")} · ` : ""}{t(line.label)}{line.before !== undefined ? ` · ${t("Before")}: ${line.before} · ${t("After")}: ${line.after}` : ""}</span></dd>
              </div>)}</dl> : event.payloadVersion === 2 && event.entityType === "contact_section" ? <dl>{describeContactActivity(event).map((line,index) => <div className="activity-log-change" key={`${line.kind}-${index}`}>
                  <dt>{t(line.kind)}</dt><dd><span>{line.field ? `${line.locale ? `${t(line.locale)} · ` : ""}${t(line.field)} · ` : ""}{t(line.label)}{line.before !== undefined ? ` · ${t("Before")}: ${line.before}` : ""}{line.after !== undefined ? ` · ${t("After")}: ${line.after}` : ""}</span></dd>
              </div>)}</dl> : event.payloadVersion === 2 && event.entityType === "project_list" ? <dl>{describeProjectsActivity(event).map((line,index) => <div className="activity-log-change" key={`${line.kind}-${index}`}>
                  <dt>{t(line.kind)}</dt><dd><span>{line.locale ? `${t(line.locale)} · ${t(line.field ?? "Project method")} · ` : ""}{t(line.label)}{line.before !== undefined ? ` · ${t("Before")}: ${line.before}` : ""}{line.after !== undefined ? ` · ${t("After")}: ${line.after}` : ""}</span></dd>
              </div>)}</dl> : event.payloadVersion === 2 && (event.entityType === "experience_list" || event.entityType === "skill_group_list" || event.entityType === "education_list")
                  ? <dl>{describeExperienceSkillsActivity(event).map((line,index) => <div className="activity-log-change" key={`${line.kind}-${index}`}>
                    <dt>{t(line.kind)}</dt><dd><span>{line.locale ? `${t(line.locale)} · ${t(line.field ?? "Experience title")} · ` : ""}{t(line.label)}{line.before !== undefined ? ` · ${t("Before")}: ${line.before} · ${t("After")}: ${line.after}` : ""}</span></dd>
                  </div>)}</dl> : <dl>{Object.entries(event.changes).map(([key, change]) => <div className="activity-log-change" key={key}>
                  <dt>{t(fields[key] ?? key)}</dt><dd><span>{t("Before")}: {fieldValues(change.before, t)}</span><span>{t("After")}: {fieldValues(change.after, t)}</span></dd>
                </div>)}</dl>}</details>}
            </li>)}</ol>
            {hasMore && <button className="button secondary activity-log-more" type="button" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? t("Loading…") : t("Load more")}</button>}
          </>}
  </section>;
}
