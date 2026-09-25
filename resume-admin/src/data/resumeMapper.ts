import type {
  AwardItem, ContactSection, EditorSections, EducationItem, ExperienceItem, FocusItem, IntroItem,
  LinksSection, Locale, NavigationItem, ProfileSection, ProjectItem, ProjectMethod, SkillItem, StatusItem,
} from "../model";

type Row = Record<string, unknown>;
export type ResumeTable =
  | "resume_profile" | "resume_profile_translations" | "resume_public_links" | "resume_locale_content"
  | "resume_intro_paragraphs" | "resume_intro_paragraph_translations"
  | "resume_navigation_items" | "resume_navigation_item_translations"
  | "resume_education_entries" | "resume_education_translations"
  | "resume_experience_entries" | "resume_experience_translations"
  | "resume_project_entries" | "resume_project_translations" | "resume_project_methods"
  | "resume_skill_groups" | "resume_skill_group_translations"
  | "resume_award_entries" | "resume_award_translations"
  | "resume_contact_focus_items" | "resume_contact_focus_translations"
  | "resume_contact_status_items" | "resume_contact_status_translations";

export type ResumeRows = { resume_sites: Row[] } & Record<ResumeTable, Row[]>;
export type LoadedResume = {
  resumeId: string;
  siteKey: "example-cv";
  isPublished: boolean;
  updatedAt: string | null;
  sections: EditorSections;
};

export type ResumeSiteMetadata = {
  resumeId: string;
  siteKey: "example-cv";
  isPublished: boolean;
  updatedAt: string | null;
};

export type OverviewResumeData = { profileName: string };

const locales: Locale[] = ["zh", "en"];
const navSections: NavigationItem["sectionId"][] = ["experience", "projects", "skills", "awards", "contact"];

function value(row: Row, key: string): string {
  if (typeof row[key] !== "string") throw new Error(`Invalid resume content: ${key}`);
  return row[key] as string;
}

function optional(row: Row, key: string): string | null {
  if (row[key] === null) return null;
  return value(row, key);
}

function position(row: Row): number {
  if (!Number.isInteger(row.position) || (row.position as number) < 0) throw new Error("Invalid resume position");
  return row.position as number;
}

function sorted(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => position(a) - position(b) || value(a, "id").localeCompare(value(b, "id")));
}

function singleton(rows: Row[], name: string): Row {
  if (rows.length !== 1) throw new Error(`Expected one ${name} row`);
  return rows[0];
}

function byLocale(rows: Row[], foreignKey: string, parentId: string): Partial<Record<Locale, Row>> {
  const found: Partial<Record<Locale, Row>> = {};
  for (const row of rows) {
    if (row[foreignKey] !== parentId) continue;
    const locale = value(row, "locale");
    if (locale !== "zh" && locale !== "en") throw new Error("Unsupported resume locale");
    if (found[locale]) throw new Error("Duplicate resume translation");
    found[locale] = row;
  }
  return found;
}

function translated<T>(rows: Row[], foreignKey: string, parentId: string, map: (row: Row | undefined) => T): Record<Locale, T> {
  const found = byLocale(rows, foreignKey, parentId);
  return { zh: map(found.zh), en: map(found.en) };
}

function field(row: Row | undefined, key: string): string {
  return row ? value(row, key) : "";
}

function nullableField(row: Row | undefined, key: string): string | null {
  return row ? optional(row, key) : null;
}

function item(row: Row) {
  return {
    id: value(row, "id"), position: position(row),
    sourceKey: row.source_key === undefined ? null : optional(row, "source_key"),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
  };
}

function assertChildren(rows: ResumeRows, resumeId: string): void {
  for (const [table, entries] of Object.entries(rows)) {
    if (table === "resume_sites") continue;
    if (!Array.isArray(entries)) throw new Error(`Missing ${table} rows`);
    for (const entry of entries) if (entry.resume_id !== resumeId) throw new Error(`${table} references another resume`);
  }
}

function assertResumeOwnership(rows: Row[], resumeId: string): void {
  for (const row of rows) if (row.resume_id !== resumeId) throw new Error("Resume table references another resume");
}

/** Validate the single site row returned by the shared example-cv lookup. */
export function mapResumeSiteMetadata(row: Row | null | undefined): ResumeSiteMetadata {
  if (!row || typeof row.id !== "string" || row.site_key !== "example-cv" || typeof row.is_published !== "boolean") {
    throw new Error("Invalid target resume site");
  }
  return { resumeId: row.id, siteKey: "example-cv", isPublished: row.is_published,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null };
}

export function mapOverviewRows(profileTranslationRows: Row[], resumeId: string): OverviewResumeData {
  assertResumeOwnership(profileTranslationRows, resumeId);
  const translations = byLocale(profileTranslationRows, "resume_id", resumeId);
  return { profileName: field(translations.en, "name") };
}

export function mapProfileRows(profileRows: Row[], profileTranslationRows: Row[], resumeId: string): ProfileSection {
  assertResumeOwnership(profileRows, resumeId);
  assertResumeOwnership(profileTranslationRows, resumeId);
  const profile = singleton(profileRows, "resume_profile");
  const translations = byLocale(profileTranslationRows, "resume_id", resumeId);
  const profileText = (locale: Locale, key: string) => field(translations[locale], key);
  return {
    shared: {
      graduationValue: value(profile, "graduation_value"), avatarInitials: value(profile, "avatar_initials"),
      footerName: value(profile, "footer_name"), copyright: value(profile, "copyright"),
    },
    translations: {
      zh: mapProfileTranslation("zh", profileText), en: mapProfileTranslation("en", profileText),
    },
  };
}

function mapProfileTranslation(locale: Locale, text: (locale: Locale, key: string) => string) {
  return {
    name: text(locale, "name"), navAboutLabel: text(locale, "nav_about_label"),
    emailActionLabel: text(locale, "email_action_label"), graduationLabel: text(locale, "graduation_label"),
    avatarLabel: text(locale, "avatar_label"), contactFocusHeading: text(locale, "contact_focus_heading"),
    contactStatusHeading: text(locale, "contact_status_heading"),
  };
}

export function mapIntroductionRows(parents: Row[], translations: Row[], resumeId: string): IntroItem[] {
  assertResumeOwnership(parents, resumeId); assertResumeOwnership(translations, resumeId);
  return sorted(parents).map(parent => ({ ...item(parent),
    translations: translated(translations, "paragraph_id", value(parent, "id"), row => ({ text: field(row, "text") })) }));
}

export function mapEducationRows(parents: Row[], translations: Row[], resumeId: string): EducationItem[] {
  assertResumeOwnership(parents, resumeId); assertResumeOwnership(translations, resumeId);
  return sorted(parents).map(parent => {
    const entryType = value(parent, "entry_type");
    if (entryType !== "standard" && entryType !== "summerSchool") throw new Error("Invalid education entry type");
    return { ...item(parent), entryType,
      translations: translated(translations, "education_entry_id", value(parent, "id"), row => ({
        title: field(row, "title"), program: field(row, "program"), period: field(row, "period"), grade: field(row, "grade"),
        courseTitle: nullableField(row, "course_title"), courseDescription: nullableField(row, "course_description"),
      })) };
  });
}

export function mapExperienceRows(parents: Row[], translations: Row[], resumeId: string): ExperienceItem[] {
  assertResumeOwnership(parents, resumeId); assertResumeOwnership(translations, resumeId);
  return sorted(parents).map(parent => ({ ...item(parent),
    translations: translated(translations, "experience_entry_id", value(parent, "id"), row => ({
      organization: field(row, "organization"), title: field(row, "title"), period: field(row, "period"),
      description: field(row, "description"), location: nullableField(row, "location"),
    })) }));
}

export function mapProjectRows(parents: Row[], translations: Row[], methodsRows: Row[], resumeId: string): ProjectItem[] {
  assertResumeOwnership(parents, resumeId); assertResumeOwnership(translations, resumeId); assertResumeOwnership(methodsRows, resumeId);
  return sorted(parents).map(parent => {
    const parentId = value(parent, "id");
    const methods = {} as Record<Locale, ProjectMethod[]>;
    for (const locale of locales) {
      methods[locale] = sorted(methodsRows.filter(row => row.project_entry_id === parentId && row.locale === locale))
        .map(row => ({ ...item(row), value: value(row, "value") }));
    }
    return { ...item(parent), methods,
      translations: translated(translations, "project_entry_id", parentId, row => ({
        title: field(row, "title"), subtitle: field(row, "subtitle"), period: field(row, "period"),
        description: field(row, "description"), href: field(row, "href"),
      })) };
  });
}

export function mapSkillRows(parents: Row[], translations: Row[], resumeId: string): SkillItem[] {
  assertResumeOwnership(parents, resumeId); assertResumeOwnership(translations, resumeId);
  return sorted(parents).map(parent => ({ ...item(parent),
    translations: translated(translations, "skill_group_id", value(parent, "id"), row => ({ title: field(row, "title"), items: field(row, "items") })) }));
}

export function mapAwardRows(parents: Row[], translations: Row[], resumeId: string): AwardItem[] {
  assertResumeOwnership(parents, resumeId); assertResumeOwnership(translations, resumeId);
  return sorted(parents).map(parent => ({ ...item(parent),
    translations: translated(translations, "award_entry_id", value(parent, "id"), row => ({ name: field(row, "name"), year: field(row, "year") })) }));
}

export function mapContactRows(localeRows: Row[], focusParents: Row[], focusTranslations: Row[], statusParents: Row[], statusTranslations: Row[], resumeId: string): ContactSection {
  for (const tableRows of [localeRows, focusParents, focusTranslations, statusParents, statusTranslations]) assertResumeOwnership(tableRows, resumeId);
  const localeContent = byLocale(localeRows, "resume_id", resumeId);
  const focus = sorted(focusParents).map(parent => ({ ...item(parent),
    translations: translated(focusTranslations, "focus_item_id", value(parent, "id"), row => ({ title: field(row, "title"), detail: field(row, "detail") })) }));
  const status: StatusItem[] = sorted(statusParents).map(parent => {
    const statusType = value(parent, "status_type");
    if (statusType !== "study" && statusType !== "graduation" && statusType !== "open") throw new Error("Invalid status type");
    return { ...item(parent), statusType,
      translations: translated(statusTranslations, "status_item_id", value(parent, "id"), row => ({ title: field(row, "title"), detail: field(row, "detail") })) };
  });
  return { translations: {
    zh: { contactLabel: field(localeContent.zh, "contact_label"), availability: field(localeContent.zh, "availability") },
    en: { contactLabel: field(localeContent.en, "contact_label"), availability: field(localeContent.en, "availability") },
  }, focus, status };
}

export function mapLinksRows(linkRows: Row[], localeRows: Row[], navigationRows: Row[], navigationTranslations: Row[], resumeId: string): LinksSection {
  for (const tableRows of [linkRows, localeRows, navigationRows, navigationTranslations]) assertResumeOwnership(tableRows, resumeId);
  const links = singleton(linkRows, "resume_public_links");
  const localeContent = byLocale(localeRows, "resume_id", resumeId);
  const navigation = sorted(navigationRows).map((parent, index) => {
    if (!navSections[index]) throw new Error("Unexpected navigation item count");
    return { ...item(parent), sectionId: navSections[index],
      translations: translated(navigationTranslations, "navigation_item_id", value(parent, "id"), row => ({ label: field(row, "label") })) };
  });
  if (navigation.length !== navSections.length) throw new Error("Expected five fixed navigation items");
  const siteText = (locale: Locale, key: string) => field(localeContent[locale], key);
  return {
    shared: { email: value(links, "email"), github: value(links, "github"), githubLabel: value(links, "github_label"),
      linkedInDisplayName: value(links, "linkedin_display_name"), emailLabel: value(links, "email_label"), linkedInLabel: value(links, "linkedin_label") },
    translations: { zh: mapSiteText("zh", siteText), en: mapSiteText("en", siteText) }, navigation,
  };
}

function mapSiteText(locale: Locale, text: (locale: Locale, key: string) => string) {
  return {
    educationLabel: text(locale, "education_label"), experienceLabel: text(locale, "experience_label"),
    projectHeading: text(locale, "project_heading"), skillsLabel: text(locale, "skills_label"),
    honorsLabel: text(locale, "honors_label"), portfolioLabel: text(locale, "portfolio_label"),
    portfolioHref: text(locale, "portfolio_href"), kaggleLabel: text(locale, "kaggle_label"),
    updatedAtLabel: text(locale, "updated_at_label"), linkedInLabel: text(locale, "linkedin_label"),
    linkedInHref: text(locale, "linkedin_href"),
  };
}

/** Convert one normalized, read-only database snapshot into the existing CMS editor shape. */
export function mapResumeRows(rows: ResumeRows): LoadedResume {
  const site = singleton(rows.resume_sites, "resume_sites");
  const resumeId = value(site, "id");
  if (site.site_key !== "example-cv" || typeof site.is_published !== "boolean") throw new Error("Invalid target resume site");
  assertChildren(rows, resumeId);
  const profile = singleton(rows.resume_profile, "resume_profile");
  const links = singleton(rows.resume_public_links, "resume_public_links");
  const profileTranslations = byLocale(rows.resume_profile_translations, "resume_id", resumeId);
  const localeContent = byLocale(rows.resume_locale_content, "resume_id", resumeId);

  const intro: IntroItem[] = sorted(rows.resume_intro_paragraphs).map(parent => ({
    ...item(parent),
    translations: translated(rows.resume_intro_paragraph_translations, "paragraph_id", value(parent, "id"), row => ({ text: field(row, "text") })),
  }));
  const navigation: NavigationItem[] = sorted(rows.resume_navigation_items).map((parent, index) => {
    if (!navSections[index]) throw new Error("Unexpected navigation item count");
    return {
      ...item(parent), sectionId: navSections[index],
      translations: translated(rows.resume_navigation_item_translations, "navigation_item_id", value(parent, "id"), row => ({ label: field(row, "label") })),
    };
  });
  if (navigation.length !== navSections.length) throw new Error("Expected five fixed navigation items");

  const education: EducationItem[] = sorted(rows.resume_education_entries).map(parent => {
    const entryType = value(parent, "entry_type");
    if (entryType !== "standard" && entryType !== "summerSchool") throw new Error("Invalid education entry type");
    return {
      ...item(parent), entryType,
      translations: translated(rows.resume_education_translations, "education_entry_id", value(parent, "id"), row => ({
        title: field(row, "title"), program: field(row, "program"), period: field(row, "period"),
        grade: field(row, "grade"), courseTitle: nullableField(row, "course_title"),
        courseDescription: nullableField(row, "course_description"),
      })),
    };
  });
  const experience: ExperienceItem[] = sorted(rows.resume_experience_entries).map(parent => ({
    ...item(parent),
    translations: translated(rows.resume_experience_translations, "experience_entry_id", value(parent, "id"), row => ({
      organization: field(row, "organization"), title: field(row, "title"), period: field(row, "period"),
      description: field(row, "description"), location: nullableField(row, "location"),
    })),
  }));
  const projects: ProjectItem[] = sorted(rows.resume_project_entries).map(parent => {
    const parentId = value(parent, "id");
    const methods = {} as Record<Locale, ProjectMethod[]>;
    for (const locale of locales) {
      methods[locale] = sorted(rows.resume_project_methods.filter(row => row.project_entry_id === parentId && row.locale === locale))
        .map(row => ({ ...item(row), value: value(row, "value") }));
    }
    return {
      ...item(parent), methods,
      translations: translated(rows.resume_project_translations, "project_entry_id", parentId, row => ({
        title: field(row, "title"), subtitle: field(row, "subtitle"), period: field(row, "period"),
        description: field(row, "description"), href: field(row, "href"),
      })),
    };
  });
  const skills: SkillItem[] = sorted(rows.resume_skill_groups).map(parent => ({
    ...item(parent),
    translations: translated(rows.resume_skill_group_translations, "skill_group_id", value(parent, "id"), row => ({
      title: field(row, "title"), items: field(row, "items"),
    })),
  }));
  const awards: AwardItem[] = sorted(rows.resume_award_entries).map(parent => ({
    ...item(parent),
    translations: translated(rows.resume_award_translations, "award_entry_id", value(parent, "id"), row => ({
      name: field(row, "name"), year: field(row, "year"),
    })),
  }));
  const focus: FocusItem[] = sorted(rows.resume_contact_focus_items).map(parent => ({
    ...item(parent),
    translations: translated(rows.resume_contact_focus_translations, "focus_item_id", value(parent, "id"), row => ({
      title: field(row, "title"), detail: field(row, "detail"),
    })),
  }));
  const status: StatusItem[] = sorted(rows.resume_contact_status_items).map(parent => {
    const statusType = value(parent, "status_type");
    if (statusType !== "study" && statusType !== "graduation" && statusType !== "open") throw new Error("Invalid status type");
    return {
      ...item(parent), statusType,
      translations: translated(rows.resume_contact_status_translations, "status_item_id", value(parent, "id"), row => ({
        title: field(row, "title"), detail: field(row, "detail"),
      })),
    };
  });

  const profileText = (locale: Locale, key: string) => field(profileTranslations[locale], key);
  const localeText = (locale: Locale, key: string) => field(localeContent[locale], key);
  const sections: EditorSections = {
    profile: {
      shared: {
        graduationValue: value(profile, "graduation_value"), avatarInitials: value(profile, "avatar_initials"),
        footerName: value(profile, "footer_name"), copyright: value(profile, "copyright"),
      },
      translations: {
        zh: profileTranslation("zh"), en: profileTranslation("en"),
      },
    },
    introduction: intro, education, experience, projects, skills, awards,
    contact: {
      translations: {
        zh: { contactLabel: localeText("zh", "contact_label"), availability: localeText("zh", "availability") },
        en: { contactLabel: localeText("en", "contact_label"), availability: localeText("en", "availability") },
      },
      focus, status,
    },
    links: {
      shared: {
        email: value(links, "email"), github: value(links, "github"), githubLabel: value(links, "github_label"),
        linkedInDisplayName: value(links, "linkedin_display_name"), emailLabel: value(links, "email_label"),
        linkedInLabel: value(links, "linkedin_label"),
      },
      translations: { zh: siteText("zh"), en: siteText("en") }, navigation,
    },
  };
  return {
    resumeId, siteKey: "example-cv", isPublished: site.is_published,
    updatedAt: typeof site.updated_at === "string" ? site.updated_at : null, sections,
  };

  function profileTranslation(locale: Locale) {
    return {
      name: profileText(locale, "name"), navAboutLabel: profileText(locale, "nav_about_label"),
      emailActionLabel: profileText(locale, "email_action_label"), graduationLabel: profileText(locale, "graduation_label"),
      avatarLabel: profileText(locale, "avatar_label"), contactFocusHeading: profileText(locale, "contact_focus_heading"),
      contactStatusHeading: profileText(locale, "contact_status_heading"),
    };
  }

  function siteText(locale: Locale) {
    return {
      educationLabel: localeText(locale, "education_label"), experienceLabel: localeText(locale, "experience_label"),
      projectHeading: localeText(locale, "project_heading"), skillsLabel: localeText(locale, "skills_label"),
      honorsLabel: localeText(locale, "honors_label"), portfolioLabel: localeText(locale, "portfolio_label"),
      portfolioHref: localeText(locale, "portfolio_href"), kaggleLabel: localeText(locale, "kaggle_label"),
      updatedAtLabel: localeText(locale, "updated_at_label"), linkedInLabel: localeText(locale, "linkedin_label"),
      linkedInHref: localeText(locale, "linkedin_href"),
    };
  }
}
