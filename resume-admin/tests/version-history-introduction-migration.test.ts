import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const filename = "20261102000000_introduction_version_history_read.sql";
const migration = readFileSync(resolve(`migrations/${filename}`), "utf8");

describe("Introduction Version History reader migration", () => {
  it("keeps deployment and isolated-runtime migrations identical", () => {
    expect(readFileSync(resolve(`supabase/migrations/${filename}`), "utf8")).toBe(migration);
    expect(readFileSync(resolve(`tests/rls-runtime/supabase/migrations/${filename}`), "utf8")).toBe(migration);
  });

  it("extends the least-data authorized reader without touching stored history", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.read_version_history_v1(");
    expect(migration).toContain("cms_private.assert_activity_log_read_target(target_resume_id)");
    expect(migration).toContain("event.resume_id = target_resume_id");
    expect(migration).toContain("event.site_key_snapshot = authorized_site_key");
    expect(migration).toContain("event.section_key = 'introduction' AND event.entity_type = 'introduction_paragraph'");
    expect(migration).toContain("cms_private.activity_event_payload_is_allowed(s.entity_type, s.entity_snapshot, s.changes)");
    expect(migration).toContain("THEN 'paragraph_changes'");
    expect(migration).toContain("WHEN a.comparison_kind = 'paragraph_changes' THEN (");
    expect(migration).toContain("GROUP BY items.id, items.field_key");
    expect(migration).toContain("GROUP BY pairs.id");
    expect(migration).toContain("'paragraphs',");
    expect(migration).not.toContain("WHEN a.comparison_kind = 'paragraph_changes' THEN pg_catalog.jsonb_build_object('changes', a.changes)");
    expect(migration).toContain("'introduction_paragraph') THEN NULL ELSE ranked.entity_id END");
    expect(migration).toContain("ELSE 'unavailable'");
    expect(migration).toContain("(event.occurred_at, event.id) < (before_occurred_at, before_event_id)");
    expect(migration).toContain("LIMIT page_limit + 1");
    expect(migration).toContain("ORDER BY ranked.occurred_at DESC, ranked.id DESC");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.read_version_history_v1[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.read_version_history_v1[\s\S]*?TO authenticated/);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|cms_private\.activity_log_events)\b/i);
    const resultShape = migration.slice(migration.indexOf("RETURNS TABLE"), migration.indexOf("LANGUAGE plpgsql"));
    expect(resultShape).not.toMatch(/entity_snapshot|actor_user_id|ip_network|request_id/);
  });
});
