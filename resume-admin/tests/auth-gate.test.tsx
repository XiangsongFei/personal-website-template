import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { AuthGate } from "../src/auth/AuthGate";
import type { AdminAuthClient, AdminIdentity } from "../src/auth/supabase";
import type { ResumeRepository } from "../src/data/resumeRepository";
import { fixtureSections } from "../src/fixtures";
import { UI_LOCALE_KEY, UiLocaleProvider } from "../src/uiLocale";

const admin: AdminIdentity = { id: "admin-id", email: "admin@example.test", sessionKey: "admin-session" };
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");

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

function PathnameProbe() { const location = useLocation(); const navigationType = useNavigationType(); return <div data-testid="current-path" data-navigation-type={navigationType}>{location.pathname}</div>; }

beforeEach(() => { window.sessionStorage.clear(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.removeItem(UI_LOCALE_KEY); vi.restoreAllMocks(); if (originalInnerWidth) Object.defineProperty(window, "innerWidth", originalInnerWidth); });

describe("Stage 4C auth gate", () => {
  it("does not present an intermediate page while restoring a session", () => {
    const auth = mockClient();
    vi.mocked(auth.client.getIdentity).mockReturnValue(deferred<AdminIdentity | null>().promise);
    show(auth.client, "/experience");
    expect(screen.getByTestId("current-path").textContent).toBe("/experience");
    expect(document.querySelector(".auth-login-screen .auth-login-content")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Checking access" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Please wait while your session and admin access are verified.");
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
    expect(document.querySelector(".auth-login-screen .auth-login-content")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Checking access" })).toBeTruthy();
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
      if (path === "/links") expect(await screen.findByRole("heading", { name: "Public links" })).toBeTruthy();
      else expect(await screen.findByRole("heading", { name: title, level: 1 })).toBeTruthy();
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
    expect(document.querySelector(".auth-login-screen .auth-login-content")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "正在检查访问权限" })).toBeTruthy();
    expect(screen.getByTestId("current-path").textContent).toBe("/education");
    check.resolve(true);
    expect(await screen.findByRole("heading", { name: "教育经历" })).toBeTruthy();
  });

  it("shows sign-in when there is no session", async () => {
    const auth = mockClient(); show(auth.client);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(document.querySelector(".auth-login-screen .auth-login-content .auth-login-header")).toBeTruthy();
    expect(screen.getByText("EXAMPLE_CV")).toBeTruthy();
    expect(screen.getByText("Resume CMS")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter your password")).toBeTruthy();
    expect(auth.client.isResumeAdmin).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
  });

  it("renders a localized, secret-free configuration state in the shared Login shell", () => {
    render(<UiLocaleProvider><MemoryRouter><AuthGate client={null} resumeRepository={null} /></MemoryRouter></UiLocaleProvider>);
    expect(document.querySelector(".auth-login-screen .auth-login-content")).toBeTruthy();
    expect(screen.getByText("EXAMPLE_CV")).toBeTruthy();
    expect(screen.getByText("Resume CMS")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Configuration required" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Admin setup is incomplete. Please contact the administrator.");
    expect(document.body.textContent).not.toMatch(/VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY|publishable key|\.env/i);
  });

  it("switches the configuration state between English and Chinese without changing its shell", () => {
    render(<UiLocaleProvider><MemoryRouter><AuthGate client={null} resumeRepository={null} /></MemoryRouter></UiLocaleProvider>);
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("heading", { name: "需要配置" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("管理后台尚未完成配置，暂时无法打开。请联系网站管理员。");
    const chineseSentences = screen.getByRole("alert").querySelectorAll(".configuration-required-chinese-sentence");
    expect(chineseSentences).toHaveLength(2);
    expect(chineseSentences[0].textContent).toBe("管理后台尚未完成配置，暂时无法打开。");
    expect(chineseSentences[1].textContent).toBe("请联系网站管理员。");
    expect(document.querySelector(".auth-login-screen .auth-login-content")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Configuration required" })).toBeTruthy();
  });

  it("keeps system states on the existing responsive Login shell at representative viewport widths", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".auth-login-screen{box-sizing:border-box;min-height:100vh;min-height:100svh;min-height:100dvh");
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("@media(min-width:641px){.auth-login-screen{place-items:start center");
    expect(css).toContain("@media(max-width:640px){.auth-login-screen{padding-bottom:");
    expect(css).toContain("@media(min-width:641px){.configuration-required-state{width:calc(50vw + 50% - 24px);max-width:none}.configuration-required-state .system-state-description{max-width:none;white-space:nowrap}}");
    expect(css).toContain("@media(max-width:640px){.configuration-required-state{width:100%}.configuration-required-state .configuration-required-chinese-sentence{display:block}.configuration-required-state .system-state-description{white-space:normal}}");
    expect(css).not.toContain("width:min(calc(100% + 12px)");
    expect(css).not.toContain(".configuration-required-state .system-state-description{padding-inline-end:16px}");
    render(<UiLocaleProvider><MemoryRouter><AuthGate client={null} resumeRepository={null} /></MemoryRouter></UiLocaleProvider>);
    for (const width of [1440, 1280, 1024, 860, 768, 430, 390]) {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      expect(document.querySelector(".auth-login-screen .auth-login-content .auth-login-header")).toBeTruthy();
      expect(document.querySelector(".configuration-required-state")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Configuration required" })).toBeTruthy();
    }
  });

  it("localizes the login composition and preserves its language switch", async () => {
    const auth = mockClient(); show(auth.client);
    await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByRole("heading", { name: "欢迎回来" })).toBeTruthy();
    expect(screen.getByText("简历内容管理")).toBeTruthy();
    expect(screen.getByText("登录以继续管理你的简历内容。")).toBeTruthy();
    expect(screen.getByLabelText("邮箱")).toBeTruthy();
    expect(screen.getByPlaceholderText("请输入邮箱")).toBeTruthy();
    expect(screen.getByPlaceholderText("请输入密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
    expect(screen.getByText("EXAMPLE_CV")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
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
    expect(document.querySelector(".auth-login-screen .auth-login-content")).toBeTruthy();
    expect(screen.getByText(/admin@example.test/)).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
  });

  it("fails closed on RPC error and permits retry", async () => {
    const auth = mockClient(admin, true);
    vi.mocked(auth.client.isResumeAdmin).mockRejectedValueOnce(new Error("network"));
    show(auth.client);
    expect(await screen.findByRole("heading", { name: "Unable to check access" })).toBeTruthy();
    expect(document.querySelector(".auth-login-screen .auth-login-content")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("navigation", { name: "CMS sections" })).toBeTruthy();
  });

  it("shows a generic error for invalid credentials", async () => {
    const auth = mockClient();
    vi.mocked(auth.client.getIdentity).mockResolvedValueOnce(null);
    vi.mocked(auth.client.signIn).mockRejectedValue(new Error("specific provider error"));
    show(auth.client, "/links"); await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Unable to sign in. Check your email and password.");
    expect(screen.getByTestId("current-path").textContent).toBe("/links");
    expect(screen.getByTestId("current-path").getAttribute("data-navigation-type")).toBe("POP");
  });

  it.each(["/links", "/profile", "/overview"])("navigates a fresh successful sign-in from %s to Overview", async path => {
    const auth = mockClient(admin, true);
    vi.mocked(auth.client.getIdentity).mockResolvedValueOnce(null).mockResolvedValue(admin);
    show(auth.client, path);
    await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(screen.getByTestId("current-path").textContent).toBe("/overview");
      expect(screen.getByTestId("current-path").getAttribute("data-navigation-type")).toBe("REPLACE");
    });
    expect(await screen.findByRole("heading", { name: "Overview", level: 1 })).toBeTruthy();
  });

  it("keeps an already-authenticated session on its requested route", async () => {
    const auth = mockClient(admin, true);
    show(auth.client, "/links");
    expect(await screen.findByRole("heading", { name: "Public links" })).toBeTruthy();
    expect(screen.getByTestId("current-path").textContent).toBe("/links");
    expect(screen.getByTestId("current-path").getAttribute("data-navigation-type")).toBe("POP");
  });

  it("submits from the form keyboard path and preserves its loading state", async () => {
    const auth = mockClient();
    const signIn = deferred<void>();
    vi.mocked(auth.client.signIn).mockReturnValue(signIn.promise);
    show(auth.client);
    await screen.findByRole("heading", { name: "Welcome back" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });
    fireEvent.submit(screen.getByLabelText("Password").closest("form")!);
    expect(screen.getByRole("button", { name: "Signing in…" }).hasAttribute("disabled")).toBe(true);
    signIn.resolve(undefined);
    await waitFor(() => expect(auth.client.signIn).toHaveBeenCalledOnce());
  });

  it("checks authorization after login before mounting the CMS", async () => {
    const auth = mockClient();
    const check = deferred<boolean>();
    vi.mocked(auth.client.getIdentity).mockResolvedValueOnce(null).mockResolvedValue(admin);
    vi.mocked(auth.client.isResumeAdmin).mockReturnValue(check.promise);
    show(auth.client); await screen.findByRole("heading", { name: "Welcome back" });
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
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(auth.client.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(window.sessionStorage.getItem("example-cv-cms-fixture-profile")).toBe("fixture");
  });

  it("does not reveal a direct protected editor route while signed out", async () => {
    const auth = mockClient(); show(auth.client, "/education");
    await screen.findByRole("heading", { name: "Welcome back" });
    expect(screen.queryByRole("heading", { name: "Education" })).toBeNull();
  });

  it("restores an admin session on a protected route", async () => {
    const auth = mockClient(admin, true); show(auth.client, "/education");
    expect(await screen.findByRole("heading", { name: "Education" })).toBeTruthy();
  });

  it("cleans up its single auth subscription", async () => {
    const auth = mockClient(); const view = show(auth.client);
    await screen.findByRole("heading", { name: "Welcome back" });
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
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeTruthy();
  });

  it("reports sign-out failure without claiming success", async () => {
    const auth = mockClient(admin, true);
    vi.mocked(auth.client.signOut).mockRejectedValue(new Error("network"));
    show(auth.client); await screen.findByRole("navigation", { name: "CMS sections" });
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect((await screen.findByText("Unable to sign out. Please try again.")).getAttribute("role")).toBe("alert");
    expect(screen.getByRole("navigation", { name: "CMS sections" })).toBeTruthy();
  });
});
