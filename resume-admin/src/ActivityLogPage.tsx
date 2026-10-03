import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityLogCursor, ActivityLogEvent, ResumeRepository } from "./data/resumeRepository";
import { formatBeijingTimestamp } from "./overviewFormat";
import { useUiLocale } from "./uiLocale";

const PAGE_SIZE = 25;
const fields: Record<string, string> = { text_zh: "Chinese text", text_en: "English text", position: "Order" };
function fieldValues(value: unknown, t: (text: string) => string) {
  if (!Array.isArray(value)) return String(value ?? t("Empty"));
  if (value.length === 0) return t("Empty");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || !("value" in entry)) return "";
    return `${t("Paragraph")} ${index + 1}: ${String((entry as { value: unknown }).value ?? t("Empty"))}`;
  }).filter(Boolean).join("; ");
}

function approximateIpLocation(event: ActivityLogEvent): string | null {
  const geographicParts = [event.city, event.region, event.countryCode]
    .map(value => value?.trim() ?? "")
    .filter(Boolean);
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
  const authorizedTargetChecked = useRef(false);
  const cursorRef = useRef<ActivityLogCursor | undefined>(undefined);
  const load = useCallback(async (append: boolean) => {
    if (!resumeId || !repository?.loadActivityLogAuthorizedTargets || !repository.loadActivityLogPage) { setError(true); setLoading(false); return; }
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(false);
    try {
      if (!authorizedTargetChecked.current) {
        const targets = await repository.loadActivityLogAuthorizedTargets();
        if (!targets.some(target => target.resumeId === resumeId)) throw new Error("Activity Log target is not authorized");
        authorizedTargetChecked.current = true;
      }
      const page = await repository.loadActivityLogPage(resumeId, PAGE_SIZE, append ? cursorRef.current : undefined);
      setEvents(current => append ? [...current, ...page] : page);
      setHasMore(page.length === PAGE_SIZE);
      const last = page.at(-1);
      if (last) {
        const nextCursor = { occurredAt: last.occurredAt, id: last.id };
        cursorRef.current = nextCursor;
      }
    } catch { setError(true); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [resumeId, repository]);
  useEffect(() => {
    cursorRef.current = undefined;
    setEvents([]);
    setHasMore(false);
    authorizedTargetChecked.current = false;
    void load(false);
  }, [load]);
  return <section className="page-section activity-log-page">
    <div className="page-heading"><p className="eyebrow">{t("Admin tools")}</p><h1>{t("Activity Log")}</h1><p>{t("Review recorded changes to this resume.")}</p></div>
    {loading ? <p className="activity-log-state" role="status">{t("Loading Activity Log…")}</p>
      : error ? <div className="activity-log-state" role="alert"><p>{t("Unable to load Activity Log.")}</p><button className="button secondary" type="button" onClick={() => void load(false)}>{t("Retry")}</button></div>
        : events.length === 0 ? <p className="activity-log-state">{t("No activity has been recorded yet.")}</p>
          : <>
            <ol className="activity-log-list">{events.map(event => <li className="activity-log-event" key={event.id}>
              <div className="activity-log-event-heading"><div><h2>{t("Introduction")}</h2><p>{t(event.operation === "create" ? "Created" : event.operation === "delete" ? "Deleted" : event.operation === "reorder" ? "Reordered" : "Updated")} {t("by")} {t(event.actorRole === "qa" ? "QA" : "Owner")} · {event.actorEmail ?? t("Unknown account")}</p></div>
                <time dateTime={event.occurredAt}>{formatBeijingTimestamp(event.occurredAt)}</time></div>
              {approximateIpLocation(event) && <p className="activity-log-location" title={t("Approximate IP-derived location from the event-time network; not precise or GPS location.")}>
                <span>{t("IP location: ")}</span>{approximateIpLocation(event)}
                <span className="visually-hidden"> {t("Approximate IP-derived location")}</span>
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
