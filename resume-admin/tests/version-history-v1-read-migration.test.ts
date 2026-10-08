import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261029_version_history_v1_read.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261029000000_version_history_v1_read.sql"), "utf8");
const runtimeTest = readFileSync(resolve("tests/rls-runtime/supabase/tests/version_history_v1_read.test.sql"), "utf8");

describe("Version History V1 read contract", () => {
  it("keeps the additive canonical migration and local runtime mirror byte-identical", () => {
    expect(mirror).toBe(migration);
  });

  it("defines a stable, target-authorized least-data RPC with authenticated-only execution", () => {
    expect(migration).toContain("CREATE FUNCTION public.read_version_history_v1(");
    expect(migration).toContain("FROM cms_private.assert_activity_log_target(target_resume_id)");
    expect(migration).toContain("event.site_key_snapshot = authorized_site_key");
    expect(migration).toContain("LANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain("ORDER BY a.occurred_at DESC, a.id DESC");
    expect(migration).toContain("ORDER BY ranked.occurred_at DESC, ranked.id DESC");
    expect(migration).toContain("(event.occurred_at, event.id) < (before_occurred_at, before_event_id)");
    expect(migration).toContain("LIMIT page_limit + 1");
    expect(migration).toContain("candidate_count > page_limit");
    expect(migration).toContain("cms_private.activity_event_payload_is_allowed(s.entity_type, s.entity_snapshot, s.changes)");
    expect(migration).toContain("cms_private.activity_event_payload_v2_is_allowed(");
    expect(migration).toContain("ELSE 'unavailable'");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.read_version_history_v1[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.read_version_history_v1[\s\S]*?TO authenticated/);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+INTO\b/i);
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|POLICY|TRIGGER)\b/i);
  });

  it("returns no audit-only columns and covers the frozen domain/entity allowlist", () => {
    const result = migration.slice(migration.indexOf("RETURNS TABLE"), migration.indexOf("LANGUAGE plpgsql"));
    for (const field of ["actor_user_id", "ip_network", "country_code", "region", "city", "request_id", "idempotency", "failure_stage", "event_source", "entity_snapshot"]) {
      expect(result).not.toContain(field);
    }
    for (const field of ["award_entry", "award_list", "experience_entry", "experience_list", "skill_group", "skill_group_list", "education_entry", "education_list", "project_entry", "project_list", "contact_focus_item", "contact_status_item", "contact_section", "profile_settings", "profile_image", "public_link", "website_links_settings", "resume_file", "resume_file_set"]) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(migration).not.toContain("'introduction'");
  });

  it("contains local runtime coverage for payload adaptation, privacy, ordering, and isolation", () => {
    expect(runtimeTest).toContain("extensions.plan(29)");
    for (const phrase of ["V1 keeps only recorded entity fields", "V2 returns exact aggregate before/after", "legacy Files V1 exposes only locale and object reference", "Profile photo history exposes recorded reference changes only", "known payload version with a mismatched entity contract is excluded", "unknown payload version returns generic entry", "malformed known payload returns generic entry", "keyset pages have no duplicates or skipped entries", "QA cannot read Official Version History", "disabled Activity Log capability blocks Version History"]) {
      expect(runtimeTest).toContain(phrase);
    }
  });

  it("does not modify the frozen Activity Log migration history", () => {
    const hashes: Record<string, string> = {
      "20261025_activity_log_website_links_writer.sql": "020de6b9e4a54332699fb2ef3898c7b5d343fe13f9755977bc5a3324d4973d4d",
      "20261026_activity_log_files_writer.sql": "fdc45b7c9d3f1e4c59a2a59cbc453778ca272c5b709872f29255b3cce6476154",
      "20261027_activity_log_files_legacy_restore.sql": "598a56fa2389afc596516c380eb9f4a28859416e93618fff9064b9343ebc8cee",
      "20261028_activity_log_files_storage_authorization.sql": "f5d2d4915be47feca56d0bcd208e41393891776409607b53aa7fc057551751dc",
    };
    for (const [file, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(readFileSync(resolve(`migrations/${file}`))).digest("hex"), file).toBe(expected);
      const runtime = file === "20261025_activity_log_website_links_writer.sql" ? "20261025000000_activity_log_website_links_writer.sql"
        : file === "20261026_activity_log_files_writer.sql" ? "20261026000000_activity_log_files_writer.sql"
          : file === "20261027_activity_log_files_legacy_restore.sql" ? "20261027000000_activity_log_files_legacy_restore.sql"
            : "20261028000000_activity_log_files_storage_authorization.sql";
      expect(readFileSync(resolve(`tests/rls-runtime/supabase/migrations/${runtime}`))).toEqual(readFileSync(resolve(`migrations/${file}`)));
    }
  });
});
