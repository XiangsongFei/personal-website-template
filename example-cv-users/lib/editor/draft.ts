import type {EducationDraft, ExperienceDraft} from './records';

export type ContentLocale = 'zh' | 'en';
export const editorModules = {profile: true, introduction: true, education: true, experience: true} as const;
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
export type LocalDraft = {profile: ProfileDraft; introduction: Localized<string>; education: readonly EducationDraft[]; experience: readonly ExperienceDraft[]};

export const emptyProfile: ProfileDraft = {
  shared: {graduationValue: '', avatarInitials: '', footerName: '', copyright: ''},
  translations: {
    zh: {name: '', navAboutLabel: '', graduationLabel: '', emailActionLabel: '', avatarLabel: '', contactFocusHeading: '', contactStatusHeading: ''},
    en: {name: '', navAboutLabel: '', graduationLabel: '', emailActionLabel: '', avatarLabel: '', contactFocusHeading: '', contactStatusHeading: ''},
  },
};

export const emptyDraft: LocalDraft = {profile: emptyProfile, introduction: {zh: '', en: ''}, education: [], experience: []};

export function moduleFromHash(hash: string): EditorModule | undefined {
  if (!hash.startsWith('#')) return;
  const key = hash.slice(1);
  if (Object.hasOwn(editorModules, key)) return key as EditorModule;
}

export function validIntroduction(value: string) {
  // Match the candidate's UTF-16 limit and exclude invalid scalar text.
  return value.length <= INTRODUCTION_LIMIT && !/[\u0000\uD800-\uDFFF]/u.test(value);
}

export function moduleIsDirty<K extends EditorModule>(draft: LocalDraft, module: K) {
  return JSON.stringify(draft[module]) !== JSON.stringify(emptyDraft[module]);
}

export function cancelModule(draft: LocalDraft, module: EditorModule): LocalDraft {
  return {...draft, [module]: emptyDraft[module]};
}
