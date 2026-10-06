import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("migrations/20261027_activity_log_files_legacy_restore.sql", "utf8");
const mirror = readFileSync("tests/rls-runtime/supabase/migrations/20261027000000_activity_log_files_legacy_restore.sql", "utf8");
const filesWriter = readFileSync("migrations/20261026_activity_log_files_writer.sql", "utf8");

describe("V1.3D-7 Files legacy restoration migration", () => {
  it("keeps the runtime mirror exact and only adds a Files-specific restore surface", () => {
    expect(mirror).toBe(migration);
    expect(migration).toContain("public.load_admin_files_restore_source_v1(target_resume_id uuid, source_event_id uuid, target_locale text, target_request_id uuid, canonical_restore text)");
    expect(migration).toContain("public.restore_resume_files_from_event_v1(");
    expect(migration).toContain("cms_private.files_historical_reference_is_allowed");
    expect(migration).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
    expect(migration).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+INTO?\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
  });

  it("validates the persisted Files V2 event and derives before/after without URL parameters", () => {
    expect(migration).toContain("source_event.actor_user_id IS DISTINCT FROM target_actor_id");
    expect(migration).toContain("cms_private.activity_event_payload_v2_files_is_allowed");
    expect(migration).toContain("source_event.changes->'files'->'before'");
    expect(migration).toContain("source_event.changes->'files'->'after'");
    expect(migration).toContain("source.expected_current_reference");
    expect(migration).toContain("FROM storage.objects o WHERE o.bucket_id='resume-files' AND o.name=source.storage_object_name");
    expect(filesWriter).toContain("CREATE FUNCTION cms_private.files_reference_is_allowed");
    expect(filesWriter).toContain("target_reference ~ '[?#%\\\\]' ");
  });

  it("uses the existing update/V2/idempotency contract with authenticated-only RPC ACLs", () => {
    expect(migration).toContain("verify_resume_d7_v1_context(target_resume_id,'files',canonical_restore,signed_context,signature_hex)");
    expect(migration).toContain("domain_key='files' AND request_id=request_id_value");
    expect(migration).toContain("USING ERRCODE='P13B1'");
    expect(migration).toContain("'update','files','resume_file_set',NULL");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.restore_resume_files_from_event_v1[\s\S]*?FROM PUBLIC,anon,authenticated,service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.restore_resume_files_from_event_v1[\s\S]*?TO authenticated/);
  });
});
