import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = "20261109000000_awards_baseline_pending_safety.sql";
const canonical = resolve(process.cwd(), "migrations", migration);
const cliCopy = resolve(process.cwd(), "supabase/migrations", migration);
const runtimeCopy = resolve(process.cwd(), "tests/rls-runtime/supabase/migrations", migration);

describe("Awards baseline safety migration contract", () => {
  it("keeps all migration copies byte-identical and transaction scoped", async () => {
    const [source, cli, runtime] = await Promise.all([canonical, cliCopy, runtimeCopy].map(path => readFile(path, "utf8")));
    expect(cli).toBe(source);
    expect(runtime).toBe(source);
    expect(source.trimStart().startsWith("--")).toBe(true);
    expect(source).toMatch(/\nBEGIN;[\s\S]*\nCOMMIT;\s*$/);
    expect(source).not.toMatch(/\bTRUNCATE\b|\bDELETE\s+FROM\s+public\.resume_(?!award_)/i);
  });

  it("derives and signs a target-authorized database snapshot before exposing the baseline", async () => {
    const source = await readFile(canonical, "utf8");
    expect(source).toContain("IF (SELECT auth.uid()) IS NULL OR NOT public.can_manage_resume(target_resume_id)");
    expect(source).toContain("awards_snapshot jsonb, awards_baseline_digest text, awards_baseline_proof text");
    expect(source).toContain("awards-baseline-v1:");
    expect(source).toContain("GRANT EXECUTE ON FUNCTION public.load_admin_awards_write_state(uuid) TO authenticated");
    expect(source).toContain("FROM PUBLIC, anon, authenticated, service_role");
  });

  it("preserves signed-context, target lock, idempotency-first replay, and compare-and-set", async () => {
    const source = await readFile(canonical, "utf8");
    expect(source).toContain("expected_baseline_digest text, baseline_proof text, signed_context text, signature_hex text");
    expect(source).toContain("ctx->>'baseline_proof' IS DISTINCT FROM baseline_proof");
    expect(source).toContain("FOR UPDATE");
    expect(source.indexOf("old_result" )).toBeLessThan(source.indexOf("current_baseline_digest := pg_catalog.encode"));
    expect(source).toContain("current_baseline_digest <> expected_baseline_digest");
    expect(source).toContain("octet_length(pg_catalog.convert_to(result_response_value::text,'UTF8')) > 8192");
    expect(source).toContain("USING ERRCODE='P13B2'");
    expect(source).toContain("result_response_value := pg_catalog.jsonb_build_object('awards',result_value,'baseline_digest',result_baseline_digest,'baseline_proof',result_baseline_proof)");
    expect(source).toContain("GRANT EXECUTE ON FUNCTION public.save_resume_awards_v1(uuid,text,text,text,text,text) TO authenticated");
  });

  it("does not activate a domain, enable Restore, or alter content during installation", async () => {
    const source = await readFile(canonical, "utf8");
    expect(source).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_(?:write_modes|domain_requirements|capabilities)/i);
    expect(source).not.toMatch(/UPDATE\s+cms_private\.resume_(?:write_modes|domain_requirements|capabilities)/i);
    const installPreamble = source.slice(0, source.indexOf("CREATE FUNCTION public.save_resume_awards_v1"));
    expect(installPreamble).not.toMatch(/\bUPDATE\s+public\.resume_award_|\bDELETE\s+FROM\s+public\.resume_award_|\bINSERT\s+INTO\s+public\.resume_award_/i);
    expect(installPreamble).not.toMatch(/\bINSERT\s+INTO\s+cms_private\.activity_log_(?:events|idempotency)/i);
    expect(source).toContain("INSERT INTO cms_private.activity_log_events");
    expect(source).toContain("INSERT INTO cms_private.activity_log_idempotency");
  });
});
