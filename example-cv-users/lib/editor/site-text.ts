import type {ContentLocale} from './draft';
import type {DraftTranslations} from './records';

export const previewSections = {
  profile: ['个人资料', 'Profile'],
  introduction: ['个人介绍', 'Introduction'],
  education: ['教育经历', 'Education'],
  experience: ['工作经历', 'Experience'],
  projects: ['项目经历', 'Projects'],
  skills: ['技能', 'Skills'],
  awards: ['荣誉奖项', 'Awards'],
  contact: ['联系与链接', 'Contact'],
} as const;

export type PreviewSection = keyof typeof previewSections;
export const previewOrder = Object.keys(previewSections) as PreviewSection[];
export const editableNavigationSections = ['experience', 'projects', 'skills', 'awards', 'contact'] as const;
export type NavigationSection = typeof editableNavigationSections[number];

export const sectionTitleFields = {
  education: 'educationLabel',
  experience: 'experienceLabel',
  projects: 'projectHeading',
  skills: 'skillsLabel',
  awards: 'honorsLabel',
} as const;

export function sectionTitleField(module: string) {
  return Object.hasOwn(sectionTitleFields, module) ? sectionTitleFields[module as keyof typeof sectionTitleFields] : undefined;
}

type SiteText = Record<typeof sectionTitleFields[keyof typeof sectionTitleFields] | 'kaggleLabel' | 'portfolioLabel' | 'updatedAtLabel', string>;
export type SiteTextDraft = {
  navigation: DraftTranslations<Record<NavigationSection, string>>;
  translations: DraftTranslations<SiteText>;
};

export const emptySiteText: SiteTextDraft = {navigation: {}, translations: {}};

export function siteNavigationLabel(draft: SiteTextDraft, locale: ContentLocale, section: PreviewSection) {
  const editable = editableNavigationSections.find(key => key === section);
  return editable && draft.navigation[locale]?.[editable];
}
