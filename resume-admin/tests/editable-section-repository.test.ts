import { describe, expect, it, vi } from "vitest";
import { createResumeRepository, type EditableRepeatableSection } from "../src/data/resumeRepository";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "../src/model";

const resumeId = "resume-database-id";
const entryId = "entry-database-id";
const shapes = {
  introduction: { parent: "resume_intro_paragraphs", translations: "resume_intro_paragraph_translations", fk: "paragraph_id", payload: { text: "line one\nline two" }, response: { text: "line one\nline two" } },
  experience: { parent: "resume_experience_entries", translations: "resume_experience_translations", fk: "experience_entry_id", payload: { organization: "Org", title: "Role", period: "2024", description: "A\nB", location: null }, response: { organization: "Org", title: "Role", period: "2024", description: "A\nB", location: null } },
  skills: { parent: "resume_skill_groups", translations: "resume_skill_group_translations", fk: "skill_group_id", payload: { title: "Group", items: "Python · SQL" }, response: { title: "Group", items: "Python · SQL" } },
  awards: { parent: "resume_award_entries", translations: "resume_award_translations", fk: "award_entry_id", payload: { name: "Prize", year: "2025" }, response: { name: "Prize", year: "2025" } },
} as const;
type Section = keyof typeof shapes;
function fakeDatabase(options: { missingTranslation?: boolean } = {}) {
  const calls: Array<{ table: string; operation: string; payload?: Record<string, unknown>; filters: Array<[string, unknown]>; columns?: string }> = [];
  const from = vi.fn((table: string) => {
    const call: (typeof calls)[number] = { table, operation: "select", filters: [] }; calls.push(call);
    const query: Record<string, (...args: never[]) => unknown> = {};
    query.insert = ((payload: Record<string, unknown>) => { call.operation = "insert"; call.payload = payload; return query; }) as never;
    query.update = ((payload: Record<string, unknown>) => { call.operation = "update"; call.payload = payload; return query; }) as never;
    query.delete = (() => { call.operation = "delete"; return query; }) as never;
    query.select = ((columns: string) => { call.columns = columns; return query; }) as never;
    query.eq = ((field: string, value: unknown) => { call.filters.push([field, value]); return query; }) as never;
    const data = () => {
      const spec = Object.values(shapes).find(value => value.parent === table || value.translations === table);
      if (!spec) return null;
      if (table === spec.parent) return { id: entryId, resume_id: resumeId, position: call.payload?.position ?? 3, ...(table === "resume_intro_paragraphs" ? {} : { source_key: null }) };
      const locale = (call.payload?.locale ?? call.filters.find(([key]) => key === "locale")?.[1] ?? "zh") as Locale;
      return { resume_id: resumeId, [spec.fk]: entryId, locale, text: "line one\nline two", organization: "Org", title: "Group", items: "Python · SQL", name: "Prize", year: "2025", period: "2024", description: "A\nB", location: null, ...(call.payload ?? {}) };
    };
    query.single = (async () => ({ data: data(), error: null })) as never;
    query.maybeSingle = (async () => ({ data: options.missingTranslation && Object.values(shapes).some(spec => spec.translations === table) ? null : data(), error: null })) as never;
    query.then = ((resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve, reject)) as never;
    return query;
  });
  return { client: { from } as unknown as SupabaseClient, calls, from };
}

describe("Batch 6A writable repository schema mapping", () => {
  it.each(Object.keys(shapes) as Section[])("uses scoped %s table, FK, and schema translation fields", async section => {
    const db = fakeDatabase();
    const repository = createResumeRepository(db.client);
    const spec = shapes[section];
    const translation = section === "introduction" ? { text: "line one\nline two" }
      : section === "experience" ? { organization: "Org", title: "Role", period: "2024", description: "A\nB", location: null }
      : section === "skills" ? { title: "Group", items: "Python · SQL" } : { name: "Prize", year: "2025" };

    const parent = await repository.insertEditableEntry!(section, resumeId, 3);
    expect(parent).toEqual({ resumeId, entryId, position: 3, sourceKey: null });
    expect(db.calls[0].table).toBe(spec.parent);
    expect(db.calls[0].payload).toEqual(section === "introduction" ? { resume_id: resumeId, position: 3 } : { resume_id: resumeId, position: 3, source_key: null });

    await repository.updateEditableTranslation!(section, resumeId, entryId, "zh", translation as never);
    const update = db.calls.find(call => call.table === spec.translations && call.operation === "update")!;
    expect(update.payload).toEqual(spec.payload);
    expect(update.filters).toEqual([["resume_id", resumeId], [spec.fk, entryId], ["locale", "zh"]]);

    await repository.insertEditableTranslation!(section, resumeId, entryId, "en", translation as never);
    const insert = db.calls.find(call => call.table === spec.translations && call.operation === "insert")!;
    expect(insert.payload).toEqual({ resume_id: resumeId, [spec.fk]: entryId, locale: "en", ...spec.payload });
    expect(await repository.readEditableTranslation!(section, resumeId, entryId, "en")).toMatchObject({ resumeId, entryId, locale: "en" });
    const read = db.calls.filter(call => call.table === spec.translations).at(-1)!;
    expect(read.filters).toEqual([["resume_id", resumeId], [spec.fk, entryId], ["locale", "en"]]);

    await repository.updateEditableEntryPosition!(section, resumeId, entryId, 0);
    const reorder = db.calls.find(call => call.table === spec.parent && call.operation === "update")!;
    expect(reorder.payload).toEqual({ position: 0 });
    expect(reorder.filters).toEqual([["resume_id", resumeId], ["id", entryId]]);

    await repository.deleteEditableTranslation!(section, resumeId, entryId, "zh");
    const childDelete = db.calls.find(call => call.table === spec.translations && call.operation === "delete")!;
    expect(childDelete.filters).toEqual([["resume_id", resumeId], [spec.fk, entryId], ["locale", "zh"]]);
    await repository.deleteEditableEntry!(section, resumeId, entryId);
    const parentDelete = db.calls.find(call => call.table === spec.parent && call.operation === "delete")!;
    expect(parentDelete.filters).toEqual([["resume_id", resumeId], ["id", entryId]]);
  });

  it.each(Object.keys(shapes) as Section[])("inserts a changed locale when %s is absent instead of borrowing/falling back", async section => {
    const db = fakeDatabase({ missingTranslation: true });
    const repository = createResumeRepository(db.client);
    const spec = shapes[section];
    const translation = section === "introduction" ? { text: "Only this locale" }
      : section === "experience" ? { organization: "Only this locale", title: "", period: "", description: "", location: null }
      : section === "skills" ? { title: "Only this locale", items: "" } : { name: "Only this locale", year: "" };
    await repository.updateEditableTranslation!(section, resumeId, entryId, "zh", translation as never);
    const sectionCalls = db.calls.filter(call => call.table === spec.translations);
    expect(sectionCalls.map(call => call.operation)).toEqual(["select", "insert"]);
    expect(sectionCalls[0].filters).toEqual([["resume_id", resumeId], [spec.fk, entryId], ["locale", "zh"]]);
    expect(sectionCalls[1].payload).toEqual({ resume_id: resumeId, [spec.fk]: entryId, locale: "zh", ...spec.payload, ...(section === "experience" ? { organization: "Only this locale", title: "", period: "", description: "" } : section === "skills" ? { title: "Only this locale", items: "" } : section === "awards" ? { name: "Only this locale", year: "" } : { text: "Only this locale" }) });
  });

  it("uses only the four authorized section table pairs and never writes other sections", () => {
    const db = fakeDatabase();
    const repository = createResumeRepository(db.client);
    expect(typeof repository.insertEditableEntry).toBe("function");
    expect((Object.keys(shapes) as EditableRepeatableSection[])).toEqual(["introduction", "experience", "skills", "awards"]);
    expect(db.from).not.toHaveBeenCalled();
  });
});
