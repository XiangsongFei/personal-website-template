import { describe, expect, it } from "vitest";
import { canonicalizeFiles, canonicalizeWebsiteLinks, managedResumePdfObjectPath, validateFilesAggregate, validateWebsiteLinksAggregate, type WebsiteLinksAggregate } from "../src/data/websiteFilesAggregate";

const resumeId = "11111111-1111-4111-8111-111111111111";
const projectOrigin = "https://project.example.test";
const website = (): WebsiteLinksAggregate => ({
  shared: { email: "a@example.test", github: "https://github.com/a", github_label: "GitHub", linkedin_display_name: "Profile", email_label: "Email", linkedin_label: "LinkedIn" },
  translations: { zh: { linkedin_label: "领英", linkedin_href: "https://example.test/zh", portfolio_label: "简历", updated_at_label: "更新" },
    en: { linkedin_label: "LinkedIn", linkedin_href: "https://example.test/en", portfolio_label: "Resume", updated_at_label: "Updated" } },
  navigation: Array.from({ length: 5 }, (_, position) => ({ navigation_item_id: `11111111-1111-4111-8111-${String(position + 1).padStart(12, "0")}`,
    position, zh: { label: `导航${position}` }, en: { label: `Section ${position}` } })),
});
const files = { translations: { zh: { portfolio_href: "legacy-zh.pdf" }, en: { portfolio_href: "legacy-en.pdf" } } };
const candidate = (locale: "zh" | "en" = "en", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") =>
  `${projectOrigin}/storage/v1/object/public/resume-files/${resumeId}/${locale}/${id}.pdf`;

describe("Website & Links / Files aggregate contracts", () => {
  it("accepts and preserves the complete exact Website & Links aggregate", () => {
    const value = website(); value.shared.email_label = "  Email  ";
    expect(validateWebsiteLinksAggregate(value)).toEqual(value);
    expect(JSON.parse(canonicalizeWebsiteLinks(value))).toEqual(value);
  });

  it.each([
    ["extra top-level key", (value: WebsiteLinksAggregate) => ({ ...value, timestamp: "x" })],
    ["missing shared field", (value: WebsiteLinksAggregate) => ({ ...value, shared: { ...value.shared, email: undefined } })],
    ["duplicate navigation ID", (value: WebsiteLinksAggregate) => { value.navigation[1]!.navigation_item_id = value.navigation[0]!.navigation_item_id; return value; }],
    ["altered navigation position", (value: WebsiteLinksAggregate) => { value.navigation[0]!.position = 4; return value; }],
    ["missing navigation item", (value: WebsiteLinksAggregate) => ({ ...value, navigation: value.navigation.slice(0, 4) })],
    ["extra translation field", (value: WebsiteLinksAggregate) => ({ ...value, translations: { ...value.translations, en: { ...value.translations.en, portfolio_href: "must not be website-owned" } } })],
    ["NUL text", (value: WebsiteLinksAggregate) => ({ ...value, shared: { ...value.shared, github: "a\0b" } })],
  ] as const)("rejects %s", (_name, transform) => {
    expect(() => validateWebsiteLinksAggregate(transform(structuredClone(website())))).toThrow();
  });

  it("preserves unchanged legacy file references while validating exact zh/en reference shape", () => {
    expect(validateFilesAggregate(files)).toEqual(files);
    expect(JSON.parse(canonicalizeFiles(files))).toEqual(files);
    expect(() => validateFilesAggregate({ ...files, other: true })).toThrow();
  });

  it("recognizes only an immutable UUID candidate within the exact project, resume, and locale", () => {
    const url = candidate();
    expect(managedResumePdfObjectPath(projectOrigin, resumeId, "en", url)).toBe(`${resumeId}/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`);
    for (const value of [
      "https://attacker.example/storage/v1/object/public/resume-files/11111111-1111-4111-8111-111111111111/en/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf",
      candidate("zh"), candidate("en", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab") + "?download=1",
      candidate("en").replace("resume-files", "profile-images"), candidate("en").replace(resumeId, "22222222-2222-4222-8222-222222222222"),
      candidate("en").replace("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf", "../legacy.pdf"),
      candidate("en").replace("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf", "%2e%2e.pdf"),
    ]) expect(managedResumePdfObjectPath(projectOrigin, resumeId, "en", value)).toBeNull();
    expect(managedResumePdfObjectPath("https://project.example.test/path", resumeId, "en", url)).toBeNull();
  });
});
