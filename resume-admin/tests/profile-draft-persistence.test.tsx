import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../src/App";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import type { LoadedResume } from "../src/data/resumeMapper";
import type { ResumeRepository, UpdatedProfileRow } from "../src/data/resumeRepository";
import { fixtureSections } from "../src/fixtures";

const resumeId = "draft-resume-id";
const snapshot = (): LoadedResume => ({ resumeId, siteKey: "example-cv", isPublished: true, updatedAt: null, sections: structuredClone(fixtureSections) });
const sharedRow = (graduationValue: string): UpdatedProfileRow => ({
  resumeId, updatedAt: "2026-09-24T00:00:00Z",
  shared: { ...fixtureSections.profile.shared, graduationValue },
});
function makeRepository(): ResumeRepository {
  return {
    load: vi.fn().mockResolvedValue(snapshot()),
    updateProfileSharedDetails: vi.fn(async (_id, value) => sharedRow(value.graduationValue)),
    updateProfileTranslation: vi.fn(async (_id, locale, value) => ({ resumeId, locale, updatedAt: null, translation: value })),
  };
}

function showProfile(repository = makeRepository()) {
  const view = render(<MemoryRouter initialEntries={["/profile"]}><App identityEmail="admin@example.test"
    onSignOut={() => {}} signOutPending={false} signOutError="" resume={snapshot()}
    repository={repository} onProfileSaved={() => {}} onProfileTranslationSaved={() => {}} /></MemoryRouter>);
  return { ...view, repository };
}

const edit = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const go = (section: string) => fireEvent.click(screen.getByRole("link", { name: section }));
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("in-memory Profile draft persistence", () => {
  it("preserves a shared edit over internal navigation and Cancel restores its confirmed baseline", async () => {
    const { repository } = showProfile();
    edit("Graduation value", "2027");
    go("Education");
    expect(await screen.findByRole("heading", { name: "Education" })).toBeTruthy();
    go("Profile");
    expect(value("Graduation value")).toBe("2027");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(value("Graduation value")).toBe(fixtureSections.profile.shared.graduationValue);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
  });

  it("preserves Chinese changes and reports a single dirty Profile state", async () => {
    showProfile();
    edit("Chinese Current Focus heading", "当前关注测试");
    go("Education");
    await screen.findByRole("heading", { name: "Education" });
    go("Experience");
    await screen.findByRole("heading", { name: "Experience" });
    go("Profile");
    expect(value("Chinese Current Focus heading")).toBe("当前关注测试");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("restores a Chinese translation's last confirmed baseline after navigation and Cancel", async () => {
    showProfile();
    edit("Chinese Current Focus heading", "当前关注临时修改");
    go("Education");
    await screen.findByRole("heading", { name: "Education" });
    go("Profile");
    expect(value("Chinese Current Focus heading")).toBe("当前关注临时修改");
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(value("Chinese Current Focus heading")).toBe(fixtureSections.profile.translations.zh.contactFocusHeading);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("preserves English edits over Projects navigation while the other boundaries stay clean", async () => {
    showProfile();
    edit("English Current Status heading", "Current Status test");
    go("Projects");
    await screen.findByRole("heading", { name: "Projects" });
    go("Profile");
    expect(value("English Current Status heading")).toBe("Current Status test");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("keeps all Profile drafts dirty together through navigation without writing", async () => {
    const { repository } = showProfile();
    edit("Graduation value", "2027");
    edit("Chinese Current Focus heading", "当前关注测试");
    edit("English Current Status heading", "Current Status test");
    go("Education");
    await screen.findByRole("heading", { name: "Education" });
    go("Profile");
    expect(value("Graduation value")).toBe("2027");
    expect(value("Chinese Current Focus heading")).toBe("当前关注测试");
    expect(value("English Current Status heading")).toBe("Current Status test");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(repository.updateProfileSharedDetails).not.toHaveBeenCalled();
    expect(repository.updateProfileTranslation).not.toHaveBeenCalled();
  });

  it.each(["zh", "en"] as const)("keeps a successful %s save clean after navigation", async locale => {
    const field = locale === "zh" ? "Chinese Current Focus heading" : "English Current Status heading";
    const changed = locale === "zh" ? "当前关注已保存" : "Current Status saved";
    const { repository } = showProfile();
    edit(field, changed);
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    go("Education");
    await screen.findByRole("heading", { name: "Education" });
    go("Profile");
    expect(value(field)).toBe(changed);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
    expect(repository.updateProfileTranslation).toHaveBeenCalledOnce();
  });

  it("retains a failed translation draft across navigation and allows retry", async () => {
    const repository = makeRepository();
    vi.mocked(repository.updateProfileTranslation).mockRejectedValueOnce(new Error("network"));
    const { repository: used } = showProfile(repository);
    edit("Chinese Current Focus heading", "当前关注待重试");
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    go("Education");
    await screen.findByRole("heading", { name: "Education" });
    go("Profile");
    expect(value("Chinese Current Focus heading")).toBe("当前关注待重试");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(used.updateProfileTranslation).toHaveBeenCalledTimes(2);
  });

  it("retains a failed shared save across navigation and allows retry", async () => {
    const repository = makeRepository();
    vi.mocked(repository.updateProfileSharedDetails).mockRejectedValueOnce(new Error("network"));
    const { repository: used } = showProfile(repository);
    edit("Graduation value", "2027");
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Profile changes were not saved. Your edits remain; please retry.");
    go("Education");
    await screen.findByRole("heading", { name: "Education" });
    go("Profile");
    expect(value("Graduation value")).toBe("2027");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save profile changes" }));
    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(used.updateProfileSharedDetails).toHaveBeenCalledTimes(2);
  });

  it("starts a remounted application from the loaded production snapshot", () => {
    const repository = makeRepository();
    const first = showProfile(repository);
    edit("Chinese Current Focus heading", "未保存");
    first.unmount();
    showProfile(repository);
    expect(value("Chinese Current Focus heading")).toBe(fixtureSections.profile.translations.zh.contactFocusHeading);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });

  it("discards Profile drafts after sign-out and a later sign-in", async () => {
    let identity: { id: string; email: string | null; sessionKey: string } | null = {
      id: "admin-id", email: "admin@example.test", sessionKey: "session-a",
    };
    let listener: ((event: string, key: string | null) => void) | undefined;
    const client: AdminAuthClient = {
      getIdentity: vi.fn(async () => identity),
      isResumeAdmin: vi.fn().mockResolvedValue(true),
      signIn: vi.fn(async () => { identity = { id: "admin-id", email: "admin@example.test", sessionKey: "session-b" }; listener?.("SIGNED_IN", "session-b"); }),
      signOut: vi.fn(async () => { identity = null; listener?.("SIGNED_OUT", null); }),
      subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }),
    };
    const repository = makeRepository();
    render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByLabelText("Chinese Current Focus heading");
    edit("Chinese Current Focus heading", "只存在于当前会话");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("heading", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByLabelText("Chinese Current Focus heading");
    expect(value("Chinese Current Focus heading")).toBe(fixtureSections.profile.translations.zh.contactFocusHeading);
    expect(screen.getByText("No unsaved changes")).toBeTruthy();
  });
});
