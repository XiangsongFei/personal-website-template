import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const activity = readFileSync(resolve("migrations/20261014_activity_log_v2_experience_skills.sql"), "utf8");
const experience = readFileSync(resolve("migrations/20261015_activity_log_experience_writer.sql"), "utf8");
const skills = readFileSync(resolve("migrations/20261016_activity_log_skills_writer.sql"), "utf8");

describe("Activity Log V1.3D-2 migrations", () => {
  it("keeps the three runtime mirrors byte-identical", () => {
    expect(readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261014000000_activity_log_v2_experience_skills.sql"), "utf8")).toBe(activity);
    expect(readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261015000000_activity_log_experience_writer.sql"), "utf8")).toBe(experience);
    expect(readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261016000000_activity_log_skills_writer.sql"), "utf8")).toBe(skills);
  });

  it("extends V2 validation for exactly the two frozen aggregate shapes while preserving Awards and V1 dispatch", () => {
    for (const token of ["activity_event_payload_v2_experience_is_allowed", "activity_event_payload_v2_skills_is_allowed",
      "experience_list", "skill_group_list", "experience_entry", "skill_group", "activity_event_payload_v2_awards_is_allowed"]) {
      expect(activity).toContain(token);
    }
    expect(activity).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+cms_private\.activity_event_payload_version_is_allowed/i);
    expect(activity).toContain("655360");
    expect(activity).not.toMatch(/INSERT\s+INTO\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
  });

  it("keeps typed writers independent, target-scoped, append-only, and mode-gated", () => {
    expect(experience).toContain("public.load_admin_experience_write_state(target_resume_id uuid)");
    expect(experience).toContain("public.save_resume_experience_v1(target_resume_id uuid,canonical_experience text,signed_context text,signature_hex text)");
    expect(experience).toContain("domain_key='experience'");
    expect(experience).toContain("ON CONFLICT(experience_entry_id,locale)");
    expect(experience).toContain("offset_value");
    expect(skills).toContain("public.load_admin_skills_write_state(target_resume_id uuid)");
    expect(skills).toContain("public.save_resume_skills_v1(target_resume_id uuid,canonical_skills text,signed_context text,signature_hex text)");
    expect(skills).toContain("domain_key='skills'");
    expect(skills).toContain("ON CONFLICT(skill_group_id,locale)");
    for (const migration of [experience, skills]) {
      expect(migration).toContain("SECURITY DEFINER SET search_path=''");
      expect(migration).toContain("assert_activity_log_target(target_resume_id)");
      expect(migration).toContain("trusted_network_context_v11");
      expect(migration).toContain("USING ERRCODE='P13B1'");
      expect(migration).toContain("RETURN old_result");
      expect(migration).toContain("result_value");
      expect(migration).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_(?:capabilities|write_modes|domain_requirements)/i);
    }
    expect(experience).not.toContain("save_resume_skills_v1");
    expect(skills).not.toContain("save_resume_experience_v1");
  });

  it("cleans omitted old entries before inserting new null-ID items", () => {
    for (const migration of [experience, skills]) {
      const cleanup = migration.indexOf("DELETE FROM public.resume_");
      const insertNew = migration.indexOf("IF entry->>'id' IS NULL");
      expect(cleanup).toBeGreaterThan(-1);
      expect(insertNew).toBeGreaterThan(cleanup);
      expect(migration.slice(insertNew)).not.toMatch(/DELETE FROM public\.resume_(?:experience_entries|skill_groups)/);
    }
  });
});
