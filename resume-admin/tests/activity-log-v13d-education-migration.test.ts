import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const v2 = readFileSync(resolve("migrations/20261017_activity_log_v2_education.sql"), "utf8");
const writer = readFileSync(resolve("migrations/20261018_activity_log_education_writer.sql"), "utf8");
const v2Mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261017000000_activity_log_v2_education.sql"), "utf8");
const writerMirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261018000000_activity_log_education_writer.sql"), "utf8");
const bootstrap = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20260930000000_test_only_schema_bootstrap.sql"), "utf8");
const runtime = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_education_writer.test.sql"), "utf8");

describe("V1.3D-3 Education migrations", () => {
  it("keeps production/runtime pairs byte-identical and matches live translation PK", () => {
    expect(v2Mirror).toBe(v2);
    expect(writerMirror).toBe(writer);
    expect(bootstrap).toContain("PRIMARY KEY (education_entry_id,locale)");
    expect(bootstrap).toContain("FOREIGN KEY (education_entry_id,resume_id)");
    expect(bootstrap).not.toContain("PRIMARY KEY (education_entry_id,resume_id,locale)");
  });

  it("adds only the Education V2 payload and preserves the existing V2 dispatch branches", () => {
    for (const token of ["activity_event_payload_v2_education_is_allowed", "education_list", "education_category", "655360",
      "activity_event_payload_v2_awards_is_allowed", "activity_event_payload_v2_experience_is_allowed", "activity_event_payload_v2_skills_is_allowed"]) expect(v2).toContain(token);
    expect(v2).not.toMatch(/INSERT\s+INTO\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
    expect(v2).not.toMatch(/UPDATE\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
  });

  it("defines an authenticated target-scoped typed writer, direct-mode RLS policy, and correct production conflict target", () => {
    for (const token of ["public.load_admin_education_write_state(target_resume_id uuid)",
      "public.save_resume_education_v1(target_resume_id uuid,canonical_education text,signed_context text,signature_hex text)",
      "SECURITY DEFINER SET search_path=''", "assert_activity_log_target(target_resume_id)",
      "get_resume_write_mode(target_resume_id,'education')", "trusted_network_context_v11",
      "ON CONFLICT(education_entry_id,locale)", "offset_value", "activity_log_idempotency", "P13B1",
      "education_category=entry->>'education_category'"]) expect(writer).toContain(token);
    expect(writer).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_(?:capabilities|write_modes|domain_requirements)/i);
    expect(writer).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE/i);
    expect(runtime).toContain("test_only_d3_education_rejects_bad_signature");
    expect(runtime).toContain("test baseline includes the legacy summer-school raw NULL category");
  });
});
