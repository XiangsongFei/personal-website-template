import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const canonicalPath = "migrations/20261031000000_restore_replay_safe_domain_resolver.sql";
const mirrorPath = "tests/rls-runtime/supabase/migrations/20261031000000_restore_replay_safe_domain_resolver.sql";
const migration = readFileSync(resolve(canonicalPath), "utf8");
const mirror = readFileSync(resolve(mirrorPath), "utf8");
const functionStart = migration.indexOf("CREATE FUNCTION public.resolve_restore_domain_v1(");
const functionEnd = migration.indexOf("$function$;", functionStart) + "$function$;".length;
const resolver = migration.slice(functionStart, functionEnd);

describe("Restore replay-safe domain resolver additive migration", () => {
  it("keeps the production migration and isolated runtime mirror byte-identical", () => {
    expect(mirror).toBe(migration);
    expect(createHash("sha256").update(readFileSync(resolve(canonicalPath))).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("defines the exact scalar authenticated resolver without replacing an existing object", () => {
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(resolver).toMatch(/RETURNS\s+text/i);
    expect(resolver).toMatch(/SECURITY\s+DEFINER/i);
    expect(resolver).toMatch(/SET\s+search_path\s*=\s*''/i);
    expect(migration).toContain("procedure_row.proname = 'resolve_restore_domain_v1'");
    expect(migration).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.resolve_restore_domain_v1/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_restore_domain_v1\(uuid,uuid\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.resolve_restore_domain_v1\(uuid,uuid\) TO authenticated/i);
  });

  it("authorizes target and capability before a target-scoped immutable source lookup", () => {
    expect(resolver).toContain("IF (SELECT auth.uid()) IS NULL");
    expect(resolver).toContain("cms_private.assert_activity_log_target(target_resume_id)");
    expect(resolver).toContain("capability.capability_key = 'restore'");
    expect(resolver).toMatch(/WHERE event\.id = source_event_id\s+AND event\.resume_id = target_resume_id/s);
    expect(resolver).toContain("event_row.site_key_snapshot IS DISTINCT FROM authorized_site_key");
    expect(resolver).toContain("event_row.payload_version IS DISTINCT FROM 2");
    expect(resolver).toContain("event_row.operation IS DISTINCT FROM 'update'");
  });

  it("uses the frozen mapping and V2 validator and enforces the seven-domain/configuration contract", () => {
    for (const domain of ["awards", "experience", "skills", "education", "projects", "contact", "website_links"]) {
      expect(resolver).toContain(`'${domain}'`);
    }
    expect(resolver).toContain("cms_private.restore_domain_for_event(");
    expect(resolver).toContain("cms_private.activity_event_payload_v2_is_allowed(");
    expect(resolver).toContain("cms_private.get_resume_write_mode(target_resume_id, domain_value)");
    expect(resolver).toContain("requirement.requirement_key = 'trusted_network_context_v11'");
  });

  it("has no Preview, mutable aggregate, historical identity, digest, DML, or private response output", () => {
    for (const forbidden of ["preview_restore_v1", "restore_source_v1", "restore_current_aggregate", "restore_expected_digest",
      "restore_historical_ids_exist", "restore_dense_positions", "activity_log_idempotency", "activity_log_restore_links"]) {
      expect(resolver).not.toContain(forbidden);
    }
    expect(resolver).not.toMatch(/\bEXECUTE\b/i);
    expect(resolver).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
    expect(resolver).toMatch(/RETURN domain_value\s*;/);
    expect(resolver).not.toMatch(/RETURN\s+(?:event_row|.*entity_snapshot|.*changes)/i);
  });

  it("does not change any frozen Restore or historical migration source", () => {
    const hashes: Record<string, [string, string]> = {
      "20261025_activity_log_website_links_writer.sql": ["020de6b9e4a54332699fb2ef3898c7b5d343fe13f9755977bc5a3324d4973d4d", "20261025000000_activity_log_website_links_writer.sql"],
      "20261026_activity_log_files_writer.sql": ["fdc45b7c9d3f1e4c59a2a59cbc453778ca272c5b709872f29255b3cce6476154", "20261026000000_activity_log_files_writer.sql"],
      "20261027_activity_log_files_legacy_restore.sql": ["598a56fa2389afc596516c380eb9f4a28859416e93618fff9064b9343ebc8cee", "20261027000000_activity_log_files_legacy_restore.sql"],
      "20261028_activity_log_files_storage_authorization.sql": ["f5d2d4915be47feca56d0bcd208e41393891776409607b53aa7fc057551751dc", "20261028000000_activity_log_files_storage_authorization.sql"],
      "20261029_version_history_v1_read.sql": ["2bd2e5c16886c0028450e9a17b6b922f8b7f4cb81968c8f19ffec239e344ec91", "20261029000000_version_history_v1_read.sql"],
      "20261030_activity_log_restore_v1.sql": ["ea5f4d4f7f31446c5dedddba874c808590107aaac96f04e8d512913ca620defe", "20261030000000_activity_log_restore_v1.sql"],
    };
    for (const [file, [expectedHash, runtimeName]] of Object.entries(hashes)) {
      const bytes = readFileSync(resolve(`migrations/${file}`));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(expectedHash);
      expect(readFileSync(resolve(`tests/rls-runtime/supabase/migrations/${runtimeName}`)), file).toEqual(bytes);
    }
  });
});
