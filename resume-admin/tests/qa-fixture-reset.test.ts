import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixture = readFileSync(resolve("fixtures/qa_resume_reset.sql"), "utf8");
const mapper = readFileSync(resolve("src/data/resumeMapper.ts"), "utf8");

describe("deterministic QA fixture and reset guard", () => {
  it("uses one documented deterministic, unpublished QA root and rejects official-ID collisions", () => {
    expect(fixture).toContain("qa_id CONSTANT uuid := 'ea111111-1111-4111-8111-111111111111'");
    expect(fixture).toMatch(/VALUES \(qa_id, 'example-cv-qa', false\)/);
    expect(fixture).toMatch(/WHERE site_key = 'example-cv'[\s\S]*?IF qa_id = official_id THEN[\s\S]*?RAISE EXCEPTION/);
    expect(fixture).toContain("WHERE site_key = 'example-cv-qa'");
    expect(fixture).toContain("existing_qa_id <> qa_id");
    expect(fixture).toContain("existing_key IS DISTINCT FROM 'example-cv-qa'");
    expect(fixture).toContain("existing_published IS DISTINCT FROM false");
  });

  it("defaults to non-mutating preflight and constrains every delete to the exact QA UUID", () => {
    expect(fixture).toContain("apply_reset CONSTANT boolean := false");
    expect(fixture).toContain("IF NOT apply_reset THEN");
    expect(fixture).not.toMatch(/\bTRUNCATE\b/i);
    expect(fixture).toMatch(/DELETE FROM public\.%I WHERE resume_id = \$1/);
    expect(fixture).toMatch(/USING qa_id/);
    expect(fixture).not.toMatch(/DELETE\s+FROM\s+public\.(?:resume_sites|cms_admins)/i);
    expect(fixture).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*(?:auth\.|storage\.)/i);
    expect(fixture).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*public\.cms_admins/i);
    expect(fixture).toContain("WHERE resume_id = $1");
    const mapperBlock = mapper.match(/export type ResumeTable =([\s\S]*?);/);
    expect(mapperBlock).not.toBeNull();
    const currentTables = [...new Set([...mapperBlock![1].matchAll(/"(resume_[a-z_]+)"/g)].map(match => match[1]))];
    const resetTables = [...fixture.matchAll(/DELETE FROM public\.%I WHERE resume_id = \$1', '([^']+)'\) USING qa_id/g)].map(match => match[1]);
    expect([...resetTables].sort()).toEqual([...currentTables].sort());
    expect(fixture).toContain("IF NOT apply_reset THEN");
  });

  it("contains synthetic bilingual values and non-production links without requiring binary files", () => {
    expect(fixture.match(/'zh'/g)?.length).toBeGreaterThan(0);
    expect(fixture.match(/'en'/g)?.length).toBeGreaterThan(0);
    expect(fixture).toContain("qa@example.invalid");
    expect(fixture).toContain("QA 测试用户");
    expect(fixture).toContain("https://example.invalid/qa-linkedin");
    expect(fixture).toContain("https://example.invalid/qa-resume-zh.pdf");
    expect(fixture).toContain("https://example.invalid/qa-resume-en.pdf");
    expect(fixture).toContain("photo_url");
    expect(fixture).toContain("NULL");
  });

  it("seeds every current Admin content table, including methods, navigation, site text, and contact status", () => {
    const mapperBlock = mapper.match(/export type ResumeTable =([\s\S]*?);/);
    expect(mapperBlock).not.toBeNull();
    const currentTables = [...mapperBlock![1].matchAll(/"(resume_[a-z_]+)"/g)].map(match => match[1]);
    const fixtureTables = [...new Set([...fixture.matchAll(/INSERT INTO public\.(resume_[a-z_]+)/g)].map(match => match[1]))]
      .filter(table => table !== "resume_sites");
    expect([...fixtureTables].sort()).toEqual([...new Set(currentTables)].sort());
    for (const sectionTable of ["resume_project_methods", "resume_contact_status_items", "resume_navigation_items", "resume_locale_content", "resume_public_links"]) {
      expect(fixtureTables).toContain(sectionTable);
    }
    expect(fixture).toContain("'summerSchool', 'summerSchool'");
    expect(fixture).toContain("'study'");
    expect(fixture).toContain("'graduation'");
    expect(fixture).toContain("'open'");
  });
});
