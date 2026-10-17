import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationName = "20261110000000_restore_awards_writer_compatibility.sql";
const canonical = readFileSync(resolve("migrations", migrationName), "utf8");
const cliCopy = readFileSync(resolve("supabase/migrations", migrationName), "utf8");
const runtimeCopy = readFileSync(resolve("tests/rls-runtime/supabase/migrations", migrationName), "utf8");
const functionBody = canonical.slice(canonical.indexOf("CREATE OR REPLACE FUNCTION public.restore_domain_v1("), canonical.indexOf("\n$function$;"));

describe("Restore compatibility with the Awards baseline CAS writer", () => {
  it("keeps all migration copies byte-identical and transactional", () => {
    expect(cliCopy).toBe(canonical);
    expect(runtimeCopy).toBe(canonical);
    expect(canonical.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/);
    expect(canonical.trimEnd()).toMatch(/COMMIT;$/);
  });

  it("derives the Awards baseline under the target lock and calls only the six-argument writer", () => {
    const lock = functionBody.indexOf("FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE");
    const baseline = functionBody.indexOf("FROM public.load_admin_awards_write_state(target_resume_id)");
    const call = functionBody.indexOf("public.save_resume_awards_v1(target_resume_id,body_text,baseline_digest_value,baseline_proof_value,internal_text,internal_signature)");
    expect(lock).toBeGreaterThan(-1);
    expect(baseline).toBeGreaterThan(lock);
    expect(call).toBeGreaterThan(baseline);
    expect(functionBody).toContain("expected_baseline_digest',baseline_digest_value");
    expect(functionBody).toContain("baseline_proof',baseline_proof_value");
    expect(functionBody).not.toContain("save_resume_awards_v1(target_resume_id,body_text,internal_text,internal_signature)");
  });

  it("preserves Restore authorization, CAS, transactional event/link checks, and grants", () => {
    for (const required of [
      "IF (SELECT auth.uid()) IS NULL",
      "cms_private.assert_activity_log_target(target_resume_id)",
      "capability_key='restore'",
      "cms_private.verify_restore_v1_context",
      "Restore current state conflict",
      "FOR UPDATE",
      "exactly one event",
      "INSERT INTO cms_private.activity_log_restore_links",
      "UPDATE cms_private.activity_log_idempotency",
      "GRANT EXECUTE ON FUNCTION public.restore_domain_v1(uuid,uuid,text,uuid,text,text) TO authenticated",
    ]) expect(canonical).toContain(required);
    expect(canonical).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO?\s+cms_private\.resume_(?:write_modes|capabilities|domain_requirements)/i);
  });
});
