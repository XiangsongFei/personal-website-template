import {educationTitle, skillCategory, type EducationDraft, type ExperienceDraft, type ProjectDraft, type SkillDraft, type AwardDraft} from './records.ts';
import {emptyContact, type ContactDraft} from './contact.ts';
import {emptyLinks, type LinksDraft} from './site-links.ts';
import {emptySiteText, sectionTitleField, type SiteTextDraft} from './site-text.ts';

export type ContentLocale = 'zh' | 'en';
export const editorModules = {
  profile: true, introduction: true, education: true, experience: true, projects: true, skills: true, awards: true, contact: true, links: true,
  'site-text': true,
} as const;
export type EditorModule = keyof typeof editorModules;
type Localized<T> = Record<ContentLocale, T>;

export const INTRODUCTION_LIMIT = 20_000;

export const profileShared = {
  graduationValue: ['毕业时间', 'Graduation date', 80],
  avatarInitials: ['头像缩写', 'Avatar initials', 12],
  footerName: ['页脚署名', 'Footer name', 100],
  copyright: ['版权文字', 'Copyright text', 140],
} as const;

export const profileLocalized = {
  name: ['显示名称', 'Display name', 100],
  navAboutLabel: ['首页导航名称', 'Home navigation label', 48],
  graduationLabel: ['毕业时间标签', 'Graduation label', 48],
  emailActionLabel: ['邮件入口标签', 'Email action label', 48],
  avatarLabel: ['头像替代说明', 'Avatar description', 120],
  contactFocusHeading: ['联系区职业方向标题', 'Career interests heading', 72],
  contactStatusHeading: ['联系区状态标题', 'Contact status heading', 72],
} as const;

export type ProfileDraft = {
  shared: Record<keyof typeof profileShared, string>;
  translations: Localized<Record<keyof typeof profileLocalized, string>>;
};
export type LocalDraft = {
  profile: ProfileDraft;
  introduction: Localized<string>;
  education: readonly EducationDraft[];
  experience: readonly ExperienceDraft[];
  projects: readonly ProjectDraft[];
  skills: readonly SkillDraft[];
  awards: readonly AwardDraft[];
  contact: ContactDraft;
  links: LinksDraft;
  'site-text': SiteTextDraft;
};

export const emptyProfile: ProfileDraft = {
  shared: {graduationValue: '', avatarInitials: '', footerName: '', copyright: ''},
  translations: {
    zh: {name: '', navAboutLabel: '', graduationLabel: '', emailActionLabel: '', avatarLabel: '', contactFocusHeading: '', contactStatusHeading: ''},
    en: {name: '', navAboutLabel: '', graduationLabel: '', emailActionLabel: '', avatarLabel: '', contactFocusHeading: '', contactStatusHeading: ''},
  },
};

export const emptyDraft: LocalDraft = {
  profile: emptyProfile, introduction: {zh: '', en: ''}, education: [], experience: [], projects: [], skills: [], awards: [],
  contact: emptyContact,
  links: emptyLinks,
  'site-text': emptySiteText,
};

export function moduleFromHash(hash: string): EditorModule | undefined {
  if (!hash.startsWith('#')) return;
  const key = hash.slice(1);
  if (Object.hasOwn(editorModules, key)) return key as EditorModule;
}

export function validIntroduction(value: string) {
  // Match the candidate's UTF-16 limit and exclude invalid scalar text.
  return value.length <= INTRODUCTION_LIMIT && !/[\u0000\uD800-\uDFFF]/u.test(value);
}

export function moduleIsDirty<K extends EditorModule>(draft: LocalDraft, module: K, baseline = emptyDraft) {
  const heading = sectionTitleField(module);
  if (heading && (['zh', 'en'] as const).some(locale =>
    (draft['site-text'].translations[locale]?.[heading] ?? '') !== (baseline['site-text'].translations[locale]?.[heading] ?? ''))) return true;
  if (draft[module] === baseline[module]) return false;
  const snapshot = (value: LocalDraft) => {
    const data = module === 'education' ? value.education.map(row => ({...row, translations: {
      zh: {...row.translations.zh, title: educationTitle(row, 'zh')},
      en: {...row.translations.en, title: educationTitle(row, 'en')},
    }})) : module === 'skills' ? value.skills.map(row => ({...row, category: skillCategory(row)})) : value[module];
    return JSON.stringify(data, (key, node) => {
      // An untouched optional text field and a cleared one display the same value.
      if (key !== 'translations' && key !== 'navigation') {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
        return Object.fromEntries(Object.keys(node).sort().map(field => [field, node[field]]));
      }
      return Object.fromEntries((['zh', 'en'] as const).flatMap(locale => {
        const fields = Object.entries(node[locale] ?? {}).filter(([, field]) => field != null && field !== '')
          .sort(([left], [right]) => left.localeCompare(right));
        return fields.length ? [[locale, Object.fromEntries(fields)]] : [];
      }));
    });
  };
  return snapshot(draft) !== snapshot(baseline);
}

export function cancelModule(draft: LocalDraft, module: EditorModule, baseline = emptyDraft): LocalDraft {
  const next = {...draft, [module]: baseline[module]};
  const heading = sectionTitleField(module);
  if (!heading) return next;
  const site = draft['site-text'];
  const translations = {...site.translations};
  for (const language of ['zh', 'en'] as const) {
    const initial = baseline['site-text'].translations[language]?.[heading];
    if (site.translations[language]?.[heading] === initial) continue;
    const fields = {...translations[language]};
    if (initial === undefined) delete fields[heading];
    else fields[heading] = initial;
    if (Object.keys(fields).length) translations[language] = fields;
    else delete translations[language];
  }
  return {...next, 'site-text': {...site, translations}};
}
