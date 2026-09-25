import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createResumeRepository } from "../src/data/resumeRepository";

function mockClient(response: { data: Record<string, unknown> | null; error: { message: string } | null } = { data: null, error: null }) {
  const operations: { table: string; operation: string; payload?: unknown; filters: [string, unknown][]; selected?: string }[] = [];
  const from = vi.fn((table: string) => {
    let current: (typeof operations)[number] | null = null;
    const chain = {
      eq: vi.fn((column: string, value: unknown) => { current!.filters.push([column, value]); return chain; }),
      select: vi.fn((columns: string) => { current!.selected = columns; return chain; }),
      single: vi.fn(async () => response),
      maybeSingle: vi.fn(async () => response),
    };
    return {
      select: (columns: string) => { current = { table, operation: "select", filters: [], selected: columns }; operations.push(current); return chain; },
      update: (payload: unknown) => { current = { table, operation: "update", payload, filters: [] }; operations.push(current); return chain; },
      insert: (payload: unknown) => { current = { table, operation: "insert", payload, filters: [] }; operations.push(current); return chain; },
      delete: () => { current = { table, operation: "delete", filters: [] }; operations.push(current); return chain; },
    };
  });
  return { client: { from } as unknown as SupabaseClient, operations };
}

const trans = { title: "Title", program: "Program", period: "Period", grade: "Grade", courseTitle: null, courseDescription: "Description" };

describe("Stage 4G Education repository contract", () => {
  it("updates only allowed parent fields and filters by resume and real parent UUID", async () => {
    const db = mockClient({ data: { id: "education-uuid", resume_id: "resume-uuid", source_key: "stable-key", position: 2, entry_type: "summerSchool" }, error: null });
    await createResumeRepository(db.client).updateEducationEntry!("resume-uuid", "education-uuid", { position: 2, entryType: "summerSchool" });
    expect(db.operations[0]).toMatchObject({ table: "resume_education_entries", operation: "update", payload: { position: 2, entry_type: "summerSchool" }, filters: [["resume_id", "resume-uuid"], ["id", "education-uuid"]] });
    expect(db.operations[0].payload).not.toHaveProperty("source_key");
  });

  it.each(["zh", "en"] as const)("updates the existing %s row by education_entry_id and locale", async locale => {
    const db = mockClient({ data: { resume_id: "resume-uuid", education_entry_id: "education-uuid", locale, title: "Title", program: "Program", period: "Period", grade: "A", course_title: null, course_description: "Description" }, error: null });
    await createResumeRepository(db.client).updateEducationTranslation!("resume-uuid", "education-uuid", locale, trans);
    expect(db.operations[0]).toMatchObject({ table: "resume_education_translations", operation: "update", filters: [["resume_id", "resume-uuid"], ["education_entry_id", "education-uuid"], ["locale", locale]] });
    expect(db.operations[0].payload).toMatchObject({ title: "Title", program: "Program", period: "Period", grade: "Grade", course_title: null });
    if (locale === "zh") expect(db.operations[0].payload).not.toHaveProperty("course_description");
    else expect(db.operations[0].payload).toHaveProperty("course_description", "Description");
  });

  it("uses database-generated parent identity and actual translation FK fields for creation", async () => {
    const parentDb = mockClient({ data: { id: "generated-uuid", resume_id: "resume-uuid", source_key: null, position: 0, entry_type: "standard" }, error: null });
    const parent = await createResumeRepository(parentDb.client).insertEducationEntry!("resume-uuid", 0, "standard");
    expect(parent.entryId).toBe("generated-uuid");
    expect(parentDb.operations[0]).toMatchObject({ table: "resume_education_entries", operation: "insert", payload: { resume_id: "resume-uuid", position: 0, entry_type: "standard", source_key: null } });

    const translationDb = mockClient({ data: { resume_id: "resume-uuid", education_entry_id: "generated-uuid", locale: "zh", ...{ title: "Title", program: "Program", period: "Period", grade: "Grade", course_title: null, course_description: "Description" } }, error: null });
    await createResumeRepository(translationDb.client).insertEducationTranslation!("resume-uuid", parent.entryId, "zh", trans);
    expect(translationDb.operations[0]).toMatchObject({ table: "resume_education_translations", operation: "insert", payload: { resume_id: "resume-uuid", education_entry_id: "generated-uuid", locale: "zh", course_title: null, course_description: "Description" } });
  });

  it("fails an existing translation update when no row was returned and deletes only the parent UUID", async () => {
    const missing = mockClient();
    await expect(createResumeRepository(missing.client).updateEducationTranslation!("resume-uuid", "education-uuid", "en", trans)).rejects.toThrow("not confirmed");
    const removal = mockClient({ data: { id: "education-uuid", resume_id: "resume-uuid" }, error: null });
    await createResumeRepository(removal.client).deleteEducationEntry!("resume-uuid", "education-uuid");
    expect(removal.operations[0]).toMatchObject({ table: "resume_education_entries", operation: "delete", filters: [["resume_id", "resume-uuid"], ["id", "education-uuid"]] });
  });
});
