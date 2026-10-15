import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const historicalCanonical = readFileSync(resolve("migrations/20261031130000_test_profile_signing_probe.sql"), "utf8");
const historicalRuntime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261031130000_test_profile_signing_probe.sql"), "utf8");
const cleanupCanonical = readFileSync(resolve("migrations/20261031140000_retire_test_profile_signing_probe.sql"), "utf8");
const cleanupRuntime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261031140000_retire_test_profile_signing_probe.sql"), "utf8");

describe("Test Profile signing-probe retirement migration", () => {
  it("preserves the already-applied probe migration and its runtime mirror", () => {
    expect(historicalRuntime).toBe(historicalCanonical);
    expect(historicalCanonical).toContain("CREATE FUNCTION public.verify_test_profile_signing_probe_v1");
  });

  it("keeps the forward cleanup migration byte-identical to its runtime mirror", () => {
    expect(cleanupRuntime).toBe(cleanupCanonical);
  });

  it("requires the expected function and postgres, then revokes and drops only that exact signature", () => {
    expect(cleanupCanonical).toContain("current_user <> 'postgres'");
    expect(cleanupCanonical).toContain("probe.proowner = 'postgres'::pg_catalog.regrole");
    expect(cleanupCanonical).toContain("probe.prosecdef IS TRUE");
    expect(cleanupCanonical).toContain("probe.proconfig = ARRAY['search_path=\"\"']::text[]");
    expect(cleanupCanonical).toContain("f6000000-0000-4000-8000-000000000001");
    expect(cleanupCanonical).toContain("example-cv-qa-activity-log");
    expect(cleanupCanonical).toContain("REVOKE ALL ON FUNCTION public.verify_test_profile_signing_probe_v1(text, text)");
    expect(cleanupCanonical).toContain("DROP FUNCTION public.verify_test_profile_signing_probe_v1(text, text)");
    expect(cleanupCanonical).not.toMatch(/\bCASCADE\b/i);
    expect(cleanupCanonical).toMatch(/\nBEGIN;\s/);
    expect(cleanupCanonical).toMatch(/COMMIT;\s*$/);
  });

  it("does not alter shared signing or Profile Save objects", () => {
    expect(cleanupCanonical).not.toContain("activity_log_v11_key");
    expect(cleanupCanonical).not.toContain("save_resume_profile_v1");
    expect(cleanupCanonical).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE)\b/i);
    expect(cleanupCanonical).not.toMatch(/resume_capabilities|trusted_network_context|resume_write_modes/i);
  });
});
