import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VersionHistoryPage } from "../src/VersionHistoryPage";
import type { ResumeRepository, VersionHistoryEntry, VersionHistoryPage as Page } from "../src/data/resumeRepository";
import { UI_LOCALE_KEY, UiLocaleProvider, useUiLocale } from "../src/uiLocale";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const uuid = (n: number) => `ea000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (id: number, position: number, enName: string, zhName: string, enYear = "2025", zhYear = "2025") => ({
  id: uuid(id), position, en: { name: enName, year: enYear }, zh: { name: zhName, year: zhYear },
});
const baseEntry = (overrides: Partial<VersionHistoryEntry> = {}): VersionHistoryEntry => ({
  eventId: uuid(90), occurredAt: "2026-10-07T12:00:00Z", actorAccountLabel: "QA account", actorRole: "qa",
  domain: "awards", operation: "update", payloadVersion: 1, entityType: "award_entry", entityId: uuid(1),
  comparison: { kind: "entity_fields", changes: { year: { before: "2025", after: "2026" } } }, ...overrides,
});
const page = (entries: VersionHistoryEntry[], hasMore = false, nextCursor: Page["nextCursor"] = null): Page => ({ entries, hasMore, nextCursor });
function LocaleButton() { const { setLocale } = useUiLocale(); return <button onClick={() => setLocale("zh")}>中文</button>; }
function renderPage(repository: ResumeRepository) {
  return render(<UiLocaleProvider><LocaleButton /><VersionHistoryPage resumeId={resumeId} repository={repository} /></UiLocaleProvider>);
}
const repositoryWith = (loadVersionHistoryPage: NonNullable<ResumeRepository["loadVersionHistoryPage"]>) => ({ loadVersionHistoryPage } as ResumeRepository);

afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Version History page human-readable presentation", () => {
  it("renders V1 recorded fields with safe context and no audit-only metadata", async () => {
    const entry = { ...baseEntry(), actor_user_id: "private-user-id", ip_network: "192.0.2.0/24", request_id: "private-request",
      entity_snapshot: { secret: "must-not-render" } } as VersionHistoryEntry;
    const load = vi.fn().mockResolvedValue(page([entry]));
    renderPage(repositoryWith(load));
    expect(await screen.findByRole("heading", { name: /Awards.*Updated/, level: 2 })).toBeTruthy();
    expect(screen.getByText("Award entry")).toBeTruthy();
    expect(screen.getByText("Year")).toBeTruthy();
    expect(screen.getByText("2025")).toBeTruthy();
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByText("QA account")).toBeTruthy();
    expect(document.body.textContent).not.toContain("must-not-render");
    expect(document.body.textContent).not.toContain("192.0.2.0/24");
    expect(document.body.textContent).not.toContain("private-request");
    expect(document.body.textContent).not.toContain(entry.entityId);
    expect(load).toHaveBeenCalledWith(resumeId, 25);
    expect(screen.queryByRole("button", { name: /restore|rollback/i })).toBeNull();
  });

  it("uses presenter changes only for V2 and hides aggregate structure and unchanged fields", async () => {
    const before = [row(1, 0, "Old English", "旧中文")];
    const after = [row(1, 0, "New English", "新中文")];
    const entry = baseEntry({ payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before, after } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findAllByText("New English")).toHaveLength(2);
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText("Chinese")).toBeTruthy();
    expect(screen.getByText("Old English")).toBeTruthy();
    expect(screen.getAllByText("New English")).toHaveLength(2);
    expect(screen.getByText("旧中文")).toBeTruthy();
    expect(screen.getByText("新中文")).toBeTruthy();
    expect(document.body.textContent).not.toContain("2025");
    expect(document.body.textContent).not.toContain(uuid(1));
    expect(document.body.textContent).not.toContain("Position");
    expect(document.body.textContent).not.toContain("Shared");
    expect(document.body.textContent).not.toContain("Translations");
  });

  it("renders additions, removals, and reorder as text without IDs or numeric positions", async () => {
    const before = [row(3, 0, "Removed item", "已移除项目"), row(2, 1, "Keep", "保留"), row(5, 2, "Moved item", "调整顺序项目")];
    const after = [row(5, 0, "Moved item", "调整顺序项目"), row(2, 1, "Keep", "保留"), row(4, 2, "Added item", "新增项目")];
    const removedEvent = baseEntry({ eventId: uuid(89), operation: "delete" });
    const entry = baseEntry({ payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before, after } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry, removedEvent]))));
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByText("Added item")).toBeTruthy();
    expect(screen.getByText("Removed item")).toBeTruthy();
    expect(screen.getByText("已添加")).toBeTruthy();
    expect(screen.getAllByText("已删除").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("heading", { name: /荣誉奖项.*已删除/ })).toBeTruthy();
    expect(screen.getAllByText("顺序已调整").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\b(create|update|delete|reorder)\b/i);
    expect(document.body.textContent).not.toContain(uuid(2));
    expect(document.body.textContent).not.toContain(uuid(3));
    expect(document.body.textContent).not.toContain(uuid(4));
    expect(document.body.textContent).not.toContain(uuid(5));
    expect(document.body.textContent).not.toMatch(/Position\s*[01]/);
    const added = screen.getByText("Added item").closest("section");
    expect(added?.textContent).not.toContain("Before");
    const removed = screen.getByText("Removed item").closest("section");
    expect(removed?.textContent).not.toContain("After");
  });

  it("uses a safe generic fallback for malformed known payloads", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const entry = baseEntry({ payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before: [{ id: "bad", secret: "raw-json-must-not-render" }], after: [] } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findByText("暂时无法显示此项修改的详细内容。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /荣誉奖项.*已修改/ })).toBeTruthy();
    expect(document.body.textContent).not.toContain("raw-json-must-not-render");
    expect(document.body.textContent).not.toContain("bad");
  });

  it("keeps Files generic and never renders Storage keys or file actions", async () => {
    const entry = baseEntry({ domain: "files", entityType: "resume_file", payloadVersion: 1, entityId: null,
      comparison: { kind: "entity_fields", changes: { locale: { before: "zh", after: "en" }, object_key: { before: "qa/zh/old.pdf", after: "qa/en/new.pdf" } } } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findByText("Change details aren’t available.")).toBeTruthy();
    expect(screen.getByText("Historical file reference recorded; file availability is unknown.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("qa/zh/old.pdf");
    expect(document.body.textContent).not.toContain("qa/en/new.pdf");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: /restore|download|preview/i })).toBeNull();
  });

  it("preserves Profile photo history imagery and keeps raw references and Restore hidden", async () => {
    const entry = baseEntry({ domain: "profile", entityType: "profile_image", payloadVersion: 1, entityId: null,
      comparison: { kind: "entity_fields", changes: { object_key: { before: "profile/old.jpg", after: "profile/new.jpg" } } } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findByText("Historical photo reference recorded; file availability is unknown.")).toBeTruthy();
    expect(screen.getAllByText("Preview unavailable")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("profile/old.jpg");
    expect(document.body.textContent).not.toContain("object_key");
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
  });

  it("expands and collapses additional human-readable fields with an accessible disclosure", async () => {
    const before = [row(5, 0, "Old A", "旧甲", "2020", "2020"), row(6, 1, "Old B", "旧乙", "2021", "2021")];
    const after = [row(5, 0, "New A", "新甲", "2022", "2022"), row(6, 1, "New B", "新乙", "2023", "2023")];
    const entry = baseEntry({ payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before, after } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    expect(await screen.findAllByText("New A")).toHaveLength(2);
    expect(screen.queryByText("2023")).toBeNull();
    const more = screen.getByRole("button", { name: "Show more changes" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(screen.getAllByText("2023")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Show fewer changes" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show fewer changes" }));
    expect(screen.queryByText("2023")).toBeNull();
  });

  it("keeps long recorded values complete and only clamps them visually until expanded", async () => {
    const longValue = "Recorded award name, unchanged by the history UI. ".repeat(8);
    const entry = baseEntry({ payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before: [row(15, 0, "Old name", "旧名称")], after: [row(15, 0, longValue, "新名称")] } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    const value = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".version-history-after .version-history-long-value");
      if (!node) throw new Error("long value not rendered");
      return node;
    });
    expect(value.className).toContain("is-clamped");
    expect(value.textContent).toBe(longValue);
    fireEvent.click(screen.getByRole("button", { name: "Show more changes" }));
    const expandedValue = document.querySelector<HTMLElement>(".version-history-after .version-history-long-value");
    expect(expandedValue?.className).not.toContain("is-clamped");
    expect(expandedValue?.textContent).toBe(longValue);
  });

  it("localizes new UI labels while leaving recorded resume values untouched", async () => {
    const entry = baseEntry({ payloadVersion: 1,
      comparison: { kind: "entity_fields", changes: { name: { before: "Senior Data Analyst", after: "Principal Data Analyst" } } } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(await screen.findByRole("heading", { name: /荣誉奖项.*已修改/ })).toBeTruthy();
    expect(screen.getByText("QA account")).toBeTruthy();
    expect(screen.getByText("测试管理员")).toBeTruthy();
    expect(screen.getAllByText("荣誉名称").length).toBeGreaterThan(0);
    expect(screen.getByText("通用")).toBeTruthy();
    expect(screen.getAllByText("Senior Data Analyst").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Principal Data Analyst").length).toBeGreaterThan(0);
    expect(screen.getAllByText("修改前").length).toBeGreaterThan(0);
    expect(screen.getAllByText("修改后").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Shared");
    expect(document.body.textContent).not.toContain("Translations");
    expect(document.body.textContent).not.toContain("award_entry");
    expect(screen.getByRole("article").textContent).not.toMatch(/\b(domain|entity id|event id|request id|idempotency|digest|resolver|payload version|object key|shared|translations)\b/i);
  });

  it.each([
    ["en", "Profile details", "Contact information"],
    ["zh", "个人资料详情", "联系信息"],
  ] as const)("localizes application-defined Version History headings in %s while preserving recorded values", async (locale, profileHeading, contactHeading) => {
    if (locale === "zh") window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const profileState = (name: string) => ({
      shared: { graduation_value: "", avatar_initials: "", footer_name: "", copyright: "", photo_url: null },
      translations: {
        en: { name, nav_about_label: "About", email_action_label: "Email", graduation_label: "Graduation", avatar_label: "Photo", contact_focus_heading: "Focus", contact_status_heading: "Status" },
        zh: { name: "个人资料原文", nav_about_label: "关于", email_action_label: "邮箱", graduation_label: "毕业", avatar_label: "照片", contact_focus_heading: "关注", contact_status_heading: "状态" },
      },
    });
    const profile = baseEntry({ domain: "profile", entityType: "profile_settings", payloadVersion: 2, entityId: null,
      comparison: { kind: "aggregate", before: profileState("Recorded profile value before"), after: profileState("Recorded profile value after") } });
    const contactState = (contactLabel: string) => ({
      translations: { en: { contact_label: contactLabel, availability: "Available" }, zh: { contact_label: "联系方式原文", availability: "可联系" } },
      focus: [], status: [],
    });
    const contact = baseEntry({ eventId: uuid(91), domain: "contact", entityType: "contact_settings", payloadVersion: 2, entityId: null,
      comparison: { kind: "aggregate", before: contactState("Contact before"), after: contactState("Recorded contact value") } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([profile, contact]))));
    expect(await screen.findByRole("heading", { name: new RegExp(`${profileHeading}.*${locale === "zh" ? "已修改" : "Updated"}`), level: 3 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: new RegExp(`${contactHeading}.*${locale === "zh" ? "已修改" : "Updated"}`), level: 3 })).toBeTruthy();
    expect(screen.getByText("Recorded profile value after")).toBeTruthy();
    expect(screen.getByText("Recorded contact value")).toBeTruthy();
  });

  it("does not translate historical item labels that happen to resemble interface text", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const before = [row(92, 0, "Earlier profile", "较早的个人资料"), row(93, 1, "Earlier contact", "较早的联系方式")];
    const after = [row(92, 0, "Profile details", "个人资料"), row(93, 1, "Contact information", "联系方式")];
    const event = baseEntry({ payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before, after } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([event]))));
    await screen.findByRole("article");
    expect(screen.getByRole("heading", { level: 3, name: /Profile details.*已修改/ })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: /Contact information.*已修改/ })).toBeTruthy();
    expect(document.body.textContent).toContain("Profile details");
    expect(document.body.textContent).toContain("Contact information");
  });

  it("preserves English, Chinese, URL, and long recorded project values exactly in Chinese UI", async () => {
    const description = "Designed a forecasting model for holiday traffic.";
    const href = "https://example.com/MyEnglishPath";
    const project = (en: { title: string; subtitle: string; description: string; href: string }, zh: { title: string; subtitle: string; description: string; href: string }) => ({ id: uuid(28), position: 0,
      en: { ...en, period: "2024" },
      zh: { ...zh, period: "2024" },
      methods: { en: [], zh: [] } });
    const entry = baseEntry({ domain: "projects", payloadVersion: 2, entityType: "project_list", entityId: null,
      comparison: { kind: "aggregate", before: [project(
        { title: "Old project", subtitle: "Old subtitle", description: "Old description", href: "https://example.com/old" },
        { title: "旧中文项目", subtitle: "旧中文副标题", description: "旧中文描述", href: "https://example.com/旧路径" },
      )], after: [project(
        { title: "Senior Data Analyst", subtitle: "Data analysis", description, href },
        { title: "高级数据分析实习生", subtitle: "中文原文副标题", description: "中文历史描述", href: "https://example.com/中文路径" },
      )] } });
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([entry]))));
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    await screen.findAllByText("Senior Data Analyst");
    fireEvent.click(screen.getByRole("button", { name: "查看更多修改" }));
    for (const exactRecordedValue of ["Senior Data Analyst", "高级数据分析实习生", href, description, "https://example.com/中文路径", "中文历史描述"]) {
      expect(document.body.textContent).toContain(exactRecordedValue);
    }
    expect(document.body.textContent).not.toContain("共享");
    expect(document.body.textContent).not.toContain("译文");
    expect(document.body.textContent).not.toContain("project_list");
  });

  it("keeps the eligible Preview action localized and on the existing Preview flow", async () => {
    const event = baseEntry({ payloadVersion: 2, entityType: "award_list", entityId: null,
      comparison: { kind: "aggregate", before: [row(8, 0, "Before", "修改前")], after: [row(8, 0, "After", "修改后")] } });
    const previewCurrent = [row(8, 0, "Current", "当前")], previewTarget = [row(8, 0, "Earlier", "较早")];
    const previewRestore = vi.fn().mockResolvedValue({ status: "ready", sourceEventId: event.eventId, sourceOccurredAt: event.occurredAt,
      domain: "awards", historicalState: previewTarget, currentState: previewCurrent,
      comparison: { before: previewCurrent, after: previewTarget }, expectedCurrentDigest: "a".repeat(64) });
    const repository = { loadVersionHistoryPage: vi.fn().mockResolvedValue(page([event])), previewRestore,
      getPendingRestoreAttempt: vi.fn().mockReturnValue(null) } as unknown as ResumeRepository;
    renderPage(repository);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    fireEvent.click(await screen.findByRole("button", { name: "预览恢复内容" }));
    expect(await screen.findByRole("dialog", { name: "荣誉奖项" })).toBeTruthy();
    expect(previewRestore).toHaveBeenCalledWith({ resumeId, sourceEventId: event.eventId });
  });

  it("provides loading and empty states", async () => {
    let resolve!: (value: Page) => void;
    const deferred = new Promise<Page>(yes => { resolve = yes; });
    renderPage(repositoryWith(vi.fn().mockReturnValue(deferred)));
    expect(screen.getByRole("status").textContent).toContain("Loading Version History");
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("status").textContent).toContain("正在加载版本历史");
    resolve(page([]));
    expect(await screen.findByText("暂未记录版本历史。")).toBeTruthy();
  });

  it("uses the server cursor and appends the next server page without re-sorting", async () => {
    const first = baseEntry({ eventId: uuid(11), occurredAt: "2026-10-07T12:00:00Z" });
    const second = baseEntry({ eventId: uuid(12), occurredAt: "2026-10-06T12:00:00Z" });
    const load = vi.fn().mockResolvedValueOnce(page([first], true, { occurredAt: first.occurredAt, eventId: first.eventId })).mockResolvedValueOnce(page([second]));
    renderPage(repositoryWith(load));
    expect(await screen.findByText("QA account")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith(resumeId, 25, { occurredAt: first.occurredAt, eventId: first.eventId });
    const headings = Array.from(document.querySelectorAll(".version-history-entry article h2"), item => item.textContent);
    expect(headings).toEqual(["Awards · Updated", "Awards · Updated"]);
  });

  it("shows safe load errors and lets the admin retry", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("private token and raw payload")).mockResolvedValueOnce(page([baseEntry()]));
    renderPage(repositoryWith(load));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private token");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: /Awards.*Updated/, level: 2 })).toBeTruthy();
  });

  it("localizes first-page and load-more error recovery and pagination controls", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const first = baseEntry({ eventId: uuid(21) });
    let rejectLoadMore!: (error: Error) => void;
    const loadingMore = new Promise<Page>((_resolve, reject) => { rejectLoadMore = reject; });
    const load = vi.fn().mockRejectedValueOnce(new Error("private")).mockResolvedValueOnce(page([first], true, { occurredAt: first.occurredAt, eventId: first.eventId }))
      .mockReturnValueOnce(loadingMore).mockResolvedValueOnce(page([baseEntry({ eventId: uuid(22) })]));
    renderPage(repositoryWith(load));
    expect((await screen.findByRole("alert")).textContent).toContain("无法加载版本历史。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: /荣誉奖项.*已修改/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(screen.getByRole("button", { name: "正在加载……" }).hasAttribute("disabled")).toBe(true);
    rejectLoadMore(new Error("private"));
    expect((await screen.findByRole("alert")).textContent).toContain("无法加载更多版本历史。");
    expect(screen.getByRole("button", { name: "重试加载更多" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试加载更多" }));
    await waitFor(() => expect(document.querySelectorAll(".version-history-entry")).toHaveLength(2));
  });

  it("keeps a failed load-more recoverable while retaining loaded entries", async () => {
    const first = baseEntry({ eventId: uuid(13) });
    const load = vi.fn().mockResolvedValueOnce(page([first], true, { occurredAt: first.occurredAt, eventId: first.eventId }))
      .mockRejectedValueOnce(new Error("private"))
      .mockResolvedValueOnce(page([baseEntry({ eventId: uuid(14) })]));
    renderPage(repositoryWith(load));
    expect(await screen.findByRole("heading", { name: /Awards.*Updated/, level: 2 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.querySelectorAll(".version-history-entry")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry loading more" }));
    await waitFor(() => expect(document.querySelectorAll(".version-history-entry")).toHaveLength(2));
  });

  it("keeps the responsive layout structure content-width aware", async () => {
    renderPage(repositoryWith(vi.fn().mockResolvedValue(page([baseEntry()]))));
    await screen.findByRole("heading", { name: /Awards.*Updated/ });
    const pageElement = document.querySelector(".version-history-page");
    expect(pageElement?.className).toContain("version-history-page");
    expect(document.querySelector(".version-history-change-field")).toBeTruthy();
    expect(document.querySelector(".version-history-field-value")).toBeTruthy();
  });
});
