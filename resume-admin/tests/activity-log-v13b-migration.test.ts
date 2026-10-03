import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261010_activity_log_v13b_failure_contract.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261010000000_activity_log_v13b_failure_contract.sql"), "utf8");
const frozenV11 = readFileSync(resolve("migrations/20261005_activity_log_v11_context.sql"), "utf8");
const frozenV13A = readFileSync(resolve("migrations/20261009_activity_log_v13_system_events.sql"), "utf8");
const frozenV13AMirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261009000000_activity_log_v13_system_events.sql"), "utf8");

function functionDefinition(source: string, startToken: string): string {
  const start = source.indexOf(startToken);
  if (start < 0) throw new Error(`Missing expected function: ${startToken}`);
  const end = source.indexOf("\n$function$;", start);
  if (end < 0) throw new Error("Unterminated function definition");
  return source.slice(start, end + "\n$function$;".length);
}

describe("Activity Log V1.3B failure-contract migration", () => {
  it("keeps the new production migration and local runtime mirror byte-identical", () => {
    expect(mirror).toBe(migration);
  });

  it("changes only the intended V1.1 conflict branch to SQLSTATE P13B1", () => {
    const frozenFunction = functionDefinition(frozenV11, "CREATE FUNCTION public.save_resume_introduction_v11(");
    const expected = frozenFunction
      .replace("CREATE FUNCTION public.save_resume_introduction_v11(", "CREATE OR REPLACE FUNCTION public.save_resume_introduction_v11(")
      .replace(
        "IF existing_digest <> request_digest OR existing_completed_at IS NULL OR existing_result IS NULL THEN\n      RAISE EXCEPTION 'Idempotency key conflicts with a different request' USING ERRCODE = '23505';\n    END IF;",
        "IF existing_digest <> request_digest THEN\n      RAISE EXCEPTION 'Idempotency key conflicts with a different request' USING ERRCODE = 'P13B1';\n    END IF;\n    IF existing_completed_at IS NULL OR existing_result IS NULL THEN\n      RAISE EXCEPTION 'Idempotency key conflicts with a different request' USING ERRCODE = '23505';\n    END IF;",
      );
    expect(frozenFunction.match(/USING ERRCODE = '23505';/g)).toHaveLength(1);
    expect(expected).not.toBe(frozenFunction);
    expect(migration).toContain(expected);
    expect(functionDefinition(migration, "CREATE OR REPLACE FUNCTION public.save_resume_introduction_v11(")).toBe(expected);
    expect(migration.match(/CREATE OR REPLACE FUNCTION\s+/g)).toHaveLength(1);
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|POLICY|TRIGGER)\b/i);
    expect(migration).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(migration.match(/USING ERRCODE = 'P13B1';/g)).toHaveLength(1);
    expect(migration).toContain("Idempotency key conflicts with a different request");
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.activity_log_system_events/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.resume_(?:capabilities|domain_requirements|write_modes)/i);
  });

  it("does not alter the frozen V1.3A foundation or introduce successful-event correlation", () => {
    expect(createHash("sha256").update(frozenV13A).digest("hex"))
      .toBe("7d69bf41628fa9dd2a4a5bea20a79a49ba667c226c57bc17048b71edb8a6e79a");
    expect(frozenV13AMirror).toBe(frozenV13A);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+cms_private\.activity_log_events/i);
    expect(migration).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
  });
});
