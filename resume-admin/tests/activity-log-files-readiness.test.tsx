import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResumeLoader } from "../src/data/ResumeLoader";
import type { ActivityLogV13CEvent, ResumeRepository } from "../src/data/resumeRepository";
import { UiLocaleProvider } from "../src/uiLocale";

const target = { resumeId: "ea111111-1111-4111-8111-111111111111", siteKey: "example-cv-qa", role: "qa" as const };
const sourceEventId = "9d4ef8ea-7f04-45a5-b794-a3e16db0d467";
const originalFiles = { translations: { zh: { portfolio_href: "https://storage.example.test/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/zh/original.pdf" },
  en: { portfolio_href: "" } } };
const currentFiles = { translations: { zh: { portfolio_href: "https://storage.example.test/storage/v1/object/public/resume-files/ea111111-1111-4111-8111-111111111111/zh/current.pdf" },
  en: { portfolio_href: "" } } };
const sourceEvent: ActivityLogV13CEvent = {
  id: sourceEventId, occurredAt: "2026-10-06T10:00:00Z", actorEmail: "test-admin@example-cv.com", actorRole: "qa", operation: "update",
  section: "files", entityType: "resume_file_set", entityId: null, entitySnapshot: { files: currentFiles },
  changes: { files: { before: originalFiles, after: currentFiles } }, ipNetwork: null, countryCode: null, region: null, city: null,
  eventSource: "activity", sourceRank: 1, payloadVersion: 2,
};

function setup(filesState: "ready" | "error") {
  const repository = {
    load: vi.fn(),
    loadAdminFeatureState: vi.fn(async (resumeId: string) => ({ resumeId, activityLogEnabled: true,
      introductionWriteMode: "direct" as const, introductionTrustedContextRequired: false })),
    loadAdminFilesWriteState: filesState === "ready"
      ? vi.fn(async (resumeId: string) => ({ resumeId, domain: "files" as const, activityLogEnabled: true, writeMode: "rpc" as const, trustedContextRequired: true }))
      : vi.fn(async () => { throw new Error("Files state unavailable"); }),
    loadActivityLogAuthorizedTargets: vi.fn(async () => [target]),
    loadActivityLogPageV13C: vi.fn(async () => [sourceEvent]),
    restoreFilesFromEvent: vi.fn(async () => ({ files: originalFiles, cleanupWarning: false })),
  } as unknown as ResumeRepository;
  const view = render(<UiLocaleProvider><MemoryRouter initialEntries={["/activity-log"]}><ResumeLoader repository={repository}
    sessionKey="authenticated-qa-session" identityId="authenticated-qa-user" identityEmail="test-admin@example-cv.com"
    authorizedTarget={target} onSignOut={() => {}} signOutPending={false} signOutError="" /></MemoryRouter></UiLocaleProvider>);
  return { ...view, repository };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Activity Log Files restore route readiness", () => {
  it("permits the real guarded repository path after exact-target Files state and Activity Log data are fresh", async () => {
    const { repository } = setup("ready");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const restore = await screen.findByRole("button", { name: "Restore Chinese PDF from this event" });
    expect(repository.loadAdminFilesWriteState).toHaveBeenCalledWith(target.resumeId);
    expect(repository.loadActivityLogAuthorizedTargets).toHaveBeenCalledOnce();
    expect(repository.loadActivityLogPageV13C).toHaveBeenCalledWith(target.resumeId, 25, expect.any(Object), undefined);
    fireEvent.click(restore);
    await waitFor(() => expect(repository.restoreFilesFromEvent).toHaveBeenCalledWith(target.resumeId, sourceEventId, "zh"));
    expect(screen.queryByText("Files restoration could not be confirmed. Keep the current state unchanged.")).toBeNull();
  });

  it("keeps restore unavailable and emits no request when the route's Files state is stale or failed", async () => {
    const { repository } = setup("error");
    expect(await screen.findByRole("heading", { name: "Files" })).toBeTruthy();
    await waitFor(() => expect(repository.loadAdminFilesWriteState).toHaveBeenCalledWith(target.resumeId));
    expect(screen.queryByRole("button", { name: "Restore Chinese PDF from this event" })).toBeNull();
    expect(repository.restoreFilesFromEvent).not.toHaveBeenCalled();
  });
});
