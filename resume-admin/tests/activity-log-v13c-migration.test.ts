import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261011_activity_log_v13c_unified_read.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261011000000_activity_log_v13c_unified_read.sql"), "utf8");
const runtimeTest = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_v13c_unified_read.test.sql"), "utf8");

describe("Activity Log V1.3C unified read migration", () => {
  it("keeps the canonical migration and local runtime mirror byte-identical", () => {
    expect(mirror).toBe(migration);
  });

  it("preserves frozen Activity Log migrations through V1.3B", () => {
    const frozen: Record<string, string> = {
      "20261002_activity_log_foundation.sql": "643b04a5ca134d5be41d73af118a72886320965e6f2b59b04754d9bef098471d",
      "20261003_activity_log_phase1_introduction.sql": "824f28533336505b5a60c2ecd6bae5ab2234e0a2ca7b5afadd64db781cc797be",
      "20261004_activity_log_phase1_introduction_conflict_target.sql": "cf5bab463a6e964004f230e5b5b40f16d802eeb7327cf8637c554de41d8c4671",
      "20261005_activity_log_v11_context.sql": "a26835c1a05c06c339a14f6b521fc2548be685d09f814233296c009e4daae794",
      "20261006_activity_log_v11_vault_key_adapter.sql": "b69a741873650a6d361eeea43e70c13097ddce884c0d66b511b21e65cc5b63c6",
      "20261007_activity_log_v11_read_metadata.sql": "3a987983cf5ec7e80b299ac660c5f823b44b6bd4ab23fe1114d06ea89ef787b7",
      "20261008_activity_log_v12_filters.sql": "7825a23eb22f66839e781ec0c39855471fc0174ae6db3f8443321f42a7c67104",
      "20261009_activity_log_v13_system_events.sql": "7d69bf41628fa9dd2a4a5bea20a79a49ba667c226c57bc17048b71edb8a6e79a",
      "20261010_activity_log_v13b_failure_contract.sql": "562afba0812d85f3a22e0c206a498bb02dc8deb9fff558c2ba696d7320d3ede5",
    };
    for (const [file, expected] of Object.entries(frozen)) {
      expect(createHash("sha256").update(readFileSync(resolve(`migrations/${file}`))).digest("hex"), file).toBe(expected);
    }
  });

  it("adds only the V1.3C unified read RPC and keeps legacy reads and write paths untouched", () => {
    expect(migration).toContain("CREATE FUNCTION public.read_activity_log_events_v13c(");
    expect(migration).toContain("cms_private.assert_activity_log_target(target_resume_id)");
    expect(migration).toContain("FROM cms_private.activity_log_events AS event\n      WHERE event.resume_id = target_resume_id");
    expect(migration).toContain("FROM cms_private.activity_log_system_events AS event\n      WHERE event.resume_id = target_resume_id");
    expect(migration).toContain("event.event_kind = 'operation_failure'");
    expect(migration).toContain("event.outcome = 'rejected'");
    expect(migration).toContain("normalized_event_filter IN ('all', 'successful')");
    expect(migration).toContain("normalized_event_filter IN ('all', 'rejected')");
    expect(migration).toContain("1::integer AS source_rank");
    expect(migration).toContain("2::integer AS source_rank");
    expect(migration).toContain("before_source_rank integer DEFAULT NULL");
    expect(migration).toContain("AND unified_events.source_rank < before_source_rank");
    expect(migration).toContain("ORDER BY unified_events.occurred_at DESC,");
    expect(migration).toContain("unified_events.id DESC,");
    expect(migration).toContain("unified_events.source_rank DESC");
    expect(migration).toContain("event.changes::text");
    expect(migration).not.toMatch(/event\.actor_email_snapshot[^\n]*ILIKE/i);
    expect(migration).toContain("event.request_id::text");
    expect(migration).toContain("NULL::jsonb AS changes");
    expect(migration).toContain("NULL::text AS event_kind");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.read_activity_log_events_v13c[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.read_activity_log_events_v13c[\s\S]*?TO authenticated/);
    expect(migration).toContain("STABLE");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|POLICY|TRIGGER)\b/i);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\./i);
    expect(migration).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+cms_private\.assert_activity_log_target/i);
    expect(migration).not.toMatch(/(?:activity_log_system_events'\s*,\s*true|ACTIVITY_LOG_V13B_FAILURE_REPORTING|activity_log_system_events\s*,\s*enabled)/i);
  });

  it("contains runtime coverage for cursor ties, filters, isolation, ACLs, and capture-gate independence", () => {
    expect(runtimeTest).toContain("extensions.plan(43)");
    expect(runtimeTest).toContain("same timestamp and UUID collision");
    expect(runtimeTest).toContain("second keyset page has no duplicate or skipped row");
    expect(runtimeTest).toContain("partial cursor is rejected");
    expect(runtimeTest).toContain("unknown source rank is rejected");
    expect(runtimeTest).toContain("successful filter returns activity rows only");
    expect(runtimeTest).toContain("rejected filter returns rejected operation failures only");
    expect(runtimeTest).toContain("system_change/applied events are excluded even for all");
    expect(runtimeTest).toContain("anonymous execution is denied by function ACL");
    expect(runtimeTest).toContain("QA cannot read Official target events");
    expect(runtimeTest).toContain("global owner can read QA only because the existing target helper explicitly authorizes owner scope");
    expect(runtimeTest).toContain("disabled Activity Log capability blocks unified reads");
    expect(runtimeTest).toContain("unified reads do not depend on the independent system-event capture capability");
    expect(runtimeTest).toContain("neither private event table is directly readable by API roles");
  });
});
