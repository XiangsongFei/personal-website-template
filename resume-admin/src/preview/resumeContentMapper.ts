import type { ResumeContent, ResumeLocaleContent } from "../../../app/data/resume";
import type { EditorSections, OrderedItem, ProjectItem, Locale } from "../model";

/** A complete saved snapshot with current editor drafts already overlaid. */
export type ResumePreviewSnapshot = EditorSections;

function ordered<T extends OrderedItem>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.position - right.item.position || left.index - right.index)
    .map(({ item }) => item);
}

function publicId(section: string, item: OrderedItem): string {
  if (item.sourceKey !== null && item.sourceKey !== undefined) return item.sourceKey;
  if (item.id.startsWith("local-")) return `preview-${section}-${encodeURIComponent(item.id)}`;
  return item.id;
}

function optionalValue(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function mapProject(item: ProjectItem, locale: Locale): ResumeContent["locales"]["zh"]["projects"][number] {
  const translation = item.translations[locale];
  return {
    id: publicId("project", item),
    title: translation.title,
    subtitle: translation.subtitle,
    period: translation.period,
    methods: ordered(item.methods[locale]).map(method => method.value),
    description: translation.description,
    href: translation.href,
  };
}

function mapLocaleContent(snapshot: ResumePreviewSnapshot, locale: Locale): ResumeLocaleContent {
  const siteText = snapshot.links.translations[locale];
  return {
    intro: ordered(snapshot.introduction).map(item => item.translations[locale].text),
    nav: ordered(snapshot.links.navigation).map(item => item.translations[locale].label),
    education: siteText.educationLabel,
    experience: siteText.experienceLabel,
    projectHeading: siteText.projectHeading,
    skills: siteText.skillsLabel,
    honors: siteText.honorsLabel,
    edu: ordered(snapshot.education).map(item => omitUndefined({
      id: publicId("education", item),
      entryType: item.entryType,
      title: item.translations[locale].title,
      program: item.translations[locale].program,
      period: item.translations[locale].period,
      grade: item.translations[locale].grade,
      courseTitle: optionalValue(item.translations[locale].courseTitle),
      courseDescription: optionalValue(item.translations[locale].courseDescription),
    })),
    jobs: ordered(snapshot.experience).map(item => omitUndefined({
      id: publicId("experience", item),
      organization: item.translations[locale].organization,
      title: item.translations[locale].title,
      period: item.translations[locale].period,
      description: item.translations[locale].description,
      location: optionalValue(item.translations[locale].location),
    })),
    projects: ordered(snapshot.projects).map(item => mapProject(item, locale)),
    skillGroups: ordered(snapshot.skills).map(item => ({
      id: publicId("skill", item), title: item.translations[locale].title, items: item.translations[locale].items,
    })),
    honorsList: ordered(snapshot.awards).map(item => ({
      id: publicId("award", item), name: item.translations[locale].name, year: item.translations[locale].year,
    })),
    contact: snapshot.contact.translations[locale].contactLabel,
    availability: snapshot.contact.translations[locale].availability,
    portfolioLabel: siteText.portfolioLabel,
    portfolioHref: siteText.portfolioHref,
    kaggleLabel: siteText.kaggleLabel,
    updatedAt: siteText.updatedAtLabel,
    linkedInLabel: siteText.linkedInLabel,
    linkedInHref: siteText.linkedInHref,
    contactFocusItems: ordered(snapshot.contact.focus).map(item => [
      item.translations[locale].title, item.translations[locale].detail,
    ] as [string, string]),
    contactStatusItems: ordered(snapshot.contact.status).map(item => ({
      type: item.statusType,
      title: item.translations[locale].title,
      detail: item.translations[locale].detail,
    })),
  };
}

/** Convert a complete baseline-plus-drafts snapshot into the public content model. */
export function mapEditorSnapshotToResumeContent(snapshot: ResumePreviewSnapshot): ResumeContent {
  const { profile, links } = snapshot;
  return {
    profile: {
      name: { zh: profile.translations.zh.name, en: profile.translations.en.name },
      navAboutLabel: { zh: profile.translations.zh.navAboutLabel, en: profile.translations.en.navAboutLabel },
      emailActionLabel: { zh: profile.translations.zh.emailActionLabel, en: profile.translations.en.emailActionLabel },
      graduationLabel: { zh: profile.translations.zh.graduationLabel, en: profile.translations.en.graduationLabel },
      graduationValue: profile.shared.graduationValue,
      avatarLabel: { zh: profile.translations.zh.avatarLabel, en: profile.translations.en.avatarLabel },
      avatarInitials: profile.shared.avatarInitials,
      contactFocusHeading: { zh: profile.translations.zh.contactFocusHeading, en: profile.translations.en.contactFocusHeading },
      contactStatusHeading: { zh: profile.translations.zh.contactStatusHeading, en: profile.translations.en.contactStatusHeading },
      footerName: profile.shared.footerName,
      copyright: profile.shared.copyright,
    },
    publicLinks: {
      email: links.shared.email,
      github: links.shared.github,
      githubLabel: links.shared.githubLabel,
      linkedInDisplayName: links.shared.linkedInDisplayName,
      emailLabel: links.shared.emailLabel,
      linkedInLabel: links.shared.linkedInLabel,
    },
    locales: {
      zh: mapLocaleContent(snapshot, "zh"),
      en: mapLocaleContent(snapshot, "en"),
    },
  };
}
