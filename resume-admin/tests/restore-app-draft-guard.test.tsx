import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import type { ResumeRepository, VersionHistoryEntry } from "../src/data/resumeRepository";
import { UiLocaleProvider, UI_LOCALE_KEY } from "../src/uiLocale";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const event = (domain: "awards" | "contact"): VersionHistoryEntry => ({
  eventId, occurredAt: "2026-10-05T02:10:04Z", actorAccountLabel: "QA", actorRole: "qa", domain, operation: "update",
  payloadVersion: 2, entityType: domain === "awards" ? "award_list" : "contact_section", entityId: null,
  comparison: { kind: "aggregate", before: [], after: [] },
});
function RouteButtons() {
  const navigate = useNavigate();
  return <div><button onClick={() => navigate("/version-history")}>Open history</button><button onClick={() => navigate("/contact")}>Open contact</button></div>;
}
function renderApp(repository: ResumeRepository) {
  const resume = { resumeId, siteKey: "example-cv-qa", isPublished: false, updatedAt: null, sections: fixtureSections };
  return render(<UiLocaleProvider><MemoryRouter initialEntries={["/contact"]}><RouteButtons /><App identityEmail="qa@example.test"
    onSignOut={() => {}} signOutPending={false} signOutError="" resume={resume} repository={repository} additionalResumeId={resumeId}
    activityLogEnabled /></MemoryRouter></UiLocaleProvider>);
}
function mockRepository(domain: "awards" | "contact", overrides: Partial<ResumeRepository> = {}): ResumeRepository {
  const currentState = domain === "awards" ? [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0,
    zh: { name: "当前奖项", year: "2099" }, en: { name: "Current award", year: "2099" } }] : {
    translations: { zh: { contact_label: "联系", availability: "当前状态" }, en: { contact_label: "Contact", availability: "Current status" } },
    focus: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0, zh: { title: "关注", detail: "" }, en: { title: "Focus", detail: "" } }],
    status: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", position: 0, status_type: "open", zh: { title: "开放", detail: "" }, en: { title: "Open", detail: "" } }],
  };
  const historicalState = domain === "awards" ? [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0,
    zh: { name: "当前奖项", year: "2099" }, en: { name: "Earlier award", year: "2099" } }] : {
    translations: { zh: { contact_label: "联系", availability: "较早状态" }, en: { contact_label: "Contact", availability: "Earlier status" } },
    focus: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0, zh: { title: "关注", detail: "" }, en: { title: "Focus", detail: "" } }],
    status: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", position: 0, status_type: "open", zh: { title: "开放", detail: "" }, en: { title: "Open", detail: "" } }],
  };
  return {
    loadVersionHistoryPage: vi.fn().mockResolvedValue({ entries: [event(domain)], hasMore: false, nextCursor: null }),
    previewRestore: vi.fn().mockResolvedValue({ status: "ready", sourceEventId: eventId, sourceOccurredAt: "2026-10-05T02:10:04Z", domain,
      historicalState, currentState, comparison: { before: currentState, after: historicalState }, expectedCurrentDigest: "a".repeat(64) }),
    getPendingRestoreAttempt: vi.fn().mockReturnValue(null), restoreDomain: vi.fn().mockResolvedValue({ status: "restored", domain, source_event_id: eventId,
      result_event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", occurred_at: "2026-10-08T02:10:04Z" }),
    hasPendingContactWorkerSave: vi.fn().mockReturnValue(false), hasPendingAwardsWorkerSave: vi.fn().mockReturnValue(false),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards), loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadAdminContactWriteState: vi.fn().mockResolvedValue({ resumeId, contactWriteMode: "rpc", activityLogEnabled: true, contactTrustedContextRequired: true }),
    saveContactWithWorker: vi.fn().mockImplementation(async (_id, value) => value),
    ...overrides,
  } as unknown as ResumeRepository;
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("App-owned Restore draft and in-flight guard", () => {
  it("blocks a dirty draft in the exact restored domain", async () => {
    const repository = mockRepository("contact");
    renderApp(repository);
    fireEvent.change(await screen.findByLabelText("Chinese Availability"), { target: { value: "Unsaved contact draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview what would be restored" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this section" }));
    expect((await screen.findByRole("status")).textContent).toContain("Save or discard your unsaved changes in this section before restoring.");
    expect(repository.restoreDomain).not.toHaveBeenCalled();
  });

  it("blocks Restore while a same-domain save is unresolved", async () => {
    let resolveWriteState!: (value: unknown) => void;
    const repository = mockRepository("contact", { loadAdminContactWriteState: vi.fn().mockReturnValue(new Promise(resolve => { resolveWriteState = resolve; })) });
    renderApp(repository);
    fireEvent.change(await screen.findByLabelText("Chinese Availability"), { target: { value: "Saving contact" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview what would be restored" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this section" }));
    expect((await screen.findByRole("status")).textContent).toContain("This section is being saved. Wait for the save to finish before restoring.");
    expect(repository.restoreDomain).not.toHaveBeenCalled();
    resolveWriteState({ resumeId, contactWriteMode: "rpc", activityLogEnabled: true, contactTrustedContextRequired: true });
  });

  it("preserves an unrelated dirty Contact draft when restoring Awards", async () => {
    const repository = mockRepository("awards");
    renderApp(repository);
    fireEvent.change(await screen.findByLabelText("Chinese Availability"), { target: { value: "Keep this unrelated draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview what would be restored" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this section" }));
    await screen.findByText("This section was restored. A new entry was added to Version History; earlier history remains unchanged.");
    fireEvent.click(screen.getByRole("button", { name: "Open contact" }));
    expect(await screen.findByLabelText("Chinese Availability")).toHaveProperty("value", "Keep this unrelated draft");
  });
});
