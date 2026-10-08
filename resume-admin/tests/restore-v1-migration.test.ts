import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261030_activity_log_restore_v1.sql"), "utf8");
const mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261030000000_activity_log_restore_v1.sql"), "utf8");
const runtimeTest = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_restore_v1.test.sql"), "utf8");
const domainWriters = [
  "20261013_activity_log_awards_writer.sql",
  "20261015_activity_log_experience_writer.sql",
  "20261016_activity_log_skills_writer.sql",
  "20261018_activity_log_education_writer.sql",
  "20261020_activity_log_projects_writer.sql",
  "20261022_activity_log_contact_writer.sql",
  "20261025_activity_log_website_links_writer.sql",
].map((file) => readFileSync(resolve(`migrations/${file}`), "utf8"));

describe("Restore V1 additive backend contract", () => {
  it("keeps the production migration and isolated runtime mirror byte-identical", () => {
    expect(mirror).toBe(migration);
  });

  it("adds only a disabled-by-default target capability and private source linkage", () => {
    expect(migration).toContain("'restore'))");
    expect(migration).toContain("CREATE TABLE cms_private.activity_log_restore_links");
    expect(migration).toContain("ALTER TABLE cms_private.activity_log_restore_links ENABLE ROW LEVEL SECURITY");
    expect(migration).toMatch(/REVOKE ALL ON TABLE cms_private\.activity_log_restore_links[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_capabilities/i);
    expect(migration).not.toMatch(/GRANT\s+[^;]*activity_log_restore_links/i);
  });

  it("exposes only authenticated SECURITY DEFINER RPCs with a fixed search path", () => {
    for (const { name, signature } of [
      { name: "preview_restore_v1", signature: "uuid,uuid" },
      { name: "restore_domain_v1", signature: "uuid,uuid,text,uuid,text,text" },
    ]) {
      const start = migration.indexOf(`CREATE FUNCTION public.${name}(`);
      const functionText = migration.slice(start, migration.indexOf("$function$;", start) + "$function$;".length);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(functionText).toContain("SECURITY DEFINER");
      expect(functionText).toContain("SET search_path = ''");
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC,anon,authenticated,service_role`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO authenticated`);
    }
    expect(migration).toContain("cms_private.assert_activity_log_target(target_resume_id)");
    expect(migration).toContain("capability_key='restore'");
  });

  it("restricts restoration to supported validated V2 BEFORE aggregates and existing identities", () => {
    for (const domain of ["awards", "experience", "skills", "education", "projects", "contact", "website_links"]) {
      expect(migration).toContain(`'${domain}'`);
    }
    expect(migration).toContain("source_row.operation IS DISTINCT FROM 'update'");
    expect(migration).toContain("source_row.payload_version IS DISTINCT FROM 2");
    expect(migration).toContain("activity_event_payload_v2_is_allowed");
    expect(migration).toContain("restore_historical_ids_exist");
    expect(migration).toContain("target_event_id");
    expect(migration).not.toContain("'profile'");
    expect(migration).not.toContain("'files'");
  });

  it("binds the expected-current digest, locks the target, and reuses the existing idempotency ledger", () => {
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("restore_expected_digest");
    expect(migration).toContain("CREATE FUNCTION cms_private.restore_expected_digest(target_resume_id uuid,target_domain text,current_state jsonb)");
    expect(migration).toContain("jsonb_build_array('restore-v1',target_resume_id::text,target_domain,current_state)::text");
    expect(migration).toContain("restore_expected_digest(target_resume_id,domain_value,current_value)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION cms_private.restore_expected_digest(uuid,text,jsonb)");
    expect(migration).not.toContain("restore_expected_digest(text,jsonb)");
    expect(migration).toContain("Restore current state conflict");
    expect(migration).toContain("Restore request identity conflict");
    expect(migration).toContain("cms_private.activity_log_idempotency");
    expect(migration).not.toContain("restore_v1_idempotency");
    expect(migration).toContain("'no_change'");
    expect(migration).toContain("activity_log_restore_links(result_event_id,source_event_id,resume_id,domain_key)");
  });

  it("shares the resume_sites row-lock serialization boundary with every normal domain writer", () => {
    expect(migration).toContain("PERFORM 1 FROM public.resume_sites s WHERE s.id=target_resume_id FOR UPDATE");
    for (const writer of domainWriters) {
      expect(writer).toMatch(/PERFORM\s+1\s+FROM\s+public\.resume_sites\s+(?:AS\s+)?\w+\s+WHERE\s+\w+\.id=target_resume_id\s+FOR UPDATE/i);
    }
  });

  it("keeps the frozen Version History and earlier Activity Log migrations unchanged", () => {
    const expected: Record<string, [string, string]> = {
      "20261025_activity_log_website_links_writer.sql": ["020de6b9e4a54332699fb2ef3898c7b5d343fe13f9755977bc5a3324d4973d4d", "20261025000000_activity_log_website_links_writer.sql"],
      "20261026_activity_log_files_writer.sql": ["fdc45b7c9d3f1e4c59a2a59cbc453778ca272c5b709872f29255b3cce6476154", "20261026000000_activity_log_files_writer.sql"],
      "20261027_activity_log_files_legacy_restore.sql": ["598a56fa2389afc596516c380eb9f4a28859416e93618fff9064b9343ebc8cee", "20261027000000_activity_log_files_legacy_restore.sql"],
      "20261028_activity_log_files_storage_authorization.sql": ["f5d2d4915be47feca56d0bcd208e41393891776409607b53aa7fc057551751dc", "20261028000000_activity_log_files_storage_authorization.sql"],
      "20261029_version_history_v1_read.sql": ["2bd2e5c16886c0028450e9a17b6b922f8b7f4cb81968c8f19ffec239e344ec91", "20261029000000_version_history_v1_read.sql"],
    };
    for (const [canonical, [hash, runtime]] of Object.entries(expected)) {
      const bytes = readFileSync(resolve(`migrations/${canonical}`));
      expect(createHash("sha256").update(bytes).digest("hex"), canonical).toBe(hash);
      expect(readFileSync(resolve(`tests/rls-runtime/supabase/migrations/${runtime}`))).toEqual(bytes);
    }
  });

  it("contains isolated runtime proof for domain writes, replay, no-op, privacy, and target isolation", () => {
    expect(runtimeTest).toContain("extensions.plan(49)");
    for (const phrase of ["two authorized targets produce different digests for identical domain and canonical state", "a preview token from QA is rejected for the authorized Official-like target", "cross-target digest rejection has zero content, event, link, or ledger effects", "Project method ID belonging to another project parent is rejected", "Project method ID belonging to another locale is rejected", "existing Project V2 validator rejects duplicate method identity in historical structure", "Awards V2 BEFORE state restores successfully", "Projects and nested method IDs restore successfully", "each supported restore creates exactly one V2 event and one source link", "all domains preserve the exact historical aggregate, locale values, and order", "Awards and Projects preserve existing source-key provenance", "exact request retry returns the cached Restore result", "same request ID with a different expected digest is rejected", "no_change does not create a source link", "QA admin cannot preview or mutate Official target", "anonymous callers cannot execute the preview RPC", "missing Restore capability fails closed", "missing historical entity identity is rejected", "cross-target historical identity collision is rejected", "unknown future payload version fails closed", "stale digest conflict has zero content, event, link, or ledger effects", "post-writer failure rolls back content, V2 event, linkage, and idempotency", "private source linkage trigger rejects a cross-target link"]) {
      expect(runtimeTest).toContain(phrase);
    }
  });
});
