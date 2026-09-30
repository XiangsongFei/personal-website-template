import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResumeLoader } from "../src/data/ResumeLoader";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { fixtureSections } from "../src/fixtures";
import type { ResumeRepository, ResumeSectionRepository } from "../src/data/resumeRepository";
import { UiLocaleProvider } from "../src/uiLocale";

const sessionKey = "canonical-preview-session";
const resumeId = "canonical-preview-resume";

function createRepository() {
  const sections = structuredClone(fixtureSections);
  sections.profile.translations.en.name = "Server canonical profile";
  sections.education[0].translations.en.title = "Server canonical education";
  sections.experience[0].translations.en.organization = "Server canonical experience";
  sections.projects[0].translations.en.title = "Server canonical project";
  sections.skills[0].translations.en.title = "Server canonical skill group";
  sections.awards[0].translations.en.name = "Server canonical award";
  sections.contact.translations.en.availability = "Server canonical availability";
  sections.links.navigation[0].translations.en.label = "Server canonical navigation EN";
  sections.links.navigation[0].translations.zh.label = "服务器导航";
  const reads = {
    loadProfile: vi.fn(async () => sections.profile),
    loadIntroduction: vi.fn(async () => sections.introduction),
    loadEducation: vi.fn(async () => sections.education),
    loadExperience: vi.fn(async () => sections.experience),
    loadProjects: vi.fn(async () => sections.projects),
    loadSkills: vi.fn(async () => sections.skills),
    loadAwards: vi.fn(async () => sections.awards),
    loadContact: vi.fn(async () => sections.contact),
    loadLinks: vi.fn(async () => sections.links),
  };
  const repository = {
    load: vi.fn(async () => { throw new Error("Preview should use the section cache, not a duplicate full-snapshot request"); }),
    loadSiteMetadata: vi.fn(async () => ({ resumeId, siteKey: "example-cv" as const, isPublished: true, updatedAt: null })),
    loadOverview: vi.fn(async () => ({ profileName: sections.profile.translations.en.name })),
    ...reads,
    updateProfileSharedDetails: vi.fn(),
    updateProfileTranslation: vi.fn(),
    updateEditableTranslation: vi.fn(async (_section, targetResumeId, entryId, locale, translation) => ({
      resumeId: targetResumeId, entryId, locale, translation,
    })),
    updateEditableEntryPosition: vi.fn(async (_section, targetResumeId, entryId, position) => ({ resumeId: targetResumeId, entryId, position, sourceKey: null })),
    insertEditableEntry: vi.fn(async (_section, targetResumeId, position) => ({ resumeId: targetResumeId, entryId: "created-entry", position, sourceKey: null })),
    insertEditableTranslation: vi.fn(async (_section, targetResumeId, entryId, locale, translation) => ({ resumeId: targetResumeId, entryId, locale, translation })),
    readEditableTranslation: vi.fn(async () => null),
    deleteEditableTranslation: vi.fn(async () => {}),
    deleteEditableEntry: vi.fn(async () => {}),
  };
  return { repository: repository as unknown as ResumeRepository & ResumeSectionRepository, reads, sections };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("canonical production Preview loading", () => {
  it("keeps direct-route editor loading route-first and loads one complete cached snapshot when Preview is shown", async () => {
    const store = new ResumeSectionStore();
    store.setSession(sessionKey);
    const { repository, reads } = createRepository();
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/projects"]}><ResumeLoader repository={repository} sectionStore={store}
      sessionKey={sessionKey} identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider>);

    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    expect(repository.loadProjects).toHaveBeenCalledOnce();
    expect(repository.load).not.toHaveBeenCalled();
    expect(repository.loadProfile).not.toHaveBeenCalled();
    expect(repository.loadExperience).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Preview$/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Server canonical profile" })).toBeTruthy();
    const viewport = screen.getByTestId("resume-preview");
    expect(viewport.querySelector("#preview-education")?.textContent).toContain("Server canonical education");
    expect(viewport.querySelector("#preview-experience")?.textContent).toContain("Server canonical experience");
    expect(viewport.querySelector("#preview-projects")?.textContent).toContain("Server canonical project");
    expect(viewport.querySelector("#preview-skills")?.textContent).toContain("Server canonical skill group");
    expect(viewport.querySelector("#preview-awards")?.textContent).toContain("Server canonical award");
    expect(viewport.querySelector("#preview-contact")?.textContent).toContain("Server canonical availability");
    expect(viewport.querySelector(".resume-preview-nav-links")?.textContent).toMatch(/Server canonical navigation EN|服务器导航/);
    expect(repository.loadProjects).toHaveBeenCalledOnce();
    for (const read of Object.values(reads)) expect(read).toHaveBeenCalledOnce();
    expect(repository.load).not.toHaveBeenCalled();
  });

  it("uses the canonical snapshot ID for production writers on routes visited after the snapshot loads", async () => {
    const store = new ResumeSectionStore();
    store.setSession(sessionKey);
    const { repository } = createRepository();
    render(<UiLocaleProvider><MemoryRouter initialEntries={["/projects"]}><ResumeLoader repository={repository} sectionStore={store}
      sessionKey={sessionKey} identityEmail="admin@example.test" onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider>);

    expect(await screen.findByLabelText("English Title")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Preview$/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Server canonical profile" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));

    const routeCases = [
      ["Introduction", "Introduction"],
      ["Experience", "Experience"],
      ["Projects", "Projects"],
      ["Awards", "Awards"],
      ["Contact", "Contact"],
      ["Skills", "Skills"],
    ] as const;
    for (const [navigationLabel, heading] of routeCases) {
      fireEvent.click(screen.getByRole("link", { name: navigationLabel }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeTruthy();
      expect(screen.queryByText("Local draft only. Production writes are disabled for this section.")).toBeNull();
    }

    fireEvent.change(screen.getByLabelText("Chinese Name"), { target: { value: "Updated canonical skill" } });
    fireEvent.click(screen.getByRole("button", { name: "Save skill changes" }));
    await screen.findByText("Skill changes saved.");
    expect(repository.updateEditableTranslation).toHaveBeenCalledWith("skills", resumeId, "skill-1", "zh",
      expect.objectContaining({ title: "Updated canonical skill" }));
    expect(repository.loadSkills).toHaveBeenCalledWith(resumeId);
  });

});
