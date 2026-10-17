import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261111000000_awards_idempotency_result_array.sql";
const canonical = readFileSync(resolve("migrations", migrationName), "utf8");
const cliCopy = readFileSync(resolve("supabase/migrations", migrationName), "utf8");
const runtimeCopy = readFileSync(resolve("tests/rls-runtime/supabase/migrations", migrationName), "utf8");
const functionBody = canonical.slice(canonical.indexOf("CREATE OR REPLACE FUNCTION public.save_resume_awards_v1("));

describe("Awards idempotency result array migration", () => {
  it("keeps the migration copies byte-identical and transactional", () => {
    expect(cliCopy).toBe(canonical);
    expect(runtimeCopy).toBe(canonical);
    expect(canonical).toMatch(/\nBEGIN;[\s\S]*\nCOMMIT;\s*$/);
  });

  it("preserves the six-argument authenticated writer and security checks", () => {
    expect(functionBody).toContain("CREATE OR REPLACE FUNCTION public.save_resume_awards_v1(target_resume_id uuid, canonical_awards text, expected_baseline_digest text, baseline_proof text, signed_context text, signature_hex text)");
    for (const required of [
      "auth.uid()) IS NULL",
      "cms_private.assert_activity_log_target(target_resume_id)",
      "FOR UPDATE",
      "cms_private.verify_resume_awards_v1_context(target_resume_id,canonical_awards,expected_baseline_digest,baseline_proof,signed_context,signature_hex)",
      "current_baseline_digest <> expected_baseline_digest",
      "extensions.hmac(",
      "INSERT INTO cms_private.activity_log_events",
      "GRANT EXECUTE ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text,text,text) TO authenticated",
    ]) expect(functionBody).toContain(required);
    expect(functionBody).not.toMatch(/ALTER\s+TABLE[\s\S]*?activity_log_idempotency[\s\S]*?CHECK/i);
  });

  it("stores a singleton array but replays the original response object", () => {
    expect(functionBody).toContain("pg_catalog.jsonb_typeof(old_result) IS DISTINCT FROM 'array'");
    expect(functionBody).toContain("pg_catalog.jsonb_array_length(old_result) <> 1");
    expect(functionBody).toContain("response_value := old_result->0");
    expect(functionBody).toContain("RETURN response_value");
    expect(functionBody).toContain("result_payload_value := pg_catalog.jsonb_build_array(result_response_value)");
    expect(functionBody).toContain("result_payload=result_payload_value");
    expect(functionBody).toContain("RETURN result_response_value");
    expect(functionBody).toContain("jsonb_object_length(response_value) <> 3");
    expect(functionBody).toContain("jsonb_object_length(item) <> 4");
    expect(functionBody).toContain("jsonb_object_length(item->'zh') <> 2");
    expect(functionBody).toContain("jsonb_object_length(item->'en') <> 2");
    expect(functionBody).toContain("count(DISTINCT award.value->>'id')");
    expect(functionBody).toContain("response_value->>'baseline_digest' IS DISTINCT FROM result_baseline_digest");
    expect(functionBody).toContain("response_value->>'baseline_proof' IS DISTINCT FROM result_baseline_proof");
    expect(functionBody).toContain("'awards-baseline-v1:' || target_resume_id::text || ':' || actor_id::text || ':' || result_baseline_digest");
  });

  it("retains both UTF-8 size bounds without changing configuration or stored content", () => {
    expect(functionBody).toContain("octet_length(pg_catalog.convert_to(result_response_value::text,'UTF8')) > 8192");
    expect(functionBody).toContain("octet_length(pg_catalog.convert_to(result_payload_value::text,'UTF8')) > 8192");
    expect(functionBody).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+cms_private\.resume_(?:write_modes|domain_requirements|capabilities)/i);
    expect(canonical).not.toMatch(/ALTER\s+TABLE\s+cms_private\.activity_log_idempotency/i);
  });
});
