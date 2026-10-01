import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient, AdminIdentity } from "../src/auth/supabase";
import { fixtureSections } from "../src/fixtures";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";
import { ResumeSectionStore } from "../src/data/resumeSectionStore";
import { createWriteReadinessRepository, type ResumeRepository, type ResumeSectionRepository } from "../src/data/resumeRepository";
import { clearAllRouteSnapshots, readRouteSnapshot, writeRouteSnapshot, type RouteSnapshot, type SnapshotRoute } from "../src/data/routeSnapshot";

const site = { resumeId: "snapshot-resume", siteKey: "example-cv" as const, isPublished: true, updatedAt: "2026-09-30T00:00:00Z" };
const admin: AdminIdentity = { id: "snapshot-admin", email: "admin@example.test", sessionKey: "verified-session" };
const storageKey = "example-cv-cms:route-snapshot:v2:snapshot-admin:snapshot-resume:/profile";
const workspaceViewKey = "example-cv-cms:ui:workspace-view:profile";
const originalLocale = window.localStorage.getItem(UI_LOCALE_KEY);

function makeSnapshot(route: SnapshotRoute = "/profile", userId = admin.id): RouteSnapshot {
  const common = { schemaVersion: 2 as const, route, savedAt: Date.now(), userId, site };
  if (route === "/profile") return { ...common, route, data: structuredClone(fixtureSections.profile) } as RouteSnapshot;
  if (route === "/education") return { ...common, route, data: structuredClone(fixtureSections.education), sectionText: structuredClone(fixtureSections.links.translations) } as RouteSnapshot;
  if (["/experience", "/projects", "/skills", "/awards"].includes(route)) return { ...common, route, data: structuredClone(fixtureSections[route.slice(1) as "experience" | "projects" | "skills" | "awards"]), sectionText: structuredClone(fixtureSections.links.translations) } as RouteSnapshot;
  if (route === "/introduction") return { ...common, route, data: structuredClone(fixtureSections.introduction) } as RouteSnapshot;
  if (route === "/contact") return { ...common, route, data: structuredClone(fixtureSections.contact) } as RouteSnapshot;
  return { ...common, route, data: structuredClone(fixtureSections.links) } as RouteSnapshot;
}

function mockAuth(identity: AdminIdentity | null, allowed = true, identityPromise?: Promise<AdminIdentity | null>, accessPromise?: Promise<boolean>) {
  let listener: ((event: string, sessionKey: string | null) => void) | undefined;
  const client: AdminAuthClient = {
    getIdentity: vi.fn(() => identityPromise ?? Promise.resolve(identity)),
    getAdminTarget: vi.fn(async () => ({ resumeId: site.resumeId, siteKey: "example-cv", role: "owner" as const })),
    isResumeAdmin: vi.fn(() => accessPromise ?? Promise.resolve(allowed)),
    signIn: vi.fn(),
    signOut: vi.fn(async () => listener?.("SIGNED_OUT", null)),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }),
  };
  return { client, emit: (event: string, key: string | null = identity?.sessionKey ?? null) => listener?.(event, key) };
}

type TestRepository = ResumeRepository & Partial<ResumeSectionRepository>;
function mockRepository(overrides: Partial<TestRepository> = {}): TestRepository {
  return {
    load: vi.fn(),
    loadSiteMetadata: vi.fn().mockResolvedValue(site),
    loadProfile: vi.fn().mockResolvedValue(structuredClone(fixtureSections.profile)),
    updateProfileSharedDetails: vi.fn().mockResolvedValue({ resumeId: site.resumeId, shared: fixtureSections.profile.shared, updatedAt: null }),
    updateProfileTranslation: vi.fn(),
    ...overrides,
  } as unknown as TestRepository;
}

function show(client: AdminAuthClient, repository: ResumeRepository) {
  return render(<UiLocaleProvider><MemoryRouter initialEntries={["/profile"]}><AuthGate client={client} resumeRepository={repository} sectionStore={new ResumeSectionStore()} /></MemoryRouter></UiLocaleProvider>);
}

function markNavigationAsReload() {
  vi.spyOn(window.performance, "getEntriesByType").mockImplementation(type => (type === "navigation" ? [{ type: "reload" }] : []) as unknown as PerformanceEntryList);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.removeItem(UI_LOCALE_KEY);
  markNavigationAsReload();
});
afterEach(() => {
  cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks();
  if (originalLocale !== null) window.localStorage.setItem(UI_LOCALE_KEY, originalLocale);
});

describe("route-scoped refresh snapshots", () => {
  it("stores and synchronously reads each supported route snapshot; rejects malformed, mismatched and incompatible data", () => {
    const routes: SnapshotRoute[] = ["/profile", "/introduction", "/education", "/experience", "/projects", "/skills", "/awards", "/contact", "/links"];
    for (const route of routes) {
      expect(writeRouteSnapshot(makeSnapshot(route))).toBe(true);
      expect(readRouteSnapshot(route, admin.id, site.resumeId)?.route).toBe(route);
    }
    expect(readRouteSnapshot("/overview")).toBeNull();
    window.sessionStorage.setItem(storageKey, "{");
    expect(readRouteSnapshot("/profile", admin.id, site.resumeId)).toBeNull();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    const oldSchema = { ...makeSnapshot(), schemaVersion: 99 };
    window.sessionStorage.setItem(storageKey, JSON.stringify(oldSchema));
    expect(readRouteSnapshot("/profile", admin.id, site.resumeId)).toBeNull();
    const wrongRoute = { ...makeSnapshot(), route: "/education" };
    window.sessionStorage.setItem(storageKey, JSON.stringify(wrongRoute));
    expect(readRouteSnapshot("/profile", admin.id, site.resumeId)).toBeNull();
    expect(writeRouteSnapshot({ ...makeSnapshot(), fileDraft: new File(["private"], "private.pdf") } as unknown as RouteSnapshot)).toBe(false);
  });

  it("keeps snapshots isolated by the server-authorized resume target", () => {
    const official = makeSnapshot();
    const qa = {
      ...makeSnapshot(),
      site: { ...site, resumeId: "qa-resume-id", siteKey: "example-cv-qa", isPublished: false },
    } as RouteSnapshot;
    expect(writeRouteSnapshot(official)).toBe(true);
    expect(writeRouteSnapshot(qa)).toBe(true);
    expect(readRouteSnapshot("/profile", admin.id, site.resumeId)?.site.siteKey).toBe("example-cv");
    expect(readRouteSnapshot("/profile", admin.id, "qa-resume-id")?.site.siteKey).toBe("example-cv-qa");
    expect(readRouteSnapshot("/profile")).toBeNull();
  });

  it("waits for the authorized target before rendering a cached route, then replaces it with fresh data", async () => {
    const snapshot = makeSnapshot();
    expect(writeRouteSnapshot(snapshot)).toBe(true);
    window.sessionStorage.setItem(workspaceViewKey, "edit");
    let resolveIdentity!: (value: AdminIdentity | null) => void;
    const identityPromise = new Promise<AdminIdentity | null>(resolve => { resolveIdentity = resolve; });
    const auth = mockAuth(null, true, identityPromise);
    const freshProfile = structuredClone(fixtureSections.profile);
    freshProfile.shared.footerName = "fresh-server-confirmed-name";
    const repo = mockRepository({ loadProfile: vi.fn().mockResolvedValue(freshProfile) });
    show(auth.client, repo);

    expect(screen.queryByRole("heading", { name: "Profile", level: 1 })).toBeNull();
    expect(document.querySelector(".editor-write-lock")).toBeNull();
    expect(repo.loadProfile).not.toHaveBeenCalled();
    resolveIdentity(admin);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Profile", level: 1 })).toBeTruthy());
    await waitFor(() => expect(repo.loadProfile).toHaveBeenCalledOnce());
    await waitFor(() => expect((document.querySelector(".editor-write-lock") as HTMLFieldSetElement).disabled).toBe(false));
    await waitFor(() => expect((readRouteSnapshot("/profile", admin.id, site.resumeId) as Extract<RouteSnapshot, { route: "/profile" }> | null)?.data.shared.footerName).toBe("fresh-server-confirmed-name"));
    fireEvent.change(screen.getByLabelText("Graduation value"), { target: { value: "unsaved-draft-value" } });
    expect((readRouteSnapshot("/profile", admin.id, site.resumeId) as Extract<RouteSnapshot, { route: "/profile" }> | null)?.data.shared.graduationValue).toBe(fixtureSections.profile.shared.graduationValue);
  });

  it("does not read route data or mount a write-capable view before both identity and admin access succeed", async () => {
    const snapshot = makeSnapshot(); writeRouteSnapshot(snapshot);
    let resolveIdentity!: (value: AdminIdentity | null) => void;
    const identityPromise = new Promise<AdminIdentity | null>(resolve => { resolveIdentity = resolve; });
    let resolveAccess!: (value: boolean) => void;
    const accessPromise = new Promise<boolean>(resolve => { resolveAccess = resolve; });
    const auth = mockAuth(null, true, identityPromise, accessPromise);
    const repo = mockRepository();
    show(auth.client, repo);
    resolveIdentity(admin);
    await waitFor(() => expect(auth.client.isResumeAdmin).toHaveBeenCalledOnce());
    expect(repo.loadSiteMetadata).not.toHaveBeenCalled();
    expect(repo.loadProfile).not.toHaveBeenCalled();
    expect(document.querySelector(".editor-write-lock")).toBeNull();
    resolveAccess(true);
    await waitFor(() => expect(repo.loadProfile).toHaveBeenCalledOnce());
  });

  it.each(["signed out", "non-admin", "access check failure"] as const)("clears the cached route after %s resolves", async label => {
    writeRouteSnapshot(makeSnapshot());
    const access = deferred<boolean>();
    const identity = label === "signed out" ? null : admin;
    const allowed = label !== "non-admin";
    const accessPromise = label === "access check failure" ? access.promise : undefined;
    const auth = mockAuth(identity, allowed, undefined, accessPromise);
    show(auth.client, mockRepository());
    if (label === "access check failure") {
      await waitFor(() => expect(auth.client.isResumeAdmin).toHaveBeenCalledOnce());
      access.reject(new Error("offline"));
    }
    const heading = label === "signed out" ? "Welcome back" : label === "non-admin" ? "Access denied" : "Unable to check access";
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("rejects a snapshot belonging to another verified user and signs out clear all route snapshots", async () => {
    writeRouteSnapshot(makeSnapshot("/profile", "old-user"));
    const other: AdminIdentity = { ...admin, id: "new-user" };
    const auth = mockAuth(other, true);
    const repo = mockRepository();
    show(auth.client, repo);
    await waitFor(() => expect(repo.loadProfile).toHaveBeenCalledOnce());
    await waitFor(() => expect((readRouteSnapshot("/profile", "new-user", site.resumeId) as Extract<RouteSnapshot, { route: "/profile" }> | null)?.userId).toBe("new-user"));
    window.sessionStorage.setItem("example-cv-cms:route-snapshot:v2:snapshot-admin:snapshot-resume:/links", "placeholder");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("heading", { name: "Welcome back" });
    expect(readRouteSnapshot("/profile", admin.id, site.resumeId)).toBeNull();
    expect(window.sessionStorage.getItem("example-cv-cms:route-snapshot:v2:snapshot-admin:snapshot-resume:/links")).toBeNull();
  });

  it("removes stale presentation when the fresh route read fails", async () => {
    writeRouteSnapshot(makeSnapshot());
    const auth = mockAuth(admin, true);
    const repo = mockRepository({ loadProfile: vi.fn().mockRejectedValue(new Error("read failed")) });
    show(auth.client, repo);
    expect(screen.queryByRole("heading", { name: "Profile", level: 1 })).toBeNull();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry).toBeTruthy();
    expect((document.querySelector(".editor-write-lock") as HTMLFieldSetElement).disabled).toBe(false);
    expect((retry as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Save profile changes" })).toBeNull();
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("clears snapshots stored by this feature without touching scroll-restoration state", () => {
    window.sessionStorage.setItem("example-cv-cms:route-snapshot:v2:snapshot-admin:snapshot-resume:/profile", "x");
    window.sessionStorage.setItem("example-cv-cms:ui:scroll:/profile:editor", "42");
    clearAllRouteSnapshots();
    expect(window.sessionStorage.getItem("example-cv-cms:route-snapshot:v2:snapshot-admin:snapshot-resume:/profile")).toBeNull();
    expect(window.sessionStorage.getItem("example-cv-cms:ui:scroll:/profile:editor")).toBe("42");
  });

  it("rejects Save, Delete and Upload at the repository boundary until writeReady", async () => {
    let ready = false;
    const source = {
      load: vi.fn().mockResolvedValue(null),
      readEditableTranslation: vi.fn().mockResolvedValue(null),
      updateProfileSharedDetails: vi.fn(), deleteEducationEntry: vi.fn(), uploadResumePdf: vi.fn(),
    } as unknown as ResumeRepository;
    const guarded = createWriteReadinessRepository(source, () => ready);
    await guarded.load();
    await guarded.readEditableTranslation?.("introduction", "r", "e", "zh");
    await expect(guarded.updateProfileSharedDetails("r", fixtureSections.profile.shared)).rejects.toThrow(/unavailable/);
    await expect(guarded.deleteEducationEntry?.("r", "e")).rejects.toThrow(/unavailable/);
    await expect(guarded.uploadResumePdf?.("r", "zh", new File(["x"], "x.pdf"))).rejects.toThrow(/unavailable/);
    expect(source.updateProfileSharedDetails).not.toHaveBeenCalled();
    expect(source.deleteEducationEntry).not.toHaveBeenCalled();
    expect(source.uploadResumePdf).not.toHaveBeenCalled();
    ready = true;
    await guarded.updateProfileSharedDetails("r", fixtureSections.profile.shared);
    expect(source.updateProfileSharedDetails).toHaveBeenCalledOnce();
  });
});
