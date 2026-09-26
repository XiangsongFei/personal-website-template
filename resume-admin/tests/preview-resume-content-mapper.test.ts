import { beforeEach, describe, expect, it, vi } from "vitest";
import { isResumeContent } from "../../app/data/resume-validation";
import { fixtureSections } from "../src/fixtures";
import { mapEditorSnapshotToResumeContent } from "../src/preview/resumeContentMapper";

describe("mapEditorSnapshotToResumeContent", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("converts a complete bilingual editor snapshot into the public ResumeContent model", () => {
    const snapshot = structuredClone(fixtureSections);
    snapshot.profile.translations.zh.name = "中文未保存姓名";
    snapshot.profile.translations.en.name = "Unsaved English Name";
    snapshot.links.translations.zh.portfolioHref = "/简历.pdf";
    snapshot.links.translations.en.portfolioHref = "/resume-en.pdf";
    snapshot.contact.focus[0].translations.zh.detail = "中文细节";
    snapshot.contact.status[0].translations.en.detail = "English detail";

    const result = mapEditorSnapshotToResumeContent(snapshot);

    expect(result.profile.name).toEqual({ zh: "中文未保存姓名", en: "Unsaved English Name" });
    expect(result.publicLinks).toEqual(snapshot.links.shared);
    expect(result.locales.zh.portfolioHref).toBe("/简历.pdf");
    expect(result.locales.en.portfolioHref).toBe("/resume-en.pdf");
    expect(result.locales.zh.contactFocusItems[0]).toEqual(["数据与分析", "中文细节"]);
    expect(result.locales.en.contactStatusItems[0]).toEqual({ type: "study", title: "Example Template", detail: "English detail" });
    expect(isResumeContent(result)).toBe(true);
  });

  it("preserves position ordering, locale-specific project methods, and source keys", () => {
    const snapshot = structuredClone(fixtureSections);
    snapshot.introduction[0].position = 5;
    snapshot.introduction[1].position = 1;
    snapshot.education[0].position = 2;
    snapshot.education[1].position = 0;
    snapshot.projects[0].methods.zh[1].position = 0;
    snapshot.projects[0].methods.zh[0].position = 2;
    snapshot.projects[0].methods.en.reverse();
    snapshot.projects[0].methods.en[0].position = 0;
    snapshot.projects[0].methods.en[1].position = 4;

    const result = mapEditorSnapshotToResumeContent(snapshot);

    expect(result.locales.zh.intro).toEqual(["所有内容均为本地演示。", "这是一个双语个人网站模板。"]);
    expect(result.locales.zh.edu.map(item => item.id)).toEqual(["education-summer-school", "education-undergraduate"]);
    expect(result.locales.en.edu.map(item => item.id)).toEqual(["education-summer-school", "education-undergraduate"]);
    expect(result.locales.zh.projects[0].id).toBe("project-example-analysis");
    expect(result.locales.zh.projects[0].methods).toEqual(["指标分析", "数据整理"]);
    expect(result.locales.en.projects[0].methods).toEqual(["Metric Analysis", "Data Preparation"]);
    expect(result.locales.zh.nav).toEqual(["经历", "项目", "技能", "奖项", "联系"]);
  });

  it("creates deterministic preview-only IDs for local entries without changing their draft IDs", () => {
    const snapshot = structuredClone(fixtureSections);
    snapshot.introduction[0].id = "local-intro-1";
    snapshot.introduction[0].translations.zh.text = "未保存的新段落";
    snapshot.introduction[0].translations.en.text = "Unsaved new paragraph";
    snapshot.education[0].id = "local-education-1";
    snapshot.education[0].sourceKey = null;
    snapshot.education.push({
      ...structuredClone(snapshot.education[0]),
      id: "local-education-new",
      position: 3,
      translations: {
        zh: { title: "新建教育", program: "中文项目", period: "2026", grade: "", courseTitle: null, courseDescription: null },
        en: { title: "New education", program: "English programme", period: "2026", grade: "", courseTitle: null, courseDescription: null },
      },
    });
    snapshot.projects[0].id = "local-project-1";
    snapshot.projects[0].sourceKey = null;
    snapshot.skills[0].id = "local-skill-1";
    snapshot.skills[0].sourceKey = null;
    snapshot.awards[0].id = "local-award-1";
    snapshot.awards[0].sourceKey = null;
    const before = structuredClone(snapshot);

    const first = mapEditorSnapshotToResumeContent(snapshot);
    const second = mapEditorSnapshotToResumeContent(snapshot);

    expect(first.locales.zh.edu[0].id).toBe("preview-education-local-education-1");
    expect(first.locales.zh.edu.at(-1)).toMatchObject({ id: "preview-education-local-education-new", title: "新建教育" });
    expect(first.locales.zh.intro[0]).toBe("未保存的新段落");
    expect(first.locales.en.intro[0]).toBe("Unsaved new paragraph");
    expect(first.locales.zh.projects[0].id).toBe("preview-project-local-project-1");
    expect(first.locales.zh.skillGroups[0].id).toBe("preview-skill-local-skill-1");
    expect(first.locales.zh.honorsList[0].id).toBe("preview-award-local-award-1");
    expect(first.locales.zh.edu.map(entry => entry.id)).toEqual(second.locales.zh.edu.map(entry => entry.id));
    expect(first.locales.zh.intro).toEqual(second.locales.zh.intro);
    expect(snapshot).toEqual(before);
    expect(snapshot.education[0].id).toBe("local-education-1");
  });

  it("preserves null versus empty optional values using the public model semantics", () => {
    const snapshot = structuredClone(fixtureSections);
    snapshot.education[0].translations.zh.courseTitle = null;
    snapshot.education[0].translations.zh.courseDescription = "";
    snapshot.experience[0].translations.zh.location = null;
    snapshot.experience[0].translations.en.location = "";

    const result = mapEditorSnapshotToResumeContent(snapshot);

    expect(result.locales.zh.edu[0]).not.toHaveProperty("courseTitle");
    expect(result.locales.zh.edu[0]).toHaveProperty("courseDescription", "");
    expect(result.locales.zh.jobs[0]).not.toHaveProperty("location");
    expect(result.locales.en.jobs[0]).toHaveProperty("location", "");
    expect(isResumeContent(result)).toBe(true);
  });

  it("runs synchronously without network or repository dependencies", () => {
    const fetcher = vi.fn(() => { throw new Error("fetch must not be called"); });
    vi.stubGlobal("fetch", fetcher);

    const result = mapEditorSnapshotToResumeContent(fixtureSections);

    expect(result.locales.en.projects[0].methods).toEqual(["Data Preparation", "Metric Analysis"]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
