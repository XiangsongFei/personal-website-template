import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resumeTables } from "../src/data/resumeRepository";

const migration = readFileSync(resolve("migrations/20260928_resume_wide_updated_at.sql"), "utf8");
const functionBody = migration.split("AS $function$")[1]?.split("$function$;")[0] ?? "";

describe("resume-wide updated_at migration", () => {
  it("touches NEW.resume_id for INSERT and OLD.resume_id for DELETE", () => {
    expect(functionBody).toMatch(/IF TG_OP = 'INSERT' THEN\s+UPDATE public\.resume_sites AS parent_site\s+SET updated_at = pg_catalog\.now\(\)\s+WHERE parent_site\.id = NEW\.resume_id;\s+RETURN NEW;/);
    expect(functionBody).toMatch(/ELSIF TG_OP = 'DELETE' THEN\s+UPDATE public\.resume_sites AS parent_site\s+SET updated_at = pg_catalog\.now\(\)\s+WHERE parent_site\.id = OLD\.resume_id;\s+RETURN OLD;/);
  });

  it("touches one parent for an unchanged resume_id and both parents when it changes", () => {
    expect(functionBody).toMatch(/ELSE\s+UPDATE public\.resume_sites AS parent_site\s+SET updated_at = pg_catalog\.now\(\)\s+WHERE parent_site\.id = NEW\.resume_id;\s+IF OLD\.resume_id IS DISTINCT FROM NEW\.resume_id THEN\s+UPDATE public\.resume_sites AS parent_site\s+SET updated_at = pg_catalog\.now\(\)\s+WHERE parent_site\.id = OLD\.resume_id;\s+END IF;\s+RETURN NEW;/);
    expect(functionBody).toContain("OLD.resume_id IS DISTINCT FROM NEW.resume_id");
  });

  it("attaches one idempotent row trigger for INSERT, UPDATE, and DELETE to all Admin content tables", () => {
    const triggerTables = migration.match(/FOREACH content_table IN ARRAY ARRAY\[([\s\S]*?)\n[ ]{2}\] LOOP/)?.[1];
    expect(triggerTables).toBeTruthy();
    const tables = [...triggerTables!.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(tables).toEqual([
      "resume_profile", "resume_profile_translations", "resume_locale_content",
      "resume_intro_paragraphs", "resume_intro_paragraph_translations",
      "resume_education_entries", "resume_education_translations",
      "resume_experience_entries", "resume_experience_translations",
      "resume_project_entries", "resume_project_translations", "resume_project_methods",
      "resume_skill_groups", "resume_skill_group_translations",
      "resume_award_entries", "resume_award_translations",
      "resume_contact_focus_items", "resume_contact_focus_translations",
      "resume_contact_status_items", "resume_contact_status_translations",
      "resume_navigation_items", "resume_navigation_item_translations", "resume_public_links",
    ]);
    expect([...tables].sort()).toEqual([...resumeTables].sort());
    expect(migration).toMatch(/DROP TRIGGER IF EXISTS resume_sites_updated_at_rollup ON public\.%I/);
    expect(migration).toMatch(/CREATE TRIGGER resume_sites_updated_at_rollup AFTER INSERT OR UPDATE OR DELETE ON public\.%I FOR EACH ROW EXECUTE FUNCTION public\.touch_resume_site_updated_at_from_content\(\)/);
    expect(tables).not.toContain("resume_sites");
    expect(tables).not.toContain("storage.objects");
    expect(tables).not.toContain("auth.users");
  });

  it("revokes direct PUBLIC execution only after installing the triggers", () => {
    const installIndex = migration.indexOf("$triggers$;");
    const revokeIndex = migration.indexOf("REVOKE EXECUTE\nON FUNCTION public.touch_resume_site_updated_at_from_content()\nFROM PUBLIC;");
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeGreaterThan(installIndex);
    expect(migration).toContain("SECURITY DEFINER\nSET search_path = pg_catalog");
  });

  it("leaves the existing set_updated_at trigger and function untouched", () => {
    expect(migration).not.toMatch(/set_updated_at/i);
    expect(migration).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION public\.set_updated_at/i);
    expect(migration).not.toMatch(/(?:CREATE|DROP) TRIGGER[^;]*set_updated_at/i);
  });
});
