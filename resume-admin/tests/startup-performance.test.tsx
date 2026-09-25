import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthGate } from "../src/auth/AuthGate";
import { createAdminAuthClient, type AdminAuthClient, type AdminIdentity } from "../src/auth/supabase";
import type { ResumeRepository, ResumeSectionRepository } from "../src/data/resumeRepository";
import { fixtureSections } from "../src/fixtures";

const adminA: AdminIdentity = { id: "admin-a", email: "a@example.test", sessionKey: "session-a" };
const adminB: AdminIdentity = { id: "admin-b", email: "b@example.test", sessionKey: "session-b" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(initial: AdminIdentity | null = adminA, load = vi.fn().mockResolvedValue({
  resumeId: "resume-a", siteKey: "example-cv", isPublished: true, updatedAt: null, sections: fixtureSections,
})) {
  let identity = initial;
  let listener: ((event: string, key: string | null) => void) | undefined;
  const client: AdminAuthClient = {
    getIdentity: vi.fn(async () => identity),
    signIn: vi.fn(async () => {
      identity = adminA;
      listener?.("SIGNED_IN", adminA.sessionKey);
    }),
    isResumeAdmin: vi.fn().mockResolvedValue(true),
    signOut: vi.fn(async () => { identity = null; listener?.("SIGNED_OUT", null); }),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }),
  };
  const repository: ResumeRepository & ResumeSectionRepository = {
    load: load as ResumeRepository["load"],
    loadSiteMetadata: vi.fn().mockResolvedValue({ resumeId: "resume-a", siteKey: "example-cv", isPublished: true, updatedAt: null }),
    loadOverview: vi.fn().mockResolvedValue({ profileName: "Demo User" }),
    loadProfile: vi.fn().mockResolvedValue(fixtureSections.profile),
    loadIntroduction: vi.fn().mockResolvedValue(fixtureSections.introduction),
    loadEducation: vi.fn().mockResolvedValue(fixtureSections.education),
    loadExperience: vi.fn().mockResolvedValue(fixtureSections.experience),
    loadProjects: vi.fn().mockResolvedValue(fixtureSections.projects),
    loadSkills: vi.fn().mockResolvedValue(fixtureSections.skills),
    loadAwards: vi.fn().mockResolvedValue(fixtureSections.awards),
    loadContact: vi.fn().mockResolvedValue(fixtureSections.contact),
    loadLinks: vi.fn().mockResolvedValue(fixtureSections.links),
    updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
  };
  return {
    client, repository,
    setIdentity(next: AdminIdentity | null) { identity = next; },
    emit(event: string, key: string | null = identity?.sessionKey ?? null) { listener?.(event, key); },
    render(path = "/profile", strict = false) {
      const gate = <MemoryRouter initialEntries={[path]}><AuthGate client={client} resumeRepository={repository} /></MemoryRouter>;
      return render(strict ? <StrictMode>{gate}</StrictMode> : gate);
    },
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("startup request coalescing", () => {
  it("keeps one effective auth check and Profile section load through StrictMode effect replay", async () => {
    const app = harness();
    app.render("/profile", true);
    await screen.findByRole("navigation", { name: "CMS sections" });
    expect(app.client.isResumeAdmin).toHaveBeenCalledOnce();
    expect(app.repository.load).not.toHaveBeenCalled();
    expect(app.repository.loadSiteMetadata).toHaveBeenCalledOnce();
    expect(app.repository.loadProfile).toHaveBeenCalledOnce();
  });

  it("shares equivalent in-flight restoration and ignores duplicate recovery SIGNED_IN", async () => {
    const identity = deferred<AdminIdentity | null>();
    const app = harness();
    vi.mocked(app.client.getIdentity).mockReturnValue(identity.promise);
    app.render();
    act(() => { app.emit("INITIAL_SESSION", adminA.sessionKey); app.emit("SIGNED_IN", adminA.sessionKey); });
    identity.resolve(adminA);
    await screen.findByRole("navigation", { name: "CMS sections" });
    expect(app.client.isResumeAdmin).toHaveBeenCalledOnce();
    act(() => app.emit("SIGNED_IN", adminA.sessionKey));
    expect(screen.queryByRole("heading", { name: "Checking access" })).toBeNull();
    expect(app.client.isResumeAdmin).toHaveBeenCalledOnce();
  });

  it("does not launch a second verification after manual sign-in event plus submit continuation", async () => {
    const app = harness(null);
    app.render();
    await screen.findByRole("heading", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("navigation", { name: "CMS sections" });
    expect(app.client.isResumeAdmin).toHaveBeenCalledOnce();
  });

  it("rechecks a different session and does not reuse its predecessor's authorization", async () => {
    const app = harness();
    app.render();
    await screen.findByRole("navigation", { name: "CMS sections" });
    app.setIdentity(adminB);
    act(() => app.emit("SIGNED_IN", adminB.sessionKey));
    await screen.findByText("b@example.test");
    expect(app.client.isResumeAdmin).toHaveBeenCalledTimes(2);
    expect(app.repository.loadProfile).toHaveBeenCalledTimes(2);
  });

  it("clears the editor on sign-out and fails closed when the session is invalid", async () => {
    const app = harness();
    app.render();
    await screen.findByRole("navigation", { name: "CMS sections" });
    act(() => app.emit("SIGNED_OUT", null));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(app.repository.loadProfile).toHaveBeenCalledOnce();

    const invalid = harness(null);
    invalid.render();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(invalid.client.isResumeAdmin).not.toHaveBeenCalled();

    const expired = harness();
    vi.mocked(expired.client.getIdentity).mockRejectedValue(new Error("expired session"));
    expired.render();
    expect(await screen.findByRole("heading", { name: "Unable to check access" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(expired.client.isResumeAdmin).not.toHaveBeenCalled();
  });

  it("requires an explicit admin check before rendering protected content", async () => {
    const app = harness();
    const check = deferred<boolean>();
    vi.mocked(app.client.isResumeAdmin).mockReturnValue(check.promise);
    app.render();
    await waitFor(() => expect(app.client.isResumeAdmin).toHaveBeenCalledOnce());
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    check.resolve(false);
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(app.repository.load).not.toHaveBeenCalled();
  });

  it("revalidates on token refresh without returning the existing editor to Checking access", async () => {
    const app = harness();
    app.render();
    await screen.findByRole("navigation", { name: "CMS sections" });
    act(() => app.emit("TOKEN_REFRESHED", adminA.sessionKey));
    await waitFor(() => expect(app.client.isResumeAdmin).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Checking access" })).toBeNull();
    expect(app.repository.loadProfile).toHaveBeenCalledOnce();
  });

  it("shares the complete resume load across StrictMode replay, but Retry starts fresh", async () => {
    const failed = deferred<never>();
    const load = vi.fn().mockReturnValueOnce(failed.promise).mockResolvedValue({
      resumeId: "resume-a", siteKey: "example-cv", isPublished: true, updatedAt: null, sections: fixtureSections,
    });
    const app = harness(adminA, load);
    app.render("/legacy-compat", true);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    failed.reject(new Error("temporary failure"));
    await screen.findByRole("heading", { name: "Unable to load resume content" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("navigation", { name: "CMS sections" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not share an old session's pending resume load with a new session", async () => {
    const firstLoad = deferred<never>();
    const secondLoad = deferred<never>();
    const load = vi.fn().mockReturnValueOnce(firstLoad.promise).mockReturnValueOnce(secondLoad.promise);
    const app = harness(adminA, load);
    app.render("/legacy-compat", true);
    await waitFor(() => expect(load).toHaveBeenCalledOnce());
    app.setIdentity(adminB);
    act(() => app.emit("SIGNED_IN", adminB.sessionKey));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    firstLoad.reject(new Error("old session request"));
    secondLoad.reject(new Error("new session request"));
  });

  it("coalesces getUser by session and still requires server validation", async () => {
    const session = {
      access_token: "header.eyJzZXNzaW9uX2lkIjoic2Vzc2lvbi1hIn0.signature",
      refresh_token: "refresh-a", user: { id: "admin-a", email: "a@example.test" },
    };
    const getUser = vi.fn().mockResolvedValue({ data: { user: session.user }, error: null });
    const getSession = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const onAuthStateChange = vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    const supabase = { auth: { getSession, getUser, onAuthStateChange }, rpc } as unknown as SupabaseClient;
    const auth = createAdminAuthClient(supabase);
    const [one, two] = await Promise.all([auth.getIdentity(), auth.getIdentity()]);
    expect(one?.id).toBe("admin-a");
    expect(two?.sessionKey).toBe(one?.sessionKey);
    expect(getUser).toHaveBeenCalledOnce();
    expect(getSession).toHaveBeenCalledTimes(3); // two initial reads and one post-validation session check
    expect(await auth.isResumeAdmin()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("is_resume_admin");
  });

  it("fails closed when server user validation rejects the stored session", async () => {
    const session = { access_token: "header.eyJzZXNzaW9uX2lkIjoic2Vzc2lvbi1hIn0.signature", user: { id: "admin-a" } };
    const supabase = { auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error("expired") }),
    } } as unknown as SupabaseClient;
    await expect(createAdminAuthClient(supabase).getIdentity()).rejects.toThrow("expired");
  });
});
