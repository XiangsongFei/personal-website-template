import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VersionHistoryPage } from "../src/VersionHistoryPage";
import type { ResumeRepository, VersionHistoryEntry, VersionHistoryPage as Page } from "../src/data/resumeRepository";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const resumeId = "qa-resume";
const baseEntry = (overrides: Partial<VersionHistoryEntry> = {}): VersionHistoryEntry => ({
  eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", occurredAt: "2026-10-07T12:00:00Z", actorAccountLabel: "QA account",
  actorRole: "qa", domain: "awards", operation: "update", payloadVersion: 1, entityType: "award_entry", entityId: "award-1",
  comparison: { kind: "entity_fields", changes: { year: { before: "2025", after: "2026" } } }, ...overrides,
});
const page = (entries: VersionHistoryEntry[], hasMore = false, nextCursor: Page["nextCursor"] = null): Page => ({ entries, hasMore, nextCursor });
function renderPage(repository: ResumeRepository) {
  return render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={repository} /></UiLocaleProvider>);
}
const repositoryWith = (loadVersionHistoryPage: NonNullable<ResumeRepository["loadVersionHistoryPage"]>) => ({ loadVersionHistoryPage } as ResumeRepository);

afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Version History page", () => {
  it("renders one V1 event using only fields recorded by the typed comparison", async () => {
    const entry = { ...baseEntry(), actor_user_id: "private-user-id", ip_network: "192.0.2.0/24", request_id: "private-request", entity_snapshot: { secret: "must-not-render" } } as VersionHistoryEntry;
    const load = vi.fn().mockResolvedValue(page([entry]));
    renderPage(repositoryWith(load));
    expect(await screen.findByRole("heading", { name: "Awards", level: 2 })).toBeTruthy();
    expect(screen.getByText("2025")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
    expect(document.body.textContent).not.toContain("must-not-render");
    expect(document.body.textContent).not.toContain("192.0.2.0/24");
    expect(document.body.textContent).not.toContain("private-request");
    expect(load).toHaveBeenCalledWith(resumeId, 25);
    expect(screen.queryByRole("button", { name: /restore|rollback/i })).toBeNull();
  });

  it("renders V2 aggregate before/after data while preserving IDs, array order, and locales", async () => {
    const before = [{ id: "stable-b", position: 0, zh: { title: "旧中文" }, en: { title: "Old English" } }];
    const after = [
      { id: "stable-a", position: 0, zh: { title: "新增中文" }, en: { title: "New English" } },
      { id: "stable-b", position: 1, zh: { title: "新中文" }, en: { title: "Newer English" } },
    ];
    const entry = baseEntry({ eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before, after } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findByText("stable-a")).toBeTruthy();
    expect(screen.getAllByText("stable-b")).toHaveLength(2);
    expect(screen.getByText("新增中文")).toBeTruthy();
    expect(screen.getByText("New English")).toBeTruthy();
    const listItems = Array.from(document.querySelectorAll(".version-history-aggregate section:last-child .version-history-value-list > li"));
    expect(listItems).toHaveLength(2);
    expect(listItems[0]?.textContent).toContain("stable-a");
    expect(listItems[1]?.textContent).toContain("stable-b");
  });

  it("shows only safe generic context for unknown or malformed comparisons", async () => {
    const entry = baseEntry({ domain: "files", entityType: "future_file_event", payloadVersion: 99, entityId: null, comparison: { kind: "unavailable" } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findByText("Recorded change details are unavailable for this entry.")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByText("Recorded item")).toBeTruthy();
    expect(document.body.textContent).not.toContain("future_file_event");
    expect(document.body.textContent).not.toContain("99");
  });

  it("treats Files references as text with an availability note and no file actions", async () => {
    const entry = baseEntry({ domain: "files", entityType: "resume_file", payloadVersion: 1, entityId: null,
      comparison: { kind: "entity_fields", changes: { locale: { before: "zh", after: "en" }, object_key: { before: "qa/zh/old.pdf", after: "qa/en/new.pdf" } } } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findByText("Historical file reference recorded; file availability is unknown.")).toBeTruthy();
    expect(screen.getByText("qa/zh/old.pdf")).toBeTruthy();
    expect(screen.getByText("qa/en/new.pdf")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /restore|download|preview/i })).toBeNull();
  });

  it("keeps historical profile-photo references informational only", async () => {
    const entry = baseEntry({ domain: "profile", entityType: "profile_image", entityId: null,
      comparison: { kind: "entity_fields", changes: { object_key: { before: "profile/old.jpg", after: "profile/new.jpg" } } } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findByText("Historical photo reference recorded; file availability is unknown.")).toBeTruthy();
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("profile/old.jpg");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /restore|download|preview/i })).toBeNull();
  });

  it("provides loading and empty states", async () => {
    let resolve!: (value: Page) => void;
    const deferred = new Promise<Page>(yes => { resolve = yes; });
    renderPage(repositoryWith(vi.fn().mockReturnValue(deferred)));
    expect(screen.getByRole("status").textContent).toContain("Loading Version History");
    resolve(page([]));
    expect(await screen.findByText("No Version History entries have been recorded yet.")).toBeTruthy();
  });

  it("uses the server cursor and appends the next server page without re-sorting", async () => {
    const first = baseEntry({ eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", occurredAt: "2026-10-07T12:00:00Z" });
    const second = baseEntry({ eventId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", occurredAt: "2026-10-06T12:00:00Z" });
    const load = vi.fn().mockResolvedValueOnce(page([first], true, { occurredAt: first.occurredAt, eventId: first.eventId })).mockResolvedValueOnce(page([second]));
    renderPage(repositoryWith(load));
    expect(await screen.findByText(/QA account/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("2025");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith(resumeId, 25, { occurredAt: first.occurredAt, eventId: first.eventId });
    const eventIds = Array.from(document.querySelectorAll(".version-history-entry article h2"), item => item.id.replace("version-history-", ""));
    expect(eventIds).toEqual([first.eventId, second.eventId]);
  });

  it("shows a safe error and allows retry without exposing the thrown error", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("private token and raw payload")).mockResolvedValueOnce(page([baseEntry()]));
    renderPage(repositoryWith(load));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private token");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Awards", level: 2 })).toBeTruthy();
  });

  it("keeps a failed load-more recoverable while retaining already loaded entries", async () => {
    const first = baseEntry({ eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    const load = vi.fn().mockResolvedValueOnce(page([first], true, { occurredAt: first.occurredAt, eventId: first.eventId }))
      .mockRejectedValueOnce(new Error("private"))
      .mockResolvedValueOnce(page([baseEntry({ eventId: "ffffffff-ffff-4fff-8fff-ffffffffffff" })]));
    renderPage(repositoryWith(load));
    expect(await screen.findByRole("heading", { name: "Awards", level: 2 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.querySelectorAll(".version-history-entry")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading more" }));
    await waitFor(() => expect(document.querySelectorAll(".version-history-entry")).toHaveLength(2));
  });
});
