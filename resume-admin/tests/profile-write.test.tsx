import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { App } from "../src/App";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { fixtureSections } from "../src/fixtures";
import type { LoadedResume } from "../src/data/resumeMapper";
import { createResumeRepository, type ResumeRepository, type UpdatedProfileRow } from "../src/data/resumeRepository";

const resumeId = "loaded-resume-id";
const snapshot = (): LoadedResume => ({
  resumeId, siteKey: "example-cv", isPublished: true, updatedAt: null,
  sections: structuredClone(fixtureSections),
});

const confirmed = (graduationValue: string): UpdatedProfileRow => ({
  resumeId, updatedAt: "2026-09-24T00:00:00Z",
  shared: { graduationValue, avatarInitials: "DU", footerName: "Demo User", copyright: "© 2026 Demo User" },
});

function mockRepository(update = vi.fn().mockResolvedValue(confirmed("2030"))): ResumeRepository {
  return { load: vi.fn().mockResolvedValue(snapshot()), updateProfileSharedDetails: update, updateProfileTranslation: vi.fn() };
}

function showProfile(repository: ResumeRepository, onProfileSaved = vi.fn()) {
  const view = render(<MemoryRouter initialEntries={["/profile"]}><App identityEmail="admin@example.test"
    onSignOut={() => {}} signOutPending={false} signOutError="" resume={snapshot()}
    repository={repository} onProfileSaved={onProfileSaved} onProfileTranslationSaved={() => {}} /></MemoryRouter>);
  return { ...view, onProfileSaved };
}

function editGraduation(value: string) {
  fireEvent.change(screen.getByLabelText("Graduation value"), { target: { value } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Stage 4E repository write allowlist", () => {
  it("updates only the four shared columns on resume_profile, filtered by loaded resume_id", async () => {
    const single = vi.fn().mockResolvedValue({ data: {
      resume_id: resumeId, graduation_value: "2030", avatar_initials: "DU", footer_name: "Demo User",
      copyright: "© 2026 Demo User", updated_at: "2026-09-24T00:00:00Z",
    }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ update });
    const repo = createResumeRepository({ from } as unknown as SupabaseClient);
    const input = { ...confirmed("2030").shared, name: "NOT ALLOWED", resume_id: "WRONG" };
    const row = await repo.updateProfileSharedDetails(resumeId, input);
    expect(from).toHaveBeenCalledExactlyOnceWith("resume_profile");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      graduation_value: "2030", avatar_initials: "DU", footer_name: "Demo User", copyright: "© 2026 Demo User",
    });
    expect(eq).toHaveBeenCalledExactlyOnceWith("resume_id", resumeId);
    expect(select).toHaveBeenCalledExactlyOnceWith("resume_id,graduation_value,avatar_initials,footer_name,copyright,updated_at");
    expect(single).toHaveBeenCalledOnce();
    expect(row).toEqual(confirmed("2030"));
  });

  it("rejects missing or mismatched confirmation and invalid shared values", async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { from: vi.fn().mockReturnValue({ update: () => ({ eq: () => ({ select: () => ({ single }) }) }) }) } as unknown as SupabaseClient;
    const repo = createResumeRepository(client);
    await expect(repo.updateProfileSharedDetails(resumeId, confirmed("2030").shared)).rejects.toThrow("not confirmed");
    single.mockResolvedValue({ data: { resume_id: "another-resume" }, error: null });
    await expect(repo.updateProfileSharedDetails(resumeId, confirmed("2030").shared)).rejects.toThrow("not confirmed");
    await expect(repo.updateProfileSharedDetails(resumeId, { ...confirmed("2030").shared, footerName: null } as unknown as UpdatedProfileRow["shared"])).rejects.toThrow("Invalid shared");
  });
});

describe("Stage 4E Profile editor", () => {
  it("makes shared edits dirty while translation controls stay independent", () => {
    showProfile(mockRepository());
    expect(screen.getByRole("button", { name: "Save shared details" }).hasAttribute("disabled")).toBe(true);
    expect((screen.getByLabelText("English Name") as HTMLInputElement).readOnly).toBe(false);
    expect((screen.getByLabelText("Chinese Name") as HTMLInputElement).readOnly).toBe(false);
    expect(screen.getByRole("button", { name: "Save Chinese" }).hasAttribute("disabled")).toBe(true);
    editGraduation("2030");
    expect(screen.getByText("Shared details: Unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save shared details" }).hasAttribute("disabled")).toBe(false);
  });

  it("waits for confirmation, disables duplicate saves, then advances the baseline", async () => {
    const pending = deferred<UpdatedProfileRow>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const { onProfileSaved } = showProfile(mockRepository(update));
    editGraduation("2030");
    const form = screen.getByRole("button", { name: "Save shared details" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(update).toHaveBeenCalledExactlyOnceWith(resumeId, {
      graduationValue: "2030", avatarInitials: "DU", footerName: "Demo User", copyright: "© 2026 Demo User",
    });
    expect(screen.getByRole("button", { name: "Saving shared…" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Shared details: Unsaved changes")).toBeTruthy();
    expect(screen.queryByText("Shared profile details saved to production.")).toBeNull();
    pending.resolve(confirmed("2030"));
    expect(await screen.findByText("Shared profile details saved to production.")).toBeTruthy();
    expect(screen.getByText("Shared details: No unsaved changes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save shared details" }).hasAttribute("disabled")).toBe(true);
    expect(onProfileSaved).toHaveBeenCalledExactlyOnceWith(confirmed("2030"));
    editGraduation("2031");
    expect(screen.getByText("Shared details: Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect((screen.getByLabelText("Graduation value") as HTMLInputElement).value).toBe("2030");
  });

  it("retains the draft after failure and allows retry", async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(confirmed("2030"));
    showProfile(mockRepository(update));
    editGraduation("2030");
    fireEvent.click(screen.getByRole("button", { name: "Save shared details" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not save shared profile details. Your edits are still here; please retry.");
    expect((screen.getByLabelText("Graduation value") as HTMLInputElement).value).toBe("2030");
    expect(screen.getByText("Shared details: Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save shared details" }));
    expect(await screen.findByText("Shared profile details saved to production.")).toBeTruthy();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("keeps the confirmed production baseline after navigating away and back", async () => {
    const repository = mockRepository();
    const client: AdminAuthClient = {
      getIdentity: vi.fn().mockResolvedValue({ id: "admin-id", email: "admin@example.test", sessionKey: "admin-session" }),
      isResumeAdmin: vi.fn().mockResolvedValue(true), signIn: vi.fn(), signOut: vi.fn(),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByLabelText("Graduation value");
    editGraduation("2030");
    fireEvent.click(screen.getByRole("button", { name: "Save shared details" }));
    await screen.findByText("Shared profile details saved to production.");
    fireEvent.click(screen.getByRole("link", { name: "Overview" }));
    await screen.findByRole("heading", { name: "Overview" });
    fireEvent.click(screen.getByRole("navigation", { name: "CMS sections" }).querySelector('a[href="/profile"]')!);
    expect((screen.getByLabelText("Graduation value") as HTMLInputElement).value).toBe("2030");
    expect(screen.getByRole("button", { name: "Save shared details" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps non-Profile, non-Education sections on local-only save", () => {
    const update = vi.fn();
    const repository = mockRepository(update);
    render(<MemoryRouter initialEntries={["/links"]}><App identityEmail="admin@example.test"
      onSignOut={() => {}} signOutPending={false} signOutError="" resume={snapshot()}
      repository={repository} onProfileSaved={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("GitHub label"), { target: { value: "Local label" } });
    fireEvent.click(screen.getByRole("button", { name: "Save local draft" }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Production data was not changed");
  });

  it("does not expose a write action before auth or for a non-admin", async () => {
    const update = vi.fn();
    const repository = mockRepository(update);
    const client: AdminAuthClient = {
      getIdentity: vi.fn().mockResolvedValue({ id: "non-admin", email: "user@example.test", sessionKey: "user-session" }),
      isResumeAdmin: vi.fn().mockResolvedValue(false), signIn: vi.fn(), signOut: vi.fn(),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    render(<MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Access denied" });
    expect(repository.load).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save shared details" })).toBeNull();
  });
});
