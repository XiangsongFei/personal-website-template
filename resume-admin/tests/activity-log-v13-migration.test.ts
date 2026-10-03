import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261009_activity_log_v13_system_events.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261009000000_activity_log_v13_system_events.sql"), "utf8");
const testKeyFixture = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261009000001_test_only_v13_failure_key.sql"), "utf8");
const runtimeTest = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_v13_system_events.test.sql"), "utf8");
const canonicalizer = readFileSync(resolve("tests/activity-log-v13-canonical.ts"), "utf8");
const canonicalVectors = readFileSync(resolve("tests/activity-log-v13-vectors.ts"), "utf8");

describe("Activity Log V1.3A system event foundation", () => {
  it("preserves all frozen 20261002-20261008 production migration bytes", () => {
    const expected: Record<string, string> = {
      "20261002_activity_log_foundation.sql": "643b04a5ca134d5be41d73af118a72886320965e6f2b59b04754d9bef098471d",
      "20261003_activity_log_phase1_introduction.sql": "824f28533336505b5a60c2ecd6bae5ab2234e0a2ca7b5afadd64db781cc797be",
      "20261004_activity_log_phase1_introduction_conflict_target.sql": "cf5bab463a6e964004f230e5b5b40f16d802eeb7327cf8637c554de41d8c4671",
      "20261005_activity_log_v11_context.sql": "a26835c1a05c06c339a14f6b521fc2548be685d09f814233296c009e4daae794",
      "20261006_activity_log_v11_vault_key_adapter.sql": "b69a741873650a6d361eeea43e70c13097ddce884c0d66b511b21e65cc5b63c6",
      "20261007_activity_log_v11_read_metadata.sql": "3a987983cf5ec7e80b299ac660c5f823b44b6bd4ab23fe1114d06ea89ef787b7",
      "20261008_activity_log_v12_filters.sql": "7825a23eb22f66839e781ec0c39855471fc0174ae6db3f8443321f42a7c67104",
    };
    for (const [file, hash] of Object.entries(expected)) {
      expect(createHash("sha256").update(readFileSync(resolve(`migrations/${file}`))).digest("hex"), file).toBe(hash);
    }
  });

  it("keeps the production migration and runtime mirror byte-identical", () => {
    expect(mirror).toBe(migration);
  });

  it("adds a separate bounded append-only event store and authenticated typed recorder", () => {
    const tableStart = migration.indexOf("CREATE TABLE cms_private.activity_log_system_events (");
    const tableEnd = migration.indexOf("\n);", tableStart);
    const tableDefinition = migration.slice(tableStart, tableEnd);
    expect(migration).toContain("CREATE TABLE cms_private.activity_log_system_events (");
    expect(migration).toContain("event_id uuid PRIMARY KEY");
    expect(migration).toContain("CREATE INDEX activity_log_system_events_target_cursor_idx");
    expect(migration).toContain("ALTER TABLE cms_private.activity_log_system_events ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE FUNCTION public.record_activity_log_system_failure(");
    expect(migration).toContain("CREATE FUNCTION cms_private.activity_log_v13_canonical_bytes(");
    expect(migration).toContain("CREATE FUNCTION cms_private.activity_log_v13_canonical_cidr(");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("ON CONFLICT (event_id) DO NOTHING");
    expect(migration).toContain("Each NULL is the two ASCII bytes `N;`");
    expect(migration).toContain("Each non-NULL value is ASCII `V` + its base-10 UTF-8 byte length + `:`");
    expect(migration).not.toContain("signed_payload::text");
    expect(migration).toContain("target_event_id uuid");
    expect(migration).toContain("target_request_id uuid");
    expect(migration).toContain("activity_log_system_events'");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.record_activity_log_system_failure[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_activity_log_system_failure[\s\S]*?TO authenticated/);
    expect(migration).not.toMatch(/CREATE\s+TABLE\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE)\s+INTO\s+cms_private\.resume_capabilities/i);
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP)\s+(?:POLICY|INDEX).*activity_log_events/i);
    expect(tableDefinition).not.toMatch(/\b(?:payload|request_body|stack_trace|raw_error|authorization|cookie|jwt)\b/i);
    expect(migration).not.toMatch(/(?:ACTIVITY_LOG_HMAC_KEY|-----BEGIN|[A-F0-9]{64})/);
  });

  it("keeps the V1.3 synthetic key and signer confined to test-only runtime files", () => {
    expect(testKeyFixture).toContain("TEST ONLY");
    expect(testKeyFixture).toContain("activity_log_v13_failure_v1");
    expect(testKeyFixture).toContain("test_only_sign_activity_log_v13_failure");
    expect(testKeyFixture).toContain("cms_private.activity_log_v13_canonical_bytes(");
    expect(testKeyFixture).not.toContain("jsonb_build_object");
    expect(testKeyFixture).not.toContain("cms_private.activity_log_v13_key(");
    expect(runtimeTest).toContain("public.test_only_sign_activity_log_v13_failure");
    expect(runtimeTest).toContain("public.record_activity_log_system_failure");
    expect(migration).not.toContain("test_only_sign_activity_log_v13_failure");
  });

  it("keeps fixed cross-language canonical bytes and HMACs for edge-case vectors", () => {
    expect(canonicalizer).toContain("Buffer.from(`V${bytes.byteLength}:",);
    expect(canonicalizer).toContain("normalizeV13Cidr");
    expect(canonicalVectors).toContain("加州 é");
    expect(canonicalVectors).toContain("深圳 🧭");
    expect(canonicalVectors).not.toContain("TO_BE_FILLED");
    expect(runtimeTest).toContain("vector 1 fixed HMAC-SHA256");
    expect(runtimeTest).toContain("vector 2 canonical bytes: UTF-8 byte lengths and raw Unicode");
    expect(runtimeTest).toContain("vector 3 canonical bytes: NULL/empty and escaping-sensitive text");
    expect(runtimeTest).toContain("vector 4 canonical bytes: expanded IPv6 /48");
  });
});
