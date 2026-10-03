import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261008_activity_log_v12_filters.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261008000000_activity_log_v12_filters.sql"), "utf8");

describe("Activity Log V1.2 filters migration", () => {
  it("preserves the frozen 20261002-20261007 production migrations", () => {
    const expected: Record<string, string> = {
      "20261002_activity_log_foundation.sql": "643b04a5ca134d5be41d73af118a72886320965e6f2b59b04754d9bef098471d",
      "20261003_activity_log_phase1_introduction.sql": "824f28533336505b5a60c2ecd6bae5ab2234e0a2ca7b5afadd64db781cc797be",
      "20261004_activity_log_phase1_introduction_conflict_target.sql": "cf5bab463a6e964004f230e5b5b40f16d802eeb7327cf8637c554de41d8c4671",
      "20261005_activity_log_v11_context.sql": "a26835c1a05c06c339a14f6b521fc2548be685d09f814233296c009e4daae794",
      "20261006_activity_log_v11_vault_key_adapter.sql": "b69a741873650a6d361eeea43e70c13097ddce884c0d66b511b21e65cc5b63c6",
      "20261007_activity_log_v11_read_metadata.sql": "3a987983cf5ec7e80b299ac660c5f823b44b6bd4ab23fe1114d06ea89ef787b7",
    };
    for (const [file, hash] of Object.entries(expected)) {
      expect(createHash("sha256").update(readFileSync(resolve(`migrations/${file}`))).digest("hex"), file).toBe(hash);
    }
  });

  it("keeps the new runtime mirror byte-identical", () => { expect(mirror).toBe(migration); });

  it("adds a separate scoped read RPC and preserves legacy RPC source", () => {
    expect(migration).toContain("CREATE FUNCTION public.read_activity_log_events_v12(");
    expect(migration).toContain("cms_private.assert_activity_log_target(target_resume_id)");
    expect(migration).toContain("event.resume_id = target_resume_id");
    expect(migration).toContain("(event.occurred_at, event.id) < (before_occurred_at, before_id)");
    expect(migration).toContain("ORDER BY event.occurred_at DESC, event.id DESC");
    expect(migration).toContain("LIMIT page_limit");
    expect(migration).toContain("event.ip_network, event.country_code, event.region, event.city");
    expect(migration).toContain("event.changes::text");
    expect(migration).not.toContain("entity_snapshot ILIKE");
    expect(migration).not.toMatch(/event\.(?:ip_network|country_code|region|city|actor_email_snapshot)[\s\S]{0,80}ILIKE/i);
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.read_activity_log_events_v12[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.read_activity_log_events_v12[\s\S]*?TO authenticated/);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|POLICY)/i);
  });
});
