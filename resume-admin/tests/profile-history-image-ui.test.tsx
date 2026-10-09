import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ActivityLogPage } from "../src/ActivityLogPage";
import { ProfileHistoryPhoto, ProfileHistoryPhotoPair } from "../src/ProfileHistoryImage";
import { VersionHistoryPage } from "../src/VersionHistoryPage";
import { createResumeRepository, ProfileHistoryImageError, type ActivityLogV13CEvent, type ProfileHistoryImageRequest, type ResumeRepository, type VersionHistoryEntry } from "../src/data/resumeRepository";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UI_LOCALE_KEY, UiLocaleProvider, useUiLocale } from "../src/uiLocale";

const resumeId = "ea111111-1111-4111-8111-111111111111";
const eventId = "c6d3d789-6335-4e02-b957-ede24a4d09ab";
const occurredAt = "2026-10-05T02:10:04.438175+00:00";
const origin = "https://project.supabase.co";
const photoUrl = `${origin}/storage/v1/object/public/profile-images/${resumeId}/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
const photoKey = `${resumeId}/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp`;
const photoValue = { kind: "reference" } as const;
const noPhoto = { kind: "none" } as const;
const unsupported = { kind: "unsupported" } as const;

function profile(photo: string | null) {
  return { shared: { graduation_value: "2020", avatar_initials: "A", footer_name: "Admin", copyright: "Copyright", photo_url: photo },
    translations: Object.fromEntries(["zh", "en"].map(locale => [locale, { name: "Name", nav_about_label: "About", email_action_label: "Email",
      graduation_label: "Graduation", avatar_label: "Avatar", contact_focus_heading: "Focus", contact_status_heading: "Status" }])) };
}

function versionEntry(overrides: Partial<VersionHistoryEntry> = {}): VersionHistoryEntry {
  return { eventId, occurredAt, actorAccountLabel: "QA account", actorRole: "qa", domain: "profile", operation: "update",
    payloadVersion: 2, entityType: "profile_settings", entityId: null,
    comparison: { kind: "aggregate", before: profile(null), after: profile(photoUrl) }, ...overrides };
}

function versionRepository(entry: VersionHistoryEntry, resolve = vi.fn(async () => new Blob(["png"], { type: "image/png" }))) {
  return { loadVersionHistoryPage: vi.fn(async () => ({ entries: [entry], hasMore: false, nextCursor: null })),
    resolveProfileHistoryImage: resolve } as unknown as ResumeRepository;
}

function activityEvent(overrides: Partial<ActivityLogV13CEvent> = {}): ActivityLogV13CEvent {
  return { id: eventId, occurredAt, actorEmail: null, actorRole: "qa", operation: "update", section: "profile", entityType: "profile_settings",
    entityId: null, entitySnapshot: { profile: profile(photoUrl) }, changes: { profile: { before: profile(null), after: profile(photoUrl) } },
    ipNetwork: null, countryCode: null, region: null, city: null, eventSource: "activity", sourceRank: 1, payloadVersion: 2, ...overrides } as unknown as ActivityLogV13CEvent;
}

function activityRepository(event: ActivityLogV13CEvent, resolve = vi.fn(async () => new Blob(["png"], { type: "image/png" }))) {
  return { loadActivityLogAuthorizedTargets: vi.fn(async () => [{ resumeId, siteKey: "example-cv-qa", role: "qa" }]),
    loadActivityLogPageV13C: vi.fn(async () => [event]), resolveProfileHistoryImage: resolve } as unknown as ResumeRepository;
}

const urlMethodRestorers: Array<() => void> = [];

function setupObjectUrls() {
  const create = vi.fn(() => `blob:history-${Math.random()}`);
  const revoke = vi.fn();
  const priorCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const priorRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: create });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  urlMethodRestorers.push(() => {
    if (priorCreate) Object.defineProperty(URL, "createObjectURL", priorCreate); else Reflect.deleteProperty(URL, "createObjectURL");
    if (priorRevoke) Object.defineProperty(URL, "revokeObjectURL", priorRevoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
  });
  return { create, revoke };
}

function LocaleButton() { const { setLocale } = useUiLocale(); return <button onClick={() => setLocale("zh")}>中文</button>; }

afterEach(() => {
  cleanup();
  for (const restore of urlMethodRestorers.splice(0).reverse()) restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.removeItem(UI_LOCALE_KEY);
});

describe("Profile history photo previews", () => {
  it("renders a V2 Version History photo through the authenticated resolver contract", async () => {
    const urls = setupObjectUrls();
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/webp" }));
    const repository = versionRepository(versionEntry(), resolve);
    const view = render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={repository} /></UiLocaleProvider>);
    expect(await screen.findByAltText("Historical profile photo")).toBeTruthy();
    expect(screen.getByText("Before")).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith({ resumeId, eventId, occurredAt, side: "after" }, expect.any(AbortSignal));
    expect(resolve).not.toHaveBeenCalledWith(expect.objectContaining({ reference: photoUrl }), expect.anything());
    expect((screen.getByAltText("Historical profile photo") as HTMLImageElement).src).toMatch(/^blob:history-/);
    expect(document.body.textContent).not.toContain("project.supabase.co");
    view.unmount();
    expect(urls.revoke).toHaveBeenCalled();
  });

  it("integrates the same resolver-backed presentation into Activity Log V2", async () => {
    setupObjectUrls();
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const repository = activityRepository(activityEvent(), resolve);
    render(<UiLocaleProvider><ActivityLogPage resumeId={resumeId} repository={repository} /></UiLocaleProvider>);
    fireEvent.click(await screen.findByText(/View changed fields/));
    expect(await screen.findAllByAltText("Historical profile photo")).toHaveLength(1);
    expect(resolve).toHaveBeenCalledWith({ resumeId, eventId, occurredAt, side: "after" }, expect.any(AbortSignal));
    expect(document.body.textContent).not.toContain("project.supabase.co");
    cleanup();
  });

  it("supports V1 profile_image history without rendering its object key", async () => {
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/jpeg" }));
    const event = versionEntry({ payloadVersion: 1, entityType: "profile_image", comparison: {
      kind: "entity_fields", changes: { object_key: { before: null, after: photoKey } },
    } });
    render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={versionRepository(event, resolve)} /></UiLocaleProvider>);
    expect(await screen.findByAltText("Historical profile photo")).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith({ resumeId, eventId, occurredAt, side: "after" }, expect.any(AbortSignal));
    expect(document.body.textContent).not.toContain(photoKey);
  });

  it("supports V1 Profile-photo Activity Log entries through the same resolver", async () => {
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/jpeg" }));
    const event = activityEvent({ section: "files", payloadVersion: 1, entityType: "profile_image",
      entitySnapshot: undefined, changes: { object_key: { before: null, after: photoKey } } });
    render(<UiLocaleProvider><ActivityLogPage resumeId={resumeId} repository={activityRepository(event, resolve)} /></UiLocaleProvider>);
    fireEvent.click(await screen.findByText(/View changed fields/));
    expect(await screen.findByAltText("Historical profile photo")).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith({ resumeId, eventId, occurredAt, side: "after" }, expect.any(AbortSignal));
    expect(document.body.textContent).not.toContain(photoKey);
  });

  it("does not resolve a null side for a photo-to-null change", async () => {
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const entry = versionEntry({ payloadVersion: 1, entityType: "profile_image", comparison: {
      kind: "entity_fields", changes: { object_key: { before: photoKey, after: null } },
    } });
    render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={versionRepository(entry, resolve)} /></UiLocaleProvider>);
    expect(await screen.findByAltText("Historical profile photo")).toBeTruthy();
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ resumeId, eventId, occurredAt, side: "before" }, expect.any(AbortSignal));
  });

  it("does not request non-Profile URLs, PDFs, arbitrary references, or null values", async () => {
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const awards = versionEntry({ domain: "awards", entityType: "award_list", payloadVersion: 2,
      comparison: { kind: "aggregate", before: [{ href: photoUrl }], after: [{ href: "https://example.test/a.pdf" }] } });
    render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={versionRepository(awards, resolve)} /></UiLocaleProvider>);
    expect(await screen.findAllByText("Awards")).toHaveLength(2);
    expect(resolve).not.toHaveBeenCalled();
    cleanup();

    const view = render(<UiLocaleProvider><ProfileHistoryPhotoPair resumeId={resumeId} eventId={eventId} occurredAt={occurredAt}
      sides={{ before: noPhoto, after: unsupported }} repository={{ resolveProfileHistoryImage: resolve } as unknown as ResumeRepository} /></UiLocaleProvider>);
    expect(screen.getByText("Not set")).toBeTruthy();
    expect(screen.getByText("Preview unavailable")).toBeTruthy();
    expect(resolve).not.toHaveBeenCalled();
    view.unmount();
  });

  it("shows localized loading and unavailable states and treats image decode failure as unavailable", async () => {
    const urls = setupObjectUrls();
    let finish!: (value: Blob) => void;
    const resolve = vi.fn(() => new Promise<Blob>(yes => { finish = yes; }));
    const repository = { resolveProfileHistoryImage: resolve } as unknown as ResumeRepository;
    const view = render(<UiLocaleProvider><LocaleButton /><ProfileHistoryPhoto resumeId={resumeId} eventId={eventId} occurredAt={occurredAt}
      side="after" value={photoValue} repository={repository} /></UiLocaleProvider>);
    expect(screen.getByRole("status").textContent).toContain("Loading preview");
    fireEvent.click(screen.getByText("中文"));
    expect(screen.getByRole("status").textContent).toContain("正在加载预览");
    finish(new Blob(["image"], { type: "image/png" }));
    const image = await screen.findByAltText("历史头像");
    fireEvent.error(image);
    expect(await screen.findByText("预览不可用")).toBeTruthy();
    expect(urls.revoke).toHaveBeenCalled();
    view.unmount();
  });

  it("maps resolver and network failures to the neutral unavailable state", async () => {
    const resolver = { resolveProfileHistoryImage: vi.fn(async () => { throw new Error("private upstream detail"); }) } as unknown as ResumeRepository;
    render(<UiLocaleProvider><ProfileHistoryPhoto resumeId={resumeId} eventId={eventId} occurredAt={occurredAt}
      side="after" value={photoValue} repository={resolver} /></UiLocaleProvider>);
    expect(await screen.findByText("Preview unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("private upstream detail");
  });

  it("shows the dedicated sign-in-again state for an unauthenticated resolver", async () => {
    const repository = { resolveProfileHistoryImage: vi.fn(async () => { throw new ProfileHistoryImageError("unauthenticated"); }) } as unknown as ResumeRepository;
    render(<UiLocaleProvider><ProfileHistoryPhoto resumeId={resumeId} eventId={eventId} occurredAt={occurredAt}
      side="after" value={photoValue} repository={repository} /></UiLocaleProvider>);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Sign in again to view this preview.");
    expect(screen.queryByText("Preview unavailable")).toBeNull();
  });

  it("revokes replaced object URLs and prevents a stale event response from replacing the newer image", async () => {
    const urls = setupObjectUrls();
    let resolveOld!: (value: Blob) => void;
    let oldSignal: AbortSignal | undefined;
    const resolve = vi.fn((input: ProfileHistoryImageRequest, signal?: AbortSignal) => {
      if (input.eventId === "old-event") { oldSignal = signal; return new Promise<Blob>(yes => { resolveOld = yes; }); }
      return Promise.resolve(new Blob(["new"], { type: "image/png" }));
    });
    const repository = { resolveProfileHistoryImage: resolve } as unknown as ResumeRepository;
    const props = { resumeId, occurredAt, side: "after" as const, value: photoValue, repository };
    const view = render(<UiLocaleProvider><ProfileHistoryPhoto {...props} eventId="old-event" /></UiLocaleProvider>);
    view.rerender(<UiLocaleProvider><ProfileHistoryPhoto {...props} eventId="new-event" /></UiLocaleProvider>);
    expect(await screen.findByAltText("Historical profile photo")).toBeTruthy();
    const newUrl = (screen.getByAltText("Historical profile photo") as HTMLImageElement).src;
    resolveOld(new Blob(["old"], { type: "image/png" }));
    await waitFor(() => expect((screen.getByAltText("Historical profile photo") as HTMLImageElement).src).toBe(newUrl));
    expect(urls.revoke).not.toHaveBeenCalledWith(newUrl);
    view.unmount();
    expect(urls.revoke).toHaveBeenCalledWith(newUrl);
    expect(oldSignal?.aborted).toBe(true);
  });

  it("revokes the loaded object URL when the event is replaced", async () => {
    const urls = setupObjectUrls();
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const repository = { resolveProfileHistoryImage: resolve } as unknown as ResumeRepository;
    const props = { resumeId, occurredAt, side: "after" as const, value: photoValue, repository };
    const view = render(<UiLocaleProvider><ProfileHistoryPhoto {...props} eventId="old-event" /></UiLocaleProvider>);
    const oldImage = await screen.findByAltText("Historical profile photo") as HTMLImageElement;
    const oldUrl = oldImage.src;
    view.rerender(<UiLocaleProvider><ProfileHistoryPhoto {...props} eventId="new-event" /></UiLocaleProvider>);
    await waitFor(() => expect((screen.getByAltText("Historical profile photo") as HTMLImageElement).src).not.toBe(oldUrl));
    expect(urls.revoke).toHaveBeenCalledWith(oldUrl);
    view.unmount();
  });

  it("aborts a previous side request, revokes its loaded URL, and ignores its late result", async () => {
    const urls = setupObjectUrls();
    let resolveOldBefore!: (value: Blob) => void;
    const beforeSignals: AbortSignal[] = [];
    const resolve = vi.fn((input: ProfileHistoryImageRequest, signal?: AbortSignal) => {
      if (input.side === "before") {
        if (signal) beforeSignals.push(signal);
        if (beforeSignals.length === 1) return new Promise<Blob>(yes => { resolveOldBefore = yes; });
      }
      return Promise.resolve(new Blob([input.side], { type: "image/png" }));
    });
    const repository = { resolveProfileHistoryImage: resolve } as unknown as ResumeRepository;
    const view = render(<UiLocaleProvider><ProfileHistoryPhoto resumeId={resumeId} eventId={eventId} occurredAt={occurredAt}
      side="before" value={photoValue} repository={repository} /></UiLocaleProvider>);
    const oldBeforeSignal = beforeSignals[0];

    view.rerender(<UiLocaleProvider><ProfileHistoryPhoto resumeId={resumeId} eventId={eventId} occurredAt={occurredAt}
      side="after" value={photoValue} repository={repository} /></UiLocaleProvider>);
    const afterImage = await screen.findByAltText("Historical profile photo") as HTMLImageElement;
    const afterUrl = afterImage.src;
    expect(oldBeforeSignal.aborted).toBe(true);

    view.rerender(<UiLocaleProvider><ProfileHistoryPhoto resumeId={resumeId} eventId={eventId} occurredAt={occurredAt}
      side="before" value={photoValue} repository={repository} /></UiLocaleProvider>);
    await waitFor(() => expect((screen.getByAltText("Historical profile photo") as HTMLImageElement).src).not.toBe(afterUrl));
    const currentBeforeUrl = (screen.getByAltText("Historical profile photo") as HTMLImageElement).src;
    expect(urls.revoke).toHaveBeenCalledWith(afterUrl);

    resolveOldBefore(new Blob(["stale"], { type: "image/png" }));
    await waitFor(() => expect((screen.getByAltText("Historical profile photo") as HTMLImageElement).src).toBe(currentBeforeUrl));
    expect(urls.create).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("renders photo-to-photo replacement as two independently resolved sides", async () => {
    const resolve = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const entry = versionEntry({ comparison: { kind: "aggregate", before: profile(photoUrl), after: profile(photoUrl) } });
    render(<UiLocaleProvider><VersionHistoryPage resumeId={resumeId} repository={versionRepository(entry, resolve)} /></UiLocaleProvider>);
    await screen.findAllByAltText("Historical profile photo");
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledWith({ resumeId, eventId, occurredAt, side: "before" }, expect.any(AbortSignal));
    expect(resolve).toHaveBeenCalledWith({ resumeId, eventId, occurredAt, side: "after" }, expect.any(AbortSignal));
  });

  it("sends only event identity through the repository with the current Bearer session", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const supabase = { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "user-access-token" } }, error: null })) } };
    const repository = createResumeRepository(supabase as unknown as SupabaseClient);
    const blob = await repository.resolveProfileHistoryImage!({ resumeId, eventId, occurredAt, side: "before" }, new AbortController().signal);
    expect(blob.size).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/v1/version-history/profile-image");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer user-access-token");
    expect(JSON.parse(String(init.body))).toEqual({ resume_id: resumeId, event_id: eventId, occurred_at: occurredAt, side: "before" });
    expect(JSON.stringify(init.body)).not.toContain("supabase.co");
  });
});
