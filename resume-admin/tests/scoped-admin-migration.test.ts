import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("migrations/20261001_scoped_admin_access.sql"), "utf8");
const mapper = readFileSync(resolve("src/data/resumeMapper.ts"), "utf8");

describe("scoped Admin authorization migration contract", () => {
  it("preserves current admins as Owners without a future Owner default", () => {
    expect(migration).toMatch(/UPDATE public\.cms_admins\s+SET role = 'owner', resume_id = NULL\s+WHERE role IS NULL/);
    expect(migration).not.toMatch(/ALTER COLUMN role SET DEFAULT/);
    expect(migration).toContain("role = 'owner' AND resume_id IS NULL");
    expect(migration).toContain("role = 'qa' AND resume_id IS NOT NULL");
  });

  it("derives authority only from auth.uid and binds QA to the unpublished QA site", () => {
    expect(migration).toContain("admin.user_id = (SELECT auth.uid())");
    expect(migration).toContain("admin.resume_id = target_resume_id");
    expect(migration).toContain("site.site_key = 'example-cv-qa'");
    expect(migration).toContain("site.is_published = false");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.can_manage_resume\(uuid\) FROM PUBLIC, anon/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.can_manage_resume\(uuid\) TO authenticated/);
  });

  it("removes broad CMS admin policies before creating scoped child policies", () => {
    expect(migration).toMatch(/DROP POLICY %I ON public\.%I/);
    expect(migration).toMatch(/CREATE POLICY cms_admin_scoped_all[^']*?USING \(public\.can_manage_resume\(resume_id\)\) WITH CHECK \(public\.can_manage_resume\(resume_id\)\)/);
    expect(migration).toContain("DROP POLICY %I ON public.cms_admins");
    expect(migration).toMatch(/CREATE POLICY cms_owner_manage_resume_sites[\s\S]*?USING \(public\.is_resume_owner\(\)\) WITH CHECK \(public\.is_resume_owner\(\)\)/);
    expect(migration).toMatch(/CREATE POLICY cms_qa_read_bound_resume_site[\s\S]*?FOR SELECT TO authenticated\s+USING \(public\.can_manage_resume\(id\)\)/);
    expect(migration).not.toMatch(/CREATE POLICY[^;]+ON public\.resume_sites[^;]+FOR ALL TO authenticated[^;]+can_manage_resume\(id\)/);
  });

  it("scopes every current Admin content table and leaves published SELECT policies alone", () => {
    const mapperBlock = mapper.match(/export type ResumeTable =([\s\S]*?);/);
    const policyBlock = migration.match(/content_tables constant text\[\] := ARRAY\[([\s\S]*?)\];/);
    expect(mapperBlock).not.toBeNull();
    expect(policyBlock).not.toBeNull();
    const adminTables = [...mapperBlock![1].matchAll(/"(resume_[a-z_]+)"/g)].map(match => match[1]);
    const scopedTables = [...policyBlock![1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    expect([...scopedTables].sort()).toEqual([...new Set(adminTables)].sort());
    expect(migration).toContain("cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')");
    expect(migration).toMatch(/cmd IN \('ALL', 'INSERT', 'UPDATE', 'DELETE'\)[\s\S]*?EXECUTE pg_catalog\.format\('DROP POLICY/);
    expect(migration).not.toMatch(/cmd IN \([^)]*'SELECT'/);
  });

  it("keeps QA limited to reading the root and denies CMS membership policy access", () => {
    expect(migration).toMatch(/CREATE POLICY cms_owner_manage_resume_sites[\s\S]*?FOR ALL TO authenticated[\s\S]*?USING \(public\.is_resume_owner\(\)\) WITH CHECK \(public\.is_resume_owner\(\)\)/);
    expect(migration).toMatch(/CREATE POLICY cms_qa_read_bound_resume_site[\s\S]*?FOR SELECT TO authenticated\s+USING \(public\.can_manage_resume\(id\)\)/);
    expect(migration).toMatch(/FOR policy_row IN[\s\S]*?tablename = 'cms_admins'[\s\S]*?LOOP\s+EXECUTE pg_catalog\.format\('DROP POLICY %I ON public\.cms_admins'/);
    expect(migration).not.toMatch(/CREATE POLICY[^;]+ON public\.cms_admins/i);
    expect(migration).toContain("site.site_key = 'example-cv-qa' AND site.is_published = false");
  });

  it("enforces Storage old-row and new-row checks while retaining owner-only official legacy paths", () => {
    expect(migration).toMatch(/FOR UPDATE TO authenticated USING \(bucket_id = %L AND public\.can_manage_resume_storage_object\(bucket_id, name\)\) WITH CHECK \(bucket_id = %L AND public\.can_manage_resume_storage_object\(bucket_id, name\)\)/);
    expect(migration).toContain("object_name ~ '^example-cv/profile/");
    expect(migration).toContain("'example-cv/resume_zh.pdf', 'example-cv/resume_en.pdf'");
    expect(migration).toContain("RETURN public.is_resume_owner()");
    expect(migration).toContain("resume_(zh|en)\\.pdf");
    expect(migration).toContain("/profile/");
    expect(migration).not.toMatch(/(?:UPDATE|DELETE)\s+storage\.objects/i);
    expect(migration).toMatch(/cmd IN \('ALL', 'INSERT', 'UPDATE', 'DELETE'\)[\s\S]*?CREATE POLICY %I ON storage\.objects AS PERMISSIVE FOR UPDATE/);
    expect(migration).toMatch(/object_name !~\* '\^\[0-9a-f\].*profile\/\[\^\/\]\+/);
    expect(migration).toMatch(/object_name !~\* '\^\[0-9a-f\].*resume_\(zh\|en\)/);
    expect(migration).toContain("RETURN public.can_manage_resume(path_resume_id)");
  });
});
