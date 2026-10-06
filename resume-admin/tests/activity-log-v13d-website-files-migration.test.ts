import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const website = readFileSync(resolve("migrations/20261025_activity_log_website_links_writer.sql"), "utf8");
const files = readFileSync(resolve("migrations/20261026_activity_log_files_writer.sql"), "utf8");
const websiteRuntime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261025000000_activity_log_website_links_writer.sql"), "utf8");
const filesRuntime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261026000000_activity_log_files_writer.sql"), "utf8");
const runtime = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_website_files_writers.test.sql"), "utf8");

describe("V1.3D-7 Website & Links and Files migrations", () => {
  it("keeps both runtime migration mirrors byte-identical and installation-only", () => {
    expect(websiteRuntime).toBe(website); expect(filesRuntime).toBe(files);
    for (const sql of [website, files]) expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO?\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
  });
  it("keeps typed writers, privileges, authorization and explicit V2 validation", () => {
    expect(website).toContain("public.load_admin_website_links_write_state(target_resume_id uuid)");
    expect(website).toContain("public.save_resume_website_links_v1(target_resume_id uuid,canonical_website_links text,signed_context text,signature_hex text)");
    expect(files).toContain("public.load_admin_files_write_state(target_resume_id uuid)");
    expect(files).toContain("public.save_resume_files_v1(target_resume_id uuid,canonical_files text,signed_context text,signature_hex text)");
    for (const sql of [website, files]) {
      expect(sql).toContain("SECURITY DEFINER SET search_path=''");
      expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.save_resume_");
      expect(sql).toContain("trusted_network_context_v11"); expect(sql).toContain("activity_log_idempotency");
      expect(sql).toContain("payload_version");
    }
    expect(website).toContain("activity_event_payload_v2_website_links_is_allowed");
    expect(files).toContain("activity_event_payload_v2_files_is_allowed");
    expect(website).toContain("activity_event_payload_v2_profile_is_allowed");
    expect(website).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
    expect(files).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
  });
  it("enforces independent shared-locale ownership and fixed Navigation identity", () => {
    for (const field of ["linkedin_label", "linkedin_href", "portfolio_label", "updated_at_label"]) expect(website).toContain(`NEW.${field} IS DISTINCT FROM OLD.${field}`);
    expect(website).toContain("NEW.portfolio_href IS DISTINCT FROM OLD.portfolio_href");
    expect(website).toContain("position NOT BETWEEN 0 AND 4");
    expect(website).toContain("count(DISTINCT n.position)");
    expect(website).not.toContain("SET contact_label");
    expect(website).toContain("Navigation identity/order is fixed");
    expect(website).toContain("SET label=nav->'zh'->>'label'");
    expect(website).not.toMatch(/UPDATE\s+public\.resume_navigation_items/i);
  });
  it("validates unique target-scoped PDF candidates but preserves unchanged legacy references", () => {
    expect(files).toContain("files_reference_is_allowed");
    expect(files).toContain("IS DISTINCT FROM before_value->'translations'->locale->>'portfolio_href'");
    expect(files).toContain("resume-files/");
    expect(files).toContain("target_reference ~ '[?#%\\\\]' ");
    expect(files).toContain("filename ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$'");
    expect(runtime).toContain("direct Contact locale update composes while Website & Links and Files are rpc");
    expect(runtime).toContain("changed save creates one valid Website & Links V2 event");
    expect(runtime).toContain("changed Files save creates one valid reference-only V2 event");
    expect(runtime).toContain("replay creates no duplicate event");
  });
});
