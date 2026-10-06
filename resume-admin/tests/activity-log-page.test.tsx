import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogPage, beijingDateRange, beijingDateStartUtc, describeAwardsActivity, describeContactActivity, describeExperienceSkillsActivity, describeFilesActivity, describeProfileActivity, describeProjectsActivity, describeWebsiteLinksActivity } from "../src/ActivityLogPage";
import type { ActivityLogEvent, ActivityLogV13CEvent, ActivityLogV13CRejectedEvent, ActivityLogV13CSuccessEvent, ResumeRepository } from "../src/data/resumeRepository";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const resumeId = "qa-resume";
function event(id: string, changes: ActivityLogEvent["changes"] = {}): ActivityLogEvent {
  return { id, occurredAt: "2026-10-02T10:00:00Z", actorEmail: "qa@example.test", actorRole: "qa", operation: "update",
    section: "introduction", entityType: "introduction_paragraph", entityId: "introduction", entitySnapshot: { paragraphs: [] }, changes,
    ipNetwork: null, countryCode: null, region: null, city: null };
}
function v13cActivity(base: ActivityLogEvent): ActivityLogV13CEvent {
  return { ...base, eventSource: "activity", sourceRank: 1, payloadVersion: 1 };
}
function rejectedEvent(id = "rejected-event"): ActivityLogV13CRejectedEvent {
  return { id, occurredAt: "2026-10-02T10:00:00Z", actorEmail: "qa@example.test", actorRole: "qa", operation: "update",
    section: "introduction", ipNetwork: null, countryCode: null, region: null, city: null,
    eventSource: "system", sourceRank: 2, eventKind: "operation_failure", outcome: "rejected",
    failureStage: "idempotency", failureCode: "idempotency_conflict", requestId: "request-qa-1",
    entityType: null, entityId: null, entitySnapshot: null, changes: null, payloadVersion: null };
}
function withLocation(base: ActivityLogEvent, location: Partial<Pick<ActivityLogEvent, "ipNetwork" | "countryCode" | "region" | "city">>): ActivityLogEvent {
  return { ...base, ...location };
}
function visibleLocationText(): string {
  const row = document.querySelector(".activity-log-location");
  return row ? Array.from(row.childNodes).slice(0, 2).map(node => node.textContent ?? "").join("").trim() : "";
}
function renderPage(repository: ResumeRepository) {
  const loadV13C = vi.fn(async (id: string, size: number, filters: Parameters<NonNullable<ResumeRepository["loadActivityLogPageV13C"]>>[2], cursor?: Parameters<NonNullable<ResumeRepository["loadActivityLogPageV13C"]>>[3]) => {
    const page = repository.loadActivityLogPageV13C
      ? await repository.loadActivityLogPageV13C(id, size, filters, cursor)
      : await repository.loadActivityLogPage!(id, size, cursor && { occurredAt: cursor.occurredAt, id: cursor.id });
    return page.map(row => "eventSource" in row ? row as ActivityLogV13CEvent : v13cActivity(row as ActivityLogEvent));
  });
  const compatible = { ...repository, loadActivityLogPageV13C: loadV13C } as ResumeRepository;
  return { ...render(<UiLocaleProvider><ActivityLogPage resumeId={resumeId} repository={compatible} /></UiLocaleProvider>), repository: compatible };
}
afterEach(() => { cleanup(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Activity Log page", () => {
  it("derives collection additions/removals/translation edits and relative reorder without UUID labels", () => {
    const item = (id: string, position: number, zhName: string, enName = "Award") => ({ id, position,
      zh: { name: zhName, year: "2025" }, en: { name: enName, year: "2025" } });
    const first = item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 0, "甲");
    const second = item("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1, "乙");
    const inserted = item("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 2, "丙");
    const base = event("award-v2");
    const v2: ActivityLogV13CEvent = { ...base, section: "awards", entityType: "award_list", entityId: null,
      entitySnapshot: { awards: [first, second, inserted] }, changes: { awards: { before: [first, second], after: [first, second, inserted] } },
      eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeAwardsActivity(v2)).toEqual([{ kind: "Added", label: "丙" }]);
    expect(describeAwardsActivity({ ...v2, changes: { awards: { before: [first, second], after: [first] } } }))
      .toEqual([{ kind: "Removed", label: "乙" }]);
    expect(describeAwardsActivity({ ...v2, changes: { awards: { before: [first], after: [] } } }))
      .toEqual([{ kind: "Removed", label: "甲" }]);
    expect(describeAwardsActivity({ ...v2, changes: { awards: { before: [], after: [item("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 0, "丙")] } } }))
      .toEqual([{ kind: "Added", label: "丙" }]);
    const editedAndMoved: ActivityLogV13CEvent = { ...v2, changes: { awards: { before: [first, second], after: [
      { ...second, position: 0, zh: { ...second.zh, year: "2026" } }, { ...first, position: 1 },
    ] } } };
    expect(describeAwardsActivity(editedAndMoved)).toEqual([
      { kind: "Updated", label: "乙", locale: "Chinese", field: "Year", before: "2025", after: "2026" },
      { kind: "Reordered", label: "Awards" },
    ]);
  });

  it("describes Experience and Skills collection diffs with shared-ID relative reorder semantics", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const priorExp = { id: a, position: 0, zh: { organization: "甲组织", title: "工程师", period: "2024", description: "旧描述", location: null },
      en: { organization: "Org A", title: "Engineer", period: "2024", description: "Old", location: "" } };
    const nextExp = { ...priorExp, position: 1, zh: { ...priorExp.zh, description: "新描述", location: "上海" } };
    const otherExp = { ...priorExp, id: b, position: 0, zh: { ...priorExp.zh, organization: "乙组织" } };
    const base = event("experience-v2");
    const expEvent: ActivityLogV13CEvent = { ...base, section: "experience", entityType: "experience_list", entityId: null,
      entitySnapshot: { experience: [otherExp, nextExp] }, changes: { experience: { before: [priorExp], after: [otherExp, nextExp] } },
      eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeExperienceSkillsActivity(expEvent)).toEqual([
      { kind: "Added", label: "乙组织" },
      { kind: "Updated", label: "甲组织", locale: "Chinese", field: "Experience description", before: "旧描述", after: "新描述" },
      { kind: "Updated", label: "甲组织", locale: "Chinese", field: "Experience location", before: "null", after: "上海" },
    ]);
    const firstSkill = { id: a, position: 0, zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "Chinese" } };
    const secondSkill = { id: b, position: 1, zh: { title: "工具", items: "SQL" }, en: { title: "Tools", items: "SQL" } };
    const reordered: ActivityLogV13CEvent = { ...base, section: "skills", entityType: "skill_group_list", entityId: null,
      entitySnapshot: { skills: [secondSkill, firstSkill] }, changes: { skills: { before: [firstSkill, secondSkill], after: [secondSkill, firstSkill] } },
      eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeExperienceSkillsActivity(reordered)).toEqual([{ kind: "Reordered", label: "Skills" }]);
  });

  it("decodes and renders the explicit Website Links and Files V2 contracts without exposing a file URL", async () => {
    const websiteBefore = { shared: { email: "a@example.test", github: "", github_label: "GitHub", linkedin_display_name: "Name", email_label: "Email", linkedin_label: "LinkedIn" },
      translations: { zh: { linkedin_label: "领英", linkedin_href: "", portfolio_label: "简历", updated_at_label: "更新" }, en: { linkedin_label: "LinkedIn", linkedin_href: "", portfolio_label: "Resume", updated_at_label: "Updated" } },
      navigation: [0, 1, 2, 3, 4].map(position => ({ navigation_item_id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${position + 1}`, position, zh: { label: `中文${position}` }, en: { label: `English ${position}` } })) };
    const websiteAfter = structuredClone(websiteBefore);
    websiteAfter.translations.en.updated_at_label = "Updated on";
    const base = event("website-links-v2");
    const websiteEvent: ActivityLogV13CEvent = { ...base, section: "website_links", entityType: "website_links_settings", entityId: null,
      entitySnapshot: { website_links: websiteAfter }, changes: { website_links: { before: websiteBefore, after: websiteAfter } },
      eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeWebsiteLinksActivity(websiteEvent)).toEqual([{ kind: "Updated", label: "Site text", locale: "English", field: "Updated-at label", before: "Updated", after: "Updated on" }]);

    const filesBefore = { translations: { zh: { portfolio_href: "" }, en: { portfolio_href: "" } } };
    const filesAfter = { translations: { zh: { portfolio_href: "" }, en: { portfolio_href: "https://storage.example.test/storage/v1/object/public/resume-files/qa-resume/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf" } } };
    const fileEvent: ActivityLogV13CEvent = { ...base, id: "files-v2", section: "files", entityType: "resume_file_set", entityId: null,
      entitySnapshot: { files: filesAfter }, changes: { files: { before: filesBefore, after: filesAfter } },
      eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeFilesActivity(fileEvent)).toEqual([{ kind: "Updated", label: "Resume files", locale: "English", field: "Resume PDF", before: "Not set", after: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf" }]);
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
      loadActivityLogPage: vi.fn().mockResolvedValue([fileEvent]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByRole("heading", { name: "Files" })).toBeTruthy();
    expect(screen.getByText(/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\.pdf/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("storage.example.test");
  });

  it("renders V2 Experience/Skills semantic rows in English and Chinese", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const row = { id, position: 0, zh: { title: "语言", items: "中文" }, en: { title: "Languages", items: "Chinese" } };
    const v2: ActivityLogV13CEvent = { ...event("skill-v2"), section: "skills", entityType: "skill_group_list", entityId: null,
      entitySnapshot: { skills: [row] }, changes: { skills: { before: [], after: [row] } },
      eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
      loadActivityLogPageV13C: vi.fn().mockResolvedValue([v2]) } as unknown as ResumeRepository;
    renderPage(repository);
    fireEvent.click(await screen.findByText(/View changed fields/));
    expect(await screen.findByText("Added")).toBeTruthy();
    cleanup(); window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    renderPage(repository);
    fireEvent.click(await screen.findByText(/查看变更字段/));
    expect(await screen.findByText("已添加")).toBeTruthy();
  });

  it("describes Education aggregate additions and bilingual field edits", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const before = { id, position: 0, entry_type: "summerSchool", education_category: null,
      zh: { title: "暑期学校", program: "旧项目", period: "2025", grade: "A", course_title: null, course_description: "", custom_category_label: null },
      en: { title: "Summer School", program: "Old program", period: "2025", grade: "A", course_title: null, course_description: "", custom_category_label: null } };
    const after = { ...before, zh: { ...before.zh, program: "新项目" }, en: { ...before.en, program: "New program" } };
    const base = event("education-v2");
    const v2: ActivityLogV13CEvent = { ...base, section: "education", entityType: "education_list", entityId: null,
      entitySnapshot: { education: [after] }, changes: { education: { before: [before], after: [after] } },
      eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeExperienceSkillsActivity(v2)).toEqual([
      { kind: "Updated", label: "暑期学校", locale: "Chinese", field: "Education program", before: "旧项目", after: "新项目" },
      { kind: "Updated", label: "暑期学校", locale: "English", field: "Education program", before: "Old program", after: "New program" },
    ]);
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
      loadActivityLogPageV13C: vi.fn().mockResolvedValue([v2]) } as unknown as ResumeRepository;
    renderPage(repository);
    fireEvent.click(await screen.findByText(/View changed fields/));
    expect(await screen.findByText(/Chinese · Education program · 暑期学校 · Before: 旧项目 · After: 新项目/)).toBeTruthy();
    expect(screen.getByText(/English · Education program · 暑期学校 · Before: Old program · After: New program/)).toBeTruthy();
  });

  it("describes Contact V2 bilingual fields, Focus/Status edits, type changes, and order", () => {
    const focusId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const statusId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const translations = { zh: { contact_label: "联系", availability: "交流" }, en: { contact_label: "Contact", availability: "Open" } };
    const before = { translations, focus: [{ id: focusId, position: 3, zh: { title: "实践", detail: "旧细节" }, en: { title: "Practice", detail: "Old detail" } }],
      status: [{ id: statusId, position: 2, status_type: "open", zh: { title: "开放", detail: "交流" }, en: { title: "Open", detail: "Discuss" } }] };
    const after = { translations: { ...translations, zh: { ...translations.zh, contact_label: "联系我" } },
      focus: [{ ...before.focus[0]!, position: 0, zh: { ...before.focus[0]!.zh, detail: "新细节" } }],
      status: [{ ...before.status[0]!, position: 0, status_type: "study" }] };
    const base = event("contact-v2");
    const v2: ActivityLogV13CEvent = { ...base, section: "contact", entityType: "contact_section", entityId: null,
      entitySnapshot: { contact: after }, changes: { contact: { before, after } }, eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeContactActivity(v2)).toEqual([
      { kind: "Updated", label: "Contact", locale: "Chinese", field: "Contact label", before: "联系", after: "联系我" },
      { kind: "Updated", label: "实践", locale: "Chinese", field: "Focus detail", before: "旧细节", after: "新细节" },
      { kind: "Updated", label: "开放", field: "Status type", before: "open", after: "study" },
    ]);
  });

  it("renders Contact V2 semantic changes in the Activity Log UI", async () => {
    const before = { translations: { zh: { contact_label: "联系", availability: "旧状态" }, en: { contact_label: "Contact", availability: "Old availability" } }, focus: [], status: [] };
    const after = { ...before, translations: { ...before.translations, en: { ...before.translations.en, availability: "New availability" } } };
    const row: ActivityLogV13CEvent = { ...event("contact-render-v2"), section: "contact", entityType: "contact_section", entityId: null,
      entitySnapshot: { contact: after }, changes: { contact: { before, after } }, eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
      loadActivityLogPageV13C: vi.fn().mockResolvedValue([row]) } as unknown as ResumeRepository;
    renderPage(repository);
    fireEvent.click(await screen.findByText(/View changed fields/));
    expect(await screen.findByText(/Availability/)).toBeTruthy();
    const changeText = document.querySelector(".activity-log-change")?.textContent ?? "";
    expect(changeText).toContain("Old availability");
    expect(changeText).toContain("New availability");
  });

  it("describes Projects method edits and renders a Projects V2 event with sparse before positions", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const project = (positions: number[], values: string[]) => ({ id, position: 0,
      zh: { title: "项目甲", subtitle: "", period: "2024", description: "", href: "" },
      en: { title: "Project A", subtitle: "", period: "2024", description: "", href: "" },
      methods: { zh: positions.map((position, i) => ({ id: `${String.fromCharCode(97 + i).repeat(8)}-${String.fromCharCode(97 + i).repeat(4)}-4${String.fromCharCode(97 + i).repeat(3)}-8${String.fromCharCode(97 + i).repeat(3)}-${String.fromCharCode(97 + i).repeat(12)}`, position, value: values[i]! })), en: [] },
    });
    const before = project([0, 1, 3], ["规划", "设计", "交付"]);
    const after = project([0, 1, 2], ["规划", "设计", "上线"]);
    const base = event("projects-v2");
    const v2: ActivityLogV13CEvent = { ...base, section: "projects", entityType: "project_list", entityId: null,
      entitySnapshot: { projects: [after] }, changes: { projects: { before: [before], after: [after] } }, eventSource: "activity", sourceRank: 1, payloadVersion: 2 };
    expect(describeProjectsActivity(v2)).toEqual([{ kind: "Updated", label: "项目甲", locale: "Chinese", field: "Project method", before: "交付", after: "上线" }]);
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
      loadActivityLogPageV13C: vi.fn().mockResolvedValue([v2]) } as unknown as ResumeRepository;
    renderPage(repository);
    fireEvent.click(await screen.findByText(/View changed fields/));
    expect(await screen.findByText(/Project method/)).toBeTruthy();
  });

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
    expect(view.repository.loadActivityLogPageV13C).toHaveBeenCalledWith(resumeId, 25, expect.objectContaining({ eventFilter: "all", section: "", search: "" }), undefined);
  });

  it.each([["All events", "all"], ["Successful activity", "successful"], ["Rejected operations", "rejected"]] as const)(
    "applies the %s event filter and starts a fresh page chain", async (_label, eventFilter) => {
      const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([]) } as unknown as ResumeRepository;
      const view = renderPage(repository);
      await screen.findByText("No activity has been recorded yet.");
      fireEvent.change(screen.getByLabelText("Event type"), { target: { value: eventFilter } });
      fireEvent.click(screen.getByText("Apply"));
      await waitFor(() => expect(view.repository.loadActivityLogPageV13C).toHaveBeenCalledTimes(2));
      expect(view.repository.loadActivityLogPageV13C).toHaveBeenLastCalledWith(resumeId, 25, expect.objectContaining({ eventFilter }), undefined);
    },
  );

  it("renders rejected system metadata without a changed-fields or entity presentation", async () => {
    const rejected = { ...rejectedEvent(), ipNetwork: "188.253.112.0/24", countryCode: "HK", city: "Hong Kong" };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPageV13C: vi.fn().mockResolvedValue([rejected]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByText("Rejected operation")).toBeTruthy();
    expect(screen.getByText("Idempotency")).toBeTruthy();
    expect(screen.getByText("idempotency_conflict")).toBeTruthy();
    expect(screen.getByText("request-qa-1")).toBeTruthy();
    expect(visibleLocationText()).toBe("Approximate IP location: Hong Kong, HK · 188.253.112.0/24");
    expect(screen.queryByText("View changed fields")).toBeNull();
    expect(screen.queryByText("introduction_paragraph")).toBeNull();
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("renders Profile V2 translation and shared-field changes from the complete aggregate", async () => {
    const profile = (name: string, graduation: string) => ({
      shared: { graduation_value: graduation, avatar_initials: "DU", footer_name: "Demo", copyright: "© Demo", photo_url: null },
      translations: Object.fromEntries(["zh", "en"].map(locale => [locale, { name, nav_about_label: "About", email_action_label: "Email",
        graduation_label: "Graduation", avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status" }])),
    });
    const before = profile("Old name", "2025"); const after = profile("New name", "2026");
    const row = { ...event("profile-v2", { profile: { before, after } }), section: "profile", entityType: "profile_settings", entityId: null,
      entitySnapshot: { profile: after } } as ActivityLogEvent;
    const activity = { ...v13cActivity(row), payloadVersion: 2 as const } as ActivityLogV13CSuccessEvent;
    expect(describeProfileActivity(activity).map(line => [line.locale, line.field, line.before, line.after])).toEqual([
      [undefined, "Graduation value", "2025", "2026"], ["Chinese", "Name", "Old name", "New name"], ["English", "Name", "Old name", "New name"],
    ]);
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
      loadActivityLogPageV13C: vi.fn().mockResolvedValue([activity]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByText(/Update by QA/)).toBeTruthy();
    fireEvent.click(screen.getByText(/View changed fields/));
    expect(await screen.findByText(/Graduation value/)).toBeTruthy();
    expect(screen.getByText(/English.*Name.*Before: Old name.*After: New name/)).toBeTruthy();
  });

  it("localizes rejected-event labels and the approximate-location label in Chinese", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const rejected = { ...rejectedEvent(), ipNetwork: "188.253.112.0/24", countryCode: "HK", city: "Hong Kong" };
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPageV13C: vi.fn().mockResolvedValue([rejected]) } as unknown as ResumeRepository;
    renderPage(repository);
    expect(await screen.findByText("操作被拒绝")).toBeTruthy();
    expect(screen.getByText("失败阶段")).toBeTruthy();
    expect(screen.getByText("幂等性")).toBeTruthy();
    expect(screen.getByText("失败代码")).toBeTruthy();
    expect(screen.getByText("请求 ID")).toBeTruthy();
    expect(visibleLocationText()).toBe("IP 大致位置：Hong Kong, HK · 188.253.112.0/24");
  });

  it("continues a mixed-source page using source rank and preserves same-ID rows", async () => {
    const system = rejectedEvent("collision-id");
    const activity = v13cActivity({ ...event("collision-id", { text: { before: "before", after: "after" } }), occurredAt: system.occurredAt });
    const firstPage: ActivityLogV13CEvent[] = [
      ...Array.from({ length: 24 }, (_, index) => v13cActivity(event(`first-${index}`))),
      system,
    ];
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPageV13C: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([activity]) } as unknown as ResumeRepository;
    const view = renderPage(repository);
    await screen.findByText("Load more");
    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() => expect(view.repository.loadActivityLogPageV13C).toHaveBeenCalledTimes(2));
    expect(view.repository.loadActivityLogPageV13C).toHaveBeenNthCalledWith(2, resumeId, 25, expect.objectContaining({ eventFilter: "all" }), {
      occurredAt: system.occurredAt, id: system.id, sourceRank: 2,
    });
    await waitFor(() => expect(document.querySelectorAll(".activity-log-event")).toHaveLength(26));
    expect(document.querySelectorAll(".activity-log-event")[24].textContent).toContain("Rejected operation");
    expect(document.querySelectorAll(".activity-log-event")[25].querySelector("details")).toBeTruthy();
  });

  it("uses source-aware row identity for equal IDs from separate sources", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rejected = rejectedEvent("same-id");
    const activity = v13cActivity({ ...event("same-id", { text: { before: "before", after: "after" } }), occurredAt: rejected.occurredAt });
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPageV13C: vi.fn().mockResolvedValue([rejected, activity]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText("Rejected operation");
    await screen.findByText("View changed fields (1)");
    expect(document.querySelectorAll(".activity-log-event")).toHaveLength(2);
    expect(errors.mock.calls.flat().join(" ")).not.toContain("same key");
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
    expect(view.repository.loadActivityLogPageV13C).toHaveBeenNthCalledWith(2, resumeId, 25, expect.objectContaining({ eventFilter: "all", section: "", operation: "" }), { occurredAt: firstPage[24].occurredAt, id: firstPage[24].id, sourceRank: 1 });
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
    expect(visibleLocationText()).toBe("Approximate IP location: San Francisco, California, US · 203.0.113.0/24");
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
    expect(visibleLocationText()).toBe("IP 大致位置：Hong Kong, HK · 188.253.112.0/24");
  });

  it("shows geo-only metadata when there is no IP network", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([withLocation(event("location-geo-only"), {
      city: "San Francisco", region: "California", countryCode: "US",
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText(/San Francisco, California, US/);
    expect(visibleLocationText()).toBe("Approximate IP location: San Francisco, California, US");
  });

  it("shows only the IP network when geographic metadata is absent", async () => {
    const repository = { loadActivityLogAuthorizedTargets: vi.fn().mockResolvedValue([{ resumeId, siteKey: "example-cv-qa", role: "qa" }]), loadActivityLogPage: vi.fn().mockResolvedValue([withLocation(event("location-network-only"), {
      ipNetwork: "188.253.112.0/24",
    })]) } as unknown as ResumeRepository;
    renderPage(repository);
    await screen.findByText("188.253.112.0/24");
    expect(visibleLocationText()).toBe("Approximate IP location: 188.253.112.0/24");
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
    const reader = vi.mocked(view.repository.loadActivityLogPageV13C!);
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
    expect(view.repository.loadActivityLogPageV13C).toHaveBeenLastCalledWith(resumeId, 25, expect.objectContaining({ eventFilter: "all", actorEmail: "", dateFrom: null, dateToExclusive: null }), undefined);
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
    const callsBefore = vi.mocked(view.repository.loadActivityLogPageV13C!).mock.calls.length;
    fireEvent.click(screen.getByText("Apply"));
    expect(screen.getByRole("alert").textContent).toBe("Invalid date range.");
    expect(view.repository.loadActivityLogPageV13C).toHaveBeenCalledTimes(callsBefore);
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
