import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261002_activity_log_foundation.sql"), "utf8");

describe("Phase 0B Activity Log foundation migration contract", () => {
  it("requires the reviewed owner and keeps current target/domain modes direct", () => {
    expect(migration).toContain("current_user <> 'postgres'");
    expect(migration).toContain("'example-cv', 'example-cv-qa'");
    expect(migration).toContain("SELECT site.id, domain.domain_key, 'direct'");
    expect(migration).toContain("RETURN COALESCE(resolved_mode, 'direct')");
    expect(migration).toContain("write_mode IN ('direct', 'rpc')");
  });

  it("fails closed for missing capabilities and leaves both production targets disabled", () => {
    expect(migration).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("capability.enabled");
    expect(migration).not.toMatch(/INSERT INTO cms_private\.resume_capabilities/i);
  });

  it("isolates storage and config tables from client ACLs and RLS", () => {
    expect(migration).toContain("REVOKE ALL ON SCHEMA cms_private FROM PUBLIC, anon, authenticated, service_role, pg_write_all_data");
    expect(migration).toContain("REVOKE ALL ON TABLE cms_private.resume_capabilities, cms_private.resume_write_modes,");
    expect(migration).toContain("ALTER TABLE cms_private.activity_log_events ENABLE ROW LEVEL SECURITY");
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]*?ON cms_private\./i);
    expect(migration).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[\s\S]*?ON\s+(?:TABLE\s+)?cms_private\./i);
  });

  it("keeps history immutable and exposes only scoped authenticated read RPCs", () => {
    expect(migration).toContain("activity_log_events_no_row_mutation");
    expect(migration).toContain("activity_log_events_no_truncate");
    expect(migration).toContain("public.can_manage_resume(site.id)");
    expect(migration).toContain("public.activity_log_authorized_targets()");
    expect(migration).toContain("public.read_activity_log_events(");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.activity_log_authorized_targets\(\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.activity_log_authorized_targets\(\) TO authenticated/);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.(?:activity_log_authorized_targets|read_activity_log_events)[^;]*TO anon/i);
  });

  it("does not alter existing CMS DML, policies, Storage, or target helper semantics", () => {
    expect(migration).not.toMatch(/(?:GRANT|REVOKE)[^;]*(?:resume_profile|resume_intro_paragraphs|storage\.objects)/i);
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP) POLICY[^;]*cms_admin_scoped_all/i);
    expect(migration).not.toMatch(/(?:CREATE OR REPLACE )?FUNCTION public\.(?:can_manage_resume|get_admin_resume_target)\b/i);
    expect(migration).not.toMatch(/INSERT INTO cms_private\.resume_capabilities[\s\S]*example-cv/);
  });
});
