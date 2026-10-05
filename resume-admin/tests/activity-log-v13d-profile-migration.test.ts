import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const production = readFileSync(resolve("migrations/20261024_activity_log_profile_writer.sql"), "utf8");
const runtime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261024000000_activity_log_profile_writer.sql"), "utf8");
const bootstrap = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20260930000000_test_only_schema_bootstrap.sql"), "utf8");
const profileTests = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_profile_writer.test.sql"), "utf8");

describe("V1.3D-6 Profile writer migration", () => {
  it("keeps the canonical production migration byte-identical to its local runtime mirror", () => {
    expect(runtime).toBe(production);
  });

  it("creates only an unconfigured, owner-only origin mechanism and never activates a target", () => {
    expect(production).toContain("CREATE TABLE cms_private.profile_photo_origin_config");
    expect(production).toContain("ENABLE ROW LEVEL SECURITY");
    expect(production).toContain("REVOKE ALL ON TABLE cms_private.profile_photo_origin_config FROM PUBLIC, anon, authenticated, service_role");
    expect(production).not.toMatch(/INSERT\s+INTO\s+cms_private\.profile_photo_origin_config/i);
    expect(production).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO?\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
    expect(production).not.toMatch(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
  });

  it("adds only the typed Profile V2 event combination while preserving all migrated validators", () => {
    for (const token of ["activity_event_payload_v2_awards_is_allowed", "activity_event_payload_v2_experience_is_allowed",
      "activity_event_payload_v2_skills_is_allowed", "activity_event_payload_v2_education_is_allowed",
      "activity_event_payload_v2_projects_is_allowed", "activity_event_payload_v2_contact_is_allowed",
      "activity_event_payload_v2_profile_is_allowed", "'profile_settings'", "'profile','profile_settings'"]) {
      expect(production).toContain(token);
    }
    expect(production).toContain("CREATE FUNCTION public.load_admin_profile_write_state(target_resume_id uuid)");
    expect(production).toContain("CREATE FUNCTION public.save_resume_profile_v1(target_resume_id uuid,canonical_profile text,signed_context text,signature_hex text)");
    expect(production).toContain("SECURITY DEFINER\nSET search_path=''");
    expect(production).toContain("GRANT EXECUTE ON FUNCTION public.save_resume_profile_v1(uuid,text,text,text) TO authenticated");
    expect(production).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
  });

  it("keeps the photo URL contract exact and validates changed values in PostgreSQL", () => {
    for (const token of ["profile-images/", "target_resume_id::text || '/profile/'", "filename_value ~",
      "target_photo_url ~ '[?#%\\\\]'", "incoming->'shared'->'photo_url' IS DISTINCT FROM before_value->'shared'->'photo_url'",
      "origin_value IS NULL OR NOT cms_private.profile_photo_url_is_allowed"]) expect(production).toContain(token);
    expect(production).not.toContain("INSERT INTO cms_private.profile_photo_origin_config");
  });

  it("makes the local Profile translation FK schema-faithful and exercises writer/RLS/idempotency proofs", () => {
    expect(bootstrap).toContain("FOREIGN KEY (resume_id) REFERENCES public.resume_profile(resume_id) ON DELETE CASCADE");
    expect(profileTests).toContain("semantic no-op preserves parent and Profile row timestamps and creates no event");
    expect(profileTests).toContain("changed save returns the updated aggregate");
    expect(profileTests).toContain("changed save persists the English translation");
    expect(profileTests).toContain("changed save persists shared Profile fields");
    expect(profileTests).toContain("changed save creates exactly one Profile V2 event");
    expect(profileTests).toContain("Profile V2 event snapshot and before/after validate");
    expect(profileTests).toContain("exact replay creates no duplicate event and conflicting payload fails before mutation");
    expect(profileTests).toContain("rpc mode denies direct Profile INSERT/UPDATE/DELETE");
    expect(profileTests).toContain("changed non-null photo fails closed when the origin is unconfigured");
  });
});
