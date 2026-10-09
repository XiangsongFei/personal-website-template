import { describe, expect, it } from "vitest";
import type { VersionHistoryEntry, VersionHistoryJson } from "../src/data/resumeRepository";
import { presentVersionHistoryChange } from "../src/data/versionHistoryPresenter";

const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const entry = (overrides: Partial<VersionHistoryEntry> = {}): VersionHistoryEntry => ({
  eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", occurredAt: "2026-10-01T00:00:00Z", actorAccountLabel: "test account",
  actorRole: "qa", domain: "awards", operation: "update", payloadVersion: 2, entityType: "award_list", entityId: null,
  comparison: { kind: "aggregate", before: [], after: [] }, ...overrides,
});
const award = (id: string, position: number, enName: string, zhName: string, enYear = "2099", zhYear = "2099") => ({
  id, position, en: { name: enName, year: enYear }, zh: { name: zhName, year: zhYear },
});
const aggregate = (before: VersionHistoryJson, after: VersionHistoryJson, overrides: Partial<VersionHistoryEntry> = {}) =>
  entry({ ...overrides, comparison: { kind: "aggregate", before, after } });

describe("presentVersionHistoryChange", () => {
  it("summarizes an Awards field update with locale and omits unchanged values", () => {
    const result = presentVersionHistoryChange(aggregate(
      [award(idA, 0, "QA Synthetic Award 2 [EN ADV]", "QA 虚构奖项 2")],
      [award(idA, 0, "QA Synthetic Award 2", "QA 虚构奖项 2")],
    ));
    expect(result.state).toBe("changes");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ state: "updated", label: "QA Synthetic Award 2" });
    expect(result.items[0]?.fields).toEqual([{ key: "name", locale: "en", kind: "updated",
      before: { recorded: true, value: "QA Synthetic Award 2 [EN ADV]" }, after: { recorded: true, value: "QA Synthetic Award 2" } }]);
    expect(JSON.stringify(result)).not.toContain(idA);
  });

  it("preserves bilingual separation and reports Chinese name and year changes only", () => {
    const result = presentVersionHistoryChange(aggregate([award(idA, 0, "Same", "旧名", "2099", "2020")],
      [award(idA, 0, "Same", "新名", "2099", "2021")]));
    expect(result.items[0]?.fields.map(({ key, locale }) => [key, locale])).toEqual([["name", "zh"], ["year", "zh"]]);
    expect(result.items[0]?.fields[0]?.before).toEqual({ recorded: true, value: "旧名" });
  });

  it("reports an English year update while suppressing unchanged fields in both locales", () => {
    const result = presentVersionHistoryChange(aggregate([award(idA, 0, "Same", "相同", "2020", "2020")],
      [award(idA, 0, "Same", "相同", "2021", "2020")]));
    expect(result.items[0]?.fields).toEqual([{ key: "year", locale: "en", kind: "updated",
      before: { recorded: true, value: "2020" }, after: { recorded: true, value: "2021" } }]);
  });

  it("marks added and removed items without fabricating values on the absent side", () => {
    const added = presentVersionHistoryChange(aggregate([], [award(idA, 0, "New", "新")])).items[0]!;
    expect(added.state).toBe("added");
    expect(added.fields[0]?.before).toEqual({ recorded: false });
    expect(added.fields[0]?.after).toEqual({ recorded: true, value: "New" });
    const removed = presentVersionHistoryChange(aggregate([award(idA, 0, "Old", "旧")], [])).items[0]!;
    expect(removed.state).toBe("removed");
    expect(removed.fields[0]?.before).toEqual({ recorded: true, value: "Old" });
    expect(removed.fields[0]?.after).toEqual({ recorded: false });
  });

  it("reports a reorder semantically without exposing numeric positions", () => {
    const result = presentVersionHistoryChange(aggregate(
      [award(idA, 0, "A", "甲"), award(idB, 1, "B", "乙")],
      [award(idB, 0, "B", "乙"), award(idA, 1, "A", "甲")],
    ));
    expect(result.items.filter(item => item.state === "reordered").map(item => item.label).sort()).toEqual(["A", "B"]);
    expect(JSON.stringify(result)).not.toContain("position");
    expect(JSON.stringify(result)).not.toContain('"0"');
  });

  it("does not call an insertion-induced index shift a reorder", () => {
    const result = presentVersionHistoryChange(aggregate([award(idA, 0, "A", "甲")],
      [award(idB, 0, "B", "乙"), award(idA, 1, "A", "甲")]));
    expect(result.items.map(item => item.state)).toEqual(["added"]);
  });

  it("retains null and empty-string distinctions", () => {
    const before = [{ id: idA, position: 0, en: { organization: "", title: "Role", period: "", description: "", location: null },
      zh: { organization: "", title: "职位", period: "", description: "", location: null } }];
    const after = [{ ...before[0]!, en: { ...before[0]!.en, location: "" } }];
    const result = presentVersionHistoryChange(aggregate(before as unknown as VersionHistoryJson, after as unknown as VersionHistoryJson,
      { domain: "experience", entityType: "experience_list" }));
    expect(result.items[0]?.fields).toEqual([{ key: "location", locale: "en", kind: "updated",
      before: { recorded: true, value: null }, after: { recorded: true, value: "" } }]);
  });

  it("fails closed for malformed, ambiguous, and unsupported history", () => {
    const malformed = presentVersionHistoryChange(aggregate([{ ...award(idA, 0, "A", "甲"), extra: "unexpected" }], []));
    expect(malformed).toMatchObject({ state: "generic", items: [] });
    const duplicate = presentVersionHistoryChange(aggregate([award(idA, 0, "A", "甲"), award(idA, 1, "B", "乙")], []));
    expect(duplicate.state).toBe("generic");
    expect(presentVersionHistoryChange(entry({ payloadVersion: 9 })).state).toBe("generic");
    expect(presentVersionHistoryChange(entry({ payloadVersion: 1, comparison: { kind: "entity_fields", changes: {
      year: { before: "2025", after: "2026", extra: "not allowed" },
    } } as unknown as VersionHistoryEntry["comparison"] })).state).toBe("generic");
    expect(presentVersionHistoryChange(entry({ domain: "files", entityType: "resume_file", payloadVersion: 1,
      comparison: { kind: "entity_fields", changes: { object_key: { before: "private/key", after: "new/key" } } } })).state).toBe("generic");
    expect(presentVersionHistoryChange(entry({ domain: "experience", entityType: "award_entry", payloadVersion: 1,
      comparison: { kind: "entity_fields", changes: { year: { before: "2025", after: "2026" } } } })).state).toBe("generic");
  });

  it("is deterministic and does not mutate the source event", () => {
    const source = aggregate([award(idA, 0, "Old", "旧")], [award(idA, 0, "New", "新")]);
    const original = structuredClone(source);
    expect(presentVersionHistoryChange(source)).toEqual(presentVersionHistoryChange(source));
    expect(source).toEqual(original);
  });

  it("presents V1 only from recorded fields and uses neutral labels when no label exists", () => {
    const result = presentVersionHistoryChange(entry({ payloadVersion: 1, entityType: "award_entry", entityId: idA,
      comparison: { kind: "entity_fields", changes: { year: { before: "2025", after: "2026" } } } }));
    expect(result.items[0]).toMatchObject({ itemType: "award", label: null, state: "updated" });
    expect(result.items[0]?.fields.map(value => value.locale)).toEqual(["shared"]);
    expect(JSON.stringify(result)).not.toContain(idA);
  });

  it("supports long bilingual Experience fields without truncation", () => {
    const long = "Long English description ".repeat(80);
    const row = (description: string) => ({ id: idA, position: 0,
      en: { organization: "Org", title: "Role", period: "2020", description, location: null },
      zh: { organization: "组织", title: "职位", period: "2020", description: "说明", location: null } });
    const result = presentVersionHistoryChange(aggregate([row("old")], [row(long)], { domain: "experience", entityType: "experience_list" }));
    expect(result.items[0]?.fields.find(value => value.key === "description")?.after).toEqual({ recorded: true, value: long });
    expect(JSON.stringify(result)).not.toContain(idA);
  });

  it("reports Experience reorder only when stable-ID order changes", () => {
    const row = (id: string, position: number, title: string) => ({ id, position,
      en: { organization: "Org", title, period: "2020", description: "", location: null },
      zh: { organization: "组织", title, period: "2020", description: "", location: null } });
    const result = presentVersionHistoryChange(aggregate([row(idA, 0, "A"), row(idB, 1, "B")],
      [row(idB, 0, "B"), row(idA, 1, "A")], { domain: "experience", entityType: "experience_list" }));
    expect(result.items.map(item => item.state).sort()).toEqual(["reordered", "reordered"]);
    expect(JSON.stringify(result)).not.toContain("position");
  });

  it("treats Skills items as localized text and does not invent item identities", () => {
    const row = (items: string) => ({ id: idA, position: 0, en: { title: "Tools", items }, zh: { title: "工具", items: "技能" } });
    const result = presentVersionHistoryChange(aggregate([row("React, SQL")], [row("React, SQL, Rust")], { domain: "skills", entityType: "skill_group_list" }));
    expect(result.items[0]?.fields).toEqual([{ key: "items", locale: "en", kind: "updated",
      before: { recorded: true, value: "React, SQL" }, after: { recorded: true, value: "React, SQL, Rust" } }]);
    expect(result.items[0]?.fields).toHaveLength(1);
    expect(result.items[0]?.fields[0]?.after).toEqual({ recorded: true, value: "React, SQL, Rust" });
  });

  it("preserves Education null/custom semantics", () => {
    const row = (category: string | null) => ({ id: idA, position: 0, entry_type: "standard", education_category: category,
      en: { title: "School", program: "Program", period: "2020", grade: "A", course_title: null, course_description: null, custom_category_label: null },
      zh: { title: "学校", program: "项目", period: "2020", grade: "优", course_title: null, course_description: null, custom_category_label: null } });
    const result = presentVersionHistoryChange(aggregate([row(null)], [row("custom")], { domain: "education", entityType: "education_list" }));
    expect(result.items[0]?.fields).toEqual([{ key: "education_category", locale: "shared", kind: "updated",
      before: { recorded: true, value: null }, after: { recorded: true, value: "custom" } }]);
  });

  it("preserves Education bilingual changes and does not turn null into a display value", () => {
    const row = (enTitle: string, zhTitle: string) => ({ id: idA, position: 0, entry_type: "standard", education_category: null,
      en: { title: enTitle, program: "Program", period: "2020", grade: "", course_title: null, course_description: null, custom_category_label: null },
      zh: { title: zhTitle, program: "项目", period: "2020", grade: "", course_title: null, course_description: null, custom_category_label: null } });
    const result = presentVersionHistoryChange(aggregate([row("Old", "旧")], [row("New", "新")], { domain: "education", entityType: "education_list" }));
    expect(result.items[0]?.fields.map(({ key, locale }) => [key, locale])).toEqual([["title", "en"], ["title", "zh"]]);
    expect(result.items[0]?.fields.every(change => "recorded" in change.before && change.before.recorded
      && "recorded" in change.after && change.after.recorded)).toBe(true);
  });

  it("summarizes Projects and stable method subentry changes without exposing IDs", () => {
    const project = (title: string, method: string) => [{ id: idA, position: 0,
      zh: { title: "项目", subtitle: "", period: "", description: "", href: "" },
      en: { title, subtitle: "", period: "", description: "", href: "https://example.test" },
      methods: { en: [{ id: idB, position: 0, value: method }], zh: [] } }];
    const result = presentVersionHistoryChange(aggregate(project("Old", "Old method"), project("New", "New method"),
      { domain: "projects", entityType: "project_list" }));
    expect(result.items[0]?.fields).toEqual([{ key: "title", locale: "en", kind: "updated",
      before: { recorded: true, value: "Old" }, after: { recorded: true, value: "New" } }]);
    expect(result.items[0]?.children[0]?.fields[0]).toMatchObject({ key: "value", locale: "en", before: { value: "Old method" }, after: { value: "New method" } });
    expect(JSON.stringify(result)).not.toContain(idA);
    expect(JSON.stringify(result)).not.toContain(idB);
  });

  it("detects Project additions/removals and project order changes from stable IDs", () => {
    const project = (id: string, position: number, title: string) => ({ id, position,
      zh: { title: "项目", subtitle: "", period: "", description: "", href: "" },
      en: { title, subtitle: "", period: "", description: "", href: "" }, methods: { en: [], zh: [] } });
    const entity = (rows: ReturnType<typeof project>[]) => rows;
    const removedAndAdded = presentVersionHistoryChange(aggregate(entity([project(idA, 0, "Old")]),
      entity([project(idB, 0, "New")]), { domain: "projects", entityType: "project_list" }));
    expect(removedAndAdded.items.map(item => item.state).sort()).toEqual(["added", "removed"]);
    const reordered = presentVersionHistoryChange(aggregate(entity([project(idA, 0, "A"), project(idB, 1, "B")]),
      entity([project(idB, 0, "B"), project(idA, 1, "A")]), { domain: "projects", entityType: "project_list" }));
    expect(reordered.items.map(item => item.state).sort()).toEqual(["reordered", "reordered"]);
    expect(JSON.stringify(reordered)).not.toContain("position");
  });

  it("summarizes Contact additions and localized updates", () => {
    const contact = (title: string, id = idA) => ({ translations: { en: { contact_label: "Contact", availability: "Open" }, zh: { contact_label: "联系", availability: "开放" } },
      focus: [{ id, position: 0, en: { title, detail: "Details" }, zh: { title: "中文", detail: "详情" } }], status: [] });
    const result = presentVersionHistoryChange(aggregate(contact("Updated"), contact("Updated", idB), { domain: "contact", entityType: "contact_section" }));
    expect(result.items[0]?.children.map(item => item.state)).toContain("added");
    const change = presentVersionHistoryChange(aggregate(contact("Old"), contact("New"), { domain: "contact", entityType: "contact_section" }));
    expect(change.items[0]?.children[0]?.fields.find(value => value.key === "title")?.locale).toBe("en");
  });

  it("summarizes Contact removals and relative reorder without exposing positions", () => {
    const item = (id: string, position: number, title: string) => ({ id, position,
      en: { title, detail: "Detail" }, zh: { title, detail: "详情" } });
    const contact = (rows: ReturnType<typeof item>[]) => ({ translations: { en: { contact_label: "Contact", availability: "Open" }, zh: { contact_label: "联系", availability: "开放" } }, focus: rows, status: [] });
    const result = presentVersionHistoryChange(aggregate(contact([item(idA, 0, "A"), item(idB, 1, "B")]),
      contact([item(idB, 0, "B")]), { domain: "contact", entityType: "contact_section" }));
    const children = result.items[0]?.children ?? [];
    expect(children.some(child => child.state === "removed" && child.label === "A")).toBe(true);
    expect(children.some(child => child.state === "reordered")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("position");
    const moved = presentVersionHistoryChange(aggregate(contact([item(idA, 0, "A"), item(idB, 1, "B")]),
      contact([item(idB, 0, "B"), item(idA, 1, "A")]), { domain: "contact", entityType: "contact_section" }));
    expect(moved.items[0]?.children.map(child => child.state).sort()).toEqual(["reordered", "reordered"]);
  });

  it("summarizes Website & Links values without promoting internal IDs or URLs to labels", () => {
    const website = (href: string) => ({ shared: { email: "a@example.test", github: "gh", github_label: "GitHub", linkedin_display_name: "Li", email_label: "Email", linkedin_label: "LinkedIn" },
      translations: { en: { linkedin_label: "LinkedIn", linkedin_href: href, portfolio_label: "Portfolio", updated_at_label: "Updated" },
        zh: { linkedin_label: "领英", linkedin_href: "https://zh.example.test", portfolio_label: "作品集", updated_at_label: "更新" } },
      navigation: Array.from({ length: 5 }, (_, position) => ({ navigation_item_id: "00000000-0000-4000-8000-" + String(position + 1).padStart(12, "0"),
        position, zh: { label: "中文" + position }, en: { label: "English " + position } })) });
    const result = presentVersionHistoryChange(aggregate(website("https://old.example.test"), website("https://new.example.test"),
      { domain: "website_links", entityType: "website_links_settings" }));
    const change = result.items[0]?.fields.find(value => value.key === "linkedin_href");
    expect(change?.locale).toBe("en");
    expect(change?.after).toEqual({ recorded: true, value: "https://new.example.test" });
    expect(result.items[0]?.label).toBeNull();
    expect(JSON.stringify(result)).not.toContain("navigation_item_id");
  });

  it("fails closed for an unexpected Website storage-reference field", () => {
    const result = presentVersionHistoryChange(aggregate(
      { shared: { email: "", github: "", github_label: "", linkedin_display_name: "", email_label: "", linkedin_label: "", object_key: "private/file" },
        translations: {}, navigation: [] },
      { shared: { email: "", github: "", github_label: "", linkedin_display_name: "", email_label: "", linkedin_label: "", object_key: "private/new" },
        translations: {}, navigation: [] },
      { domain: "website_links", entityType: "website_links_settings" }));
    expect(result).toMatchObject({ state: "generic", items: [] });
    expect(JSON.stringify(result)).not.toContain("private/");
  });

  it("presents Profile photo changes semantically without URLs, and never implies Restore", () => {
    const profile = (photo: string | null) => ({ shared: { graduation_value: "2020", avatar_initials: "A", footer_name: "Name", copyright: "©", photo_url: photo },
      translations: Object.fromEntries(["en", "zh"].map(locale => [locale, { name: locale, nav_about_label: "About", email_action_label: "Email", graduation_label: "Grad", avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status" }])) });
    const secret = "https://storage.example.test/private/photo-key";
    const result = presentVersionHistoryChange(aggregate(profile(null), profile(secret), { domain: "profile", entityType: "profile_settings" }));
    expect(result.items[0]?.fields).toContainEqual({ key: "photo", locale: "shared", kind: "updated",
      before: { redacted: true }, after: { redacted: true } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("photo_url");
    expect(JSON.stringify(result)).not.toContain("restore");
  });

  it("summarizes ordinary Profile updates without exposing photo references", () => {
    const profile = (footerName: string) => ({ shared: { graduation_value: "2020", avatar_initials: "A", footer_name: footerName, copyright: "©", photo_url: "https://example.test/private" },
      translations: Object.fromEntries(["en", "zh"].map(locale => [locale, { name: "Name", nav_about_label: "About", email_action_label: "Email", graduation_label: "Grad", avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status" }])) });
    const result = presentVersionHistoryChange(aggregate(profile("Old footer"), profile("New footer"), { domain: "profile", entityType: "profile_settings" }));
    expect(result.items[0]?.fields).toEqual([{ key: "footer_name", locale: "shared", kind: "updated",
      before: { recorded: true, value: "Old footer" }, after: { recorded: true, value: "New footer" } }]);
    expect(JSON.stringify(result)).not.toContain("photo_url");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("handles V1 Profile photo references without including the object key", () => {
    const result = presentVersionHistoryChange(entry({ domain: "profile", payloadVersion: 1, entityType: "profile_image", entityId: null,
      comparison: { kind: "entity_fields", changes: { object_key: { before: "private/old", after: "private/new" } } } }));
    expect(result.items[0]?.itemType).toBe("profile_photo");
    expect(JSON.stringify(result)).not.toContain("private/");
    expect(JSON.stringify(result)).not.toContain("object_key");
  });

  it("uses a neutral label instead of any entity ID when the event has no display text", () => {
    const result = presentVersionHistoryChange(entry({ entityId: idA, payloadVersion: 1, entityType: "award_entry",
      comparison: { kind: "entity_fields", changes: { year: { before: "2025", after: "2026" } } } }));
    expect(result.items[0]?.label).toBeNull();
    expect(JSON.stringify(result)).not.toContain(idA);
  });
});
