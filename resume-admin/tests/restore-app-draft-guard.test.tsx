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
  const aggregate = domain === "awards" ? fixtureSections.awards : fixtureSections.contact;
  return {
    loadVersionHistoryPage: vi.fn().mockResolvedValue({ entries: [event(domain)], hasMore: false, nextCursor: null }),
    previewRestore: vi.fn().mockResolvedValue({ status: "ready", sourceEventId: eventId, sourceOccurredAt: "2026-10-05T02:10:04Z", domain,
      historicalState: [], currentState: aggregate as never, comparison: { before: aggregate as never, after: [] }, expectedCurrentDigest: "a".repeat(64) }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this domain" }));
    expect((await screen.findByRole("status")).textContent).toContain("Save or discard this domain's unsaved changes");
    expect(repository.restoreDomain).not.toHaveBeenCalled();
  });

  it("blocks Restore while a same-domain save is unresolved", async () => {
    let resolveWriteState!: (value: unknown) => void;
    const repository = mockRepository("contact", { loadAdminContactWriteState: vi.fn().mockReturnValue(new Promise(resolve => { resolveWriteState = resolve; })) });
    renderApp(repository);
    fireEvent.change(await screen.findByLabelText("Chinese Availability"), { target: { value: "Saving contact" } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this domain" }));
    expect((await screen.findByRole("status")).textContent).toContain("currently being saved");
    expect(repository.restoreDomain).not.toHaveBeenCalled();
    resolveWriteState({ resumeId, contactWriteMode: "rpc", activityLogEnabled: true, contactTrustedContextRequired: true });
  });

  it("preserves an unrelated dirty Contact draft when restoring Awards", async () => {
    const repository = mockRepository("awards");
    renderApp(repository);
    fireEvent.change(await screen.findByLabelText("Chinese Availability"), { target: { value: "Keep this unrelated draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this domain" }));
    await screen.findByText("Restore completed for this domain only.");
    fireEvent.click(screen.getByRole("button", { name: "Open contact" }));
    expect(await screen.findByLabelText("Chinese Availability")).toHaveProperty("value", "Keep this unrelated draft");
  });
});
