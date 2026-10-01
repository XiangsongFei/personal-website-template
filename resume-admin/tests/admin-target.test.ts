import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAdminTarget } from "../src/auth/supabase";

const ownerId = "10000000-0000-4000-8000-000000000001";
const qaId = "20000000-0000-4000-8000-000000000002";

describe("trusted Admin target RPC", () => {
  it.each([
    [{ resume_id: ownerId, site_key: "example-cv", role: "owner" }, { resumeId: ownerId, siteKey: "example-cv", role: "owner" }],
    [{ resume_id: qaId, site_key: "example-cv-qa", role: "qa" }, { resumeId: qaId, siteKey: "example-cv-qa", role: "qa" }],
  ] as const)("resolves the server-authorized membership target", async (row, expected) => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const target = await readAdminTarget({ rpc } as unknown as SupabaseClient);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_admin_resume_target");
    expect(target).toEqual(expected);
  });

  it("fails closed if a QA RPC response attempts to redirect to official content", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ resume_id: qaId, site_key: "example-cv", role: "qa" }], error: null });
    await expect(readAdminTarget({ rpc } as unknown as SupabaseClient)).rejects.toThrow("Invalid Admin resume target");
  });

  it("fails closed if the RPC returns multiple targets", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [
      { resume_id: ownerId, site_key: "example-cv", role: "owner" },
      { resume_id: qaId, site_key: "example-cv-qa", role: "qa" },
    ], error: null });
    await expect(readAdminTarget({ rpc } as unknown as SupabaseClient)).rejects.toThrow("No authorized Admin resume target");
  });
});
