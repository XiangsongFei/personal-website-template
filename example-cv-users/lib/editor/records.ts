import type {ContentLocale} from './draft';

export type OrderedDraftRecord = {clientId: string; position: number};
export type DraftTranslations<T> = Partial<Record<ContentLocale, Partial<T>>>;

export function moveRecord<T extends OrderedDraftRecord>(rows: readonly T[], clientId: string, direction: -1 | 1): readonly T[] {
  const from = rows.findIndex(row => row.clientId === clientId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= rows.length) return rows;

  const next = [...rows];
  next[from] = {...rows[to], position: from};
  next[to] = {...rows[from], position: to};
  return next;
}

export function removeRecord<T extends OrderedDraftRecord>(rows: readonly T[], clientId: string): readonly T[] {
  return rows.filter(row => row.clientId !== clientId).map((row, position) =>
    row.position === position ? row : {...row, position});
}

export function editTranslation<T>(
  translations: DraftTranslations<T>, locale: ContentLocale, changes: Partial<T>,
): DraftTranslations<T> {
  return {...translations, [locale]: {...translations[locale], ...changes}};
}

export const educationCategories = ['undergraduate', 'graduate', 'doctoral', 'summerSchool', 'custom'] as const;
export type EducationCategory = typeof educationCategories[number];

const categoryNames: Record<EducationCategory, Record<ContentLocale, string>> = {
  undergraduate: {zh: '本科', en: 'Undergraduate'},
  graduate: {zh: '研究生', en: 'Graduate'},
  doctoral: {zh: '博士', en: 'Doctoral'},
  summerSchool: {zh: '暑期学校', en: 'Summer School'},
  custom: {zh: '自定义', en: 'Custom'},
};

const presetTitles: Record<Exclude<EducationCategory, 'custom'>, Record<ContentLocale, string>> = {
  undergraduate: {zh: '本科教育', en: 'Undergraduate Education'},
  graduate: {zh: '研究生教育', en: 'Graduate Education'},
  doctoral: {zh: '博士教育', en: 'Doctoral Education'},
  summerSchool: {zh: '暑期学校', en: 'Summer School'},
};

export type EducationText = {
  title: string;
  program: string;
  period: string;
  grade: string;
  courseTitle: string | null;
  courseDescription: string | null;
  customCategoryLabel: string | null;
};

export type EducationDraft = OrderedDraftRecord & {
  entryType: 'standard' | 'summerSchool';
  category: EducationCategory | null;
  // Provenance only. A local category change is not a persistence receipt.
  persistedCategory: EducationCategory | null;
  translations: DraftTranslations<EducationText>;
};

export function newEducation(clientId: string, position: number): EducationDraft {
  return {clientId, position, entryType: 'standard', category: null, persistedCategory: null, translations: {}};
}

export function educationCategory(row: EducationDraft) {
  return row.category ?? (row.entryType === 'summerSchool' ? 'summerSchool' : null);
}

export function changeEducationCategory(row: EducationDraft, category: EducationCategory | null): EducationDraft {
  return {...row, category, entryType: category === 'summerSchool' ? 'summerSchool' : 'standard'};
}

export function educationCategoryLabel(category: EducationCategory | null, locale: ContentLocale) {
  if (category) return categoryNames[category][locale];
  return locale === 'zh' ? '未分类' : 'Uncategorized';
}

export function educationTitle(row: EducationDraft, locale: ContentLocale) {
  const title = row.translations[locale]?.title;
  if (title !== undefined) return title;
  const category = educationCategory(row);
  return category && category !== 'custom' ? presetTitles[category][locale] : '';
}

export function educationDisplay(row: EducationDraft, locale: ContentLocale) {
  const values = row.translations[locale];
  const category = educationCategory(row);
  return {
    title: educationTitle(row, locale),
    categoryTitle: category === 'custom' ? values?.customCategoryLabel ?? '' : category ? educationCategoryLabel(category, locale) : '',
    program: values?.program ?? '',
    period: values?.period ?? '',
    grade: values?.grade ?? '',
    courseTitle: category === 'summerSchool' ? values?.courseTitle ?? '' : '',
    courseDescription: category === 'summerSchool' ? values?.courseDescription ?? '' : '',
  };
}

export type ExperienceText = {
  organization: string;
  title: string;
  period: string;
  description: string;
  location: string | null;
};

export type ExperienceDraft = OrderedDraftRecord & {translations: DraftTranslations<ExperienceText>};

export function newExperience(clientId: string, position: number): ExperienceDraft {
  return {clientId, position, translations: {}};
}

export type ProjectText = {title: string; subtitle: string; period: string; description: string; href: string};
export type ProjectMethodDraft = OrderedDraftRecord & {value: string};
export type ProjectDraft = OrderedDraftRecord & {
  translations: DraftTranslations<ProjectText>;
  methods: Record<ContentLocale, readonly ProjectMethodDraft[]>;
};

export function newProject(clientId: string, position: number): ProjectDraft {
  return {clientId, position, translations: {}, methods: {zh: [], en: []}};
}

export function updateProjectMethods(project: ProjectDraft, locale: ContentLocale, methods: readonly ProjectMethodDraft[]): ProjectDraft {
  return {...project, methods: {...project.methods, [locale]: methods}};
}

export function safeHttpUrl(value: string | undefined): string | undefined {
  const input = value?.trim();
  if (!input || !/^https?:\/\/[^/]/i.test(input) || /[\u0000-\u0020\u007f\\]/u.test(input)) return;
  try {
    const url = new URL(input);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // Invalid URL text remains in the local draft for the user to correct.
  }
}

export {safeHttpUrl as safeProjectUrl};

export function projectDisplay(project: ProjectDraft, locale: ContentLocale) {
  const values = project.translations[locale];
  return {
    title: values?.title ?? '',
    subtitle: values?.subtitle ?? '',
    period: values?.period ?? '',
    description: values?.description ?? '',
    href: safeHttpUrl(values?.href),
    methods: project.methods[locale].filter(method => method.value.trim()),
  };
}

export const skillPresetTitles = {
  programming: {zh: '编程', en: 'Programming'},
  dataSystems: {zh: '数据与系统', en: 'Data & Systems'},
  analytics: {zh: '分析', en: 'Analytics'},
  tools: {zh: '工具', en: 'Tools'},
  languages: {zh: '语言', en: 'Languages'},
} as const;

type SkillPreset = keyof typeof skillPresetTitles;
export type SkillCategory = SkillPreset | 'custom';
export const skillCategories: readonly SkillCategory[] = [...Object.keys(skillPresetTitles) as SkillPreset[], 'custom'];

export type SkillText = {title: string; items: string};
export type SkillDraft = OrderedDraftRecord & {
  // Editor choice only, never a storage column.
  category?: SkillCategory;
  translations: DraftTranslations<SkillText>;
};

export function newSkill(clientId: string, position: number): SkillDraft {
  return {clientId, position, translations: {}};
}

export function skillCategory(row: SkillDraft): SkillCategory {
  if (row.category) return row.category;
  const pair = (Object.keys(skillPresetTitles) as SkillPreset[]).find(key => {
    const titles = skillPresetTitles[key];
    return row.translations.zh?.title === titles.zh && row.translations.en?.title === titles.en;
  });
  return pair ?? 'custom';
}

export function skillTitle(row: SkillDraft, locale: ContentLocale): string {
  const category = skillCategory(row);
  return category === 'custom' ? row.translations[locale]?.title ?? '' : skillPresetTitles[category][locale];
}

export type AwardText = {name: string; year: string};
export type AwardDraft = OrderedDraftRecord & {translations: DraftTranslations<AwardText>};

export function newAward(clientId: string, position: number): AwardDraft {
  return {clientId, position, translations: {}};
}

export function awardYearsDiffer(row: AwardDraft): boolean {
  const zh = row.translations.zh?.year;
  const en = row.translations.en?.year;
  return zh !== undefined && en !== undefined && zh !== en;
}
