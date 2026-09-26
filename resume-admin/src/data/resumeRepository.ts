import type { SupabaseClient } from "@supabase/supabase-js";
import { createBatch6BRepositoryWrites, type Batch6BWriteRepository } from "./resumeBatch6bRepository";
import {
  mapAwardRows, mapContactRows, mapEducationRows, mapExperienceRows, mapIntroductionRows,
  mapLinksRows, mapOverviewRows, mapProfileRows, mapProjectRows, mapResumeRows, mapResumeSiteMetadata,
  mapSkillRows, type LoadedResume, type OverviewResumeData, type ResumeRows, type ResumeSiteMetadata, type ResumeTable,
} from "./resumeMapper";
import type {
  AwardItem, ContactSection, EducationItem, ExperienceItem, IntroItem, LinksSection,
  Locale, ProfileSection, ProfileTranslation, ProjectItem, SkillItem,
} from "../model";

export const resumeTables = [
  "resume_profile", "resume_profile_translations", "resume_public_links", "resume_locale_content",
  "resume_intro_paragraphs", "resume_intro_paragraph_translations",
  "resume_navigation_items", "resume_navigation_item_translations",
  "resume_education_entries", "resume_education_translations",
  "resume_experience_entries", "resume_experience_translations",
  "resume_project_entries", "resume_project_translations", "resume_project_methods",
  "resume_skill_groups", "resume_skill_group_translations",
  "resume_award_entries", "resume_award_translations",
  "resume_contact_focus_items", "resume_contact_focus_translations",
  "resume_contact_status_items", "resume_contact_status_translations",
] as const satisfies readonly ResumeTable[];

export interface ResumeRepository extends Partial<Batch6BWriteRepository> {
  load(): Promise<LoadedResume>;
  updateProfileSharedDetails(resumeId: string, shared: ProfileSection["shared"]): Promise<UpdatedProfileRow>;
  updateProfileTranslation(resumeId: string, locale: Locale, translation: ProfileTranslation): Promise<UpdatedProfileTranslationRow>;
  updateEducationEntry?(resumeId: string, entryId: string, changes: Partial<Pick<EducationItem, "position" | "entryType">>): Promise<UpdatedEducationEntryRow>;
  updateEducationTranslation?(resumeId: string, entryId: string, locale: Locale, translation: EducationItem["translations"][Locale]): Promise<UpdatedEducationTranslationRow>;
  insertEducationEntry?(resumeId: string, position: number, entryType: EducationItem["entryType"]): Promise<UpdatedEducationEntryRow>;
  insertEducationTranslation?(resumeId: string, entryId: string, locale: Locale, translation: EducationItem["translations"][Locale]): Promise<UpdatedEducationTranslationRow>;
  readEducationTranslation?(resumeId: string, entryId: string, locale: Locale): Promise<UpdatedEducationTranslationRow | null>;
  deleteEducationEntry?(resumeId: string, entryId: string): Promise<void>;
  updateEditableEntryPosition?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, position: number): Promise<EditableEntryRow>;
  insertEditableEntry?<K extends EditableRepeatableSection>(section: K, resumeId: string, position: number): Promise<EditableEntryRow>;
  updateEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale, translation: EditableTranslation<K>): Promise<EditableTranslationRow<K>>;
  insertEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale, translation: EditableTranslation<K>): Promise<EditableTranslationRow<K>>;
  readEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale): Promise<EditableTranslationRow<K> | null>;
  deleteEditableTranslation?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string, locale: Locale): Promise<void>;
  deleteEditableEntry?<K extends EditableRepeatableSection>(section: K, resumeId: string, entryId: string): Promise<void>;
}

/** Additional typed reads for future route-first loading; the current loader still calls load(). */
export interface ResumeSectionRepository {
  loadSiteMetadata(): Promise<ResumeSiteMetadata>;
  loadOverview(resumeId: string): Promise<OverviewResumeData>;
  loadProfile(resumeId: string): Promise<ProfileSection>;
  loadIntroduction(resumeId: string): Promise<IntroItem[]>;
  loadEducation(resumeId: string): Promise<EducationItem[]>;
  loadExperience(resumeId: string): Promise<ExperienceItem[]>;
  loadProjects(resumeId: string): Promise<ProjectItem[]>;
  loadSkills(resumeId: string): Promise<SkillItem[]>;
  loadAwards(resumeId: string): Promise<AwardItem[]>;
  loadContact(resumeId: string): Promise<ContactSection>;
  loadLinks(resumeId: string): Promise<LinksSection>;
}

export type CompleteResumeRepository = ResumeRepository & ResumeSectionRepository;

export type UpdatedProfileRow = {
  resumeId: string;
  shared: ProfileSection["shared"];
  updatedAt: string | null;
};

export type UpdatedProfileTranslationRow = {
  resumeId: string;
  locale: Locale;
  translation: ProfileTranslation;
  updatedAt: string | null;
};

export type UpdatedEducationEntryRow = { resumeId: string; entryId: string; position: number; entryType: EducationItem["entryType"]; sourceKey: string | null };
export type UpdatedEducationTranslationRow = { resumeId: string; entryId: string; locale: Locale; translation: EducationItem["translations"][Locale] };

export type EditableRepeatableSection = "introduction" | "experience" | "projects" | "skills" | "awards";
type EditableSectionItem = { introduction: IntroItem; experience: ExperienceItem; projects: ProjectItem; skills: SkillItem; awards: AwardItem };
export type EditableTranslation<K extends EditableRepeatableSection> = EditableSectionItem[K]["translations"][Locale];
export type EditableEntryRow = { resumeId: string; entryId: string; position: number; sourceKey: string | null };
export type EditableTranslationRow<K extends EditableRepeatableSection> = {
  resumeId: string; entryId: string; locale: Locale; translation: EditableTranslation<K>;
};

function rows(value: unknown, table: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`Invalid ${table} response`);
  }
  return value as Record<string, unknown>[];
}

async function readSiteRow(supabase: SupabaseClient): Promise<Record<string, unknown>> {
  const { data: site, error } = await supabase
    .from("resume_sites").select("*").eq("site_key", "example-cv").maybeSingle();
  if (error) throw new Error("Unable to load target resume site");
  if (!site || typeof site.id !== "string" || site.site_key !== "example-cv") throw new Error("Target resume site not found");
  return site;
}

async function readResumeRows(supabase: SupabaseClient, table: ResumeTable, resumeId: string): Promise<Record<string, unknown>[]> {
  if (typeof resumeId !== "string" || !resumeId) throw new Error("Missing resume ID");
  const { data, error } = await supabase.from(table).select("*").eq("resume_id", resumeId);
  if (error) throw new Error(`Unable to load ${table}`);
  return rows(data, table);
}

/** Site-scoped reads plus the explicitly allowlisted Profile and Education write paths. */
export function createResumeRepository(supabase: SupabaseClient): CompleteResumeRepository {
  return {
    ...createEditableSectionWrites(supabase),
    ...createBatch6BRepositoryWrites(supabase),
    async load() {
      const site = await readSiteRow(supabase);
      const resumeId = site.id as string;
      const children = await Promise.all(resumeTables.map(async table => {
        return [table, await readResumeRows(supabase, table, resumeId)] as const;
      }));
      return mapResumeRows({ resume_sites: [site], ...Object.fromEntries(children) } as ResumeRows);
    },
    async loadSiteMetadata() {
      return mapResumeSiteMetadata(await readSiteRow(supabase));
    },
    async loadOverview(resumeId) {
      return mapOverviewRows(await readResumeRows(supabase, "resume_profile_translations", resumeId), resumeId);
    },
    async loadProfile(resumeId) {
      const [profile, translations] = await Promise.all([
        readResumeRows(supabase, "resume_profile", resumeId),
        readResumeRows(supabase, "resume_profile_translations", resumeId),
      ]);
      return mapProfileRows(profile, translations, resumeId);
    },
    async loadIntroduction(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_intro_paragraphs", resumeId),
        readResumeRows(supabase, "resume_intro_paragraph_translations", resumeId),
      ]);
      return mapIntroductionRows(parents, translations, resumeId);
    },
    async loadEducation(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_education_entries", resumeId),
        readResumeRows(supabase, "resume_education_translations", resumeId),
      ]);
      return mapEducationRows(parents, translations, resumeId);
    },
    async loadExperience(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_experience_entries", resumeId),
        readResumeRows(supabase, "resume_experience_translations", resumeId),
      ]);
      return mapExperienceRows(parents, translations, resumeId);
    },
    async loadProjects(resumeId) {
      const [parents, translations, methods] = await Promise.all([
        readResumeRows(supabase, "resume_project_entries", resumeId),
        readResumeRows(supabase, "resume_project_translations", resumeId),
        readResumeRows(supabase, "resume_project_methods", resumeId),
      ]);
      return mapProjectRows(parents, translations, methods, resumeId);
    },
    async loadSkills(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_skill_groups", resumeId),
        readResumeRows(supabase, "resume_skill_group_translations", resumeId),
      ]);
      return mapSkillRows(parents, translations, resumeId);
    },
    async loadAwards(resumeId) {
      const [parents, translations] = await Promise.all([
        readResumeRows(supabase, "resume_award_entries", resumeId),
        readResumeRows(supabase, "resume_award_translations", resumeId),
      ]);
      return mapAwardRows(parents, translations, resumeId);
    },
    async loadContact(resumeId) {
      const [localeContent, focus, focusTranslations, status, statusTranslations] = await Promise.all([
        readResumeRows(supabase, "resume_locale_content", resumeId),
        readResumeRows(supabase, "resume_contact_focus_items", resumeId),
        readResumeRows(supabase, "resume_contact_focus_translations", resumeId),
        readResumeRows(supabase, "resume_contact_status_items", resumeId),
        readResumeRows(supabase, "resume_contact_status_translations", resumeId),
      ]);
      return mapContactRows(localeContent, focus, focusTranslations, status, statusTranslations, resumeId);
    },
    async loadLinks(resumeId) {
      const [links, localeContent, navigation, navigationTranslations] = await Promise.all([
        readResumeRows(supabase, "resume_public_links", resumeId),
        readResumeRows(supabase, "resume_locale_content", resumeId),
        readResumeRows(supabase, "resume_navigation_items", resumeId),
        readResumeRows(supabase, "resume_navigation_item_translations", resumeId),
      ]);
      return mapLinksRows(links, localeContent, navigation, navigationTranslations, resumeId);
    },
    async updateProfileSharedDetails(resumeId, shared) {
      if (typeof resumeId !== "string" || !resumeId) throw new Error("Missing resume ID");
      if (!shared || typeof shared.graduationValue !== "string" || typeof shared.avatarInitials !== "string"
        || (shared.photoUrl !== null && (typeof shared.photoUrl !== "string" || !/^https?:\/\//i.test(shared.photoUrl)))
        || typeof shared.footerName !== "string" || typeof shared.copyright !== "string") {
        throw new Error("Invalid shared profile details");
      }
      const payload = {
        graduation_value: shared.graduationValue,
        avatar_initials: shared.avatarInitials,
        photo_url: shared.photoUrl,
        footer_name: shared.footerName,
        copyright: shared.copyright,
      };
      const { data, error } = await supabase.from("resume_profile")
        .update(payload).eq("resume_id", resumeId)
        .select("resume_id,graduation_value,avatar_initials,photo_url,footer_name,copyright,updated_at").single();
      if (error || !data || data.resume_id !== resumeId) throw new Error("Profile save was not confirmed");
      if (typeof data.graduation_value !== "string" || typeof data.avatar_initials !== "string"
        || (data.photo_url !== null && (typeof data.photo_url !== "string" || !/^https?:\/\//i.test(data.photo_url)))
        || typeof data.footer_name !== "string" || typeof data.copyright !== "string") {
        throw new Error("Invalid profile save response");
      }
      return {
        resumeId,
        shared: {
          graduationValue: data.graduation_value,
          avatarInitials: data.avatar_initials,
          photoUrl: data.photo_url,
          footerName: data.footer_name,
          copyright: data.copyright,
        },
        updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
      };
    },
    async updateProfileTranslation(resumeId, locale, translation) {
      if (typeof resumeId !== "string" || !resumeId) throw new Error("Missing resume ID");
      if (locale !== "zh" && locale !== "en") throw new Error("Invalid profile locale");
      if (!translation || typeof translation.name !== "string" || typeof translation.navAboutLabel !== "string"
        || typeof translation.emailActionLabel !== "string" || typeof translation.graduationLabel !== "string"
        || typeof translation.avatarLabel !== "string" || typeof translation.contactFocusHeading !== "string"
        || typeof translation.contactStatusHeading !== "string") {
        throw new Error("Invalid profile translation");
      }
      const payload = {
        name: translation.name,
        nav_about_label: translation.navAboutLabel,
        email_action_label: translation.emailActionLabel,
        graduation_label: translation.graduationLabel,
        avatar_label: translation.avatarLabel,
        contact_focus_heading: translation.contactFocusHeading,
        contact_status_heading: translation.contactStatusHeading,
      };
      const { data, error } = await supabase.from("resume_profile_translations")
        .update(payload).eq("resume_id", resumeId).eq("locale", locale)
        .select("resume_id,locale,name,nav_about_label,email_action_label,graduation_label,avatar_label,contact_focus_heading,contact_status_heading,updated_at").single();
      if (error || !data || data.resume_id !== resumeId || data.locale !== locale) {
        throw new Error("Profile translation save was not confirmed");
      }
      if (typeof data.name !== "string" || typeof data.nav_about_label !== "string"
        || typeof data.email_action_label !== "string" || typeof data.graduation_label !== "string"
        || typeof data.avatar_label !== "string" || typeof data.contact_focus_heading !== "string"
        || typeof data.contact_status_heading !== "string") {
        throw new Error("Invalid profile translation response");
      }
      return {
        resumeId,
        locale,
        translation: {
          name: data.name,
          navAboutLabel: data.nav_about_label,
          emailActionLabel: data.email_action_label,
          graduationLabel: data.graduation_label,
          avatarLabel: data.avatar_label,
          contactFocusHeading: data.contact_focus_heading,
          contactStatusHeading: data.contact_status_heading,
        },
        updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
      };
    },
    async updateEducationEntry(resumeId, entryId, changes) {
      if (!resumeId || !entryId || !changes || Object.keys(changes).length === 0
        || (changes.position !== undefined && (!Number.isInteger(changes.position) || changes.position < 0))
        || (changes.entryType !== undefined && changes.entryType !== "standard" && changes.entryType !== "summerSchool")) {
        throw new Error("Invalid Education entry update");
      }
      const payload: Record<string, unknown> = {};
      if (changes.position !== undefined) payload.position = changes.position;
      if (changes.entryType !== undefined) payload.entry_type = changes.entryType;
      const { data, error } = await supabase.from("resume_education_entries").update(payload)
        .eq("resume_id", resumeId).eq("id", entryId)
        .select("id,resume_id,source_key,position,entry_type").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId) throw new Error("Education entry save was not confirmed");
      if (!Number.isInteger(data.position) || (data.entry_type !== "standard" && data.entry_type !== "summerSchool")
        || (data.source_key !== null && typeof data.source_key !== "string")) throw new Error("Invalid Education entry save response");
      return { resumeId, entryId, position: data.position as number, entryType: data.entry_type, sourceKey: data.source_key };
    },
    async updateEducationTranslation(resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid Education translation identity");
      validateEducationTranslation(translation);
      const payload: Record<string, unknown> = {
        title: translation.title, program: translation.program, period: translation.period, grade: translation.grade,
        course_title: translation.courseTitle, course_description: translation.courseDescription,
      };
      // This field remains read-only in Chinese because the public renderer has phrase-specific markup.
      if (locale === "zh") delete payload.course_description;
      return persistEducationTranslation(supabase, "update", resumeId, entryId, locale, payload);
    },
    async insertEducationEntry(resumeId, position, entryType) {
      if (!resumeId || !Number.isInteger(position) || position < 0 || (entryType !== "standard" && entryType !== "summerSchool")) {
        throw new Error("Invalid new Education entry");
      }
      const { data, error } = await supabase.from("resume_education_entries")
        .insert({ resume_id: resumeId, position, entry_type: entryType, source_key: null })
        .select("id,resume_id,source_key,position,entry_type").single();
      if (error || !data || typeof data.id !== "string" || !data.id || data.resume_id !== resumeId) throw new Error("Education parent creation was not confirmed; verify production before retrying");
      if (!Number.isInteger(data.position) || (data.entry_type !== "standard" && data.entry_type !== "summerSchool")
        || (data.source_key !== null && typeof data.source_key !== "string")) throw new Error("Invalid Education parent creation response");
      return { resumeId, entryId: data.id, position: data.position as number, entryType: data.entry_type, sourceKey: data.source_key };
    },
    async insertEducationTranslation(resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid Education translation identity");
      validateEducationTranslation(translation);
      const payload: Record<string, unknown> = {
        resume_id: resumeId, education_entry_id: entryId, locale, title: translation.title,
        program: translation.program, period: translation.period, grade: translation.grade,
        course_title: translation.courseTitle, course_description: translation.courseDescription,
      };
      return persistEducationTranslation(supabase, "insert", resumeId, entryId, locale, payload);
    },
    async readEducationTranslation(resumeId, entryId, locale) {
      const { data, error } = await supabase.from("resume_education_translations").select("*")
        .eq("resume_id", resumeId).eq("education_entry_id", entryId).eq("locale", locale).maybeSingle();
      if (error) throw new Error("Unable to verify Education translation state");
      if (!data) return null;
      return parseEducationTranslation(data, resumeId, entryId, locale);
    },
    async deleteEducationEntry(resumeId, entryId) {
      if (!resumeId || !entryId) throw new Error("Invalid Education delete identity");
      const { data, error } = await supabase.from("resume_education_entries").delete()
        .eq("resume_id", resumeId).eq("id", entryId).select("id,resume_id").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId) throw new Error("Education delete was not confirmed");
    },
  };
}

type EditableTableSpec = { parent: string; translations: string; foreignKey: string; sourceKey: boolean };
const editableTables: Record<EditableRepeatableSection, EditableTableSpec> = {
  introduction: { parent: "resume_intro_paragraphs", translations: "resume_intro_paragraph_translations", foreignKey: "paragraph_id", sourceKey: false },
  experience: { parent: "resume_experience_entries", translations: "resume_experience_translations", foreignKey: "experience_entry_id", sourceKey: true },
  skills: { parent: "resume_skill_groups", translations: "resume_skill_group_translations", foreignKey: "skill_group_id", sourceKey: true },
  awards: { parent: "resume_award_entries", translations: "resume_award_translations", foreignKey: "award_entry_id", sourceKey: true },
  projects: { parent: "resume_project_entries", translations: "resume_project_translations", foreignKey: "project_entry_id", sourceKey: true },
};

function editablePayload<K extends EditableRepeatableSection>(section: K, value: EditableTranslation<K>): Record<string, unknown> {
  switch (section) {
    case "introduction": return { text: (value as IntroItem["translations"][Locale]).text };
    case "experience": {
      const translation = value as ExperienceItem["translations"][Locale];
      return { organization: translation.organization, title: translation.title, period: translation.period,
        description: translation.description, location: translation.location };
    }
    case "skills": {
      const translation = value as SkillItem["translations"][Locale]; return { title: translation.title, items: translation.items };
    }
    case "awards": {
      const translation = value as AwardItem["translations"][Locale]; return { name: translation.name, year: translation.year };
    }
    case "projects": { const translation = value as ProjectItem["translations"][Locale]; return { title: translation.title, subtitle: translation.subtitle, period: translation.period, description: translation.description, href: translation.href }; }
  }
}

function parseEditableTranslation<K extends EditableRepeatableSection>(section: K, row: Record<string, unknown>, resumeId: string,
  entryId: string, locale: Locale): EditableTranslationRow<K> {
  const spec = editableTables[section];
  if (row.resume_id !== resumeId || row[spec.foreignKey] !== entryId || row.locale !== locale) throw new Error("Invalid editable translation identity");
  let translation: Record<string, unknown>;
  switch (section) {
    case "introduction":
      translation = { text: row.text };
      break;
    case "experience":
      translation = { organization: row.organization, title: row.title, period: row.period, description: row.description, location: row.location };
      if (translation.location !== null && typeof translation.location !== "string") throw new Error("Invalid Experience location response");
      break;
    case "skills": translation = { title: row.title, items: row.items }; break;
    case "awards": translation = { name: row.name, year: row.year }; break;
    case "projects": translation = { title: row.title, subtitle: row.subtitle, period: row.period, description: row.description, href: row.href }; break;
  }
  if (Object.entries(translation).some(([key, value]) => key !== "location" && typeof value !== "string")) throw new Error("Invalid editable translation response");
  return { resumeId, entryId, locale, translation: translation as EditableTranslation<K> };
}

async function persistEditableTranslation<K extends EditableRepeatableSection>(supabase: SupabaseClient, section: K,
  resumeId: string, entryId: string, locale: Locale, translation: EditableTranslation<K>, operation: "insert" | "update"): Promise<EditableTranslationRow<K>> {
  const spec = editableTables[section];
  const content = editablePayload(section, translation);
  let resolvedOperation = operation;
  if (operation === "update") {
    const { data: existing, error: readError } = await supabase.from(spec.translations).select("*").eq("resume_id", resumeId)
      .eq(spec.foreignKey, entryId).eq("locale", locale).maybeSingle();
    if (readError) throw new Error(`Unable to verify ${section} ${locale} translation state`);
    // Missing locale rows map to empty strings in the editor. Create only that absent locale; never copy the other locale.
    if (!existing) resolvedOperation = "insert";
  }
  const mutation = supabase.from(spec.translations);
  const payload = { resume_id: resumeId, [spec.foreignKey]: entryId, locale, ...content };
  const query = resolvedOperation === "insert"
    ? mutation.insert(payload).select("*").single()
    : mutation.update(content).eq("resume_id", resumeId).eq(spec.foreignKey, entryId).eq("locale", locale).select("*").single();
  const { data, error } = await query;
  if (error || !data) throw new Error(`${section} ${locale} translation ${resolvedOperation === "insert" ? "creation" : "save"} was not confirmed`);
  return parseEditableTranslation(section, data, resumeId, entryId, locale);
}

function createEditableSectionWrites(supabase: SupabaseClient): Pick<ResumeRepository,
  "updateEditableEntryPosition" | "insertEditableEntry" | "updateEditableTranslation" | "insertEditableTranslation"
  | "readEditableTranslation" | "deleteEditableTranslation" | "deleteEditableEntry"> {
  return {
    async updateEditableEntryPosition(section, resumeId, entryId, position) {
      if (!resumeId || !entryId || !Number.isInteger(position) || position < 0) throw new Error("Invalid editable entry position");
      const spec = editableTables[section];
      const { data, error } = await supabase.from(spec.parent).update({ position }).eq("resume_id", resumeId).eq("id", entryId).select("*").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId || data.position !== position) throw new Error("Entry reorder was not confirmed");
      if (spec.sourceKey && data.source_key !== null && typeof data.source_key !== "string") throw new Error("Invalid entry source key response");
      return { resumeId, entryId, position, sourceKey: typeof data.source_key === "string" ? data.source_key : null };
    },
    async insertEditableEntry(section, resumeId, position) {
      if (!resumeId || !Number.isInteger(position) || position < 0) throw new Error("Invalid new editable entry");
      const spec = editableTables[section];
      const payload: Record<string, unknown> = { resume_id: resumeId, position };
      if (spec.sourceKey) payload.source_key = null;
      const { data, error } = await supabase.from(spec.parent).insert(payload).select("*").single();
      if (error || !data || typeof data.id !== "string" || !data.id || data.resume_id !== resumeId || (!Number.isInteger(data.position) || (data.position as number) < 0)) {
        throw new Error("Parent creation was not confirmed; verify production before retrying");
      }
      if (spec.sourceKey && data.source_key !== null && typeof data.source_key !== "string") throw new Error("Invalid new entry source key response");
      return { resumeId, entryId: data.id, position: data.position as number, sourceKey: typeof data.source_key === "string" ? data.source_key : null };
    },
    async updateEditableTranslation(section, resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid editable translation identity");
      return persistEditableTranslation(supabase, section, resumeId, entryId, locale, translation, "update");
    },
    async insertEditableTranslation(section, resumeId, entryId, locale, translation) {
      if (!resumeId || !entryId || (locale !== "zh" && locale !== "en")) throw new Error("Invalid editable translation identity");
      return persistEditableTranslation(supabase, section, resumeId, entryId, locale, translation, "insert");
    },
    async readEditableTranslation(section, resumeId, entryId, locale) {
      const spec = editableTables[section];
      const { data, error } = await supabase.from(spec.translations).select("*").eq("resume_id", resumeId)
        .eq(spec.foreignKey, entryId).eq("locale", locale).maybeSingle();
      if (error) throw new Error(`Unable to verify ${section} ${locale} translation state`);
      return data ? parseEditableTranslation(section, data, resumeId, entryId, locale) : null;
    },
    async deleteEditableTranslation(section, resumeId, entryId, locale) {
      const spec = editableTables[section];
      const { error } = await supabase.from(spec.translations).delete().eq("resume_id", resumeId).eq(spec.foreignKey, entryId).eq("locale", locale);
      if (error) throw new Error(`${section} ${locale} translation delete failed`);
    },
    async deleteEditableEntry(section, resumeId, entryId) {
      const spec = editableTables[section];
      if (section === "projects") { const { error: methodsError } = await supabase.from("resume_project_methods").delete().eq("resume_id", resumeId).eq("project_entry_id", entryId); if (methodsError) throw new Error("Project methods could not be deleted"); }
      const { data, error } = await supabase.from(spec.parent).delete().eq("resume_id", resumeId).eq("id", entryId).select("id,resume_id").single();
      if (error || !data || data.id !== entryId || data.resume_id !== resumeId) throw new Error(`${section} entry delete was not confirmed`);
    },
  };
}

function validateEducationTranslation(value: EducationItem["translations"][Locale]): void {
  if (!value || [value.title, value.program, value.period, value.grade].some(field => typeof field !== "string")
    || (value.courseTitle !== null && typeof value.courseTitle !== "string")
    || (value.courseDescription !== null && typeof value.courseDescription !== "string")) throw new Error("Invalid Education translation");
}

async function persistEducationTranslation(supabase: SupabaseClient, operation: "insert" | "update", resumeId: string,
  entryId: string, locale: Locale, values: Record<string, unknown>): Promise<UpdatedEducationTranslationRow> {
  const selected = "resume_id,education_entry_id,locale,title,program,period,grade,course_title,course_description";
  const mutation = supabase.from("resume_education_translations");
  const query = operation === "insert"
    ? mutation.insert(values).select(selected).single()
    : mutation.update(values).eq("resume_id", resumeId).eq("education_entry_id", entryId).eq("locale", locale).select(selected).single();
  const { data, error } = await query;
  if (error || !data) throw new Error(`Education ${locale} translation save was not confirmed`);
  return parseEducationTranslation(data, resumeId, entryId, locale);
}

function parseEducationTranslation(data: Record<string, unknown>, resumeId: string, entryId: string, locale: Locale): UpdatedEducationTranslationRow {
  if (data.resume_id !== resumeId || data.education_entry_id !== entryId || data.locale !== locale
    || [data.title, data.program, data.period, data.grade].some(value => typeof value !== "string")
    || (data.course_title !== null && typeof data.course_title !== "string")
    || (data.course_description !== null && typeof data.course_description !== "string")) {
    throw new Error("Invalid Education translation response");
  }
  return { resumeId, entryId, locale, translation: {
    title: data.title as string, program: data.program as string, period: data.period as string, grade: data.grade as string,
    courseTitle: data.course_title as string | null, courseDescription: data.course_description as string | null,
  } };
}
