import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("supabase/migrations/20261103000000_education_experience_test_rpc_routing.sql"), "utf8");
const mirror = readFileSync(resolve("migrations/20261103000000_education_experience_test_rpc_routing.sql"), "utf8");

describe("Education and Experience Test-only RPC routing migration", () => {
  it("targets only the unpublished official Test identity and requires Activity Log to be enabled", () => {
    expect(migration).toContain("site_key = 'example-cv-qa-activity-log' AND is_published IS FALSE");
    expect(migration).toContain("capability_key = 'activity_log'");
    expect(migration).toContain("Activity Log must already be enabled for the official Test target");
    expect(migration).not.toContain("example-cv-qa'");
  });

  it("enables both RPC and trusted-context requirements for Test while guarding Owner direct mode", () => {
    expect(migration).toContain("domain_key IN ('education', 'experience')");
    expect(migration).toContain("write_mode = 'rpc'");
    expect(migration).toContain("'trusted_network_context_v11', true");
    expect(migration).toContain("Owner Education/Experience modes must remain direct");
    expect(migration).toContain("write_mode <> 'direct'");
    expect(migration).toContain("ON CONFLICT (resume_id, domain_key, requirement_key)");
  });

  it("changes no content, event history, reader, permissions, or Restore behavior and mirrors the deployment migration", () => {
    expect(mirror).toBe(migration);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\.resume_(?!write_modes|domain_requirements)/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP)\s+(?:FUNCTION|TABLE|POLICY|ROLE|TRIGGER)/i);
    expect(migration).not.toMatch(/restore|restore_enabled/i);
  });
});
