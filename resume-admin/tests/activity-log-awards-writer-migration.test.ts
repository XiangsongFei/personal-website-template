import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261013_activity_log_awards_writer.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261013000000_activity_log_awards_writer.sql"), "utf8");
const frozenIntro = readFileSync(resolve("migrations/20261005_activity_log_v11_context.sql"), "utf8");

describe("Activity Log Awards transactional writer migration", () => {
  it("keeps the runtime mirror byte-identical and leaves frozen Introduction source alone", () => {
    expect(mirror).toBe(migration);
    expect(frozenIntro).toContain("public.save_resume_introduction_v11");
    expect(migration).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.save_resume_introduction_v11/i);
  });
  it("defines only Awards-scoped target state, context verifier, writer, and direct-write helper", () => {
    expect(migration).toContain("public.load_admin_awards_write_state(target_resume_id uuid)");
    expect(migration).toContain("cms_private.verify_resume_awards_v1_context");
    expect(migration).toContain("public.save_resume_awards_v1(target_resume_id uuid, canonical_awards text, signed_context text, signature_hex text)");
    expect(migration).toContain("cms_private.get_resume_write_mode(target_resume_id, 'awards')");
    expect(migration).toContain("requirement_key='trusted_network_context_v11'");
    expect(migration).toContain("cms_private.assert_activity_log_target(target_resume_id)");
    expect(migration).toContain("domain_key='awards'");
  });
  it("uses transactional exact replay, changed-digest conflict, no-op suppression, and one v2 event", () => {
    expect(migration).toContain("USING ERRCODE='P13B1'");
    expect(migration).toContain("IF old_digest <> digest_value THEN");
    expect(migration).toContain("ON CONFLICT(award_entry_id,locale)");
    expect(migration).toContain("'award_list',NULL");
    expect(migration).toContain("'update','awards','award_list',NULL");
    expect(migration).toContain("result_payload=result_value,completed_at=pg_catalog.transaction_timestamp()");
    expect(migration).toContain("RETURN old_result");
  });
  it("preserves the database result-byte guard and proves valid protocol inputs cannot reach its over-limit branch", () => {
    expect(migration).toContain("pg_catalog.octet_length(pg_catalog.convert_to(result_value::text,'UTF8')) > 8192");
    // The idempotency result is the raw Awards array. Replacing `null` (4 JSON
    // bytes) with a quoted canonical UUID (38 JSON bytes) adds 34 bytes per row.
    // The emitted JSONB object adds 13 punctuation spaces per row: 7 in the
    // outer four-field object and 3 in each two-field locale object. The array
    // adds at most 31 separator spaces. Thus the worst case is
    // 4096 + 32*(34+13) + 31 = 5631 bytes, below the frozen 8192-byte guard.
    const canonicalRequestByteLimit = 4096;
    const maximumEntries = 32;
    const generatedIdExpansionBytes = 38 - 4;
    const jsonbPunctuationSpacesPerEntry = 7 + 3 + 3;
    const maximumArraySeparatorSpaces = maximumEntries - 1;
    expect(generatedIdExpansionBytes).toBe(34);
    const maximumSerializedResult = canonicalRequestByteLimit
      + maximumEntries * (generatedIdExpansionBytes + jsonbPunctuationSpacesPerEntry)
      + maximumArraySeparatorSpaces;
    expect(maximumSerializedResult).toBe(5631);
    expect(maximumSerializedResult).toBeLessThan(8192);
    expect(migration).toContain("jsonb_array_length(rows_value) > 32");
    expect(migration).toContain("canonical_awards,'UTF8')) > 4096");
  });
  it("restricts RPC execution and gates only Awards direct DML without changing target state", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.save_resume_awards_v1[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.save_resume_awards_v1[\s\S]*?TO authenticated/);
    expect(migration).toContain("public.can_direct_write_awards(resume_id)");
    expect(migration).not.toMatch(/resume_locale_content|INSERT\s+INTO\s+cms_private\.resume_(?:capabilities|write_modes|domain_requirements)/i);
    expect(migration).not.toMatch(/ACTIVITY_LOG_V13B|record_activity_log_system_failure/i);
  });
});
