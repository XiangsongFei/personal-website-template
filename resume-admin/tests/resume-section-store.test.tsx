import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient } from "../src/auth/supabase";
import { ResumeSectionStore, StaleResumeSectionRequestError } from "../src/data/resumeSectionStore";
import type { ResumeRepository } from "../src/data/resumeRepository";
import { fixtureSections } from "../src/fixtures";
import type { ResumeSiteMetadata } from "../src/data/resumeMapper";

const sessionA = "admin-a:session-a";
const sessionB = "admin-b:session-b";
const site = "resolved-resume-id";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function activatedStore(session = sessionA) {
  const store = new ResumeSectionStore();
  store.setSession(session);
  return store;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("authenticated resume section store", () => {
  it("coalesces concurrent same-session, site, and section loads and reuses successful values", async () => {
    const store = activatedStore();
    const pending = deferred<typeof fixtureSections.profile>();
    const loader = vi.fn(() => pending.promise);
    const first = store.loadSection(sessionA, site, "profile", loader);
    const second = store.loadSection(sessionA, site, "profile", loader);
    expect(first).toBe(second);
    expect(store.getSectionState(sessionA, site, "profile").status).toBe("loading");
    await Promise.resolve();
    expect(loader).toHaveBeenCalledOnce();
    pending.resolve(fixtureSections.profile);
    await expect(first).resolves.toBe(fixtureSections.profile);
    expect(store.getSectionState(sessionA, site, "profile")).toEqual({ status: "loaded", value: fixtureSections.profile });
    await expect(store.loadSection(sessionA, site, "profile", loader)).resolves.toBe(fixtureSections.profile);
    expect(loader).toHaveBeenCalledOnce();
  });

  it("loads different sections and sites independently", async () => {
    const store = activatedStore();
    const profileLoader = vi.fn().mockResolvedValue(fixtureSections.profile);
    const educationLoader = vi.fn().mockResolvedValue(fixtureSections.education);
    const otherSiteLoader = vi.fn().mockResolvedValue(fixtureSections.profile);
    await Promise.all([
      store.loadSection(sessionA, site, "profile", profileLoader),
      store.loadSection(sessionA, site, "education", educationLoader),
      store.loadSection(sessionA, "another-resume-id", "profile", otherSiteLoader),
    ]);
    expect(profileLoader).toHaveBeenCalledOnce();
    expect(educationLoader).toHaveBeenCalledOnce();
    expect(otherSiteLoader).toHaveBeenCalledOnce();
  });

  it("keeps failures retryable and isolates them from successful sections", async () => {
    const store = activatedStore();
    const profileLoader = vi.fn().mockResolvedValue(fixtureSections.profile);
    const educationLoader = vi.fn().mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(fixtureSections.education);
    await store.loadSection(sessionA, site, "profile", profileLoader);
    await expect(store.loadSection(sessionA, site, "education", educationLoader)).rejects.toThrow("temporary failure");
    expect(store.getSectionState(sessionA, site, "education").status).toBe("error");
    expect(store.getSectionState(sessionA, site, "profile")).toEqual({ status: "loaded", value: fixtureSections.profile });
    await expect(store.loadSection(sessionA, site, "education", educationLoader)).resolves.toBe(fixtureSections.education);
    expect(educationLoader).toHaveBeenCalledTimes(2);
    expect(profileLoader).toHaveBeenCalledOnce();
  });

  it("force-reloads exactly one section and rejects its superseded in-flight result", async () => {
    const store = activatedStore();
    const stale = deferred<typeof fixtureSections.education>();
    const oldRequest = store.loadSection(sessionA, site, "education", () => stale.promise);
    const refreshed = structuredClone(fixtureSections.education);
    const newLoader = vi.fn().mockResolvedValue(refreshed);
    const reload = store.reloadSection(sessionA, site, "education", newLoader);
    await expect(reload).resolves.toEqual(refreshed);
    stale.resolve(fixtureSections.education);
    await expect(oldRequest).rejects.toBeInstanceOf(StaleResumeSectionRequestError);
    expect(store.getSectionState(sessionA, site, "education")).toEqual({ status: "loaded", value: refreshed });
    expect(store.getSectionState(sessionA, site, "profile").status).toBe("idle");
    expect(newLoader).toHaveBeenCalledOnce();
  });

  it("does not share values across sessions and clears data when session identity changes", async () => {
    const store = activatedStore();
    const firstLoader = vi.fn().mockResolvedValue(fixtureSections.profile);
    await store.loadSection(sessionA, site, "profile", firstLoader);
    store.setSession(sessionB);
    expect(store.getSectionState(sessionB, site, "profile").status).toBe("idle");
    const secondLoader = vi.fn().mockResolvedValue(fixtureSections.profile);
    await store.loadSection(sessionB, site, "profile", secondLoader);
    expect(firstLoader).toHaveBeenCalledOnce();
    expect(secondLoader).toHaveBeenCalledOnce();
    expect(store.getSectionState(sessionA, site, "profile").status).toBe("idle");
  });

  it("ignores and rejects a late response from an invalidated session", async () => {
    const store = activatedStore();
    const pending = deferred<typeof fixtureSections.profile>();
    const request = store.loadSection(sessionA, site, "profile", () => pending.promise);
    store.invalidate();
    store.setSession(sessionB);
    pending.resolve(fixtureSections.profile);
    await expect(request).rejects.toBeInstanceOf(StaleResumeSectionRequestError);
    expect(store.getSectionState(sessionB, site, "profile").status).toBe("idle");
    expect(store.getSectionState(sessionA, site, "profile").status).toBe("idle");
  });

  it("coalesces and reuses site metadata lookup within the session", async () => {
    const store = activatedStore();
    const metadata: ResumeSiteMetadata = { resumeId: site, siteKey: "example-cv", isPublished: true, updatedAt: null };
    const pending = deferred<ResumeSiteMetadata>();
    const loader = vi.fn(() => pending.promise);
    const first = store.loadSiteMetadata(sessionA, loader);
    const second = store.loadSiteMetadata(sessionA, loader);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledOnce();
    pending.resolve(metadata);
    await expect(first).resolves.toEqual(metadata);
    await expect(store.loadSiteMetadata(sessionA, loader)).resolves.toEqual(metadata);
    expect(loader).toHaveBeenCalledOnce();
    expect(store.getSiteMetadataState(sessionA)).toEqual({ status: "loaded", value: metadata });
  });

  it("uses no UI-locale dimension and writes no resume data to browser storage", async () => {
    const store = activatedStore();
    const localSet = vi.spyOn(window.localStorage.__proto__, "setItem");
    const sessionSet = vi.spyOn(window.sessionStorage.__proto__, "setItem");
    const loader = vi.fn().mockResolvedValue(fixtureSections.profile);
    let uiLocale = "en";
    await store.loadSection(sessionA, site, "profile", loader);
    uiLocale = "zh";
    await store.loadSection(sessionA, site, "profile", loader);
    expect(uiLocale).toBe("zh");
    expect(loader).toHaveBeenCalledOnce();
    expect(localSet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("starts empty when a new store instance is created", async () => {
    const previous = activatedStore();
    await previous.loadSection(sessionA, site, "profile", async () => fixtureSections.profile);
    const remounted = new ResumeSectionStore();
    remounted.setSession(sessionA);
    expect(remounted.getSectionState(sessionA, site, "profile").status).toBe("idle");
  });

  it("coalesces StrictMode-style duplicate requests and retains the full ResumeLoader path", async () => {
    const store = activatedStore();
    const loader = vi.fn().mockResolvedValue(fixtureSections.education);
    const [first, second] = await Promise.all([
      store.loadSection(sessionA, site, "education", loader),
      store.loadSection(sessionA, site, "education", loader),
    ]);
    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledOnce();
    const source = readFileSync(resolve("src/data/ResumeLoader.tsx"), "utf8");
    expect(source).toContain("loadOnce(repository, sessionKey)");
    expect(source).toContain("repository.load()");
    expect(source).toContain('"profile", () => repository.loadProfile(metadata.resumeId)');
  });

  it("clears the section cache on AuthGate sign-out", async () => {
    const sectionStore = activatedStore();
    let listener: ((event: string, sessionKey: string | null) => void) | undefined;
    const authClient: AdminAuthClient = {
      getIdentity: vi.fn().mockResolvedValue({ id: "admin-a", email: "a@example.test", sessionKey: sessionA }),
      signIn: vi.fn(), isResumeAdmin: vi.fn().mockResolvedValue(true),
      signOut: vi.fn(async () => { listener?.("SIGNED_OUT", null); }),
      subscribe: vi.fn(callback => { listener = callback as typeof listener; return () => { listener = undefined; }; }),
    };
    const repository: ResumeRepository = {
      load: vi.fn().mockResolvedValue({ resumeId: site, siteKey: "example-cv", isPublished: true, updatedAt: null, sections: fixtureSections }),
      updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn(),
    };
    render(<StrictMode><MemoryRouter initialEntries={["/profile"]}><AuthGate client={authClient} resumeRepository={repository} sectionStore={sectionStore} /></MemoryRouter></StrictMode>);
    await screen.findByRole("navigation", { name: "CMS sections" });
    await sectionStore.loadSection(sessionA, site, "profile", async () => fixtureSections.profile);
    expect(sectionStore.getSectionState(sessionA, site, "profile").status).toBe("loaded");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(sectionStore.getSectionState(sessionA, site, "profile").status).toBe("idle");
  });
});
