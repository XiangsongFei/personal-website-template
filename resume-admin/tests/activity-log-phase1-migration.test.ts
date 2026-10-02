import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261003_activity_log_phase1_introduction.sql"), "utf8");
const correctiveMigration = readFileSync(resolve("migrations/20261004_activity_log_phase1_introduction_conflict_target.sql"), "utf8");
const runtimeBootstrap = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20260930000000_test_only_schema_bootstrap.sql"), "utf8");

function saveIntroductionFunction(source: string): string {
  return source.match(/CREATE(?: OR REPLACE)? FUNCTION public\.save_resume_introduction\([\s\S]*?\$function\$;/)?.[0] ?? "";
}

describe("Phase 1 Introduction Activity Log migration contract", () => {
  it("adds a fixed typed RPC with server authorization, target, and mode checks", () => {
    expect(migration).toContain("CREATE FUNCTION public.save_resume_introduction(target_resume_id uuid, target_items jsonb)");
    expect(migration).toContain("cms_private.assert_activity_log_target(target_resume_id)");
    expect(migration).toContain("cms_private.get_resume_write_mode(target_resume_id, 'introduction') <> 'rpc'");
    expect(migration).toContain("SELECT auth.jwt() ->> 'email'");
    expect(migration).not.toMatch(/target_(?:actor|email|role|before|after|event)/i);
    expect(migration).not.toMatch(/EXECUTE\s+format|EXECUTE\s+target/i);
  });

  it("captures before state, returns canonical after state, skips no-ops, and appends one event", () => {
    expect(migration).toContain("INTO before_rows");
    expect(migration).toContain("INTO after_rows");
    expect(migration).toContain("IF desired_count = pg_catalog.jsonb_array_length(before_rows)");
    expect(migration).toContain("RETURN (SELECT COALESCE(pg_catalog.jsonb_agg");
    expect(migration.match(/INSERT INTO cms_private\.activity_log_events/g)).toHaveLength(1);
    expect(migration).toContain("'update','introduction','introduction_paragraph','introduction'");
  });

  it("extends only the Introduction payload shape and atomically protects direct-write cutover", () => {
    expect(migration).toContain("WHEN 'introduction_paragraph' THEN ARRAY['position','text','text_zh','text_en']");
    expect(migration).toContain("target_snapshot->'paragraphs'");
    expect(migration).toContain("public.can_direct_write_introduction(resume_id)");
    expect(migration).toContain("CREATE POLICY cms_admin_scoped_select ON public.resume_intro_paragraphs");
    expect(migration).toContain("CREATE POLICY cms_admin_scoped_direct_dml ON public.resume_intro_paragraph_translations FOR ALL");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.save_resume_introduction(uuid,jsonb) TO authenticated");
    expect(migration).toContain("INSERT INTO cms_private.resume_capabilities");
    expect(migration).toContain("'example-cv-qa'");
    expect(migration).toContain("domain_key='introduction'");
    const qaModeUpdate = migration.match(/UPDATE cms_private\.resume_write_modes[\s\S]*?;/)?.[0] ?? "";
    expect(qaModeUpdate).toContain("example-cv-qa");
    expect(qaModeUpdate).not.toContain("site_key='example-cv'");
  });

  it("fails closed on the pinned QA target before DDL and verifies its full final mode state", () => {
    const guardStart = migration.indexOf("DO $qa_target_guard$");
    const guardEnd = migration.indexOf("$qa_target_guard$;", guardStart);
    const guard = guardStart < 0 || guardEnd < 0 ? "" : migration.slice(guardStart, guardEnd);
    const functionReplacement = migration.indexOf("CREATE OR REPLACE FUNCTION cms_private.activity_event_payload_is_allowed");
    const cutover = migration.indexOf("INSERT INTO cms_private.resume_capabilities");
    const modeGuardStart = migration.indexOf("DO $mode_guard$");
    const modeGuardEnd = migration.indexOf("$mode_guard$;", modeGuardStart);
    const modeGuard = modeGuardStart < 0 || modeGuardEnd < 0 ? "" : migration.slice(modeGuardStart, modeGuardEnd);

    expect(guard).toContain("id='ea111111-1111-4111-8111-111111111111'");
    expect(guard).toContain("site_key='example-cv-qa'");
    expect(guard).toContain("is_published=false");
    expect(guard).toContain("site_key='example-cv-qa' AND id <> 'ea111111-1111-4111-8111-111111111111'");
    expect(guard).toContain("RAISE EXCEPTION");
    expect(functionReplacement).toBeGreaterThan(guardEnd);
    expect(cutover).toBeGreaterThan(functionReplacement);
    expect(modeGuard).toContain("IF NOT EXISTS (SELECT 1 FROM public.resume_sites");
    expect(modeGuard).toContain("AND domain_key IN ('introduction','education','experience','awards','skills','contact','projects','website_links','profile','files')) <> 10");
    expect(modeGuard).toContain("OR EXISTS (SELECT 1 FROM cms_private.resume_write_modes");
    expect(modeGuard).not.toMatch(/IF EXISTS\s*\(SELECT 1 FROM public\.resume_sites/);
  });

  it("keeps the frozen Phase 0B validator contract for legacy Introduction events", () => {
    const phase0b = readFileSync(resolve("migrations/20261002_activity_log_foundation.sql"), "utf8");
    const functionBody = (source: string) => source.match(/CREATE(?: OR REPLACE)? FUNCTION cms_private\.activity_event_payload_is_allowed\([\s\S]*?\$function\$;/)?.[0] ?? "";
    const genericValidation = (body: string) => {
      const marker = "IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(target_snapshot)) > 24";
      const start = body.lastIndexOf(marker);
      const end = body.indexOf("RETURN true;", start);
      return start < 0 || end < 0 ? "" : body.slice(start, end + "RETURN true;".length)
        .replace(/\b(?:keys|k)\b/g, "key_alias")
        .replace(/\b(?:fields|f)\b/g, "field_alias")
        .replace(/\s+/g, "");
    };
    const frozenBody = functionBody(phase0b);
    const phase1Body = functionBody(migration);

    expect(phase1Body).toContain("legacy_fields := ARRAY['position','text']");
    expect(phase1Body).toContain("target_snapshot ? 'paragraphs'");
    expect(phase1Body).toContain("target_changes ? 'text_zh'");
    expect(phase1Body).toContain("pg_catalog.octet_length(target_snapshot::text) > 12000");
    expect(phase1Body).toContain("pg_catalog.octet_length(target_changes::text) > 12000");
    expect(phase1Body).toContain("NOT (change_entry.value ? 'before') OR NOT (change_entry.value ? 'after')");
    expect(genericValidation(phase1Body)).toBe(genericValidation(frozenBody));
    expect(genericValidation(phase1Body)).not.toBe("");
  });

  it("does not alter the frozen Phase 0B migration", () => {
    const phase0b = readFileSync(resolve("migrations/20261002_activity_log_foundation.sql"), "utf8");
    expect(phase0b).toContain("CREATE TABLE cms_private.activity_log_events");
    expect(migration).not.toBe(phase0b);
  });

  it("corrects only the Introduction conflict target to match the production key", () => {
    const originalFunction = saveIntroductionFunction(migration);
    const correctedFunction = saveIntroductionFunction(correctiveMigration);
    expect(originalFunction).not.toBe("");
    expect(correctedFunction).toBe(originalFunction
      .replace("CREATE FUNCTION public.save_resume_introduction(", "CREATE OR REPLACE FUNCTION public.save_resume_introduction(")
      .replace("ON CONFLICT(paragraph_id,resume_id,locale)", "ON CONFLICT(paragraph_id,locale)"));
    expect(correctiveMigration).toContain("ON CONFLICT(paragraph_id,locale)");
    expect(correctiveMigration).not.toContain("ON CONFLICT(paragraph_id,resume_id,locale)");
  });

  it("models the verified production Introduction translation primary key", () => {
    expect(runtimeBootstrap).toMatch(/CREATE TABLE public\.resume_intro_paragraph_translations\s*\([\s\S]*?PRIMARY KEY \(paragraph_id,locale\)/);
    expect(runtimeBootstrap).not.toContain("PRIMARY KEY (paragraph_id,resume_id,locale)");
  });
});
