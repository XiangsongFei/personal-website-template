import type { SupabaseClient } from "@supabase/supabase-js";
import type { FocusItem, LinksSection, Locale, ProjectItem, StatusItem } from "../model";

type Row = Record<string, unknown>;
type OrderedParent = { resumeId: string; entryId: string; position: number; sourceKey: string | null; statusType?: StatusItem["statusType"] };
type Translation<K> = { resumeId: string; entryId: string; locale: Locale; translation: K };
type MethodRow = { resumeId: string; projectId: string; methodId: string; locale: Locale; position: number; value: string };
const tableSpec = {
  focus: { parent: "resume_contact_focus_items", translations: "resume_contact_focus_translations", fk: "focus_item_id" },
  status: { parent: "resume_contact_status_items", translations: "resume_contact_status_translations", fk: "status_item_id" },
} as const;
type ContactEntryKind = keyof typeof tableSpec;

function assertIdentity(resumeId: string, id?: string): void { if (!resumeId || (id !== undefined && !id)) throw new Error("Invalid resume mutation identity"); }
function validateLocale(locale: Locale): void { if (locale !== "zh" && locale !== "en") throw new Error("Invalid resume locale"); }
function checkedRow(data: Row | null, resumeId: string, id?: string): Row {
  if (!data || data.resume_id !== resumeId || (id !== undefined && data.id !== id)) throw new Error("Production write was not confirmed");
  return data;
}
function parseParent(row: Row, resumeId: string, hasSourceKey: boolean): OrderedParent {
  if (!Number.isInteger(row.position) || (row.position as number) < 0
    || (hasSourceKey && row.source_key !== null && typeof row.source_key !== "string")) throw new Error("Invalid production parent response");
  return { resumeId, entryId: String(row.id), position: row.position as number, sourceKey: hasSourceKey ? row.source_key as string | null : null,
    ...(typeof row.status_type === "string" ? { statusType: row.status_type as StatusItem["statusType"] } : {}) };
}
function translationPayload(section: "projects" | ContactEntryKind, value: ProjectItem["translations"][Locale] | FocusItem["translations"][Locale] | StatusItem["translations"][Locale]): Row {
  if (section === "projects") {
    const v = value as ProjectItem["translations"][Locale];
    return { title: v.title, subtitle: v.subtitle, period: v.period, description: v.description, href: v.href };
  }
  const v = value as FocusItem["translations"][Locale];
  return { title: v.title, detail: v.detail };
}
function parseTranslation(section: "projects" | ContactEntryKind, row: Row, resumeId: string, id: string, locale: Locale): Translation<ProjectItem["translations"][Locale] | FocusItem["translations"][Locale]> {
  const fk = section === "projects" ? "project_entry_id" : tableSpec[section].fk;
  if (row.resume_id !== resumeId || row[fk] !== id || row.locale !== locale) throw new Error("Invalid production translation response");
  const content = section === "projects"
    ? { title: row.title, subtitle: row.subtitle, period: row.period, description: row.description, href: row.href }
    : { title: row.title, detail: row.detail };
  if (Object.values(content).some(value => typeof value !== "string")) throw new Error("Invalid production translation response");
  return { resumeId, entryId: id, locale, translation: content as ProjectItem["translations"][Locale] };
}
async function persistTranslation(client: SupabaseClient, section: "projects" | ContactEntryKind, resumeId: string, id: string, locale: Locale, value: ProjectItem["translations"][Locale] | FocusItem["translations"][Locale], operation: "insert" | "update"): Promise<Translation<ProjectItem["translations"][Locale] | FocusItem["translations"][Locale]>> {
  assertIdentity(resumeId, id); validateLocale(locale);
  const table = section === "projects" ? "resume_project_translations" : tableSpec[section].translations;
  const fk = section === "projects" ? "project_entry_id" : tableSpec[section].fk;
  const fields = translationPayload(section, value);
  let mode = operation;
  if (operation === "update") {
    const { data, error } = await client.from(table).select("*").eq("resume_id", resumeId).eq(fk, id).eq("locale", locale).maybeSingle();
    if (error) throw new Error(`Unable to verify ${section} ${locale} translation`);
    if (!data) mode = "insert";
  }
  const query = mode === "insert"
    ? client.from(table).insert({ resume_id: resumeId, [fk]: id, locale, ...fields }).select("*").single()
    : client.from(table).update(fields).eq("resume_id", resumeId).eq(fk, id).eq("locale", locale).select("*").single();
  const { data, error } = await query;
  if (error) throw new Error(`${section} ${locale} translation write failed`);
  return parseTranslation(section, checkedRow(data, resumeId), resumeId, id, locale);
}

export function createBatch6BRepositoryWrites(client: SupabaseClient) {
  async function updatePosition(kind: "projects" | ContactEntryKind, resumeId: string, id: string, position: number): Promise<OrderedParent> {
    assertIdentity(resumeId, id); if (!Number.isInteger(position) || position < 0) throw new Error("Invalid position");
    const table = kind === "projects" ? "resume_project_entries" : tableSpec[kind].parent;
    const { data, error } = await client.from(table).update({ position }).eq("resume_id", resumeId).eq("id", id).select("*").single();
    if (error) throw new Error(`${kind} reorder was not confirmed`);
    return parseParent(checkedRow(data, resumeId, id), resumeId, kind === "projects");
  }
  async function insertParent(kind: "projects" | ContactEntryKind, resumeId: string, position: number, statusType?: StatusItem["statusType"]): Promise<OrderedParent> {
    assertIdentity(resumeId); if (!Number.isInteger(position) || position < 0) throw new Error("Invalid position");
    const table = kind === "projects" ? "resume_project_entries" : tableSpec[kind].parent;
    const values: Row = { resume_id: resumeId, position };
    if (kind === "projects") values.source_key = null;
    if (kind === "status") values.status_type = statusType ?? "open";
    const { data, error } = await client.from(table).insert(values).select("*").single();
    if (error || !data || typeof data.id !== "string" || !data.id) throw new Error(`${kind} parent creation was not confirmed; verify production before retrying`);
    return parseParent(checkedRow(data, resumeId), resumeId, kind === "projects");
  }
  async function deleteTranslation(kind: "projects" | ContactEntryKind, resumeId: string, id: string, locale: Locale): Promise<void> {
    assertIdentity(resumeId, id); validateLocale(locale);
    const table = kind === "projects" ? "resume_project_translations" : tableSpec[kind].translations;
    const fk = kind === "projects" ? "project_entry_id" : tableSpec[kind].fk;
    const { error } = await client.from(table).delete().eq("resume_id", resumeId).eq(fk, id).eq("locale", locale);
    if (error) throw new Error(`${kind} translation delete failed`);
  }
  async function deleteParent(kind: "projects" | ContactEntryKind, resumeId: string, id: string): Promise<void> {
    assertIdentity(resumeId, id);
    const table = kind === "projects" ? "resume_project_entries" : tableSpec[kind].parent;
    const { data, error } = await client.from(table).delete().eq("resume_id", resumeId).eq("id", id).select("id,resume_id").single();
    if (error) throw new Error(`${kind} delete was not confirmed`);
    checkedRow(data, resumeId, id);
  }
  return {
    updateProjectPosition: (resumeId: string, id: string, position: number) => updatePosition("projects", resumeId, id, position),
    insertProject: (resumeId: string, position: number) => insertParent("projects", resumeId, position),
    updateProjectTranslation: (resumeId: string, id: string, locale: Locale, value: ProjectItem["translations"][Locale]) => persistTranslation(client, "projects", resumeId, id, locale, value, "update"),
    insertProjectTranslation: (resumeId: string, id: string, locale: Locale, value: ProjectItem["translations"][Locale]) => persistTranslation(client, "projects", resumeId, id, locale, value, "insert"),
    readProjectTranslation: async (resumeId: string, id: string, locale: Locale) => {
      const { data, error } = await client.from("resume_project_translations").select("*").eq("resume_id", resumeId).eq("project_entry_id", id).eq("locale", locale).maybeSingle();
      if (error) throw new Error("Unable to verify project translation");
      return data ? parseTranslation("projects", data, resumeId, id, locale) : null;
    },
    deleteProjectTranslation: (resumeId: string, id: string, locale: Locale) => deleteTranslation("projects", resumeId, id, locale),
    deleteProject: async (resumeId: string, id: string) => {
      const { error } = await client.from("resume_project_methods").delete().eq("resume_id", resumeId).eq("project_entry_id", id);
      if (error) throw new Error("Project methods could not be deleted");
      await deleteTranslation("projects", resumeId, id, "zh"); await deleteTranslation("projects", resumeId, id, "en"); await deleteParent("projects", resumeId, id);
    },
    updateProjectMethod: async (resumeId: string, projectId: string, methodId: string, locale: Locale, changes: { value?: string; position?: number }): Promise<MethodRow> => {
      assertIdentity(resumeId, projectId); assertIdentity(resumeId, methodId); validateLocale(locale);
      if (!Object.keys(changes).length || (changes.position !== undefined && (!Number.isInteger(changes.position) || changes.position < 0)) || (changes.value !== undefined && typeof changes.value !== "string")) throw new Error("Invalid project method update");
      const { data, error } = await client.from("resume_project_methods").update(changes).eq("resume_id", resumeId).eq("project_entry_id", projectId).eq("id", methodId).eq("locale", locale).select("*").single();
      if (error || !data || data.resume_id !== resumeId || data.project_entry_id !== projectId || data.locale !== locale || typeof data.value !== "string" || !Number.isInteger(data.position)) throw new Error("Project method update was not confirmed");
      return { resumeId, projectId, methodId, locale, position: data.position as number, value: data.value };
    },
    insertProjectMethod: async (resumeId: string, projectId: string, locale: Locale, position: number, value: string): Promise<MethodRow> => {
      assertIdentity(resumeId, projectId); validateLocale(locale); if (!Number.isInteger(position) || position < 0 || typeof value !== "string") throw new Error("Invalid new project method");
      const { data, error } = await client.from("resume_project_methods").insert({ resume_id: resumeId, project_entry_id: projectId, locale, position, value }).select("*").single();
      if (error || !data || typeof data.id !== "string" || data.resume_id !== resumeId || data.project_entry_id !== projectId || data.locale !== locale || !Number.isInteger(data.position) || typeof data.value !== "string") throw new Error("Project method creation was not confirmed; verify production before retrying");
      return { resumeId, projectId, methodId: data.id, locale, position: data.position as number, value: data.value };
    },
    readProjectMethodByPosition: async (resumeId: string, projectId: string, locale: Locale, position: number, value: string): Promise<MethodRow | null> => {
      assertIdentity(resumeId, projectId); validateLocale(locale);
      const { data, error } = await client.from("resume_project_methods").select("id,resume_id,project_entry_id,locale,position,value").eq("resume_id", resumeId).eq("project_entry_id", projectId).eq("locale", locale).eq("position", position).eq("value", value).maybeSingle();
      if (error) throw new Error("Unable to verify project method creation");
      if (!data) return null;
      if (typeof data.id !== "string" || data.resume_id !== resumeId || data.project_entry_id !== projectId || data.locale !== locale || data.position !== position || data.value !== value) throw new Error("Invalid project method recovery response");
      return { resumeId, projectId, methodId: data.id, locale, position, value };
    },
    deleteProjectMethod: async (resumeId: string, projectId: string, methodId: string, locale: Locale): Promise<void> => {
      assertIdentity(resumeId, projectId); assertIdentity(resumeId, methodId); validateLocale(locale);
      const { error } = await client.from("resume_project_methods").delete().eq("resume_id", resumeId).eq("project_entry_id", projectId).eq("id", methodId).eq("locale", locale);
      if (error) throw new Error("Project method delete failed");
    },
    updateFocusPosition: (resumeId: string, id: string, position: number) => updatePosition("focus", resumeId, id, position),
    insertFocus: (resumeId: string, position: number) => insertParent("focus", resumeId, position),
    updateFocusTranslation: (resumeId: string, id: string, locale: Locale, value: FocusItem["translations"][Locale]) => persistTranslation(client, "focus", resumeId, id, locale, value, "update"),
    insertFocusTranslation: (resumeId: string, id: string, locale: Locale, value: FocusItem["translations"][Locale]) => persistTranslation(client, "focus", resumeId, id, locale, value, "insert"),
    readFocusTranslation: async (resumeId: string, id: string, locale: Locale) => { const { data, error } = await client.from(tableSpec.focus.translations).select("*").eq("resume_id", resumeId).eq("focus_item_id", id).eq("locale", locale).maybeSingle(); if (error) throw new Error("Unable to verify Focus translation"); return data ? parseTranslation("focus", data, resumeId, id, locale) : null; },
    deleteFocusTranslation: (resumeId: string, id: string, locale: Locale) => deleteTranslation("focus", resumeId, id, locale),
    deleteFocus: async (resumeId: string, id: string) => { await deleteTranslation("focus", resumeId, id, "zh"); await deleteTranslation("focus", resumeId, id, "en"); await deleteParent("focus", resumeId, id); },
    updateStatusPosition: (resumeId: string, id: string, position: number) => updatePosition("status", resumeId, id, position),
    updateStatusType: async (resumeId: string, id: string, statusType: StatusItem["statusType"]) => { assertIdentity(resumeId, id); if (!["study", "graduation", "open"].includes(statusType)) throw new Error("Invalid status type"); const { data, error } = await client.from(tableSpec.status.parent).update({ status_type: statusType }).eq("resume_id", resumeId).eq("id", id).select("id,resume_id,status_type").single(); if (error || !data || data.id !== id || data.resume_id !== resumeId || data.status_type !== statusType) throw new Error("Status type save was not confirmed"); },
    insertStatus: (resumeId: string, position: number, statusType: StatusItem["statusType"]) => insertParent("status", resumeId, position, statusType),
    updateStatusTranslation: (resumeId: string, id: string, locale: Locale, value: StatusItem["translations"][Locale]) => persistTranslation(client, "status", resumeId, id, locale, value, "update"),
    insertStatusTranslation: (resumeId: string, id: string, locale: Locale, value: StatusItem["translations"][Locale]) => persistTranslation(client, "status", resumeId, id, locale, value, "insert"),
    readStatusTranslation: async (resumeId: string, id: string, locale: Locale) => { const { data, error } = await client.from(tableSpec.status.translations).select("*").eq("resume_id", resumeId).eq("status_item_id", id).eq("locale", locale).maybeSingle(); if (error) throw new Error("Unable to verify Status translation"); return data ? parseTranslation("status", data, resumeId, id, locale) : null; },
    deleteStatusTranslation: (resumeId: string, id: string, locale: Locale) => deleteTranslation("status", resumeId, id, locale),
    deleteStatus: async (resumeId: string, id: string) => { await deleteTranslation("status", resumeId, id, "zh"); await deleteTranslation("status", resumeId, id, "en"); await deleteParent("status", resumeId, id); },
    updateContactAvailability: async (resumeId: string, locale: Locale, availability: string) => {
      assertIdentity(resumeId); validateLocale(locale); if (locale === "zh") throw new Error("Chinese availability remains read-only");
      const { data, error } = await client.from("resume_locale_content").update({ availability }).eq("resume_id", resumeId).eq("locale", locale).select("resume_id,locale,availability").single();
      if (error || !data || data.resume_id !== resumeId || data.locale !== locale || data.availability !== availability) throw new Error("Contact availability save was not confirmed");
    },
    updateContactLabel: async (resumeId: string, locale: Locale, contactLabel: string) => {
      assertIdentity(resumeId); validateLocale(locale); if (typeof contactLabel !== "string") throw new Error("Invalid Contact label");
      const { data, error } = await client.from("resume_locale_content").update({ contact_label: contactLabel }).eq("resume_id", resumeId).eq("locale", locale).select("resume_id,locale,contact_label").single();
      if (error || !data || data.resume_id !== resumeId || data.locale !== locale || data.contact_label !== contactLabel) throw new Error("Contact text save was not confirmed");
      return { resumeId, locale, contactLabel };
    },
    updatePublicLinks: async (resumeId: string, values: Partial<LinksSection["shared"]>) => {
      assertIdentity(resumeId);
      const keys: Record<keyof LinksSection["shared"], string> = { email: "email", github: "github", githubLabel: "github_label", linkedInDisplayName: "linkedin_display_name", emailLabel: "email_label", linkedInLabel: "linkedin_label" };
      const payload: Row = {}; for (const key of Object.keys(values) as (keyof LinksSection["shared"])[]) { if (typeof values[key] !== "string") throw new Error("Invalid public link value"); payload[keys[key]] = values[key]; }
      if (!Object.keys(payload).length) return;
      const { data, error } = await client.from("resume_public_links").update(payload).eq("resume_id", resumeId).select("resume_id").single();
      if (error || data?.resume_id !== resumeId) throw new Error("Public link save was not confirmed");
    },
    updateSiteText: async (resumeId: string, locale: Locale, values: Partial<LinksSection["translations"][Locale]>) => {
      assertIdentity(resumeId); validateLocale(locale);
      const keys: Record<keyof LinksSection["translations"][Locale], string> = { educationLabel: "education_label", experienceLabel: "experience_label", projectHeading: "project_heading", skillsLabel: "skills_label", honorsLabel: "honors_label", portfolioLabel: "portfolio_label", portfolioHref: "portfolio_href", kaggleLabel: "kaggle_label", updatedAtLabel: "updated_at_label", linkedInLabel: "linkedin_label", linkedInHref: "linkedin_href" };
      const payload: Row = {}; for (const key of Object.keys(values) as (keyof LinksSection["translations"][Locale])[]) { if (typeof values[key] !== "string") throw new Error("Invalid site text value"); payload[keys[key]] = values[key]; }
      if (!Object.keys(payload).length) return;
      const { data, error } = await client.from("resume_locale_content").update(payload).eq("resume_id", resumeId).eq("locale", locale).select("resume_id,locale").single();
      if (error || data?.resume_id !== resumeId || data.locale !== locale) throw new Error("Site text save was not confirmed");
    },
    updateNavigationLabel: async (resumeId: string, id: string, locale: Locale, label: string) => {
      assertIdentity(resumeId, id); validateLocale(locale); if (typeof label !== "string") throw new Error("Invalid navigation label");
      const { data, error } = await client.from("resume_navigation_item_translations").update({ label }).eq("resume_id", resumeId).eq("navigation_item_id", id).eq("locale", locale).select("resume_id,navigation_item_id,locale,label").single();
      if (error || !data || data.resume_id !== resumeId || data.navigation_item_id !== id || data.locale !== locale || data.label !== label) throw new Error("Navigation label save was not confirmed");
    },
  };
}

export type Batch6BWriteRepository = ReturnType<typeof createBatch6BRepositoryWrites>;
