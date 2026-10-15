import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const canonical = readFileSync(resolve("migrations/20261031130000_test_profile_signing_probe.sql"), "utf8");
const runtime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261031130000_test_profile_signing_probe.sql"), "utf8");

describe("Test Profile signing-probe migration", () => {
  it("keeps the canonical forward migration byte-identical to its local SQL-test mirror", () => {
    expect(runtime).toBe(canonical);
  });

  it("hard-binds to the unpublished Test identity and fixed target", () => {
    expect(canonical).toContain("'f6000000-0000-4000-8000-000000000001'");
    expect(canonical).toContain("'example-cv-qa-activity-log'");
    expect(canonical).toContain("site.is_published IS FALSE");
    expect(canonical).toContain("admin.role = 'qa'");
    expect(canonical).toContain("public.can_manage_resume(test_target)");
    expect(canonical).not.toContain("example-cv-qa'");
  });

  it("uses purpose separation, freshness, the Vault provider, and a read-only function grant", () => {
    expect(canonical).toContain("'test_profile_signing_probe_v1'");
    expect(canonical).toContain("expires_seconds - issued_seconds > 30");
    expect(canonical).toContain("cms_private.activity_log_v11_key('activity_log_v11_hmac_v1')");
    expect(canonical).toContain("example-cv:test-profile-signing-probe:v1");
    expect(canonical).toContain("REVOKE ALL ON FUNCTION public.verify_test_profile_signing_probe_v1(text, text)");
    expect(canonical).toContain("TO authenticated");
    expect(canonical).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE)\b/i);
    expect(canonical).not.toContain("save_resume_profile_v1");
    expect(canonical).not.toContain("restore");
    expect(canonical).not.toContain("resume_capabilities");
  });
});
