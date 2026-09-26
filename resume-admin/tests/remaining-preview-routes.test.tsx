import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import type { LoadedResume } from "../src/data/resumeMapper";
import type { ResumeRepository } from "../src/data/resumeRepository";
import type { PreviewSection } from "../src/preview/ResumePreviewPanel";
import { UiLocaleProvider } from "../src/uiLocale";

const resumeId = "preview-resume";
const resume: LoadedResume = { resumeId, siteKey: "example-cv", isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) };

function createRepository() {
  const write = vi.fn(async () => undefined);
  const repo = {
    updateProfileSharedDetails: write, updateProfileTranslation: write, updateEducationEntry: write, updateEducationTranslation: write,
    updateEditableEntryPosition: write, insertEditableEntry: write, updateEditableTranslation: write, insertEditableTranslation: write,
    deleteEditableTranslation: write, deleteEditableEntry: write, updateProjectMethod: write, insertProjectMethod: write, deleteProjectMethod: write,
    updateContactLabel: write, updateFocusPosition: write, insertFocus: write, updateFocusTranslation: write, insertFocusTranslation: write,
    readFocusTranslation: vi.fn(async () => null), deleteFocus: write, updateStatusPosition: write, insertStatus: write,
    updateStatusTranslation: write, insertStatusTranslation: write, readStatusTranslation: vi.fn(async () => null), deleteStatus: write,
    updateStatusType: write, updatePublicLinks: write, updateSiteText: write, updateNavigationLabel: write,
    uploadResumePdf: write,
  };
  return { repo: repo as unknown as ResumeRepository, write };
}

function open(path: string, productionRepeatable = false) {
  const { repo, write } = createRepository();
  const routeSection = path.slice(1) as PreviewSection;
  render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><App identityEmail="admin@example.test" onSignOut={() => {}}
    signOutPending={false} signOutError="" resume={resume} repository={repo}
    additionalResumeId={productionRepeatable ? resumeId : null}
    additionalSections={productionRepeatable ? { [routeSection]: fixtureSections[routeSection] } : {}}
  /></MemoryRouter></UiLocaleProvider>);
  return { repo, write };
}

function preview() { return within(screen.getByTestId("resume-preview")); }
function previewNode() { return screen.getByTestId("resume-preview"); }
function setPreviewLocale(locale: "Chinese" | "English") {
  fireEvent.click(within(screen.getByRole("group", { name: "Preview language" })).getByRole("button", { name: `Preview ${locale}` }));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Awards, Contact, and Links live preview", () => {
  it("previews Awards continuously in both locales and reflects edits, adds, reorder, and delete without writes", () => {
    const { write } = open("/awards", true);
    expect(previewNode().getAttribute("data-preview-focus")).toBe("awards");
    const awards = previewNode().querySelector("#preview-awards");
    expect(awards).toBeTruthy();
    expect(within(awards as HTMLElement).getByRole("heading", { level: 3, name: "Example Project Outcome" })).toBeTruthy();
    expect(previewNode().querySelector("#preview-skills")).toBeTruthy();

    fireEvent.change(screen.getAllByLabelText("English Award name")[0], { target: { value: "Unsaved award title" } });
    fireEvent.change(screen.getAllByLabelText("Chinese Award name")[0], { target: { value: "未保存荣誉" } });
    expect(within(awards as HTMLElement).getByRole("heading", { level: 3, name: "Unsaved award title" })).toBeTruthy();
    const list = document.querySelector('[aria-label="Awards items"]') as HTMLElement;
    fireEvent.click(within(list).getByRole("button", { name: "Move Unsaved award title down" }));
    expect(Array.from(awards!.querySelectorAll(".resume-preview-award-list h3"), item => item.textContent)).toEqual([
      "Example Academic Honour", "Unsaved award title",
    ]);
    setPreviewLocale("Chinese");
    expect(within(awards as HTMLElement).getByRole("heading", { level: 3, name: "未保存荣誉" })).toBeTruthy();
    setPreviewLocale("English");

    fireEvent.click(within(list).getByRole("button", { name: "Add item" }));
    const awardNames = screen.getAllByLabelText("English Award name");
    fireEvent.change(awardNames[awardNames.length - 1], { target: { value: "New preview award" } });
    expect(within(awards as HTMLElement).getByRole("heading", { level: 3, name: "New preview award" })).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Delete New preview award" }));
    fireEvent.click(within(list).getByRole("button", { name: "Confirm delete" }));
    expect(within(awards as HTMLElement).queryByRole("heading", { level: 3, name: "New preview award" })).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("previews Contact footer, Focus, and Status drafts and ordering in both locales without writes", () => {
    const { write } = open("/contact", true);
    expect(previewNode().getAttribute("data-preview-focus")).toBe("contact");
    const contact = previewNode().querySelector("#preview-contact") as HTMLElement;
    expect(within(contact).getByRole("heading", { level: 2, name: fixtureSections.contact.translations.en.availability })).toBeTruthy();
    expect(within(contact).getByText("Example Template")).toBeTruthy();
    expect(within(contact).getByText("Data & Analysis")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English Availability"), { target: { value: "Open to a new discussion." } });
    expect(within(contact).getByRole("heading", { level: 2, name: "Open to a new discussion." })).toBeTruthy();

    const focus = document.querySelector('[aria-label="Current Focus"]') as HTMLElement;
    fireEvent.change(screen.getAllByLabelText("English Focus title")[0], { target: { value: "Unsaved focus" } });
    fireEvent.change(screen.getAllByLabelText("Chinese Focus title")[0], { target: { value: "未保存重点" } });
    expect(within(contact).getByText("Unsaved focus")).toBeTruthy();
    fireEvent.click(within(focus).getByRole("button", { name: "Move Unsaved focus down" }));
    expect(Array.from(contact.querySelectorAll(".resume-preview-focus-list article p"), item => item.textContent)).toEqual(["Projects & Practice", "Unsaved focus"]);
    fireEvent.click(within(focus).getByRole("button", { name: "Add item" }));
    const focusTitles = screen.getAllByLabelText("English Focus title");
    fireEvent.change(focusTitles[focusTitles.length - 1], { target: { value: "Added focus" } });
    expect(within(contact).getByText("Added focus")).toBeTruthy();
    fireEvent.click(within(focus).getByRole("button", { name: "Delete Added focus" }));
    fireEvent.click(within(focus).getByRole("button", { name: "Confirm delete" }));
    expect(within(contact).queryByText("Added focus")).toBeNull();

    const status = document.querySelector('[aria-label="Current Status"]') as HTMLElement;
    fireEvent.change(screen.getAllByLabelText("English Status title")[0], { target: { value: "Unsaved status" } });
    expect(within(contact).getByText("Unsaved status")).toBeTruthy();
    fireEvent.click(within(status).getByRole("button", { name: "Move Unsaved status down" }));
    expect(Array.from(contact.querySelectorAll(".resume-preview-status-list p"), item => item.textContent)).toEqual(["Open to Discussions", "Unsaved status"]);
    fireEvent.click(within(status).getByRole("button", { name: "Add item" }));
    const statusTitles = screen.getAllByLabelText("English Status title");
    fireEvent.change(statusTitles[statusTitles.length - 1], { target: { value: "Added status" } });
    expect(within(contact).getByText("Added status")).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("Status type (shared)")[screen.getAllByLabelText("Status type (shared)").length - 1], { target: { value: "graduation" } });
    expect(contact.querySelector('[data-status-type="graduation"]')).toBeTruthy();
    fireEvent.click(within(status).getByRole("button", { name: "Delete Added status" }));
    fireEvent.click(within(status).getByRole("button", { name: "Confirm delete" }));
    expect(within(contact).queryByText("Added status")).toBeNull();

    setPreviewLocale("Chinese");
    expect(within(contact).getByText("未保存重点")).toBeTruthy();
    expect(within(contact).getByText("示例模板")).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
  });

  it("reflects Links & Site Text drafts at their public locations; locale changes remain preview-only", () => {
    const { write } = open("/links", true);
    expect(previewNode().getAttribute("data-preview-focus")).toBe("about");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "preview@example.test" } });
    expect(previewNode().querySelector('.resume-preview-actions a[href="mailto:preview@example.test"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English Resume PDF label"), { target: { value: "Updated resume button" } });
    expect(preview().getByRole("link", { name: /Updated resume button/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English LinkedIn URL"), { target: { value: "https://linkedin.example.test/profile" } });
    expect(previewNode().querySelector('.resume-preview-actions a[href="https://linkedin.example.test/profile"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("English LinkedIn text"), { target: { value: "LinkedIn destination" } });
    expect(previewNode().querySelector(".resume-preview-contact-links > div:nth-child(2) > span")?.textContent).toBe("LinkedIn destination");
    const firstNavigationRow = document.querySelector(".navigation-label-row") as HTMLElement;
    fireEvent.change(within(firstNavigationRow).getByLabelText("English Navigation label"), { target: { value: "Career" } });
    fireEvent.change(within(firstNavigationRow).getByLabelText("Chinese Navigation label"), { target: { value: "职业经历" } });
    expect(preview().getByRole("link", { name: "Resume preview Career" })).toBeTruthy();
    setPreviewLocale("Chinese");
    expect(preview().getByRole("link", { name: "Resume preview 职业经历" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Links & Site Text" })).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
    setPreviewLocale("English");
    expect(preview().getByRole("link", { name: "Resume preview Career" })).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
  });
});
