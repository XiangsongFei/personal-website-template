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

  it("validates both existing Test collections against the aggregate writer preconditions before changing modes", () => {
    expect(migration).toContain("Test Education collection is incomplete or exceeds the RPC limit");
    expect(migration).toContain("Test Education collection is outside the supported RPC contract");
    expect(migration).toContain("Test Experience collection is incomplete or exceeds the RPC limit");
    expect(migration).toContain("Test Experience collection is outside the supported RPC contract");
    expect(migration).toContain("activity_event_payload_v2_education_is_allowed");
    expect(migration).toContain("activity_event_payload_v2_experience_is_allowed");
    expect(migration.indexOf("Test Experience collection is outside the supported RPC contract"))
      .toBeLessThan(migration.indexOf("UPDATE cms_private.resume_write_modes"));
  });

  it("holds DML-blocking locks on only the four validated collections through mode activation", () => {
    const lock = "LOCK TABLE public.resume_education_entries, public.resume_education_translations,\n"
      + "  public.resume_experience_entries, public.resume_experience_translations\n  IN SHARE MODE;";
    const lockIndex = migration.indexOf(lock);
    expect(lockIndex).toBeGreaterThan(migration.indexOf("BEGIN;"));
    expect(lockIndex).toBeLessThan(migration.indexOf("DO $test_target_guard$"));
    expect(lockIndex).toBeLessThan(migration.indexOf("FROM public.resume_education_entries"));
    expect(lockIndex).toBeLessThan(migration.indexOf("FROM public.resume_experience_entries"));
    expect(lockIndex).toBeLessThan(migration.indexOf("UPDATE cms_private.resume_write_modes"));
    expect(migration.match(/LOCK TABLE/g)).toHaveLength(1);
    expect(migration).not.toContain("resume_profile");
  });

  it("changes no content, event history, reader, permissions, or Restore behavior and mirrors the deployment migration", () => {
    expect(mirror).toBe(migration);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+public\.resume_(?!write_modes|domain_requirements)/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP)\s+(?:FUNCTION|TABLE|POLICY|ROLE|TRIGGER)/i);
    expect(migration).not.toMatch(/restore|restore_enabled/i);
  });
});
