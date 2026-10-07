import { afterEach, describe, expect, it, vi } from "vitest";
import { createFilesSaveOperation } from "../src/data/resumeRepository";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("QA-only Files client stage diagnostics", () => {
  it("is silent outside the explicit QA build mode", () => {
    vi.stubEnv("MODE", "production");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    createFilesSaveOperation().diagnostic?.("storage_state_completed");
    expect(info).not.toHaveBeenCalled();
  });

  it("emits only approved structured fields with monotonic elapsed time in QA mode", () => {
    vi.stubEnv("MODE", "qa");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const operation = createFilesSaveOperation();
    operation.diagnostic?.("pending_identity_ready", "zh", "created");

    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0]?.[0]).toBe("d8_files_client_stage");
    const record = info.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(record).toEqual(expect.objectContaining({ stage: "pending_identity_ready", locale: "zh", category: "created" }));
    expect(typeof record.elapsed_ms).toBe("number");
    expect(record.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(Object.keys(record).sort()).toEqual(["category", "elapsed_ms", "locale", "stage"]);
    expect(Object.keys(record)).not.toContain("request_id");
    expect(Object.values(record)).not.toContain("test-token");
  });

  it("swallows a console failure so diagnostic output cannot escape into save code", () => {
    vi.stubEnv("MODE", "qa");
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("console unavailable"); });
    expect(() => createFilesSaveOperation().diagnostic?.("production_save_started")).not.toThrow();
  });
});
