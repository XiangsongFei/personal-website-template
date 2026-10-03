import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogPage, beijingDateRange, beijingDateStartUtc } from "../src/ActivityLogPage";
import type { ActivityLogEvent, ResumeRepository } from "../src/data/resumeRepository";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const resumeId = "qa-resume";
function event(id: string, changes: ActivityLogEvent["changes"] = {}): ActivityLogEvent {
  return { id, occurredAt: "2026-10-02T10:00:00Z", actorEmail: "qa@example.test", actorRole: "qa", operation: "update",
    section: "introduction", entityType: "introduction_paragraph", entityId: "introduction", entitySnapshot: { paragraphs: [] }, changes,
    ipNetwork: null, countryCode: null, region: null, city: null };
}
function withLocation(base: ActivityLogEvent, location: Partial<Pick<ActivityLogEvent, "ipNetwork" | "countryCode" | "region" | "city">>): ActivityLogEvent {
  return { ...base, ...location };
}
function visibleLocationText(): string {
  const row = document.querySelector(".activity-log-location");
  return row ? Array.from(row.childNodes).slice(0, 2).map(node => node.textContent ?? "").join("").trim() : "";
}
function renderPage(repository: ResumeRepository) {
  const compatible = { ...repository, loadActivityLogPageV12: vi.fn((id: string, size: number, _filters: unknown, cursor?: { occurredAt: string; id: string }) => repository.loadActivityLogPage!(id, size, cursor)) } as ResumeRepository;
  return { ...render(<UiLocaleProvider><ActivityLogPage resumeId={resumeId} repository={compatible} /></UiLocaleProvider>), repository: compatible };
}
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Activity Log page", () => {
  it.each([
    ["create", "Create"], ["update", "Update"], ["delete", "Delete"],
    ["reorder", "Reorder"], ["upload", "Upload"], ["remove", "Remove"],
  ] as const)("renders the %s operation distinctly", async (operation, label) => {
    const row = { ...event(`operation-${operation}`), operation };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([row]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByText(new RegExp(`${label} by QA`))).toBeTruthy();
  });

  it("renders the empty state", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([]) } as unknown as ResumeRepository;
    const view = renderPage(repository);
    expect(await screen.findByText("No activity has been recorded yet.")).toBeTruthy();
    expect(view.repository.loadActivityLogPageV12).toHaveBeenCalledWith(resumeId, 25, expect.objectContaining({ section: "", search: "" }), undefined);
  });

  it("shows actor snapshots and only field-level before/after changes in Chinese", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([event("event-1", {
      text_zh: { before: [{ id: "internal-row-id", value: "原中文" }], after: [{ id: "internal-row-id", value: "新中文" }] },
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByText("活动记录")).toBeTruthy();
    expect(screen.getByText(/QA.*qa@example\.test/)).toBeTruthy();
    fireEvent.click(screen.getByText(/查看变更字段/));
    expect(screen.getByText("中文内容")).toBeTruthy();
    expect(screen.getByText(/修改前: 段落 1: 原中文/)).toBeTruthy();
    expect(screen.getByText(/修改后: 段落 1: 新中文/)).toBeTruthy();
    expect(screen.queryByText("internal-row-id")).toBeNull();
  });

  it("supports keyset load more", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => event(`event-${index}`));
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([event("event-next")]) } as unknown as ResumeRepository;
    const view = renderPage(repository);
    await screen.findByText("Load more");
    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(repository.loadActivityLogPage).toHaveBeenCalledTimes(2));
    expect(view.repository.loadActivityLogPageV12).toHaveBeenNthCalledWith(2, resumeId, 25, expect.objectContaining({ section: "", operation: "" }), { occurredAt: firstPage[24].occurredAt, id: firstPage[24].id });
  });

  it("offers retry after read failure without displaying the raw error", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockRejectedValueOnce(new Error("private database details")).mockResolvedValueOnce([]) } as unknown as ResumeRepository;
    renderPage(repository);
    fireEvent.click(await screen.findByText("Retry"));
    expect(await screen.findByText("No activity has been recorded yet.")).toBeTruthy();
    expect(screen.queryByText("private database details")).toBeNull();
  });

  it("fails closed instead of using the unfiltered legacy reader when the V1.2 reader is missing", async () => {
    const repository = {
      loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
      loadActivityLogPage: vi.fn().mockResolvedValue([event("legacy-unfiltered-result")]),
    } as unknown as ResumeRepository;
    render(<UiLocaleProvider><ActivityLogPage resumeId={resumeId} repository={repository} /></UiLocaleProvider>);
    expect(await screen.findByText("Unable to load Activity Log.")).toBeTruthy();
    expect(repository.loadActivityLogPage).not.toHaveBeenCalled();
    expect(screen.queryByText("Update by QA · qa@example.test")).toBeNull();
  });

  it("shows all event-time location parts in order with the English label", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([withLocation(event("location-all", { text: { before: "Before", after: "After" } }), {
      city: "San Francisco", region: "California", countryCode: "US", ipNetwork: "203.0.113.0/24",
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText(/San Francisco, California, US/);
    expect(visibleLocationText()).toBe("IP location: San Francisco, California, US · 203.0.113.0/24");
    expect(document.querySelector(".activity-log-location")?.getAttribute("title")).toContain("not precise or GPS");
    expect(document.querySelector(".activity-log-location")?.closest("details")).toBeNull();
  });

  it("omits a missing region and uses the Chinese IP location label", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([withLocation(event("location-no-region"), {
      city: "Hong Kong", countryCode: "HK", ipNetwork: "188.253.112.0/24",
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText(/Hong Kong, HK/);
    expect(visibleLocationText()).toBe("IP 位置：Hong Kong, HK · 188.253.112.0/24");
  });

  it("shows geo-only metadata when there is no IP network", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([withLocation(event("location-geo-only"), {
      city: "San Francisco", region: "California", countryCode: "US",
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText(/San Francisco, California, US/);
    expect(visibleLocationText()).toBe("IP location: San Francisco, California, US");
  });

  it("shows only the IP network when geographic metadata is absent", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([withLocation(event("location-network-only"), {
      ipNetwork: "188.253.112.0/24",
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText("188.253.112.0/24");
    expect(visibleLocationText()).toBe("IP location: 188.253.112.0/24");
  });

  it("renders no location row for historical events whose four metadata fields are NULL", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([event("historical-no-location")]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText(/Update by QA/);
    expect(document.querySelector(".activity-log-location")).toBeNull();
    expect(screen.queryByText(/Unknown|未知|N\/A/)).toBeNull();
  });

  it("omits location components that are empty strings", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([withLocation(event("empty-location"), {
      city: "  ", region: "", countryCode: "", ipNetwork: "",
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText(/Update by QA/);
    expect(document.querySelector(".activity-log-location")).toBeNull();
  });

  it("keeps draft filters from querying until Apply and reuses applied filters for pagination", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => event(`filtered-${index}`));
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(firstPage).mockResolvedValueOnce([event("filtered-next")]) } as unknown as ResumeRepository;
    const view = renderPage(repository);
    await screen.findByText("Load more");
    const reader = vi.mocked(view.repository.loadActivityLogPageV12!);
    const callsBeforeDraft = reader.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "files" } });
    fireEvent.change(screen.getByLabelText("Operation"), { target: { value: "upload" } });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "annual report" } });
    expect(reader).toHaveBeenCalledTimes(callsBeforeDraft);
    fireEvent.click(screen.getByText("Apply"));
    await screen.findByText("Load more");
    expect(reader).toHaveBeenLastCalledWith(resumeId, 25, expect.objectContaining({ section: "files", operation: "upload", search: "annual report" }), undefined);
    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(reader).toHaveBeenCalledTimes(callsBeforeDraft + 2));
    expect(reader.mock.calls.at(-1)?.[2]).toMatchObject({ section: "files", operation: "upload", search: "annual report" });
  });

  it("clears applied filters and returns to an unfiltered first page", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([]) } as unknown as ResumeRepository;
    const view = renderPage(repository);
    await screen.findByText("No activity has been recorded yet.");
    fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "qa@example.test" } });
    fireEvent.click(screen.getByText("Apply"));
    await screen.findByText("No activity matches these filters.");
    fireEvent.click(screen.getByText("Clear"));
    await screen.findByText("No activity has been recorded yet.");
    expect(view.repository.loadActivityLogPageV12).toHaveBeenLastCalledWith(resumeId, 25, expect.objectContaining({ actorEmail: "", dateFrom: null, dateToExclusive: null }), undefined);
  });

  it("validates dates and converts Beijing calendar dates independently of browser timezone", async () => {
    expect(beijingDateStartUtc("2026-10-03")).toBe("2026-10-02T16:00:00.000Z");
    expect(beijingDateStartUtc("0099-01-01")).toBe("0098-12-31T16:00:00.000Z");
    expect(beijingDateRange("2026-10-03", "2026-10-03")).toEqual({ dateFrom: "2026-10-02T16:00:00.000Z", dateToExclusive: "2026-10-03T16:00:00.000Z" });
    expect(beijingDateRange("2026-01-31", "2026-01-31")).toEqual({ dateFrom: "2026-01-30T16:00:00.000Z", dateToExclusive: "2026-01-31T16:00:00.000Z" });
    expect(beijingDateRange("2026-12-31", "2026-12-31")).toEqual({ dateFrom: "2026-12-30T16:00:00.000Z", dateToExclusive: "2026-12-31T16:00:00.000Z" });
    expect(beijingDateRange("2024-02-29", "2024-02-29")).toEqual({ dateFrom: "2024-02-28T16:00:00.000Z", dateToExclusive: "2024-02-29T16:00:00.000Z" });
    expect(beijingDateRange("2026-10-03", "2026-10-02")).toBeNull();
    expect(beijingDateStartUtc("2026-02-30")).toBeNull();
    expect(beijingDateStartUtc("2025-02-29")).toBeNull();
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([]) } as unknown as ResumeRepository;
    const view = renderPage(repository);
    await screen.findByText("No activity has been recorded yet.");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2026-10-02" } });
    const callsBefore = vi.mocked(view.repository.loadActivityLogPageV12!).mock.calls.length;
    fireEvent.click(screen.getByText("Apply"));
    expect(screen.getByRole("alert").textContent).toBe("Invalid date range.");
    expect(view.repository.loadActivityLogPageV12).toHaveBeenCalledTimes(callsBefore);
  });

  it("renders the event section and operation instead of a hardcoded Introduction heading", async () => {
    const upload = { ...event("file-upload"), section: "files", entityType: "resume_file", operation: "upload" as const };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([upload]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByRole("heading", { name: "Files" })).toBeTruthy();
    expect(screen.getByText(/Upload by QA/)).toBeTruthy();
  });

  it("uses a safe fallback for an unknown event section", async () => {
    const unknown = { ...event("unknown-section"), section: "unrecognized" };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([unknown]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByRole("heading", { name: "Unknown section" })).toBeTruthy();
  });

  it("ignores a prior in-flight page after a new filter query is applied", async () => {
    let resolveOld!: (value: ActivityLogEvent[]) => void;
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn()
      .mockImplementationOnce(() => new Promise<ActivityLogEvent[]>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce([event("new-filter-result")]) } as unknown as ResumeRepository;
    renderPage(repository);
    await waitFor(() => expect(repository.loadActivityLogPage).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "new" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(await screen.findByText("Update by QA · qa@example.test")).toBeTruthy();
    resolveOld([{ ...event("stale-result"), actorEmail: "stale-query@example.test" }]);
    await waitFor(() => expect(screen.queryByText(/stale-query@example\.test/)).toBeNull());
  });

  it("clears an old load-more busy state when filters start a new page chain", async () => {
    let resolveOldMore!: (value: ActivityLogEvent[]) => void;
    const firstPage = Array.from({ length: 25 }, (_, index) => event(`busy-${index}`));
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn()
      .mockResolvedValueOnce(firstPage)
      .mockImplementationOnce(() => new Promise<ActivityLogEvent[]>(resolve => { resolveOldMore = resolve; }))
      .mockResolvedValueOnce(firstPage) } as unknown as ResumeRepository;
    renderPage(repository);
    const more = await screen.findByText("Load more");
    fireEvent.click(more);
    await waitFor(() => expect(repository.loadActivityLogPage).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "fresh chain" } });
    fireEvent.click(screen.getByText("Apply"));
    const refreshedMore = await screen.findByText("Load more");
    expect((refreshedMore as HTMLButtonElement).disabled).toBe(false);
    resolveOldMore([event("ignored-old-more")]);
  });

  it("localizes section and remove operation labels in Chinese", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const removed = { ...event("removed"), section: "skills", operation: "remove" as const };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([removed]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByRole("heading", { name: "技能" })).toBeTruthy();
    expect(screen.getByText(/移除 操作人： QA/)).toBeTruthy();
  });
});
