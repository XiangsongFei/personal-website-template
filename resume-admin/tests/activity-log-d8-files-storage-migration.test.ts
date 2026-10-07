import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261028_activity_log_files_storage_authorization.sql"), "utf8");
const runtime = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261028000000_activity_log_files_storage_authorization.sql"), "utf8");
const runtimeProof = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_d8_files_storage_authorization.test.sql"), "utf8");

describe("V1.3D-8 resume PDF Storage authorization migration", () => {
  it("keeps the runtime migration identical and installation-only", () => {
    expect(runtime).toBe(migration);
    expect(migration).toMatch(/BEGIN;[\s\S]*COMMIT;/);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO\s+cms_private\.(?:resume_write_modes|resume_domain_requirements|resume_capabilities|resume_files_storage_protocol)/i);
    expect(migration).not.toMatch(/GRANT\s+EXECUTE[^;]*service_role/i);
  });

  it("uses explicit per-resume intent mode and authenticated-only Storage helpers", () => {
    expect(migration).toContain("cms_private.resume_files_storage_protocol");
    expect(migration).toContain("protocol_key='intent_v1'");
    expect(migration).toContain("(SELECT auth.uid())");
    expect(migration).toContain("public.activity_log_authorized_targets()");
    expect(migration).toContain("target_bucket<>'resume-files'");
    expect(migration).toContain("CREATE POLICY cms_admin_scoped_resume_files_insert");
    expect(migration).toContain("CREATE POLICY cms_admin_scoped_resume_files_update");
    expect(migration).toContain("CREATE POLICY cms_admin_scoped_resume_files_delete");
    expect(migration).toContain("REVOKE ALL ON cms_private.resume_file_upload_intents FROM PUBLIC,anon,authenticated,service_role");
    expect(migration).toContain("REVOKE ALL ON cms_private.resume_file_cleanup_intents FROM PUBLIC,anon,authenticated,service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.prepare_resume_file_upload_v1");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.claim_resume_file_cleanup_v1");
    expect(migration).not.toContain("service_role) TO");
    expect(migration).toContain("public.load_admin_files_storage_state_v1(target_resume_id uuid)");
    expect(migration).toContain("COALESCE((SELECT p.protocol_key FROM cms_private.resume_files_storage_protocol p");
  });

  it("uses trusted database time for a single non-renewable five-minute prepare window", () => {
    expect(migration).toContain("expires_at timestamptz NOT NULL");
    expect(migration).toContain("clock_timestamp()+interval '5 minutes'");
    expect(migration).toContain("i.status='prepared' AND i.expires_at>clock_timestamp()");
    expect(migration).toContain("prior.status='prepared' AND prior.expires_at<=clock_timestamp()");
    expect(migration).toContain("intent.status IN ('uploaded','consumed') THEN RETURN true");
    expect(migration).toContain("intent.expires_at<=clock_timestamp()");
  });

  it("proves authenticated intent paths and rejects direct, cross-target, legacy and referenced cleanup", () => {
    for (const assertion of [
      "legacy nonactivated QA Storage path retains its prior authenticated policy",
      "exact prepared upload intent permits Storage INSERT under the authenticated user identity",
      "direct browser-style Storage INSERT without an exact intent is denied",
      "QA cannot insert an object under the Official resume path",
      "malformed managed path is denied after intent-mode activation",
      "intent mode denies Storage UPDATE and upsert-style mutation",
      "upload authorization alone does not grant Storage DELETE",
      "exact cleanup authorization permits Storage DELETE under the authenticated user identity",
      "intent mode rejects legacy and Official objects for cleanup",
      "cleanup authorization cannot delete an object that is currently referenced by the Files aggregate",
    ]) expect(runtimeProof).toContain(assertion);
    expect(runtimeProof).toContain("BEGIN;");
    expect(runtimeProof).toContain("ROLLBACK;");
  });
});
