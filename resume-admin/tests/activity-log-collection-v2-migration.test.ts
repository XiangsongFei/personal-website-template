import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261012_activity_log_collection_v2.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261012000000_activity_log_collection_v2.sql"), "utf8");
const bootstrap = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20260930000000_test_only_schema_bootstrap.sql"), "utf8");
const runtimeTest = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_collection_v2.test.sql"), "utf8");

describe("Activity Log collection payload V2 migration", () => {
  it("keeps the runtime mirror byte-identical", () => { expect(mirror).toBe(migration); });
  it("preserves the frozen V1 validator and dispatches only version 1 or the Awards V2 combination", () => {
    expect(migration).toContain("cms_private.activity_event_payload_is_allowed(target_entity_type, target_snapshot, target_changes)");
    expect(migration).toContain("WHEN 1 THEN"); expect(migration).toContain("WHEN 2 THEN");
    expect(migration).toContain("target_section IS DISTINCT FROM 'awards'"); expect(migration).toContain("target_entity_type IS DISTINCT FROM 'award_list'");
    expect(migration).toContain("target_entity_id IS NOT NULL"); expect(migration).toContain("target_operation IS DISTINCT FROM 'update'");
    expect(migration).toContain("payload_version IN (1,2)"); expect(migration).toContain("ELSE false");
  });
  it("bounds V2 arrays and combined serialized payload, validates shape and rejects malformed values", () => {
    expect(migration).toContain("jsonb_array_length(side_value) > 32");
    expect(migration).toContain("> 12000"); expect(migration).toContain("target_snapshot->'awards' IS DISTINCT FROM target_changes->'awards'->'after'");
    expect(migration).toContain("(entry.value->>'position') !~ '^(0|[1-9][0-9]*)$'");
    expect(migration).toContain("(entry.value->>'id') !~ '^[0-9a-f]{8}-");
    expect(runtimeTest).toContain("combined snapshot and changes payloads above 12000 UTF-8 bytes are rejected");
    expect(runtimeTest).toContain("more than 32 Awards are rejected");
  });
  it("does not rewrite history, change write paths, or activate a target", () => {
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.(?:activity_log_events|resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
    expect(migration).not.toMatch(/\b(?:CREATE|DROP)\s+(?:TABLE|INDEX|POLICY|TRIGGER)\b/i);
    expect(migration.match(/ALTER TABLE cms_private\.activity_log_events/g)).toHaveLength(8);
    expect(migration).not.toMatch(/save_resume_awards|trusted_network_context_v11|activity_log.*enabled/i);
  });
  it("aligns only the test-only Awards schema and records frozen-history integrity", () => {
    expect(bootstrap).toContain("UNIQUE (resume_id,position), UNIQUE (resume_id,source_key)");
    expect(bootstrap).toContain("PRIMARY KEY (award_entry_id,locale)");
    expect(bootstrap).toContain("FOREIGN KEY (award_entry_id,resume_id)");
    expect(bootstrap).toContain("resume_award_translations_resume_locale_idx ON public.resume_award_translations(resume_id,locale)");
    const frozen = readFileSync(resolve("migrations/20261011_activity_log_v13c_unified_read.sql"));
    expect(createHash("sha256").update(frozen).digest("hex")).toBe("413a29050b1bfdcd909174f37a485681f8a7dc44db5826bd5cf5a8bfaf05bf34");
  });
});
