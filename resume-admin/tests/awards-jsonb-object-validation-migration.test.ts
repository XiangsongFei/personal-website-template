import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261112000000_awards_jsonb_object_validation.sql";
const canonical = readFileSync(resolve("migrations", migrationName), "utf8");
const cliCopy = readFileSync(resolve("supabase/migrations", migrationName), "utf8");
const runtimeCopy = readFileSync(resolve("tests/rls-runtime/supabase/migrations", migrationName), "utf8");
const functionBody = canonical.slice(canonical.indexOf("CREATE OR REPLACE FUNCTION public.save_resume_awards_v1("));

describe("Awards JSONB object validation migration", () => {
  it("keeps the migration copies identical and transactional", () => {
    expect(cliCopy).toBe(canonical);
    expect(runtimeCopy).toBe(canonical);
    expect(canonical).toMatch(/\nBEGIN;[\s\S]*\nCOMMIT;\s*$/);
  });

  it("replaces unsupported object-length calls without weakening exact shape checks", () => {
    expect(functionBody).not.toContain("jsonb_object_length");
    expect(functionBody.match(/pg_catalog\.jsonb_object_keys\(CASE WHEN pg_catalog\.jsonb_typeof\([\s\S]*?ELSE '\{\}'::jsonb END\)/g)).toHaveLength(4);
    expect(functionBody).toContain("THEN response_value ELSE '{}'::jsonb END)) <> 3");
    expect(functionBody).toContain("THEN item ELSE '{}'::jsonb END)) <> 4");
    expect(functionBody).toContain("THEN item->'zh' ELSE '{}'::jsonb END)) <> 2");
    expect(functionBody).toContain("THEN item->'en' ELSE '{}'::jsonb END)) <> 2");
    expect(functionBody).toContain("IS DISTINCT FROM 'object'");
    expect(functionBody).toContain("NOT (response_value ?& ARRAY['awards','baseline_digest','baseline_proof'])");
    expect(functionBody).toContain("NOT (item ?& ARRAY['id','position','zh','en'])");
    expect(functionBody).toContain("NOT ((item->'zh') ?& ARRAY['name','year'])");
    expect(functionBody).toContain("NOT ((item->'en') ?& ARRAY['name','year'])");
  });

  it("retains writer signature, auth, target checks, CAS, HMAC, idempotency, and atomic event semantics", () => {
    expect(functionBody).toContain("CREATE OR REPLACE FUNCTION public.save_resume_awards_v1(target_resume_id uuid, canonical_awards text, expected_baseline_digest text, baseline_proof text, signed_context text, signature_hex text)");
    for (const required of [
      "auth.uid()) IS NULL",
      "cms_private.assert_activity_log_target(target_resume_id)",
      "FOR UPDATE",
      "cms_private.verify_resume_awards_v1_context(target_resume_id,canonical_awards,expected_baseline_digest,baseline_proof,signed_context,signature_hex)",
      "IF FOUND THEN",
      "current_baseline_digest <> expected_baseline_digest",
      "extensions.hmac(",
      "INSERT INTO cms_private.activity_log_events",
      "result_payload=result_payload_value",
      "GRANT EXECUTE ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text,text,text) TO authenticated",
    ]) expect(functionBody).toContain(required);
    expect(functionBody).not.toMatch(/ALTER\s+TABLE\s+cms_private\.activity_log_idempotency/i);
  });
});
