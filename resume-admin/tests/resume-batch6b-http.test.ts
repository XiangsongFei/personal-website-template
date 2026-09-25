import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createBatch6BRepositoryWrites } from "../src/data/resumeBatch6bRepository";

const supabaseUrl = "https://example.supabase.co";
const publishableKey = "sb_publishable_test_key";
const signedInJwt = "signed-in-user-jwt";

describe("Batch 6B Supabase HTTP request construction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the configured Supabase client and includes the publishable key and user JWT on every REST request", async () => {
    const requests: Array<{ url: string; headers: Headers; method: string; body: string | null }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : null });
      const url = String(input);
      const payload = url.includes("resume_contact_focus_items")
        ? { id: "focus-uuid", resume_id: "resume-uuid", position: 0 }
        : url.includes("resume_contact_status_items")
          ? { id: "status-uuid", resume_id: "resume-uuid", position: 0, status_type: "open" }
          : url.includes("resume_project_methods")
            ? { id: "method-uuid", resume_id: "resume-uuid", project_entry_id: "project-uuid", locale: "en", position: 0, value: "Method" }
            : {};
      return new Response(JSON.stringify(payload), {
        status: 201,
        headers: { "Content-Type": "application/json", "Content-Range": "*/1" },
      });
    });
    const client = createClient(supabaseUrl, publishableKey, {
      accessToken: async () => signedInJwt,
      global: { fetch: fetchMock },
    });
    const writes = createBatch6BRepositoryWrites(client);

    await writes.insertFocus("resume-uuid", 0);
    await writes.insertStatus("resume-uuid", 0, "open");
    await writes.insertProjectMethod("resume-uuid", "project-uuid", "en", 0, "Method");
    await writes.readProjectMethodByPosition("resume-uuid", "project-uuid", "en", 0, "Method");

    expect(requests.map(request => new URL(request.url).pathname)).toEqual([
      "/rest/v1/resume_contact_focus_items",
      "/rest/v1/resume_contact_status_items",
      "/rest/v1/resume_project_methods",
      "/rest/v1/resume_project_methods",
    ]);
    for (const request of requests) {
      expect(request.headers.get("apikey")).toBe(publishableKey);
      expect(request.headers.get("authorization")).toBe(`Bearer ${signedInJwt}`);
    }
    expect(requests[0].method).toBe("POST");
    expect(requests[1].method).toBe("POST");
    expect(requests[2].method).toBe("POST");
    expect(requests[3].method).toBe("GET");
    expect(JSON.parse(requests[0].body!)).toEqual({ resume_id: "resume-uuid", position: 0 });
    expect(JSON.parse(requests[1].body!)).toEqual({ resume_id: "resume-uuid", position: 0, status_type: "open" });
    expect(JSON.parse(requests[2].body!)).toEqual({ resume_id: "resume-uuid", project_entry_id: "project-uuid", locale: "en", position: 0, value: "Method" });
  });
});
