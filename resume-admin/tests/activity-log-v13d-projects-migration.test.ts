import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const v2 = readFileSync(resolve("migrations/20261019_activity_log_v2_projects.sql"), "utf8");
const writer = readFileSync(resolve("migrations/20261020_activity_log_projects_writer.sql"), "utf8");

describe("Activity Log V1.3D-4 Projects migrations", () => {
  it("keeps canonical production migrations byte-identical to local runtime mirrors", () => {
    expect(readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261019000000_activity_log_v2_projects.sql"), "utf8")).toBe(v2);
    expect(readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261020000000_activity_log_projects_writer.sql"), "utf8")).toBe(writer);
  });

  it("adds only the typed Projects V2 shape while keeping target modes and existing domain dispatch frozen", () => {
    for (const token of ["activity_event_payload_v2_projects_is_allowed", "project_list", "target_section IS DISTINCT FROM 'projects'",
      "side_index=1 AND project_position<=prior_project_position", "side_index=2 AND project_position<>project_index-1",
      "side_index=1 AND method_position<=prior_method_position", "side_index=2 AND method_position<>method_index-1",
      "prior_project_position:=project_position", "activity_event_payload_v2_education_is_allowed"]) {
      expect(v2).toContain(token);
    }
    expect(v2).not.toMatch(/INSERT\s+INTO\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
    expect(writer).toContain("public.load_admin_projects_write_state(target_resume_id uuid)");
    expect(writer).toContain("public.save_resume_projects_v1(target_resume_id uuid,canonical_projects text,signed_context text,signature_hex text)");
    expect(writer).toContain("domain_key='projects'");
    expect(writer).toContain("ON CONFLICT(project_entry_id,resume_id,locale)");
    expect(writer).toContain("RETURN old_result");
    expect(writer).toContain("USING ERRCODE='P13B1'");
    expect(writer).toContain("SECURITY DEFINER SET search_path=''");
    expect(writer).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_(?:capabilities|write_modes|domain_requirements)/i);
  });

  it("matches production nonpartial source-key uniqueness in the isolated runtime fixture", () => {
    const bootstrap = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20260930000000_test_only_schema_bootstrap.sql"), "utf8");
    expect(bootstrap).toContain("UNIQUE (resume_id,source_key)");
    expect(bootstrap).not.toMatch(/CREATE\s+UNIQUE\s+INDEX\s+resume_project_source_key_unique/i);
  });
});
