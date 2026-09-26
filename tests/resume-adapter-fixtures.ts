import { resumeContent } from "../app/data/resume";
import type { ResumeDatabaseRows } from "../app/data/resume-adapter";

const resumeId = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-01-01T00:00:00.000Z";

export function createResumeRowsFixture(): ResumeDatabaseRows {
  let next = 10;
  const id = () => `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
  const row = (fields: Record<string, unknown>) => ({ resume_id: resumeId, created_at: timestamp, updated_at: timestamp, ...fields });
  const siteRow = (fields: Record<string, unknown>) => ({ created_at: timestamp, updated_at: timestamp, ...fields });
  const result: ResumeDatabaseRows = {
    resume_sites: [siteRow({ id: resumeId, site_key: "example-cv", is_published: true })],
    resume_profile: [row({ graduation_value: resumeContent.profile.graduationValue, avatar_initials: resumeContent.profile.avatarInitials, photo_url: resumeContent.profile.photoUrl, footer_name: resumeContent.profile.footerName, copyright: resumeContent.profile.copyright })],
    resume_profile_translations: [],
    resume_public_links: [row({ email: resumeContent.publicLinks.email, github: resumeContent.publicLinks.github, github_label: resumeContent.publicLinks.githubLabel, linkedin_display_name: resumeContent.publicLinks.linkedInDisplayName, email_label: resumeContent.publicLinks.emailLabel, linkedin_label: resumeContent.publicLinks.linkedInLabel })],
    resume_locale_content: [],
    resume_intro_paragraphs: [], resume_intro_paragraph_translations: [],
    resume_navigation_items: [], resume_navigation_item_translations: [],
    resume_education_entries: [], resume_education_translations: [],
    resume_experience_entries: [], resume_experience_translations: [],
    resume_project_entries: [], resume_project_translations: [], resume_project_methods: [],
    resume_skill_groups: [], resume_skill_group_translations: [],
    resume_award_entries: [], resume_award_translations: [],
    resume_contact_focus_items: [], resume_contact_focus_translations: [],
    resume_contact_status_items: [], resume_contact_status_translations: [],
  };

  for (const locale of ["zh", "en"] as const) {
    const profile = resumeContent.profile;
    result.resume_profile_translations.push(row({
      locale,
      name: profile.name[locale],
      nav_about_label: profile.navAboutLabel[locale],
      email_action_label: profile.emailActionLabel[locale],
      graduation_label: profile.graduationLabel[locale],
      avatar_label: profile.avatarLabel[locale],
      contact_focus_heading: profile.contactFocusHeading[locale],
      contact_status_heading: profile.contactStatusHeading[locale],
    }));
    const content = resumeContent.locales[locale];
    result.resume_locale_content.push(row({
      locale,
      education_label: content.education,
      experience_label: content.experience,
      project_heading: content.projectHeading,
      skills_label: content.skills,
      honors_label: content.honors,
      contact_label: content.contact,
      availability: content.availability,
      portfolio_label: content.portfolioLabel,
      portfolio_href: content.portfolioHref,
      kaggle_label: content.kaggleLabel,
      updated_at_label: content.updatedAt,
      linkedin_label: content.linkedInLabel,
      linkedin_href: content.linkedInHref,
    }));
  }

  addSimple(result.resume_intro_paragraphs, result.resume_intro_paragraph_translations, "paragraph_id", "text", "intro");
  addSimple(result.resume_navigation_items, result.resume_navigation_item_translations, "navigation_item_id", "label", "nav");
  addEntries(result.resume_education_entries, result.resume_education_translations, "education_entry_id", "edu", (x) => ({
    title: x.title, program: x.program, period: x.period, grade: x.grade,
    course_title: x.courseTitle ?? null, course_description: x.courseDescription ?? null,
  }), (x) => ({ entry_type: x.entryType }));
  addEntries(result.resume_experience_entries, result.resume_experience_translations, "experience_entry_id", "jobs", (x) => ({
    organization: x.organization, title: x.title, period: x.period, description: x.description, location: x.location ?? null,
  }));
  addEntries(result.resume_project_entries, result.resume_project_translations, "project_entry_id", "projects", (x) => ({
    title: x.title, subtitle: x.subtitle, period: x.period, description: x.description, href: x.href,
  }));
  addEntries(result.resume_skill_groups, result.resume_skill_group_translations, "skill_group_id", "skillGroups", (x) => ({ title: x.title, items: x.items }));
  addEntries(result.resume_award_entries, result.resume_award_translations, "award_entry_id", "honorsList", (x) => ({ name: x.name, year: x.year }));
  addEntries(result.resume_contact_focus_items, result.resume_contact_focus_translations, "focus_item_id", "contactFocusItems", (x) => ({ title: x[0], detail: x[1] }));
  addEntries(result.resume_contact_status_items, result.resume_contact_status_translations, "status_item_id", "contactStatusItems", (x) => ({ title: x.title, detail: x.detail }), (x) => ({ status_type: x.type }));

  function addSimple(
    parents: Record<string, unknown>[], translations: Record<string, unknown>[], foreignKey: string,
    valueField: string, sourceKey: "intro" | "nav",
  ) {
    const zhValues = resumeContent.locales.zh[sourceKey];
    const enValues = resumeContent.locales.en[sourceKey];
    if (zhValues.length !== enValues.length) throw new Error(`Fixture ${sourceKey} locales have mismatched lengths`);
    for (let position = 0; position < zhValues.length; position++) {
      const parentId = id();
      parents.push(row({ id: parentId, position, source_key: null }));
      translations.push(row({ [foreignKey]: parentId, locale: "zh", [valueField]: zhValues[position] }));
      translations.push(row({ [foreignKey]: parentId, locale: "en", [valueField]: enValues[position] }));
    }
  }

  function addEntries(
    parents: Record<string, unknown>[], translations: Record<string, unknown>[], foreignKey: string,
    sourceKey: "edu" | "jobs" | "projects" | "skillGroups" | "honorsList" | "contactFocusItems" | "contactStatusItems",
    translate: (item: Record<string, unknown>) => Record<string, unknown>,
    baseFields: (item: Record<string, unknown>) => Record<string, unknown> = () => ({}),
  ) {
    const zhItems = resumeContent.locales.zh[sourceKey] as unknown as Record<string, unknown>[];
    const enItems = resumeContent.locales.en[sourceKey] as unknown as Record<string, unknown>[];
    if (zhItems.length !== enItems.length) throw new Error(`Fixture ${sourceKey} locales have mismatched lengths`);
    for (let position = 0; position < zhItems.length; position++) {
      const zh = zhItems[position];
      const en = enItems[position];
      if (typeof zh.id === "string" && typeof en.id === "string" && zh.id !== en.id) {
        throw new Error(`Fixture ${sourceKey} IDs differ by locale`);
      }
      const parentId = id();
      parents.push(row({ id: parentId, position, source_key: typeof zh.id === "string" ? zh.id : null, ...baseFields(zh) }));
      translations.push(row({ [foreignKey]: parentId, locale: "zh", ...translate(zh) }));
      translations.push(row({ [foreignKey]: parentId, locale: "en", ...translate(en) }));
      if (sourceKey === "projects") {
        for (const [methodPosition, value] of (zh.methods as string[]).entries()) {
          result.resume_project_methods.push(row({ id: id(), project_entry_id: parentId, locale: "zh", position: methodPosition, value }));
        }
        for (const [methodPosition, value] of (en.methods as string[]).entries()) {
          result.resume_project_methods.push(row({ id: id(), project_entry_id: parentId, locale: "en", position: methodPosition, value }));
        }
      }
    }
  }

  return result;
}
