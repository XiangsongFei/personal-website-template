import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient, AdminIdentity } from "../src/auth/supabase";
import type { ResumeRepository } from "../src/data/resumeRepository";
import { fixtureSections } from "../src/fixtures";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const admin: AdminIdentity = { id: "admin-id", email: "admin@example.test", sessionKey: "admin-session" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function mockClient(identity: AdminIdentity | null = null, allowed = false) {
  let listener: ((event: "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED", sessionKey: string | null) => void) | undefined;
  const unsubscribe = vi.fn();
  const client: AdminAuthClient = {
    getIdentity: vi.fn().mockResolvedValue(identity),
    signIn: vi.fn().mockResolvedValue(undefined),
    isResumeAdmin: vi.fn().mockResolvedValue(allowed),
    signOut: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(callback => { listener = callback as typeof listener; return unsubscribe; }),
  };
  return { client, emit: (event: "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED", sessionKey: string | null = identity?.sessionKey ?? null) => listener?.(event, sessionKey), unsubscribe };
}

function show(client: AdminAuthClient, path = "/overview") {
  const resumeRepository: ResumeRepository = { load: vi.fn().mockResolvedValue({
    resumeId: "test-resume-id", siteKey: "example-cv", isPublished: true, updatedAt: null, sections: fixtureSections,
  }), updateProfileSharedDetails: vi.fn(), updateProfileTranslation: vi.fn() };
  return render(<UiLocaleProvider><MemoryRouter initialEntries={[path]}><PathnameProbe /><AuthGate client={client} resumeRepository={resumeRepository} /></MemoryRouter></UiLocaleProvider>);
}

function PathnameProbe() { const location = useLocation(); return <div data-testid="current-path">{location.pathname}</div>; }

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); });

describe("Stage 4C auth gate", () => {
  it("does not present an intermediate page while restoring a session", () => {
    const auth = mockClient();
    vi.mocked(auth.client.getIdentity).mockReturnValue(deferred<AdminIdentity | null>().promise);
    show(auth.client, "/experience");
    expect(screen.getByTestId("current-path").textContent).toBe("/experience");
    expect(document.querySelector(".auth-screen, .app-shell")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save production changes" })).toBeNull();
  });

  it("does not mount the CMS until admin authorization is confirmed", async () => {
    const auth = mockClient(admin, true);
    const check = deferred<boolean>();
    vi.mocked(auth.client.isResumeAdmin).mockReturnValue(check.promise);
    show(auth.client, "/profile");
    await waitFor(() => expect(auth.client.isResumeAdmin).toHaveBeenCalledOnce());
    expect(screen.getByTestId("current-path").textContent).toBe("/profile");
    expect(document.querySelector(".auth-screen, .app-shell")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save production changes" })).toBeNull();
    check.resolve(true);
    expect(await screen.findByRole("navigation", { name: "CMS sections" })).toBeTruthy();
  });

  it("preserves every supported deep route through session and admin checks", async () => {
    const routes = [
      ["/overview", "Overview"], ["/profile", "Profile"], ["/introduction", "Introduction"],
      ["/education", "Education"], ["/experience", "Experience"], ["/projects", "Projects"],
      ["/skills", "Skills"], ["/awards", "Awards"], ["/contact", "Contact"], ["/links", "Links & Site Text"],
    ] as const;
    for (const [path, title] of routes) {
      cleanup();
      window.sessionStorage.clear();
      const auth = mockClient(admin, true);
      show(auth.client, path);
      expect(await screen.findByRole("heading", { name: title, level: 1 })).toBeTruthy();
      expect(screen.getByTestId("current-path").textContent).toBe(path);
    }
  });

  it("uses the not-found route only for an invalid path without rewriting its URL", async () => {
    const auth = mockClient(admin, true);
    show(auth.client, "/not-a-cms-section");
    expect(await screen.findByRole("heading", { name: "Section not found" })).toBeTruthy();
    expect(screen.getByTestId("current-path").textContent).toBe("/not-a-cms-section");
  });

  it("preserves the saved UI locale through session and authorization restoration", async () => {
    window.localStorage.setItem(UI_LOCALE_KEY, "zh");
    const auth = mockClient(admin, true);
    const check = deferred<boolean>();
    vi.mocked(auth.client.isResumeAdmin).mockReturnValue(check.promise);
    show(auth.client, "/education");
    await waitFor(() => expect(auth.client.isResumeAdmin).toHaveBeenCalledOnce());
    expect(document.querySelector(".auth-screen, .app-shell")).toBeNull();
    expect(screen.getByTestId("current-path").textContent).toBe("/education");
    check.resolve(true);
    expect(await screen.findByRole("heading", { name: "教育经历" })).toBeTruthy();
  });

  it("shows sign-in when there is no session", async () => {
    const auth = mockClient(); show(auth.client);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(auth.client.isResumeAdmin).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
  });

  it("mounts the fixture CMS only after explicit admin true", async () => {
    const auth = mockClient(admin, true); show(auth.client);
    expect(await screen.findByRole("navigation", { name: "CMS sections" })).toBeTruthy();
    expect(screen.getByText("admin@example.test")).toBeTruthy();
    expect(auth.client.isResumeAdmin).toHaveBeenCalledOnce();
  });

  it("denies a non-admin session without mounting the CMS", async () => {
    const auth = mockClient(admin, false); show(auth.client);
    expect(await screen.findByRole("heading", { name: "Access denied" })).toBeTruthy();
    expect(screen.getByText(/admin@example.test/)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
  });

  it("fails closed on RPC error and permits retry", async () => {
    const auth = mockClient(admin, true);
    vi.mocked(auth.client.isResumeAdmin).mockRejectedValueOnce(new Error("network"));
    show(auth.client);
    expect(await screen.findByRole("heading", { name: "Unable to check access" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("navigation", { name: "CMS sections" })).toBeTruthy();
  });

  it("shows a generic error for invalid credentials", async () => {
    const auth = mockClient();
    vi.mocked(auth.client.signIn).mockRejectedValue(new Error("specific provider error"));
    show(auth.client); await screen.findByRole("heading", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Unable to sign in. Check your email and password.");
  });

  it("checks authorization after login before mounting the CMS", async () => {
    const auth = mockClient();
    const check = deferred<boolean>();
    vi.mocked(auth.client.getIdentity).mockResolvedValueOnce(null).mockResolvedValue(admin);
    vi.mocked(auth.client.isResumeAdmin).mockReturnValue(check.promise);
    show(auth.client); await screen.findByRole("heading", { name: "Sign in" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.client.isResumeAdmin).toHaveBeenCalled());
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    check.resolve(true);
    expect(await screen.findByRole("navigation", { name: "CMS sections" })).toBeTruthy();
  });

  it("signs out, unmounts CMS, and keeps fixture session storage", async () => {
    const auth = mockClient(admin, true); show(auth.client);
    await screen.findByRole("navigation", { name: "CMS sections" });
    window.sessionStorage.setItem("example-cv-cms-fixture-profile", "fixture");
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(auth.client.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(window.sessionStorage.getItem("example-cv-cms-fixture-profile")).toBe("fixture");
  });

  it("does not reveal a direct protected editor route while signed out", async () => {
    const auth = mockClient(); show(auth.client, "/education");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByRole("heading", { name: "Education" })).toBeNull();
  });

  it("restores an admin session on a protected route", async () => {
    const auth = mockClient(admin, true); show(auth.client, "/education");
    expect(await screen.findByRole("heading", { name: "Education" })).toBeTruthy();
  });

  it("cleans up its single auth subscription", async () => {
    const auth = mockClient(); const view = show(auth.client);
    await screen.findByRole("heading", { name: "Sign in" });
    expect(auth.client.subscribe).toHaveBeenCalledOnce();
    view.unmount(); expect(auth.unsubscribe).toHaveBeenCalledOnce();
  });

  it("makes no production resume content request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const auth = mockClient(admin, true); show(auth.client);
    await screen.findByRole("navigation", { name: "CMS sections" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unmounts the CMS on a signed-out auth event", async () => {
    const auth = mockClient(admin, true); show(auth.client);
    await screen.findByRole("navigation", { name: "CMS sections" });
    auth.emit("SIGNED_OUT");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  });

  it("reports sign-out failure without claiming success", async () => {
    const auth = mockClient(admin, true);
    vi.mocked(auth.client.signOut).mockRejectedValue(new Error("network"));
    show(auth.client); await screen.findByRole("navigation", { name: "CMS sections" });
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Unable to sign out. Please try again.");
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
  });
});
