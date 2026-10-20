import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const canonical = readFileSync(resolve("migrations/20261114000000_activity_log_section_titles.sql"), "utf8");
const cli = readFileSync(resolve("supabase/migrations/20261114000000_activity_log_section_titles.sql"), "utf8");
const runtime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261114000000_activity_log_section_titles.sql"), "utf8");
const sqlTest = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_section_titles_writer.test.sql"), "utf8");

describe("Section Titles writer migration", () => {
  it("keeps migration mirrors exact and does not activate targets or Restore", () => {
    expect(cli).toBe(canonical); expect(runtime).toBe(canonical);
    expect(canonical).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
    expect(canonical).not.toMatch(/restore_domain|restore_enabled|restore_resume/i);
  });
  it("adds an authenticated-only signed aggregate writer with baseline CAS and atomic audit", () => {
    expect(canonical).toContain("public.load_admin_section_titles_write_state(target_resume_id uuid)");
    expect(canonical).toContain("public.save_resume_section_titles_v1(target_resume_id uuid,canonical_section_titles text,signed_context text,signature_hex text)");
    expect(canonical).toContain("GRANT EXECUTE ON FUNCTION public.save_resume_section_titles_v1");
    expect(canonical).toContain("expected_baseline_digest"); expect(canonical).toContain("baseline_proof");
    expect(canonical).toContain("FOR UPDATE"); expect(canonical).toContain("P13B1"); expect(canonical).toContain("P13B2");
    expect(canonical).toContain("activity_event_payload_v2_section_titles_is_allowed");
    expect(canonical.indexOf("INSERT INTO cms_private.activity_log_idempotency")).toBeLessThan(canonical.indexOf("INSERT INTO cms_private.activity_log_events"));
    expect(canonical).toContain("UPDATE cms_private.activity_log_idempotency SET result_payload=pg_catalog.jsonb_build_array(after_value)");
  });
  it("keeps the direct-write guard limited to the six title columns and conditional on RPC routing", () => {
    expect(canonical).toContain("BEFORE UPDATE OF education_label,experience_label,skills_label,honors_label,project_heading,kaggle_label");
    expect(canonical).toContain("get_resume_write_mode(target_resume_id,'section_titles')='direct'");
    expect(canonical).toContain("AND (NOT public.can_direct_write_section_titles(OLD.resume_id)");
    expect(sqlTest).toContain("same request replays without another event");
    expect(sqlTest).toContain("forced audit failure rolls back title values and idempotency");
  });
});
