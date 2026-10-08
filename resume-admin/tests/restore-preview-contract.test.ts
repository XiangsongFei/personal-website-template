import { describe, expect, it } from "vitest";
import { isRestorePreviewAggregate, isRestorePreviewTimestamp, validateRestorePreviewContract, type RestorePreviewDomain } from "../src/data/restorePreviewContract";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const textPair = (keys: Record<string, unknown>) => ({ zh: { ...keys }, en: { ...keys } });

const fixtures: Record<RestorePreviewDomain, unknown> = {
  awards: [{ id: uuid(1), position: 0, ...textPair({ name: "Award", year: "2024" }) }],
  experience: [{ id: uuid(2), position: 0, ...textPair({ organization: "Org", title: "Role", period: "2024", description: "Work", location: null }) }],
  skills: [{ id: uuid(3), position: 0, ...textPair({ title: "Skills", items: "TypeScript" }) }],
  education: [{ id: uuid(4), position: 0, entry_type: "standard", education_category: "undergraduate",
    ...textPair({ title: "Degree", program: "CS", period: "2020", grade: "A", course_title: null, course_description: null, custom_category_label: null }) }],
  projects: [{ id: uuid(5), position: 0, ...textPair({ title: "Project", subtitle: "", period: "2024", description: "", href: "" }), methods: { zh: [{ id: uuid(6), position: 0, value: "Method" }], en: [] } }],
  contact: { translations: textPair({ contact_label: "Contact", availability: "Available" }),
    focus: [{ id: uuid(7), position: 0, ...textPair({ title: "Focus", detail: "Detail" }) }],
    status: [{ id: uuid(8), position: 0, status_type: "open", ...textPair({ title: "Open", detail: "Detail" }) }] },
  website_links: { shared: { email: "", github: "", github_label: "", linkedin_display_name: "", email_label: "", linkedin_label: "" },
    translations: textPair({ linkedin_label: "LinkedIn", linkedin_href: "", portfolio_label: "Portfolio", updated_at_label: "Updated" }),
    navigation: Array.from({ length: 5 }, (_, position) => ({ navigation_item_id: uuid(20 + position), position,
      zh: { label: `ZH ${position}` }, en: { label: `EN ${position}` } })) },
};

type TestRecord = Record<string, unknown>;
type InvalidCase = { missing: (state: unknown) => void; wrong: (state: unknown) => void; nested: (state: unknown) => void };
const row = (state: unknown, index: number) => (state as TestRecord[])[index]!;
const field = (value: unknown, key: string) => (value as TestRecord)[key] as TestRecord;
const invalidCases: Record<RestorePreviewDomain, InvalidCase> = {
  awards: { missing: s => { Reflect.deleteProperty(field(row(s, 0), "zh"), "name"); }, wrong: s => { field(row(s, 0), "zh").year = 2024; }, nested: s => { field(row(s, 0), "zh").actor_user_id = uuid(99); } },
  experience: { missing: s => { Reflect.deleteProperty(field(row(s, 0), "zh"), "organization"); }, wrong: s => { field(row(s, 0), "zh").location = 3; }, nested: s => { field(row(s, 0), "en").ip_network = "private"; } },
  skills: { missing: s => { Reflect.deleteProperty(field(row(s, 0), "zh"), "items"); }, wrong: s => { field(row(s, 0), "en").title = false; }, nested: s => { field(row(s, 0), "zh").audit = { detail: "not allowed" }; } },
  education: { missing: s => { Reflect.deleteProperty(field(row(s, 0), "zh"), "course_description"); }, wrong: s => { field(row(s, 0), "en").course_title = 12; }, nested: s => { field(row(s, 0), "zh").actor = { id: uuid(99) }; } },
  projects: { missing: s => { Reflect.deleteProperty(row(s, 0), "methods"); }, wrong: s => { row(field(row(s, 0), "methods").zh, 0).value = 12; }, nested: s => { field(row(s, 0), "methods").en = [{ id: uuid(9), position: 0, value: "x", audit: true }]; } },
  contact: { missing: s => { Reflect.deleteProperty(field(field(s, "translations"), "zh"), "contact_label"); }, wrong: s => { row(field(s, "status"), 0).status_type = "unknown"; }, nested: s => { field(row(field(s, "focus"), 0), "zh").actor_user_id = uuid(99); } },
  website_links: { missing: s => { Reflect.deleteProperty(field(s, "shared"), "email"); }, wrong: s => { row(field(s, "navigation"), 0).position = "0"; }, nested: s => { field(row(field(s, "navigation"), 0), "zh").ip_network = "private"; } },
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("frozen Restore preview response contract", () => {
  it.each(Object.entries(fixtures) as [RestorePreviewDomain, unknown][])("accepts canonical %s historical/current states", (domain, state) => {
    expect(isRestorePreviewAggregate(domain, state)).toBe(true);
    expect(isRestorePreviewAggregate(domain, clone(state))).toBe(true);
  });

  it.each(Object.entries(fixtures) as [RestorePreviewDomain, unknown][])("rejects missing, wrongly typed, and nested unknown fields for %s", (domain, fixture) => {
    const rules = invalidCases[domain];
    for (const mutate of [rules.missing, rules.wrong, rules.nested]) {
      const state = clone(fixture);
      mutate(state);
      expect(isRestorePreviewAggregate(domain, state)).toBe(false);
    }
  });

  it("accepts only the frozen RFC3339 timestamp representation", () => {
    expect(isRestorePreviewTimestamp("2026-10-05T02:10:04+00:00")).toBe(true);
    expect(isRestorePreviewTimestamp("2026-10-05T02:10:04.123456Z")).toBe(true);
    expect(isRestorePreviewTimestamp("October 5, 2026")).toBe(false);
    expect(isRestorePreviewTimestamp("2026-10-05")).toBe(false);
    expect(isRestorePreviewTimestamp("2026-02-30T02:10:04Z")).toBe(false);
  });

  it("enforces status and comparison consistency with canonical states", () => {
    const base = { source_event_id: uuid(30), source_occurred_at: "2026-10-05T02:10:04+00:00", domain: "awards",
      historical_state: fixtures.awards, current_state: [], comparison: { before: [], after: fixtures.awards }, expected_current_digest: "a".repeat(64) };
    expect(validateRestorePreviewContract({ ...base, status: "ready" }, uuid(30))).not.toBeNull();
    expect(validateRestorePreviewContract({ ...base, status: "no_change" }, uuid(30))).toBeNull();
    expect(validateRestorePreviewContract({ ...base, status: "ready", comparison: { before: fixtures.awards, after: fixtures.awards } }, uuid(30))).toBeNull();
    const equal = { ...base, historical_state: [], current_state: [], comparison: { before: [], after: [] }, status: "no_change" };
    expect(validateRestorePreviewContract(equal, uuid(30))).not.toBeNull();
  });

  it("requires stable Website & Links navigation identities between both states", () => {
    const state = clone(fixtures.website_links) as { navigation: Array<{ navigation_item_id: string }> };
    const changed = clone(state); changed.navigation[0].navigation_item_id = uuid(99);
    const value = { status: "ready", source_event_id: uuid(30), source_occurred_at: "2026-10-05T02:10:04Z", domain: "website_links",
      historical_state: changed, current_state: state, comparison: { before: state, after: changed }, expected_current_digest: "b".repeat(64) };
    expect(validateRestorePreviewContract(value, uuid(30))).toBeNull();
  });
});
