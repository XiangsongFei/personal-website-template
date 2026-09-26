import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { fixtureSections } from "../src/fixtures";
import type { LoadedResume } from "../src/data/resumeMapper";
import type { ResumeRepository, UpdatedProfileRow } from "../src/data/resumeRepository";

const resumeId = "profile-photo-resume";
const snapshot = (photoUrl: string | null = null): LoadedResume => {
  const sections = structuredClone(fixtureSections);
  sections.profile.shared.photoUrl = photoUrl;
  return { resumeId, siteKey: "example-cv", isPublished: true, updatedAt: null, sections };
};
const persistedUrl = "https://storage.example.test/profile-images/example-cv/profile/version-1.webp";

function show(repository: ResumeRepository, photoUrl: string | null = null) {
  return render(<MemoryRouter initialEntries={["/profile"]}><App identityEmail="admin@example.test" onSignOut={() => {}}
    signOutPending={false} signOutError="" resume={snapshot(photoUrl)} repository={repository}
    onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter>);
}

function repo(overrides: Partial<ResumeRepository> = {}): ResumeRepository {
  return {
    load: vi.fn().mockResolvedValue(snapshot()),
    uploadProfilePhoto: vi.fn().mockResolvedValue(persistedUrl),
    updateProfileSharedDetails: vi.fn(async (_id, shared) => ({ resumeId, shared, updatedAt: null })),
    updateProfileTranslation: vi.fn(),
    ...overrides,
  };
}

function selectPhoto(name = "portrait.webp") {
  const file = new File(["image"], name, { type: "image/webp" });
  fireEvent.change(screen.getByLabelText("Profile photo"), { target: { files: [file] } });
  return file;
}

function setPreviewLocale(locale: "zh" | "en") {
  const preview = screen.getByTestId("resume-preview");
  if (preview.getAttribute("lang") !== locale) fireEvent.click(within(preview).getByRole("button", { name: "Preview language" }));
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Profile photo draft lifecycle", () => {
  it("previews a selected file immediately without production writes and keeps both locales editable", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:profile-photo-draft");
    const repository = repo();
    show(repository);
    selectPhoto();
    const previewElement = screen.getByTestId("resume-preview");
    expect((previewElement.querySelector("img") as HTMLImageElement).src).toBe("blob:profile-photo-draft");
    expect(repository.uploadProfilePhoto).not.toHaveBeenCalled();
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Chinese Name")).toBeTruthy();
    expect(screen.getByLabelText("English Name")).toBeTruthy();

    setPreviewLocale("en");
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe("blob:profile-photo-draft");
    expect(screen.getByLabelText("Chinese Name")).toBeTruthy();
    expect(screen.getByLabelText("English Name")).toBeTruthy();
  });

  it("Cancel restores the confirmed initials fallback and revokes the temporary URL", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:discard-me");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    show(repo());
    selectPhoto();
    expect(screen.getByTestId("resume-preview").querySelector("img")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(screen.getByTestId("resume-preview").querySelector("img")).toBeNull();
    expect(within(screen.getByTestId("resume-preview")).getByText("DU")).toBeTruthy();
    expect(revoke).toHaveBeenCalledWith("blob:discard-me");
  });

  it("Cancel restores an already confirmed production photo", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:replacement-draft");
    show(repo(), persistedUrl);
    const preview = screen.getByTestId("resume-preview");
    expect((preview.querySelector("img") as HTMLImageElement).src).toBe(persistedUrl);
    selectPhoto();
    expect((preview.querySelector("img") as HTMLImageElement).src).toBe("blob:replacement-draft");
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((preview.querySelector("img") as HTMLImageElement).src).toBe(persistedUrl);
  });

  it("removes a saved photo in the local draft and previews the initials fallback", () => {
    const repository = repo();
    show(repository, persistedUrl);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByText("No profile photo")).toBeTruthy();
    expect(screen.getByTestId("resume-preview").querySelector("img")).toBeNull();
    expect(within(screen.getByTestId("resume-preview")).getByText("DU")).toBeTruthy();
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
    expect(repository.uploadProfilePhoto).not.toHaveBeenCalled();
  });

  it("Cancel restores the confirmed photo after a local removal", () => {
    const repository = repo();
    show(repository, persistedUrl);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByTestId("resume-preview").querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe(persistedUrl);
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
  });

  it("Cancel restores shared and localized Profile values together with a pending photo removal", () => {
    show(repo(), persistedUrl);
    fireEvent.change(screen.getByLabelText("Graduation value"), { target: { value: "2035" } });
    fireEvent.change(screen.getByLabelText("Chinese Name"), { target: { value: "临时中文名" } });
    fireEvent.change(screen.getByLabelText("English Name"), { target: { value: "Temporary English name" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Graduation value") as HTMLInputElement).value).toBe(fixtureSections.profile.shared.graduationValue);
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).value).toBe(fixtureSections.profile.translations.zh.name);
    expect((screen.getByLabelText("English Name") as HTMLInputElement).value).toBe(fixtureSections.profile.translations.en.name);
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe(persistedUrl);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("saves a local removal by persisting photoUrl null without uploading or deleting Storage data", async () => {
    const repository = repo();
    show(repository, persistedUrl);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    await waitFor(() => expect(repository.updateProfileSharedDetails).toHaveBeenCalledWith(resumeId, {
      ...fixtureSections.profile.shared, photoUrl: null,
    }));
    expect(repository.uploadProfilePhoto).not.toHaveBeenCalled();
    expect(screen.getByTestId("resume-preview").querySelector("img")).toBeNull();
    expect(within(screen.getByTestId("resume-preview")).getByText("DU")).toBeTruthy();
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("replaces a removal draft with a selected photo and saves through the upload flow", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:replacement-after-remove");
    const repository = repo();
    show(repository, persistedUrl);
    fireEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.getByTestId("resume-preview").querySelector("img")).toBeNull();
    selectPhoto("replacement.webp");
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe("blob:replacement-after-remove");
    expect(repository.uploadProfilePhoto).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    await waitFor(() => expect(repository.uploadProfilePhoto).toHaveBeenCalledOnce());
    await waitFor(() => expect(repository.updateProfileSharedDetails).toHaveBeenCalledWith(resumeId, {
      ...fixtureSections.profile.shared, photoUrl: persistedUrl,
    }));
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe(persistedUrl);
  });

  it("does not show Remove photo when the confirmed Profile has no photo", () => {
    show(repo());
    expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });

  it("uploads and persists only on explicit save, then switches preview to the confirmed unique URL", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:upload-me");
    const repository = repo();
    show(repository);
    selectPhoto();
    expect(repository.uploadProfilePhoto).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    await waitFor(() => expect(repository.uploadProfilePhoto).toHaveBeenCalledOnce());
    await waitFor(() => expect(repository.updateProfileSharedDetails).toHaveBeenCalledWith(resumeId, { ...fixtureSections.profile.shared, photoUrl: persistedUrl }));
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe(persistedUrl);
  });

  it("retains a selected photo after database failure and retries persistence without re-uploading", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry-photo");
    const update = vi.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockImplementation(async (_id: string, shared: UpdatedProfileRow["shared"]) => ({ resumeId, shared, updatedAt: null }));
    const repository = repo({ updateProfileSharedDetails: update });
    show(repository);
    selectPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe("blob:retry-photo");
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(repository.uploadProfilePhoto).toHaveBeenCalledOnce();
    expect(update).toHaveBeenLastCalledWith(resumeId, { ...fixtureSections.profile.shared, photoUrl: persistedUrl });
  });

  it("retains the selected photo and retries after an upload failure", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:upload-retry");
    const upload = vi.fn().mockRejectedValueOnce(new Error("storage unavailable")).mockResolvedValue(persistedUrl);
    const repository = repo({ uploadProfilePhoto: upload });
    show(repository);
    selectPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe("blob:upload-retry");
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    await waitFor(() => expect(repository.updateProfileSharedDetails).toHaveBeenCalledWith(resumeId, { ...fixtureSections.profile.shared, photoUrl: persistedUrl }));
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a confirmed photo upload when a localized save partially fails", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:partial-photo-save");
    const translation = vi.fn()
      .mockRejectedValueOnce(new Error("translation unavailable"))
      .mockImplementation(async (_id: string, locale: "zh" | "en", value: typeof fixtureSections.profile.translations.zh) => ({ resumeId, locale, translation: value, updatedAt: null }));
    const repository = repo({ updateProfileTranslation: translation });
    show(repository);
    selectPhoto();
    fireEvent.change(screen.getByLabelText("Chinese Name"), { target: { value: "更新中文名" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Some Profile changes could not be saved. Saved changes are kept; remaining changes are still unsaved.");
    expect(repository.uploadProfilePhoto).toHaveBeenCalledOnce();
    expect(repository.updateProfileSharedDetails).toHaveBeenCalledOnce();
    expect((screen.getByTestId("resume-preview").querySelector("img") as HTMLImageElement).src).toBe(persistedUrl);
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(repository.uploadProfilePhoto).toHaveBeenCalledOnce();
    expect(repository.updateProfileSharedDetails).toHaveBeenCalledOnce();
    expect(translation).toHaveBeenCalledTimes(2);
  });
});
