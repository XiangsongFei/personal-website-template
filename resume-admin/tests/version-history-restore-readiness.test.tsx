import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResumeLoader } from "../src/data/ResumeLoader";
import type { ActivityLogAuthorizedTarget, ResumeRepository, VersionHistoryEntry, VersionHistoryPage } from "../src/data/resumeRepository";
import { UiLocaleProvider } from "../src/uiLocale";

const qaTarget: ActivityLogAuthorizedTarget = { resumeId: "ea111111-1111-4111-8111-111111111111", siteKey: "example-cv-qa-activity-log", role: "qa" };
const ownerTarget: ActivityLogAuthorizedTarget = { resumeId: "20000000-0000-4000-8000-000000000001", siteKey: "example-cv", role: "owner" };
const entry: VersionHistoryEntry = {
  eventId: "ea000000-0000-4000-8000-000000000901", occurredAt: "2026-10-07T12:00:00Z", actorAccountLabel: "QA account", actorRole: "qa",
  domain: "awards", operation: "update", payloadVersion: 2, entityType: "award_list", entityId: null,
  comparison: { kind: "aggregate", before: [{ id: "ea000000-0000-4000-8000-000000000902", position: 0,
    zh: { name: "旧奖项", year: "2025" }, en: { name: "Old award", year: "2025" } }], after: [{ id: "ea000000-0000-4000-8000-000000000902", position: 0,
    zh: { name: "新奖项", year: "2026" }, en: { name: "Current award", year: "2026" } }] },
};
const history: VersionHistoryPage = { entries: [entry], hasMore: false, nextCursor: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function repository(loadAdminFilesRestoreCapability: NonNullable<ResumeRepository["loadAdminFilesRestoreCapability"]>): ResumeRepository {
  return {
    loadAdminFeatureState: vi.fn(async resumeId => ({ resumeId, activityLogEnabled: true,
      introductionWriteMode: "direct" as const, introductionTrustedContextRequired: false })),
    loadAdminFilesRestoreCapability,
    loadVersionHistoryPage: vi.fn(async () => history),
  } as unknown as ResumeRepository;
}

function view(repo: ResumeRepository, target: ActivityLogAuthorizedTarget, identityId: string, sessionKey: string) {
  return <UiLocaleProvider><MemoryRouter initialEntries={["/version-history"]}><ResumeLoader repository={repo} sessionKey={sessionKey}
    identityEmail={`${identityId}@example.test`} identityId={identityId} authorizedTarget={target} onSignOut={() => {}}
    signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Version History Restore capability readiness", () => {
  it.each([
    ["disabled", vi.fn(async () => false)],
    ["failed", vi.fn(async () => { throw new Error("capability unavailable"); })],
  ] as const)("keeps history readable and hides Restore when capability is %s", async (_state, loadCapability) => {
    render(view(repository(loadCapability), qaTarget, "qa-actor", "qa-session"));
    expect(await screen.findByRole("heading", { level: 1, name: "Version History" })).toBeTruthy();
    expect((await screen.findAllByText("Current award")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Preview what would be restored" })).toBeNull();
    expect(loadCapability).toHaveBeenCalledWith(qaTarget.resumeId);
  });

  it("does not let a pending actor A capability response enable Restore for actor B", async () => {
    const actorA = deferred<boolean>();
    const actorB = deferred<boolean>();
    const loadCapability = vi.fn()
      .mockImplementationOnce(() => actorA.promise)
      .mockImplementationOnce(() => actorB.promise);
    const repo = repository(loadCapability);
    const rendered = render(view(repo, qaTarget, "actor-a", "session-a"));
    expect((await screen.findAllByText("Current award")).length).toBeGreaterThan(0);
    rendered.rerender(view(repo, qaTarget, "actor-b", "session-b"));
    await waitFor(() => expect(loadCapability).toHaveBeenCalledTimes(2));
    actorA.resolve(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Preview what would be restored" })).toBeNull());
    actorB.resolve(false);
    expect(screen.queryByRole("button", { name: "Preview what would be restored" })).toBeNull();
    expect((await screen.findAllByText("Current award")).length).toBeGreaterThan(0);
  });

  it("does not let a prior target capability response bleed into a newly selected target", async () => {
    const targetA = deferred<boolean>();
    const targetB = deferred<boolean>();
    const loadCapability = vi.fn()
      .mockImplementationOnce(() => targetA.promise)
      .mockImplementationOnce(() => targetB.promise);
    const repo = repository(loadCapability);
    const rendered = render(view(repo, qaTarget, "same-actor", "same-session"));
    expect((await screen.findAllByText("Current award")).length).toBeGreaterThan(0);
    rendered.rerender(view(repo, ownerTarget, "same-actor", "same-session"));
    await waitFor(() => expect(loadCapability).toHaveBeenCalledTimes(2));
    targetA.resolve(true);
    expect(screen.queryByRole("button", { name: "Preview what would be restored" })).toBeNull();
    targetB.resolve(true);
    expect(await screen.findByRole("button", { name: "Preview what would be restored" })).toBeTruthy();
    expect(loadCapability).toHaveBeenNthCalledWith(1, qaTarget.resumeId);
    expect(loadCapability).toHaveBeenNthCalledWith(2, ownerTarget.resumeId);
  });
});
