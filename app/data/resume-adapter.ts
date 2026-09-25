import type { ResumeLocale, ResumeLocaleContent } from "./resume";

/** Rows selected from the public resume tables in the production schema. */
export type ResumeDatabaseRows = {
  resume_sites: Row[];
  resume_profile: Row[];
  resume_profile_translations: Row[];
  resume_public_links: Row[];
  resume_locale_content: Row[];
  resume_intro_paragraphs: Row[];
  resume_intro_paragraph_translations: Row[];
  resume_navigation_items: Row[];
  resume_navigation_item_translations: Row[];
  resume_education_entries: Row[];
  resume_education_translations: Row[];
  resume_experience_entries: Row[];
  resume_experience_translations: Row[];
  resume_project_entries: Row[];
  resume_project_translations: Row[];
  resume_project_methods: Row[];
  resume_skill_groups: Row[];
  resume_skill_group_translations: Row[];
  resume_award_entries: Row[];
  resume_award_translations: Row[];
  resume_contact_focus_items: Row[];
  resume_contact_focus_translations: Row[];
  resume_contact_status_items: Row[];
  resume_contact_status_translations: Row[];
};

const databaseTables: (keyof ResumeDatabaseRows)[] = [
  "resume_sites", "resume_profile", "resume_profile_translations", "resume_public_links", "resume_locale_content",
  "resume_intro_paragraphs", "resume_intro_paragraph_translations", "resume_navigation_items",
  "resume_navigation_item_translations", "resume_education_entries", "resume_education_translations",
  "resume_experience_entries", "resume_experience_translations", "resume_project_entries",
  "resume_project_translations", "resume_project_methods", "resume_skill_groups",
  "resume_skill_group_translations", "resume_award_entries", "resume_award_translations",
  "resume_contact_focus_items", "resume_contact_focus_translations", "resume_contact_status_items",
  "resume_contact_status_translations",
];

type Row = Record<string, unknown>;

export class ResumeDataValidationError extends Error {
  readonly name = "ResumeDataValidationError";

  constructor(message: string) {
    super(message);
  }
}

const fail = (message: string): never => {
  throw new ResumeDataValidationError(message);
};

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tableRows(value: unknown, table: keyof ResumeDatabaseRows): Row[] {
  if (!Array.isArray(value) || value.some((row) => !isRecord(row))) {
    return fail(`${table} must be an array of database rows`);
  }
  return value as Row[];
}

function text(row: Row, key: string, where: string): string {
  const value = row[key];
  if (typeof value !== "string") return fail(`${where}.${key} must be a string`);
  return value;
}

function optionalText(row: Row, key: string, where: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return fail(`${where}.${key} must be a string or null`);
  return value;
}

function rowPosition(row: Row, where: string): number {
  if (!Number.isInteger(row.position) || (row.position as number) < 0) {
    return fail(`${where}.position must be a non-negative integer`);
  }
  return row.position as number;
}

function requiredString(row: Row, key: string, where: string): string {
  return text(row, key, where);
}

function ensureUnique(rows: Row[], key: string, where: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = requiredString(row, key, where);
    if (seen.has(value)) fail(`${where} contains duplicate ${key} "${value}"`);
    seen.add(value);
  }
}

function ensureResume(rows: Row[], resumeId: string, table: string): void {
  for (const row of rows) {
    if (row.resume_id !== resumeId) fail(`${table} references a different resume`);
  }
}

const tablesWithId = new Set<keyof ResumeDatabaseRows>([
  "resume_sites",
  "resume_intro_paragraphs",
  "resume_navigation_items",
  "resume_education_entries",
  "resume_experience_entries",
  "resume_project_entries",
  "resume_project_methods",
  "resume_skill_groups",
  "resume_award_entries",
  "resume_contact_focus_items",
  "resume_contact_status_items",
]);

function validateRows(rows: Row[], table: keyof ResumeDatabaseRows): void {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (tablesWithId.has(table)) {
    ensureUnique(rows, "id", table);
    for (const [index, row] of rows.entries()) {
      if (!uuidPattern.test(text(row, "id", `${table}[${index}]`))) {
        fail(`${table}[${index}].id must be a UUID`);
      }
    }
  }
  if (table !== "resume_sites") {
    for (const [index, row] of rows.entries()) {
      if (!uuidPattern.test(text(row, "resume_id", `${table}[${index}]`))) {
        fail(`${table}[${index}].resume_id must be a UUID`);
      }
    }
  }
}

function ordered(rows: Row[], table: string): Row[] {
  const positioned = rows.map((row, index) => ({ row, position: rowPosition(row, `${table}[${index}]`) }));
  const positions = new Set<number>();
  for (const item of positioned) {
    if (positions.has(item.position)) fail(`${table} contains duplicate position ${item.position}`);
    positions.add(item.position);
  }
  return positioned.sort((a, b) => a.position - b.position).map(({ row }) => row);
}

function translationsFor(
  translations: Row[],
  foreignKey: string,
  parentId: string,
  resumeId: string,
  table: string,
): Record<ResumeLocale, Row> {
  const matches = translations.filter((row) => row[foreignKey] === parentId);
  const byLocale = new Map<ResumeLocale, Row>();
  for (const row of matches) {
    if (row.resume_id !== resumeId) fail(`${table} references a different resume`);
    const locale = text(row, "locale", table);
    if (locale !== "zh" && locale !== "en") fail(`${table} has unsupported locale "${locale}"`);
    const supportedLocale = locale as ResumeLocale;
    if (byLocale.has(supportedLocale)) fail(`${table} has duplicate ${locale} translation for ${parentId}`);
    byLocale.set(supportedLocale, row);
  }
  if (!byLocale.has("zh") || !byLocale.has("en")) {
    fail(`${table} must contain zh and en translations for ${parentId}`);
  }
  return { zh: byLocale.get("zh")!, en: byLocale.get("en")! };
}

function translationsForResume(translations: Row[], resumeId: string, table: string): Record<ResumeLocale, Row> {
  const matches = translations.filter((row) => row.resume_id === resumeId);
  const byLocale = new Map<ResumeLocale, Row>();
  for (const row of matches) {
    const locale = text(row, "locale", table);
    if (locale !== "zh" && locale !== "en") fail(`${table} has unsupported locale "${locale}"`);
    const supportedLocale = locale as ResumeLocale;
    if (byLocale.has(supportedLocale)) fail(`${table} has duplicate ${locale} translation for resume ${resumeId}`);
    byLocale.set(supportedLocale, row);
  }
  if (!byLocale.has("zh") || !byLocale.has("en")) fail(`${table} must contain zh and en translations`);
  return { zh: byLocale.get("zh")!, en: byLocale.get("en")! };
}

function ensureChildRowsBelong(
  children: Row[],
  parents: Row[],
  foreignKey: string,
  table: string,
): void {
  const parentIds = new Set(parents.map((row) => requiredString(row, "id", table)));
  for (const child of children) {
    const parentId = text(child, foreignKey, table);
    if (!parentIds.has(parentId)) fail(`${table} references missing parent ${parentId}`);
  }
}

function ensureLocaleSet(rows: Row[], table: string): void {
  const locales = rows.map((row) => text(row, "locale", table));
  if (locales.length !== 2 || new Set(locales).size !== 2 || !locales.includes("zh") || !locales.includes("en")) {
    fail(`${table} must contain exactly one row for each of zh and en`);
  }
}

function exactlyOne(rows: Row[], table: string): Row {
  if (rows.length !== 1) fail(`${table} must contain exactly one row`);
  return rows[0];
}

function oneForResume(rows: Row[], resumeId: string, table: string): Row {
  return exactlyOne(rows.filter((row) => row.resume_id === resumeId), table);
}

function stableSourceKey(row: Row, where: string): string {
  const value = optionalText(row, "source_key", where);
  if (value === undefined) return fail(`${where}.source_key is required to reconstruct the public item ID`);
  return value;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return value;
}

/** Convert a complete set of production-shaped public table rows to the static resume model. */
export function adaptResumeRows(input: ResumeDatabaseRows): typeof import("./resume").resumeContent {
  if (!isRecord(input)) fail("Resume database payload must be an object");
  const unexpectedTables = Object.keys(input).filter((key) => !databaseTables.includes(key as keyof ResumeDatabaseRows));
  if (unexpectedTables.length) fail(`Unexpected resume table(s): ${unexpectedTables.join(", ")}`);
  const data = Object.fromEntries(databaseTables.map((table) => [table, tableRows(input[table], table)])) as ResumeDatabaseRows;
  for (const table of databaseTables) validateRows(data[table], table);

  const site = exactlyOne(data.resume_sites, "resume_sites");
  const resumeId = requiredString(site, "id", "resume_sites");
  if (text(site, "site_key", "resume_sites") !== "example-cv") fail('resume_sites.site_key must be "example-cv"');
  if (site.is_published !== true) fail("resume_sites must be published");

  for (const table of databaseTables) {
    if (table !== "resume_sites") ensureResume(data[table], resumeId, table);
  }
  validateProjectMethods(data.resume_project_methods, data.resume_project_entries, resumeId);

  const profile = oneForResume(data.resume_profile, resumeId, "resume_profile");
  const profileTranslations = translationsForResume(data.resume_profile_translations, resumeId, "resume_profile_translations");
  const links = oneForResume(data.resume_public_links, resumeId, "resume_public_links");
  const localeRows = data.resume_locale_content.filter((row) => row.resume_id === resumeId);
  ensureLocaleSet(localeRows, "resume_locale_content");
  const localeByCode = new Map(localeRows.map((row) => [text(row, "locale", "resume_locale_content"), row]));

  return {
    profile: {
      name: { zh: text(profileTranslations.zh, "name", "profile.zh"), en: text(profileTranslations.en, "name", "profile.en") },
      navAboutLabel: { zh: text(profileTranslations.zh, "nav_about_label", "profile.zh"), en: text(profileTranslations.en, "nav_about_label", "profile.en") },
      emailActionLabel: { zh: text(profileTranslations.zh, "email_action_label", "profile.zh"), en: text(profileTranslations.en, "email_action_label", "profile.en") },
      graduationLabel: { zh: text(profileTranslations.zh, "graduation_label", "profile.zh"), en: text(profileTranslations.en, "graduation_label", "profile.en") },
      graduationValue: text(profile, "graduation_value", "profile"),
      avatarLabel: { zh: text(profileTranslations.zh, "avatar_label", "profile.zh"), en: text(profileTranslations.en, "avatar_label", "profile.en") },
      avatarInitials: text(profile, "avatar_initials", "profile"),
      contactFocusHeading: { zh: text(profileTranslations.zh, "contact_focus_heading", "profile.zh"), en: text(profileTranslations.en, "contact_focus_heading", "profile.en") },
      contactStatusHeading: { zh: text(profileTranslations.zh, "contact_status_heading", "profile.zh"), en: text(profileTranslations.en, "contact_status_heading", "profile.en") },
      footerName: text(profile, "footer_name", "profile"),
      copyright: text(profile, "copyright", "profile"),
    },
    publicLinks: {
      email: text(links, "email", "resume_public_links"),
      github: text(links, "github", "resume_public_links"),
      githubLabel: text(links, "github_label", "resume_public_links"),
      linkedInDisplayName: text(links, "linkedin_display_name", "resume_public_links"),
      emailLabel: text(links, "email_label", "resume_public_links"),
      linkedInLabel: text(links, "linkedin_label", "resume_public_links"),
    },
    locales: {
      zh: adaptLocale("zh", data, localeByCode.get("zh")!, resumeId),
      en: adaptLocale("en", data, localeByCode.get("en")!, resumeId),
    },
  };
}

function adaptLocale(locale: ResumeLocale, data: ResumeDatabaseRows, localeRow: Row, resumeId: string): ResumeLocaleContent {
  const localeFields = {
    education: text(localeRow, "education_label", `locale.${locale}`),
    experience: text(localeRow, "experience_label", `locale.${locale}`),
    projectHeading: text(localeRow, "project_heading", `locale.${locale}`),
    skills: text(localeRow, "skills_label", `locale.${locale}`),
    honors: text(localeRow, "honors_label", `locale.${locale}`),
    contact: text(localeRow, "contact_label", `locale.${locale}`),
    availability: text(localeRow, "availability", `locale.${locale}`),
    portfolioLabel: text(localeRow, "portfolio_label", `locale.${locale}`),
    portfolioHref: text(localeRow, "portfolio_href", `locale.${locale}`),
    kaggleLabel: text(localeRow, "kaggle_label", `locale.${locale}`),
    updatedAt: text(localeRow, "updated_at_label", `locale.${locale}`),
    linkedInLabel: text(localeRow, "linkedin_label", `locale.${locale}`),
    linkedInHref: text(localeRow, "linkedin_href", `locale.${locale}`),
  };
  const intro = localizedSimpleList(data.resume_intro_paragraphs, data.resume_intro_paragraph_translations, "paragraph_id", resumeId, locale, "resume_intro_paragraph_translations", "text");
  const nav = localizedSimpleList(data.resume_navigation_items, data.resume_navigation_item_translations, "navigation_item_id", resumeId, locale, "resume_navigation_item_translations", "label");

  const edu = localizedEntries(data.resume_education_entries, data.resume_education_translations, "education_entry_id", locale, resumeId, "resume_education_translations", (base, translation, where) => omitUndefined({
    id: stableSourceKey(base, where),
    entryType: text(base, "entry_type", where) as "standard" | "summerSchool",
    title: text(translation, "title", where),
    program: text(translation, "program", where),
    period: text(translation, "period", where),
    grade: text(translation, "grade", where),
    courseTitle: optionalText(translation, "course_title", where),
    courseDescription: optionalText(translation, "course_description", where),
  }));
  for (const entry of edu) if (entry.entryType !== "standard" && entry.entryType !== "summerSchool") fail(`education ${entry.id} has invalid entry_type`);

  const jobs = localizedEntries(data.resume_experience_entries, data.resume_experience_translations, "experience_entry_id", locale, resumeId, "resume_experience_translations", (base, translation, where) => omitUndefined({
    id: stableSourceKey(base, where),
    organization: text(translation, "organization", where),
    title: text(translation, "title", where),
    period: text(translation, "period", where),
    description: text(translation, "description", where),
    location: optionalText(translation, "location", where),
  }));

  const projects = localizedEntries(data.resume_project_entries, data.resume_project_translations, "project_entry_id", locale, resumeId, "resume_project_translations", (base, translation, where) => ({
    id: stableSourceKey(base, where),
    title: text(translation, "title", where),
    subtitle: text(translation, "subtitle", where),
    period: text(translation, "period", where),
    methods: ordered(data.resume_project_methods.filter((method) => method.project_entry_id === base.id && method.locale === locale), "resume_project_methods").map((method) => text(method, "value", "resume_project_methods")),
    description: text(translation, "description", where),
    href: text(translation, "href", where),
  }));

  const skillGroups = localizedEntries(data.resume_skill_groups, data.resume_skill_group_translations, "skill_group_id", locale, resumeId, "resume_skill_group_translations", (base, translation, where) => ({
    id: stableSourceKey(base, where), title: text(translation, "title", where), items: text(translation, "items", where),
  }));
  const honorsList = localizedEntries(data.resume_award_entries, data.resume_award_translations, "award_entry_id", locale, resumeId, "resume_award_translations", (base, translation, where) => ({
    id: stableSourceKey(base, where), name: text(translation, "name", where), year: text(translation, "year", where),
  }));
  const contactFocusItems = localizedEntries(data.resume_contact_focus_items, data.resume_contact_focus_translations, "focus_item_id", locale, resumeId, "resume_contact_focus_translations", (_base, translation, where) => [
    text(translation, "title", where), text(translation, "detail", where),
  ] as [string, string]);
  const contactStatusItems = localizedEntries(data.resume_contact_status_items, data.resume_contact_status_translations, "status_item_id", locale, resumeId, "resume_contact_status_translations", (base, translation, where) => ({
    type: text(base, "status_type", where), title: text(translation, "title", where), detail: text(translation, "detail", where),
  }));

  return { intro, nav, ...localeFields, edu, jobs, projects, skillGroups, honorsList, contactFocusItems, contactStatusItems };
}

function localizedSimpleList(
  parents: Row[], translations: Row[], foreignKey: string, resumeId: string, locale: ResumeLocale,
  table: string, valueField: string,
): string[] {
  const orderedParents = ordered(parents, table);
  ensureUnique(orderedParents, "id", table);
  ensureChildRowsBelong(translations, orderedParents, foreignKey, table);
  return orderedParents.map((parent) => {
    const parentId = requiredString(parent, "id", table);
    const translation = translationsFor(translations, foreignKey, parentId, resumeId, table)[locale];
    return text(translation, valueField, table);
  });
}

function localizedEntries<T>(
  parents: Row[], translations: Row[], foreignKey: string, locale: ResumeLocale, resumeId: string, table: string,
  map: (base: Row, translation: Row, where: string) => T,
): T[] {
  const orderedParents = ordered(parents, table);
  ensureUnique(orderedParents, "id", table);
  const keyedParents = orderedParents.filter((row) => row.source_key !== null && row.source_key !== undefined);
  ensureUnique(keyedParents, "source_key", table);
  ensureChildRowsBelong(translations, orderedParents, foreignKey, table);
  return orderedParents.map((base) => {
    const baseId = requiredString(base, "id", table);
    const sourceKey = optionalText(base, "source_key", table);
    const where = `${table}.${locale}.${sourceKey ?? baseId}`;
    return map(base, translationsFor(translations, foreignKey, baseId, resumeId, table)[locale], where);
  });
}

function validateProjectMethods(methods: Row[], projects: Row[], resumeId: string): void {
  const projectIds = new Set(projects.map((row) => requiredString(row, "id", "resume_project_entries")));
  const grouped = new Map<string, Row[]>();
  for (const method of methods) {
    const projectId = text(method, "project_entry_id", "resume_project_methods");
    if (!projectIds.has(projectId)) fail(`resume_project_methods references missing project ${projectId}`);
    if (method.resume_id !== resumeId) fail("resume_project_methods references a different resume");
    const locale = text(method, "locale", "resume_project_methods");
    if (locale !== "zh" && locale !== "en") fail(`resume_project_methods has unsupported locale "${locale}"`);
    text(method, "value", "resume_project_methods");
    const key = `${projectId}:${locale}`;
    grouped.set(key, [...(grouped.get(key) ?? []), method]);
  }
  for (const methodRows of grouped.values()) ordered(methodRows, "resume_project_methods");
}
