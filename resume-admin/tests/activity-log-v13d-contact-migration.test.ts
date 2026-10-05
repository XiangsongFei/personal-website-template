import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const v2 = readFileSync(resolve("migrations/20261021_activity_log_contact_writer.sql"), "utf8");
const writer = readFileSync(resolve("migrations/20261022_activity_log_contact_writer.sql"), "utf8");
const v2Mirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261021000000_activity_log_contact_writer.sql"), "utf8");
const writerMirror = readFileSync(resolve("tests/rls-runtime/supabase/migrations/20261022000000_activity_log_contact_writer.sql"), "utf8");
const runtime = readFileSync(resolve("tests/rls-runtime/supabase/tests/activity_log_contact_writer.test.sql"), "utf8");

describe("V1.3D-5 Contact migrations", () => {
  it("keeps canonical production migrations byte-identical to their local runtime mirrors", () => {
    expect(v2Mirror).toBe(v2);
    expect(writerMirror).toBe(writer);
  });

  it("adds only the Contact V2 contract while preserving existing dispatch and installation-only semantics", () => {
    for (const token of ["activity_event_payload_v2_contact_is_allowed", "contact_section", "target_section IS DISTINCT FROM 'contact'",
      "contact_label", "availability", "status_type", "contact_aggregate_is_allowed", "activity_event_payload_v2_projects_is_allowed"]) {
      expect(v2).toContain(token);
    }
    for (const migration of [v2, writer]) {
      expect(migration).not.toMatch(/INSERT\s+INTO\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
      expect(migration).not.toMatch(/UPDATE\s+cms_private\.(?:resume_capabilities|resume_write_modes|resume_domain_requirements)/i);
    }
  });

  it("defines one target-scoped typed writer and gates only Contact-owned direct writes", () => {
    for (const token of ["public.load_admin_contact_write_state(target_resume_id uuid)",
      "public.save_resume_contact_v1(target_resume_id uuid,canonical_contact text,signed_context text,signature_hex text)",
      "SECURITY DEFINER SET search_path=''", "assert_activity_log_target(target_resume_id)", "get_resume_write_mode(target_resume_id,'contact')",
      "trusted_network_context_v11", "domain_key='contact'", "activity_log_idempotency", "USING ERRCODE='P13B1'",
      "enforce_contact_locale_write_mode", "can_direct_write_contact", "ON CONFLICT(focus_item_id,resume_id,locale)",
      "ON CONFLICT(status_item_id,resume_id,locale)"]) expect(writer).toContain(token);
    expect(writer).toContain("BEFORE INSERT OR UPDATE OR DELETE ON public.resume_locale_content");
    expect(writer).toContain("can_direct_write_contact(OLD.resume_id)");
    expect(writer).toContain("can_direct_write_contact(NEW.resume_id)");
    expect(writer).toContain("NEW.locale IS DISTINCT FROM OLD.locale");
    expect(writer).not.toMatch(/INSERT\s+INTO\s+cms_private\.resume_(?:capabilities|write_modes|domain_requirements)/i);
    expect(writer).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE/i);
    expect(runtime).toContain("semantic no-op accepts canonical dense request and preserves sparse stored positions without an event");
    expect(runtime).toContain("changed aggregate save persists locale update and exactly one V2 event");
    expect(runtime).toContain("changed save updates Focus and normalizes changed Focus order");
    expect(runtime).toContain("changed save updates Status and normalizes changed Status order");
    expect(runtime).toContain("rpc mode rejects direct locale DELETE before row removal or cascading child deletion");
    expect(runtime).toContain("rpc mode rejects valid Contact locale INSERT when the shared locale key is absent");
    expect(runtime).toContain("Contact rpc mode does not govern an unrelated stable-key locale field UPDATE");
    expect(runtime).toContain("key-changing UPDATE out of a Contact rpc target checks OLD ownership and is denied");
    expect(runtime).toContain("key-changing UPDATE into a Contact rpc target checks NEW ownership and is denied");
    expect(runtime).toContain("authorized Contact row INSERT/DELETE remain permitted in direct mode");
    expect(runtime).toContain("late Contact mutation failure rolls back locale, collection, event, and ledger changes");
  });
});
