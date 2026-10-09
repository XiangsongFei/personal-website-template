import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import { createResumeRepository } from "../src/data/resumeRepository";
import { UiLocaleProvider } from "../src/uiLocale";

const target = "ea111111-1111-4111-8111-111111111111";
const otherTarget = "ea222222-2222-4222-8222-222222222222";
const origin = "https://storage.example.test";
const zhObject = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf";
const enObject = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf";
const publicHref = (resumeId: string, locale: "zh" | "en", object: string) =>
  `${origin}/storage/v1/object/public/resume-files/${resumeId}/${locale}/${object}`;

function makeRepository(hrefs: { zh: string; en: string }, metadata: Record<string, unknown>) {
  const navigation = Array.from({ length: 5 }, (_, position) => ({
    id: `00000000-0000-4000-8000-${String(position + 1).padStart(12, "0")}`,
    resume_id: target,
    source_key: `section-${position}`,
    position,
  }));
  const localeContent = (["zh", "en"] as const).map(locale => ({
    resume_id: target,
    locale,
    education_label: "Education",
    experience_label: "Experience",
    project_heading: "Projects",
    skills_label: "Skills",
    honors_label: "Awards",
    portfolio_label: "Resume",
    portfolio_href: hrefs[locale],
    kaggle_label: "Kaggle",
    updated_at_label: "Updated",
    linkedin_label: "LinkedIn",
    linkedin_href: "",
  }));
  const rows: Record<string, Record<string, unknown>[]> = {
    resume_public_links: [{ resume_id: target, email: "", github: "", github_label: "", linkedin_display_name: "", email_label: "", linkedin_label: "" }],
    resume_locale_content: localeContent,
    resume_navigation_items: navigation,
    resume_navigation_item_translations: navigation.flatMap(row => (["zh", "en"] as const).map(locale => ({
      resume_id: target, navigation_item_id: row.id, locale, label: `${row.source_key}-${locale}`,
    }))),
  };
  const from = vi.fn((table: string) => ({ select: vi.fn(() => ({ eq: vi.fn(async (_column: string, resumeId: string) => ({
    data: (rows[table] ?? []).filter(row => row.resume_id === resumeId), error: null,
  })) })) }));
  const info = vi.fn(async (path: string) => Object.hasOwn(metadata, path)
    ? { data: { metadata: { originalFilename: metadata[path] } }, error: null }
    : { data: null, error: new Error("object metadata unavailable") });
  const rpc = vi.fn(async () => ({ data: [{ resume_id: target, site_key: "example-cv-qa", role: "qa" }], error: null }));
  const repository = createResumeRepository({ from, rpc, storage: { from: vi.fn(() => ({ info })) } } as unknown as SupabaseClient, origin);
  return { repository, info };
}

describe("managed resume PDF filename resolution", () => {
  it("reads the exact current managed objects after replacement instead of stale legacy metadata", async () => {
    const zhHref = publicHref(target, "zh", zhObject);
    const enHref = publicHref(target, "en", enObject);
    const { repository, info } = makeRepository({ zh: zhHref, en: enHref }, {
      [`${target}/zh/${zhObject}`]: "QA测试PDF.pdf",
      [`${target}/en/${enObject}`]: "English.pdf",
      [`${target}/resume_zh.pdf`]: "PDF_B.pdf",
    });

    const fresh = await repository.loadLinks(target);

    expect(fresh.resumePdfFilenames).toEqual({ zh: "QA测试PDF.pdf", en: "English.pdf" });
    expect(fresh.translations.zh.portfolioHref).toBe(zhHref);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith(`${target}/zh/${zhObject}`);
    expect(info).toHaveBeenCalledWith(`${target}/en/${enObject}`);
    expect(info).not.toHaveBeenCalledWith(`${target}/zh/resume_zh.pdf`);

    render(<UiLocaleProvider><MemoryRouter initialEntries={["/links"]}>
      <App identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError=""
        resume={{ resumeId: target, siteKey: "example-cv-qa", isPublished: false, updatedAt: null,
          sections: { ...structuredClone(fixtureSections), links: fresh } }} />
    </MemoryRouter></UiLocaleProvider>);
    expect((await screen.findByRole("link", { name: "Current PDF: QA测试PDF.pdf" })).getAttribute("href")).toBe(zhHref);
  });

  it("does not look up cross-resume, cross-locale, or unsupported references", async () => {
    const zhHref = publicHref(otherTarget, "zh", zhObject);
    const enHref = publicHref(target, "zh", zhObject);
    const { repository, info } = makeRepository({ zh: zhHref, en: enHref }, {
      [`${target}/zh/${zhObject}`]: "QA测试PDF.pdf",
    });

    const loaded = await repository.loadLinks(target);

    expect(loaded.resumePdfFilenames).toEqual({ zh: zhObject, en: zhObject });
    expect(info).not.toHaveBeenCalled();
  });

  it("keeps recognized legacy references working and uses href fallback when metadata is unavailable", async () => {
    const legacyHref = `${origin}/storage/v1/object/public/resume-files/${target}/resume_zh.pdf?cacheNonce=old`;
    const missingHref = publicHref(target, "en", enObject);
    const { repository, info } = makeRepository({ zh: legacyHref, en: missingHref }, {
      [`${target}/resume_zh.pdf`]: "PDF_B.pdf",
    });

    const loaded = await repository.loadLinks(target);

    expect(loaded.resumePdfFilenames).toEqual({ zh: "PDF_B.pdf", en: enObject });
    expect(loaded.translations.en.portfolioHref).toBe(missingHref);
    expect(info).toHaveBeenCalledWith(`${target}/resume_zh.pdf`);
    expect(info).toHaveBeenCalledWith(`${target}/en/${enObject}`);
  });

  it.each([
    ["an extra same-origin prefix", `${origin}/unrelated/${target}/resume_zh.pdf`],
    ["a dot-segment path", `${origin}/x/../${target}/resume_zh.pdf`],
    ["an encoded path separator", `${origin}/storage/v1/object/public/resume-files/${target}%2Fresume_zh.pdf`],
    ["a double-encoded path separator", `${origin}/storage/v1/object/public/resume-files/${target}%252Fresume_zh.pdf`],
    ["URL userinfo", `https://user:pass@storage.example.test/storage/v1/object/public/resume-files/${target}/resume_zh.pdf`],
    ["a different origin", `https://other.example.test/storage/v1/object/public/resume-files/${target}/resume_zh.pdf`],
  ])("does not query metadata for %s", async (_description, href) => {
    const { repository, info } = makeRepository({ zh: href, en: "" }, {});

    const loaded = await repository.loadLinks(target);

    expect(loaded.resumePdfFilenames!.zh).toBe(href.split("/").at(-1));
    expect(loaded.translations.zh.portfolioHref).toBe(href);
    expect(info).not.toHaveBeenCalled();
  });

  it("does not query Storage metadata for an unsupported external reference", async () => {
    const href = "https://external.example.test/current-resume.pdf";
    const { repository, info } = makeRepository({ zh: href, en: "" }, {});

    const loaded = await repository.loadLinks(target);

    expect(loaded.resumePdfFilenames!.zh).toBe("current-resume.pdf");
    expect(loaded.translations.zh.portfolioHref).toBe(href);
    expect(info).not.toHaveBeenCalled();
  });
});
