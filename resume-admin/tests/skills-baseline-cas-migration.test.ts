import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261113000000_skills_baseline_cas.sql"), "utf8");

describe("Skills baseline CAS migration", () => {
  it("preserves the public four-argument Skills RPC and binds its CAS baseline to the signed actor context", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.save_resume_skills_v1(target_resume_id uuid,canonical_skills text,signed_context text,signature_hex text)");
    expect(migration).toContain("expected_baseline_digest:=ctx->>'expected_baseline_digest'");
    expect(migration).toContain("baseline_proof:=ctx->>'baseline_proof'");
    expect(migration).toContain("skills-baseline-v1:' || target_resume_id::text || ':' || (SELECT auth.uid())::text || ':' || expected_baseline_digest");
    expect(migration).toContain("current_baseline_digest<>expected_baseline_digest");
    expect(migration).toContain("USING ERRCODE='P13B2'");
    expect(migration).toContain("FOR UPDATE");
  });

  it("refreshes the database-internal Restore Skills context while leaving Restore disabled", () => {
    expect(migration).toContain("public.load_admin_skills_write_state(target_resume_id)");
    expect(migration).toContain("'expected_baseline_digest',baseline_digest_value,'baseline_proof',baseline_proof_value");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.restore_domain_v1(");
    expect(migration).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_capabilities[^;]*'restore',[^;]*true/is);
  });

  it("has identical canonical, CLI, and disposable-runtime copies", () => {
    for (const file of [
      "supabase/migrations/20261113000000_skills_baseline_cas.sql",
      "tests/rls-runtime/supabase/migrations/20261113000000_skills_baseline_cas.sql",
    ]) expect(readFileSync(resolve(file), "utf8")).toBe(migration);
  });
});
