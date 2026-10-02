import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogPage } from "../src/ActivityLogPage";
import type { ActivityLogEvent, ResumeRepository } from "../src/data/resumeRepository";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const resumeId = "qa-resume";
function event(id: string, changes: ActivityLogEvent["changes"] = {}): ActivityLogEvent {
  return { id, occurredAt: "2026-10-02T10:00:00Z", actorEmail: "qa@example.test", actorRole: "qa", operation: "update",
    section: "introduction", entityType: "introduction_paragraph", entityId: "introduction", entitySnapshot: { paragraphs: [] }, changes };
}
function renderPage(repository: ResumeRepository) {
  return render(<UiLocaleProvider><ActivityLogPage resumeId={resumeId} repository={repository} /></UiLocaleProvider>);
}
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Activity Log page", () => {
  it("renders the empty state", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByText("No activity has been recorded yet.")).toBeTruthy();
    expect(repository.loadActivityLogPage).toHaveBeenCalledWith(resumeId, 25, undefined);
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
    renderPage(repository);
    await screen.findByText("Load more");
    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(repository.loadActivityLogPage).toHaveBeenCalledTimes(2));
    expect(repository.loadActivityLogPage).toHaveBeenNthCalledWith(2, resumeId, 25, { occurredAt: firstPage[24].occurredAt, id: firstPage[24].id });
  });

  it("offers retry after read failure without displaying the raw error", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockRejectedValueOnce(new Error("private database details")).mockResolvedValueOnce([]) } as unknown as ResumeRepository;
    renderPage(repository);
    fireEvent.click(await screen.findByText("Retry"));
    expect(await screen.findByText("No activity has been recorded yet.")).toBeTruthy();
    expect(screen.queryByText("private database details")).toBeNull();
  });
});
