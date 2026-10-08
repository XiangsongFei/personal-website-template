import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VersionHistoryPage } from "../src/VersionHistoryPage";
import { RestoreMutationError } from "../src/data/resumeRepository";
import type { RestoreMutationRequest, RestorePreview, ResumeRepository, VersionHistoryEntry, VersionHistoryPage as Page } from "../src/data/resumeRepository";
import type { RestorePreviewDomain } from "../src/data/restorePreviewContract";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const request: RestoreMutationRequest = { resumeId, sourceEventId: eventId, expectedCurrentDigest: "a".repeat(64), requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const current = [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", position: 0, en: { name: "Current" }, zh: { name: "当前" } }];
const historical: RestorePreview["historicalState"] = [];
const preview = (status: RestorePreview["status"] = "ready", currentState: RestorePreview["currentState"] = current): RestorePreview => ({
  status, sourceEventId: eventId, sourceOccurredAt: "2026-10-05T02:10:04Z", domain: "awards", historicalState: historical,
  currentState, comparison: { before: currentState, after: historical }, expectedCurrentDigest: "a".repeat(64),
});
const entry = (overrides: Partial<VersionHistoryEntry> = {}): VersionHistoryEntry => ({
  eventId, occurredAt: "2026-10-05T02:10:04Z", actorAccountLabel: "QA account", actorRole: "qa", domain: "awards", operation: "update",
  payloadVersion: 2, entityType: "award_list", entityId: null,
  comparison: { kind: "aggregate", before: current, after: historical }, ...overrides,
});
const page: Page = { entries: [entry()], hasMore: false, nextCursor: null };
const restored = { status: "restored" as const, domain: "awards" as const, source_event_id: eventId,
  result_event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", occurred_at: "2026-10-08T02:10:04Z" };
function renderPage(repository: ResumeRepository, canRestoreDomain?: (domain: RestorePreviewDomain, target: string) => { allowed: boolean; message?: string }, onRestoreApplied?: () => Promise<void>) {
  return render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={repository} canRestoreDomain={canRestoreDomain} onRestoreApplied={onRestoreApplied} /></UiLocaleProvider>);
}
function baseRepository(overrides: Partial<ResumeRepository> = {}): ResumeRepository {
  return { loadVersionHistoryPage: vi.fn().mockResolvedValue(page), previewRestore: vi.fn().mockResolvedValue(preview()),
    getPendingRestoreAttempt: vi.fn().mockReturnValue(null), restoreDomain: vi.fn().mockResolvedValue(restored), ...overrides } as unknown as ResumeRepository;
}

afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Version History Restore application flow", () => {
  it("only exposes Preview restore for structurally supported V2 update events", async () => {
    const unsupported = [entry({ payloadVersion: 1 }), entry({ domain: "files", entityType: "resume_file" }),
      entry({ domain: "profile", entityType: "profile_settings" }), entry({ operation: "create" }),
      entry({ domain: "introduction" as VersionHistoryEntry["domain"] })]
      .map((value, index) => ({ ...value, eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    const repo = baseRepository({ loadVersionHistoryPage: vi.fn().mockResolvedValue({ ...page, entries: unsupported }) });
    renderPage(repo);
    await screen.findByRole("heading", { level: 1, name: "Version History" });
    expect(screen.queryByRole("button", { name: "Preview restore" })).toBeNull();
  });

  it("previews safely and submits only after explicit confirmation", async () => {
    const repo = baseRepository();
    const onApplied = vi.fn();
    renderPage(repo, () => ({ allowed: true }), onApplied);
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    expect(await screen.findByRole("dialog", { name: "Restore one domain" })).toBeTruthy();
    expect(screen.getByText("Only this domain will change. The current state will be replaced with the historical state recorded before this event. Other domains and files will not be restored.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Current state" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Historical target state — before this event" })).toBeTruthy();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restore this domain" }));
    await screen.findByText("Restore completed for this domain only.");
    expect(repo.restoreDomain).toHaveBeenCalledOnce();
    expect(repo.restoreDomain).toHaveBeenCalledWith(expect.objectContaining({ resumeId, sourceEventId: eventId, expectedCurrentDigest: "a".repeat(64) }), "new");
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("blocks confirmation when the same-domain draft guard rejects", async () => {
    const repo = baseRepository();
    renderPage(repo, () => ({ allowed: false, message: "Save or discard this domain's unsaved changes before restoring." }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this domain" }));
    expect((await screen.findByRole("status")).textContent).toContain("Save or discard this domain's unsaved changes before restoring.");
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("does not show confirmation for a no-change Preview", async () => {
    const repo = baseRepository({ previewRestore: vi.fn().mockResolvedValue(preview("no_change", current)) });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    await screen.findByText("This domain already matches the historical state. Nothing was changed.");
    expect(screen.queryByRole("button", { name: "Restore this domain" })).toBeNull();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("reuses the exact pending request after an unresolved prior attempt", async () => {
    const repo = baseRepository({ getPendingRestoreAttempt: vi.fn().mockReturnValue(request) });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    expect(await screen.findByRole("button", { name: "Retry the same Restore request" })).toBeTruthy();
    expect(repo.previewRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry the same Restore request" }));
    await waitFor(() => expect(repo.restoreDomain).toHaveBeenCalledOnce());
    expect(repo.restoreDomain).toHaveBeenCalledWith(request, "retry");
  });

  it("preserves stale Preview and requires an explicit fresh Preview", async () => {
    const repo = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("stale_preview")),
      previewRestore: vi.fn().mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview("ready", [])) });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this domain" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The content changed after Preview.");
    expect(screen.getAllByText("Current")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Get a fresh Preview" }));
    await waitFor(() => expect(repo.previewRestore).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(repo.restoreDomain).toHaveBeenCalledOnce();
  });

  it("does not claim success for mutation-time no-change", async () => {
    const repo = baseRepository({ restoreDomain: vi.fn().mockResolvedValue({ status: "no_change", domain: "awards", source_event_id: eventId, result_event_id: null }) });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this domain" }));
    expect(await screen.findByText("The current domain already matches the selected historical state. Nothing was changed.")).toBeTruthy();
    expect(screen.queryByText("Restore completed for this domain only.")).toBeNull();
  });

  it("prevents a double click from dispatching a second mutation", async () => {
    let finish!: (value: typeof restored) => void;
    const repo = baseRepository({ restoreDomain: vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; })) });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    const confirm = await screen.findByRole("button", { name: "Restore this domain" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(repo.restoreDomain).toHaveBeenCalledOnce();
    finish(restored);
    await screen.findByText("Restore completed for this domain only.");
  });

  it("shows exact-retry recovery after an ambiguous outcome", async () => {
    const repo = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("outcome_unknown", true)),
      getPendingRestoreAttempt: vi.fn().mockReturnValueOnce(null).mockReturnValue(request) });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "Preview restore" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this domain" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Retry only the exact same request.");
    expect(screen.getByRole("button", { name: "Retry the same Restore request" })).toBeTruthy();
  });
});
