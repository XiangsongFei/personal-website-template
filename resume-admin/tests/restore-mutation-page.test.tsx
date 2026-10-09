import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { VersionHistoryPage } from "../src/VersionHistoryPage";
import { RestoreMutationError, RestorePreviewError } from "../src/data/resumeRepository";
import type { RestoreMutationRequest, RestorePreview, ResumeRepository, VersionHistoryEntry, VersionHistoryPage as Page } from "../src/data/resumeRepository";
import type { RestorePreviewDomain } from "../src/data/restorePreviewContract";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const request: RestoreMutationRequest = { resumeId, sourceEventId: eventId, expectedCurrentDigest: "a".repeat(64), requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const id1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const award = (id: string, position: number, enName: string, zhName: string, enYear = "2099", zhYear = "2099") => ({
  id, position, en: { name: enName, year: enYear }, zh: { name: zhName, year: zhYear },
});
const current = [award(id1, 0, "Current award", "当前奖项"), award(id2, 1, "Unchanged award", "未修改奖项")];
const historical = [award(id1, 0, "Earlier award", "较早奖项"), award(id2, 1, "Unchanged award", "未修改奖项")];
const preview = (overrides: Partial<RestorePreview> = {}): RestorePreview => {
  const currentState = overrides.currentState ?? current;
  const historicalState = overrides.historicalState ?? historical;
  const unchanged = JSON.stringify(currentState) === JSON.stringify(historicalState);
  return {
    status: overrides.status ?? (unchanged ? "no_change" : "ready"), sourceEventId: eventId,
    sourceOccurredAt: "2026-10-05T02:10:04Z", domain: "awards", historicalState, currentState,
    comparison: { before: currentState, after: historicalState }, expectedCurrentDigest: "a".repeat(64), ...overrides,
  };
};
const entry = (overrides: Partial<VersionHistoryEntry> = {}): VersionHistoryEntry => ({
  eventId, occurredAt: "2026-10-05T02:10:04Z", actorAccountLabel: "QA account", actorRole: "qa", domain: "awards", operation: "update",
  payloadVersion: 2, entityType: "award_list", entityId: null,
  comparison: { kind: "aggregate", before: current, after: historical }, ...overrides,
});
const page: Page = { entries: [entry()], hasMore: false, nextCursor: null };
const restored = { status: "restored" as const, domain: "awards" as const, source_event_id: eventId,
  result_event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", occurred_at: "2026-10-08T02:10:04Z" };

function renderPage(repository: ResumeRepository, canRestoreDomain?: (domain: RestorePreviewDomain, target: string) => { allowed: boolean; message?: string }, onRestoreApplied?: () => Promise<void>) {
  return render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={repository} canRestoreDomain={canRestoreDomain} onRestoreApplied={onRestoreApplied} /></UiLocaleProvider>);
}
function baseRepository(overrides: Partial<ResumeRepository> = {}): ResumeRepository {
  return { loadVersionHistoryPage: vi.fn().mockResolvedValue(page), previewRestore: vi.fn().mockResolvedValue(preview()),
    getPendingRestoreAttempt: vi.fn().mockReturnValue(null), restoreDomain: vi.fn().mockResolvedValue(restored), ...overrides } as unknown as ResumeRepository;
}
async function openPreview(dialogName = "Awards") {
  const zh = window.localStorage.getItem(UI_LOCALE_KEY) === "zh";
  const previewAction = zh ? "预览恢复内容" : "Preview what would be restored";
  fireEvent.click(await screen.findByRole("button", { name: previewAction }));
  const zhDomains: Record<string, string> = { Awards: "荣誉奖项", Experience: "工作经历", Skills: "技能", Education: "教育经历", Projects: "项目经历", Contact: "联系方式", "Website & Links": "网站与链接" };
  return screen.findByRole("dialog", { name: zh ? zhDomains[dialogName] ?? dialogName : dialogName });
}

afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Version History Restore presentation and state machine", () => {
  it("offers Preview only for supported V2 update events and keeps Profile non-restorable", async () => {
    const unsupported = [entry({ payloadVersion: 1 }), entry({ domain: "files", entityType: "resume_file" }),
      entry({ domain: "profile", entityType: "profile_settings" }), entry({ operation: "create" }),
      entry({ domain: "introduction" as VersionHistoryEntry["domain"] })]
      .map((value, index) => ({ ...value, eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
    const repo = baseRepository({ loadVersionHistoryPage: vi.fn().mockResolvedValue({ ...page, entries: unsupported }) });
    renderPage(repo);
    await screen.findByRole("heading", { level: 1, name: "Version History" });
    expect(screen.queryByRole("button", { name: "Preview what would be restored" })).toBeNull();
  });

  it("shows a human-readable authoritative Current → After restore diff, not aggregate structure", async () => {
    const repo = baseRepository();
    const onApplied = vi.fn().mockResolvedValue(undefined);
    renderPage(repo, () => ({ allowed: true }), onApplied);
    const dialog = await openPreview();
    expect(within(dialog).getByText("Restore preview")).toBeTruthy();
    expect(within(dialog).getByText("This preview shows how this section would look after restoring its earlier content. Only this section will change. Other sections will stay as they are.")).toBeTruthy();
    expect(within(dialog).getAllByText("Current", { selector: ".version-history-value-side-label" })).toHaveLength(2);
    expect(within(dialog).getAllByText("After restore", { selector: ".version-history-value-side-label" })).toHaveLength(2);
    expect(dialog.querySelector(".version-history-before .version-history-long-value")?.textContent).toBe("Current award");
    expect(dialog.querySelector(".version-history-after .version-history-long-value")?.textContent).toBe("Earlier award");
    expect(within(dialog).queryByText("Unchanged award")).toBeNull();
    expect(within(dialog).queryByText("2099")).toBeNull();
    expect(within(dialog).queryByText(id1)).toBeNull();
    expect(within(dialog).queryByText("Position")).toBeNull();
    expect(within(dialog).queryByText("Shared")).toBeNull();
    expect(within(dialog).queryByText("Translations")).toBeNull();
    expect(within(dialog).queryByText(/\[object Object\]|"name"|"position"/)).toBeNull();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore this section" }));
    expect(await screen.findByText("This section was restored. A new entry was added to Version History; earlier history remains unchanged.")).toBeTruthy();
    expect(repo.restoreDomain).toHaveBeenCalledOnce();
    expect(repo.restoreDomain).toHaveBeenCalledWith(expect.objectContaining({ resumeId, sourceEventId: eventId, expectedCurrentDigest: "a".repeat(64) }), "new");
    expect(onApplied).toHaveBeenCalledOnce();
  });

  it("localizes Restore UI while preserving actual English and Chinese resume values", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const repo = baseRepository();
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "预览恢复内容" }));
    const dialog = await screen.findByRole("dialog", { name: "荣誉奖项" });
    expect(screen.getByText("恢复预览")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "荣誉奖项" })).toBeTruthy();
    expect(within(dialog).getByText("请在恢复前确认此部分将如何变化。恢复只会更改此部分，其他部分保持不变。")).toBeTruthy();
    const currentValues = dialog.querySelectorAll(".version-history-before .version-history-long-value");
    const restoredValues = dialog.querySelectorAll(".version-history-after .version-history-long-value");
    expect([...currentValues].map(value => value.textContent)).toEqual(["Current award", "当前奖项"]);
    expect([...restoredValues].map(value => value.textContent)).toEqual(["Earlier award", "较早奖项"]);
    expect(within(dialog).queryByText("Current", { selector: ".version-history-value-side-label" })).toBeNull();
    expect(within(dialog).getAllByText("当前内容", { selector: ".version-history-value-side-label" })).toHaveLength(2);
    expect(within(dialog).getAllByText("恢复后", { selector: ".version-history-value-side-label" })).toHaveLength(2);
    expect(within(dialog).getByRole("button", { name: "恢复此部分" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "关闭恢复预览" })).toBeTruthy();
    expect(within(dialog).getAllByRole("button", { name: "取消" })).toHaveLength(1);
    expect(within(dialog).queryByText(/digest|idempotency|request id|RPC|trusted context|resolver|载荷版本|域|实体 ID/i)).toBeNull();
  });

  it("keeps keyboard focus inside Restore Preview and returns it to the trigger on Escape", async () => {
    const repo = baseRepository();
    renderPage(repo);
    const trigger = await screen.findByRole("button", { name: "Preview what would be restored" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close restore preview" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const restore = within(dialog).getByRole("button", { name: "Restore this section" });
    expect(within(dialog).getAllByRole("button")).toEqual([close, cancel, restore]);
    expect(close.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(close.textContent).toBe("×");
    close.focus();
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(restore);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    expect(dialog.contains(document.activeElement)).toBe(true);

    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("returns focus to the Preview trigger when footer Cancel closes the dialog", async () => {
    const repo = baseRepository();
    renderPage(repo);
    const trigger = await screen.findByRole("button", { name: "Preview what would be restored" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("renders add, remove, and reorder outcomes without exposing positions", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const addedId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const repo = baseRepository({ previewRestore: vi.fn().mockResolvedValue(preview({
      currentState: [award(id1, 0, "Kept award", "保留奖项"), award(id2, 1, "Current only", "仅当前")],
      historicalState: [award(id1, 0, "Kept award", "保留奖项"), award(addedId, 1, "Earlier only", "仅较早")],
    })) });
    renderPage(repo);
    await openPreview();
    expect(screen.getByText("将添加")).toBeTruthy();
    expect(screen.getByText("将删除")).toBeTruthy();
    expect(screen.queryByText("Position")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看更多修改" }));
    expect(screen.getAllByText("Earlier only").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current only").length).toBeGreaterThan(0);
    cleanup();

    const reordered = baseRepository({ previewRestore: vi.fn().mockResolvedValue(preview({
      currentState: [award(id1, 0, "First", "第一"), award(id2, 1, "Second", "第二")],
      historicalState: [award(id2, 0, "Second", "第二"), award(id1, 1, "First", "第一")],
    })) });
    renderPage(reordered);
    await openPreview();
    expect(screen.getAllByText("顺序将调整").length).toBeGreaterThan(0);
    expect(screen.queryByText(/position\s*\d/i)).toBeNull();
  });

  it("preserves long values and lets the user expand the complete text", async () => {
    const longDescription = "Long historical description. ".repeat(18);
    const rowState = (description: string) => [{ id: id1, position: 0,
      en: { organization: "Example", title: "Engineer", period: "2020", description, location: null },
      zh: { organization: "示例", title: "工程师", period: "2020", description: "说明", location: null } }];
    const repo = baseRepository({ loadVersionHistoryPage: vi.fn().mockResolvedValue({ ...page, entries: [entry({ domain: "experience", entityType: "experience_list" })] }),
      previewRestore: vi.fn().mockResolvedValue(preview({ domain: "experience", currentState: rowState("Current"), historicalState: rowState(longDescription) })) });
    renderPage(repo);
    const dialog = await openPreview("Experience");
    const value = dialog.querySelector<HTMLElement>(".restore-preview-changes .version-history-after .version-history-long-value");
    expect(value?.textContent).toBe(longDescription);
    expect(value?.className).toContain("is-clamped");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show more changes" }));
    const expanded = dialog.querySelector<HTMLElement>(".restore-preview-changes .version-history-after .version-history-long-value");
    expect(expanded?.textContent).toBe(longDescription);
    expect(expanded?.className).not.toContain("is-clamped");
  });

  it("fails closed when Preview data is malformed and never enables confirmation", async () => {
    const malformed = { ...preview(), comparison: { before: historical, after: historical } } as RestorePreview;
    const repo = baseRepository({ previewRestore: vi.fn().mockResolvedValue(malformed) });
    renderPage(repo);
    await openPreview();
    expect(await screen.findByText("Preview details aren’t available. Restore has not been started.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore this section" })).toBeNull();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("preserves uncertainty when pending-state inspection conflicts or storage is unavailable", async () => {
    for (const code of ["pending_conflict", "storage_unavailable"] as const) {
      const inspect = vi.fn(() => { throw new RestoreMutationError(code); });
      const repo = baseRepository({ getPendingRestoreAttempt: inspect });
      renderPage(repo);
      await openPreview();
      const alert = screen.getByRole("alert");
      expect(within(alert).getByRole("heading", { name: "We couldn’t confirm the previous restore result" })).toBeTruthy();
      expect(alert.textContent).toContain("Don’t start another restore until this is resolved.");
      expect(alert.textContent).not.toMatch(/Restore has not been started|pending_conflict|storage_unavailable|session storage|request ID/i);
      expect(screen.queryByRole("button", { name: "Restore this section" })).toBeNull();
      expect(repo.previewRestore).not.toHaveBeenCalled();
      expect(repo.restoreDomain).not.toHaveBeenCalled();

      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
      expect(repo.previewRestore).not.toHaveBeenCalled();
      expect(repo.restoreDomain).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("localizes pending-state inspection failure in Chinese without exposing its code", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const repo = baseRepository({ getPendingRestoreAttempt: vi.fn(() => { throw new RestoreMutationError("storage_unavailable"); }) });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "预览恢复内容" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "暂时无法确认之前的恢复结果" })).toBeTruthy();
    expect(alert.textContent).toContain("目前无法安全确认之前一次恢复操作的结果。在确认结果前，请不要另行发起新的恢复操作。");
    expect(within(alert).getByRole("button", { name: "重试" })).toBeTruthy();
    expect(alert.textContent).not.toMatch(/We couldn’t|We can’t safely|Don’t start|storage_unavailable|pending_conflict|request ID|session storage/i);
    expect(screen.queryByRole("button", { name: "恢复此部分" })).toBeNull();
    expect(repo.previewRestore).not.toHaveBeenCalled();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("maps authorization and non-restorable Preview failures to safe messages", async () => {
    const denied = baseRepository({ previewRestore: vi.fn().mockRejectedValue(new RestorePreviewError("target_not_authorized")) });
    renderPage(denied);
    await openPreview();
    expect(await screen.findByText("You don’t have permission to restore this section.")).toBeTruthy();
    expect(screen.queryByText(/42501|RPC|permission denied/i)).toBeNull();
    cleanup();
    const ineligible = baseRepository({ previewRestore: vi.fn().mockRejectedValue(new RestorePreviewError("source_ineligible")) });
    renderPage(ineligible);
    await openPreview();
    expect(await screen.findByText("This change can’t be restored from Version History.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore this section" })).toBeNull();
  });

  it("keeps expired Restore recovery wording user-facing", async () => {
    const repo = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("restore_request_expired")) });
    renderPage(repo);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    expect(await screen.findByText("This restore can no longer be safely continued. Review a fresh preview before continuing.")).toBeTruthy();
    expect(screen.queryByText(/restore request|request ID|idempotency|replay/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry this restore" })).toBeNull();
  });

  it("does not show a mutation action for a no-change Preview", async () => {
    const repo = baseRepository({ previewRestore: vi.fn().mockResolvedValue(preview({ currentState: current, historicalState: current })) });
    renderPage(repo);
    await openPreview();
    expect(await screen.findByText("This section already matches the earlier content. Nothing needs to be restored.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore this section" })).toBeNull();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("preserves draft protection and localizes the guard message without mutation", async () => {
    const repo = baseRepository();
    renderPage(repo, () => ({ allowed: false, message: "Save or discard this domain's unsaved changes before restoring." }));
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    expect((await screen.findByRole("status")).textContent).toContain("Save or discard your unsaved changes in this section before restoring.");
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("resolves an existing pending request only through the exact retry path", async () => {
    const repo = baseRepository({ getPendingRestoreAttempt: vi.fn().mockReturnValue(request) });
    renderPage(repo);
    await openPreview();
    expect(screen.getByRole("heading", { name: "We couldn’t confirm the restore result" })).toBeTruthy();
    expect(screen.getByText("Retry this restore to safely check the same operation. Don’t start a different restore until the result is confirmed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry this restore" })).toBeTruthy();
    expect(screen.queryByText(/Restore request|exact request|request ID|idempotency|replay/i)).toBeNull();
    expect(screen.queryByText(request.requestId)).toBeNull();
    expect(repo.previewRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry this restore" }));
    await waitFor(() => expect(repo.restoreDomain).toHaveBeenCalledOnce());
    expect(repo.restoreDomain).toHaveBeenCalledWith(request, "retry");
    expect(repo.previewRestore).not.toHaveBeenCalled();
  });

  it("double-trigger protects an exact retry of a valid pending Restore", async () => {
    let finish!: (value: typeof restored) => void;
    const retry = vi.fn().mockReturnValue(new Promise<typeof restored>(resolve => { finish = resolve; }));
    const repo = baseRepository({ getPendingRestoreAttempt: vi.fn().mockReturnValue(request), restoreDomain: retry });
    renderPage(repo);
    await openPreview();
    const button = screen.getByRole("button", { name: "Retry this restore" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith(request, "retry");
    finish(restored);
    await screen.findByText("This section was restored. A new entry was added to Version History; earlier history remains unchanged.");
  });

  it("localizes a valid pending Restore and retries the same stored operation", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const retry = vi.fn().mockResolvedValue(restored);
    const repo = baseRepository({ getPendingRestoreAttempt: vi.fn().mockReturnValue(request), restoreDomain: retry });
    renderPage(repo);
    fireEvent.click(await screen.findByRole("button", { name: "预览恢复内容" }));
    const dialog = await screen.findByRole("dialog", { name: "荣誉奖项" });
    expect(within(dialog).getByRole("heading", { name: "暂时无法确认恢复结果" })).toBeTruthy();
    expect(within(dialog).getByText("之前的恢复结果尚未确认。请先重试本次恢复以确认结果，再进行其他恢复操作。")).toBeTruthy();
    const retryButton = within(dialog).getByRole("button", { name: "重试本次恢复" });
    expect(within(dialog).queryByText(/Restore request|exact request|request ID|idempotency|replay/i)).toBeNull();
    expect(within(dialog).queryByText(request.requestId)).toBeNull();
    expect(within(dialog).queryByText(/We couldn’t confirm|Retry this restore|Don’t start a different restore/)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "恢复此部分" })).toBeNull();
    fireEvent.click(retryButton);
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    expect(retry).toHaveBeenCalledWith(request, "retry");
    expect(repo.previewRestore).not.toHaveBeenCalled();
  });

  it("localizes the remaining Restore outcomes without changing their safety states", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");

    const success = baseRepository();
    renderPage(success);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "恢复此部分" }));
    expect(await screen.findByRole("heading", { name: "此部分已恢复" })).toBeTruthy();
    expect(screen.getByText("此部分已恢复。版本历史中已新增一条记录，之前的历史记录保持不变。")).toBeTruthy();
    cleanup();

    const noChange = baseRepository({ restoreDomain: vi.fn().mockResolvedValue({ status: "no_change", domain: "awards", source_event_id: eventId, result_event_id: null }) });
    renderPage(noChange);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "恢复此部分" }));
    expect(await screen.findByRole("heading", { name: "无需更改" })).toBeTruthy();
    expect(screen.getByText("此部分已与较早内容一致，未作更改。")).toBeTruthy();
    cleanup();

    const stale = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("stale_preview")) });
    renderPage(stale);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "恢复此部分" }));
    expect(await screen.findByText("预览后此部分内容已发生变化。请重新查看预览后再恢复。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新查看预览" })).toBeTruthy();
    cleanup();

    const failure = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("restore_unavailable")) });
    renderPage(failure);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "恢复此部分" }));
    expect(await screen.findByText("恢复未能完成。当前内容未被替换。")).toBeTruthy();
    cleanup();

    const auth = baseRepository({ previewRestore: vi.fn().mockRejectedValue(new RestorePreviewError("unauthenticated")) });
    renderPage(auth);
    await openPreview();
    expect(await screen.findByText("登录状态已过期，请重新登录后继续。")).toBeTruthy();
    cleanup();

    const ineligible = baseRepository({ previewRestore: vi.fn().mockRejectedValue(new RestorePreviewError("source_ineligible")) });
    renderPage(ineligible);
    await openPreview();
    expect(await screen.findByText("无法通过版本历史恢复此项修改。")).toBeTruthy();
    cleanup();

    const malformed = baseRepository({ previewRestore: vi.fn().mockResolvedValue({ ...preview(), comparison: { before: historical, after: historical } } as RestorePreview) });
    renderPage(malformed);
    await openPreview();
    expect(await screen.findByText("暂时无法显示恢复预览详情。恢复操作尚未开始。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "恢复此部分" })).toBeNull();
    cleanup();

    const guard = baseRepository();
    renderPage(guard, () => ({ allowed: false, message: "Save or discard this domain's unsaved changes before restoring." }));
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "恢复此部分" }));
    expect((await screen.findByRole("status")).textContent).toContain("恢复前，请先保存或放弃此部分未保存的修改。");
    expect(guard.restoreDomain).not.toHaveBeenCalled();
  });

  it("keeps truthful pre-start wording for an ordinary Preview failure without pending state", async () => {
    const repo = baseRepository({ previewRestore: vi.fn().mockRejectedValue(new RestorePreviewError("preview_unavailable")) });
    renderPage(repo);
    await openPreview();
    expect(await screen.findByText("Restore preview could not be prepared. Restore has not been started.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore this section" })).toBeNull();
    expect(repo.getPendingRestoreAttempt).toHaveBeenCalledOnce();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("blocks a pending exact retry when the draft guard rejects", async () => {
    const repo = baseRepository({ getPendingRestoreAttempt: vi.fn().mockReturnValue(request) });
    renderPage(repo, () => ({ allowed: false, message: "This domain has an unresolved save. Resolve that save before restoring." }));
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Retry this restore" }));
    expect((await screen.findByRole("status")).textContent).toContain("This section has a save that still needs attention. Resolve it before restoring.");
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });

  it("requires a fresh Preview after stale conflict and never reuses old confirmation", async () => {
    const repo = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("stale_preview")),
      previewRestore: vi.fn().mockResolvedValueOnce(preview()).mockResolvedValueOnce(preview({ currentState: current, historicalState: current })) });
    renderPage(repo);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    expect(await screen.findByText("This section changed after the preview. Review a fresh preview before restoring.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore this section" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await screen.findByText("This section already matches the earlier content. Nothing needs to be restored.");
    expect(repo.previewRestore).toHaveBeenCalledTimes(2);
    expect(repo.restoreDomain).toHaveBeenCalledOnce();
  });

  it("keeps mutation no-change distinct from successful restoration", async () => {
    const repo = baseRepository({ restoreDomain: vi.fn().mockResolvedValue({ status: "no_change", domain: "awards", source_event_id: eventId, result_event_id: null }) });
    renderPage(repo);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    expect(await screen.findByText("This section already matched the earlier content. Nothing was changed.")).toBeTruthy();
    expect(screen.queryByText("This section was restored. A new entry was added to Version History; earlier history remains unchanged.")).toBeNull();
  });

  it("separates confirmed failures from uncertain outcomes and hides technical errors", async () => {
    const failure = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("restore_unavailable")) });
    renderPage(failure);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    expect(await screen.findByText("Restore couldn’t be completed. Your current content was not replaced.")).toBeTruthy();
    expect(screen.queryByText(/restore_unavailable|digest|request id/i)).toBeNull();
    cleanup();
    const uncertain = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("outcome_unknown", true)),
      getPendingRestoreAttempt: vi.fn().mockReturnValueOnce(null).mockReturnValue(request) });
    renderPage(uncertain);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    expect(await screen.findByRole("heading", { name: "We couldn’t confirm the restore result" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry this restore" })).toBeTruthy();
  });

  it("retries an uncertain result with the identical request and no new logical operation", async () => {
    const firstRequests: RestoreMutationRequest[] = [];
    const restore = vi.fn().mockImplementation((next: RestoreMutationRequest, mode: "new" | "retry") => {
      if (mode === "new") { firstRequests.push(next); return Promise.reject(new RestoreMutationError("outcome_unknown", true)); }
      return Promise.resolve(restored);
    });
    const pending = vi.fn().mockImplementation(() => firstRequests[0] ?? null);
    pending.mockImplementationOnce(() => null);
    const repo = baseRepository({ restoreDomain: restore, getPendingRestoreAttempt: pending });
    renderPage(repo);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry this restore" }));
    await screen.findByText("This section was restored. A new entry was added to Version History; earlier history remains unchanged.");
    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenNthCalledWith(1, expect.objectContaining({ requestId: expect.any(String), expectedCurrentDigest: "a".repeat(64) }), "new");
    expect(restore).toHaveBeenNthCalledWith(2, firstRequests[0], "retry");
    expect(firstRequests[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows auth-expired copy without exposing the backend error", async () => {
    const repo = baseRepository({ restoreDomain: vi.fn().mockRejectedValue(new RestoreMutationError("unauthenticated")) });
    renderPage(repo);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "Restore this section" }));
    expect(await screen.findByText("Your session has expired. Sign in again to continue.")).toBeTruthy();
  });

  it("prevents a double mutation, disables closing while submitting, and restores focus", async () => {
    let finish!: (value: typeof restored) => void;
    const repo = baseRepository({ restoreDomain: vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; })) });
    renderPage(repo);
    const trigger = await screen.findByRole("button", { name: "Preview what would be restored" });
    fireEvent.click(trigger);
    const confirm = await screen.findByRole("button", { name: "Restore this section" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(repo.restoreDomain).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Restore this section" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Restoring this section…");
    expect(screen.getByRole("button", { name: "Close restore preview" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(repo.restoreDomain).toHaveBeenCalledOnce();
    finish(restored);
    await screen.findByText("This section was restored. A new entry was added to Version History; earlier history remains unchanged.");
    fireEvent.click(screen.getByRole("button", { name: "Close restore preview" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes without mutation on Escape", async () => {
    const repo = baseRepository();
    renderPage(repo);
    await openPreview();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(repo.restoreDomain).not.toHaveBeenCalled();
  });
});
