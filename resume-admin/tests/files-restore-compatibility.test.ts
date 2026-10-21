import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const name = "20261115000000_files_restore_qa_reference_compatibility.sql";
const migration = read(`migrations/${name}`);

describe("Files Restore compatibility static safety contracts", () => {
  it("keeps all three forward Migration copies byte-identical", () => {
    expect(read(`supabase/migrations/${name}`)).toBe(migration);
    expect(read(`tests/rls-runtime/supabase/migrations/${name}`)).toBe(migration);
    expect(migration.trim().startsWith("-- Forward-only")).toBe(true);
    expect(migration.trim().endsWith("COMMIT;")).toBe(true);
  });

  it("changes only the two QA reference-format branches in existing function bodies", () => {
    const previous = read("tests/rls-runtime/supabase/migrations/20261027000000_activity_log_files_legacy_restore.sql");
    const bodies = (sql: string) => [...sql.matchAll(/AS \$function\$([\s\S]*?)\$function\$/g)].slice(0, 2).map(match => match[1]);
    const expected = bodies(previous).map(body => body
      .replace("target_site_key = 'example-cv-qa'", "target_site_key IN ('example-cv-qa', 'example-cv-qa-activity-log')")
      .replace("site_key='example-cv-qa'", "site_key IN ('example-cv-qa', 'example-cv-qa-activity-log')"));
    expect(bodies(migration)).toEqual(expected);
  });

  it("preserves existing function identities and ACLs without activating targets", () => {
    expect(migration).toContain("pg_catalog.to_regprocedure(signature)");
    expect(migration).toContain("r.rolname=current_user AND p.prosecdef");
    expect(migration.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(migration.match(/SECURITY DEFINER SET search_path=''/g)).toHaveLength(2);
    expect(migration).not.toMatch(/\b(?:GRANT|REVOKE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/);
  });

  it("retains the bounded two-event privacy check and exact isolated QA identity", () => {
    const runner = read("tests/run-v11-local-integration.mjs");
    expect(runner).toContain("site_key_snapshot='example-cv-qa-activity-log'");
    expect(runner).not.toContain("site_key_snapshot='example-cv-qa'");
    for (const clause of ["SELECT count(*) = 2", "input_case='ipv4-input') = 1", "input_case='ipv6-input') = 1",
      "actor_user_id='10000000-0000-4000-8000-000000000002'::uuid", "ip_network IS NULL AND country_code IS NULL AND region IS NULL AND city IS NULL",
      "(signature|hmac|secret|key_material|signed_context)", "s.is_published IS FALSE", "a.role='qa'", "section_key='introduction'"]) {
      expect(runner).toContain(clause);
    }
  });
});
