import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { AuthGate } from "../src/auth/AuthGate";
import { createAdminAuthClient } from "../src/auth/supabase";
import type { ResumeRepository } from "../src/data/resumeRepository";
import { fixtureSections } from "../src/fixtures";
import { UiLocaleProvider } from "../src/uiLocale";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe("Admin sign-out adapter (mock contract)", () => {
  it("explicitly requests local, never the default global or others", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const adapter = createAdminAuthClient({ auth: { signOut } } as unknown as SupabaseClient);
    await adapter.signOut();
    expect(signOut.mock.calls).toEqual([[{ scope: "local" }]]);
  });

  it("coalesces simultaneous sign-out calls instead of issuing two remote operations", async () => {
    const response = deferred<{ error: null }>();
    const signOut = vi.fn(() => response.promise);
    const adapter = createAdminAuthClient({ auth: { signOut } } as unknown as SupabaseClient);
    const first = adapter.signOut();
    const second = adapter.signOut();
    expect(signOut).toHaveBeenCalledOnce();
    response.resolve({ error: null });
    await Promise.all([first, second]);
  });

  it("propagates the provider error to all waiters without automatically retrying", async () => {
    const error = new Error("synthetic UNKNOWN");
    const response = deferred<{ error: Error }>();
    const signOut = vi.fn(() => response.promise);
    const adapter = createAdminAuthClient({ auth: { signOut } } as unknown as SupabaseClient);
    const results = Promise.allSettled([adapter.signOut(), adapter.signOut()]);
    response.resolve({ error });
    expect(await results).toEqual([{ status: "rejected", reason: error }, { status: "rejected", reason: error }]);
    await Promise.resolve();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("propagates an unexpected thrown error without issuing a fallback logout", async () => {
    const signOut = vi.fn().mockRejectedValue(new Error("synthetic local storage failure"));
    const adapter = createAdminAuthClient({ auth: { signOut } } as unknown as SupabaseClient);
    await expect(adapter.signOut()).rejects.toThrow("synthetic local storage failure");
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });
});

// The installed, lockfile-pinned SDK executes normally. Only transport, storage,
// and cross-tab delivery are synthetic: these are NOT cloud/multi-device tests.
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class IsolatedBroadcastChannel {
  static profile = "current-browser";
  static channels = new Set<IsolatedBroadcastChannel>();
  profile = IsolatedBroadcastChannel.profile;
  listeners: Array<(event: { data: unknown }) => void> = [];
  constructor(readonly name: string) { IsolatedBroadcastChannel.channels.add(this); }
  addEventListener(_type: string, listener: (event: { data: unknown }) => void) { this.listeners.push(listener); }
  postMessage(data: unknown) {
    for (const channel of IsolatedBroadcastChannel.channels) {
      if (channel !== this && channel.profile === this.profile && channel.name === this.name) {
        for (const listener of channel.listeners) queueMicrotask(() => listener({ data }));
      }
    }
  }
  close() { IsolatedBroadcastChannel.channels.delete(this); }
}

const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@example.invalid", aud: "authenticated", role: "authenticated" };
const clients: SupabaseClient[] = [];
let testId = 0;
let storageKey: string;
let sessions: Set<string>;
let outcome: "success" | "reset" | "timeout" | "http500";
let holdLogout: ReturnType<typeof deferred<void>> | null;
let requests: Array<{ method: string; path: string; scope: string | null; sessionId?: string }>;

function seed(storage: MemoryStorage, sessionId: string) {
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, session_id: sessionId, exp: expires_at }))}.synthetic-signature`;
  storage.setItem(storageKey, JSON.stringify({ access_token: token, refresh_token: `synthetic-${sessionId}`, token_type: "bearer", expires_at, expires_in: 3600, user }));
  sessions.add(sessionId);
}

function sdk(storage: MemoryStorage, profile = "current-browser") {
  IsolatedBroadcastChannel.profile = profile;
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== "https://cms-auth.example.invalid") throw new Error("external transport forbidden");
    const method = init?.method ?? "GET";
    const authorization = new Headers(init?.headers).get("Authorization");
    const payload = authorization?.split(".")[1];
    const sessionId = payload ? (JSON.parse(atob(payload)) as { session_id: string }).session_id : undefined;
    requests.push({ method, path: url.pathname, scope: url.searchParams.get("scope"), sessionId });
    if (method === "POST" && url.pathname === "/auth/v1/logout") {
      if (holdLogout) await holdLogout.promise;
      if (outcome === "reset") throw new TypeError("synthetic ECONNRESET / response lost");
      if (outcome === "timeout") throw new DOMException("synthetic timeout", "TimeoutError");
      if (outcome === "http500") return Response.json({ message: "synthetic upstream failure" }, { status: 500 });
      if (url.searchParams.get("scope") === "local") sessions.delete(sessionId!);
      else sessions.clear(); // Detect a global/others regression; not a real server.
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && url.pathname === "/auth/v1/user") {
      if (!sessions.has(sessionId!)) return Response.json({ message: "synthetic revoked session" }, { status: 401 });
      return Response.json(user);
    }
    if (method === "POST" && url.pathname === "/rest/v1/rpc/is_resume_admin") return Response.json(true);
    if (method === "POST" && url.pathname === "/rest/v1/rpc/get_admin_resume_target") {
      return Response.json([{ resume_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", site_key: "example-cv", role: "owner" }]);
    }
    throw new Error(`unplanned synthetic request: ${method} ${url.pathname}`);
  };
  const client = createClient("https://cms-auth.example.invalid", "synthetic-public-key", {
    auth: { storage, storageKey, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: transport },
  });
  clients.push(client);
  return client;
}

function showProtectedPage(client: SupabaseClient) {
  const repository = { load: vi.fn().mockResolvedValue({ resumeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", siteKey: "example-cv", isPublished: true, updatedAt: null, sections: fixtureSections }) } as unknown as ResumeRepository;
  return render(<UiLocaleProvider><MemoryRouter initialEntries={["/education"]}><AuthGate client={createAdminAuthClient(client)} resumeRepository={repository} /></MemoryRouter></UiLocaleProvider>);
}

describe("local sign-out with installed SDK, synthetic transport and storage", () => {
  beforeEach(() => {
    storageKey = `cms-synthetic-signout-${++testId}`;
    sessions = new Set(); outcome = "success"; requests = []; holdLogout = null;
    vi.stubGlobal("BroadcastChannel", IsolatedBroadcastChannel);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("real network forbidden"); }));
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    window.sessionStorage.clear();
  });
  afterEach(async () => {
    cleanup();
    await Promise.all(clients.splice(0).map(client => client.auth.dispose()));
    IsolatedBroadcastChannel.channels.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it("clears the shared current session, notifies its other tab and denies protected UI; the independent session survives", async () => {
    const current = new MemoryStorage(); const independent = new MemoryStorage();
    seed(current, "current-session"); seed(independent, "other-device-session");
    const first = sdk(current); const otherTab = sdk(current); const otherDevice = sdk(independent, "independent-browser");
    const otherAdapter = createAdminAuthClient(otherDevice);
    await expect(otherAdapter.getIdentity()).resolves.toMatchObject({ id: user.id });
    showProtectedPage(otherTab);
    await screen.findByRole("navigation", { name: "CMS sections" });
    const events: string[] = [];
    otherTab.auth.onAuthStateChange(event => { events.push(event); });
    await act(async () => { await createAdminAuthClient(first).signOut(); });
    await screen.findByRole("heading", { name: "Welcome back" });
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(events).toContain("SIGNED_OUT");
    expect(current.getItem(storageKey)).toBeNull();
    expect(independent.getItem(storageKey)).not.toBeNull();
    expect(sessions).toEqual(new Set(["other-device-session"]));
    await expect(otherAdapter.getIdentity()).resolves.toMatchObject({ id: user.id });
    expect(requests.filter(r => r.path.endsWith("/logout"))).toEqual([{ method: "POST", path: "/auth/v1/logout", scope: "local", sessionId: "current-session" }]);
    await expect(createAdminAuthClient(otherTab).getIdentityAndAccess!()).resolves.toEqual({ identity: null, allowed: false, target: null });
  });

  it.each(["reset", "timeout", "http500"] as const)("preserves %s as an error/remote UNKNOWN while clearing local access, without automatic retry", async failure => {
    const storage = new MemoryStorage(); seed(storage, "current-session");
    const client = sdk(storage); const adapter = createAdminAuthClient(client);
    showProtectedPage(client);
    await screen.findByRole("navigation", { name: "CMS sections" });
    outcome = failure;
    await act(async () => { await expect(adapter.signOut()).rejects.toBeDefined(); });
    await screen.findByRole("heading", { name: "Welcome back" });
    expect(storage.getItem(storageKey)).toBeNull();
    expect(sessions.has("current-session")).toBe(true); // Local removal is NOT remote revocation evidence.
    expect(screen.queryByRole("navigation", { name: "CMS sections" })).toBeNull();
    expect(requests.filter(r => r.path.endsWith("/logout"))).toHaveLength(1);
    await expect(adapter.getIdentityAndAccess!()).resolves.toEqual({ identity: null, allowed: false, target: null });
    // Even an explicit second SDK call without a session cannot send the old token again.
    await adapter.signOut();
    expect(requests.filter(r => r.path.endsWith("/logout"))).toHaveLength(1);
  });

  it("issues one local logout for overlapping calls and no second remote request after 204", async () => {
    const storage = new MemoryStorage(); seed(storage, "current-session");
    const client = sdk(storage); await client.auth.getSession();
    const adapter = createAdminAuthClient(client);
    holdLogout = deferred<void>();
    const first = adapter.signOut(); const second = adapter.signOut();
    await waitFor(() => expect(requests.filter(r => r.path.endsWith("/logout"))).toHaveLength(1));
    holdLogout.resolve();
    await Promise.all([first, second]);
    await adapter.signOut();
    expect(requests.filter(r => r.path.endsWith("/logout"))).toHaveLength(1);
    expect(storage.getItem(storageKey)).toBeNull();
  });

  it("does not reuse a completed attempt when a new current session is established", async () => {
    const storage = new MemoryStorage(); seed(storage, "first-session");
    const client = sdk(storage); const adapter = createAdminAuthClient(client);
    await adapter.signOut();
    seed(storage, "new-session");
    await expect(adapter.getIdentity()).resolves.toMatchObject({ id: user.id });
    await adapter.signOut();
    expect(requests.filter(r => r.path.endsWith("/logout")).map(r => [r.scope, r.sessionId]))
      .toEqual([["local", "first-session"], ["local", "new-session"]]);
    expect(storage.getItem(storageKey)).toBeNull();
  });
});
