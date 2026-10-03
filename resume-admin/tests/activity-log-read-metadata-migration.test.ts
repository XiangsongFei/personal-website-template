import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261007_activity_log_v11_read_metadata.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261007000000_activity_log_v11_read_metadata.sql"), "utf8");

describe("Activity Log read metadata migration", () => {
  it("keeps the production and local runtime migration byte-identical", () => {
    expect(mirror).toBe(migration);
  });

  it("adds only the four existing event snapshot values to the scoped read RPC", () => {
    expect(migration).toContain("DROP FUNCTION public.read_activity_log_events(uuid, integer, timestamptz, uuid)");
    expect(migration).toContain("CREATE FUNCTION public.read_activity_log_events(");
    expect(migration).toMatch(/payload_version smallint,\s*ip_network cidr,\s*country_code text,\s*region text,\s*city text/s);
    expect(migration).toContain("cms_private.assert_activity_log_target(target_resume_id)");
    expect(migration).toContain("event.resume_id = target_resume_id");
    expect(migration).toContain("ORDER BY event.occurred_at DESC, event.id DESC");
    expect(migration).toContain("LIMIT page_limit");
    expect(migration).toContain("event.ip_network, event.country_code, event.region, event.city");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.read_activity_log_events[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.read_activity_log_events[\s\S]*?TO authenticated/);
    expect(migration).not.toMatch(/GRANT EXECUTE[^;]*TO\s+(?:anon|service_role)/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO?\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE INDEX|DROP INDEX/i);
  });
});
