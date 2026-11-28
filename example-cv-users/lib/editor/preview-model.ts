import {bilingualFieldKey, collectEditorFields, editorLocales} from './bilingual-review.ts';
import type {ContentLocale, EditorModule, LocalDraft} from './draft.ts';
import {fillingGuide, guideMethod, guideRecord} from './filling-guide.ts';
import {educationTitle, type DraftTranslations} from './records.ts';

type Language = ContentLocale | 'shared';
type RepeatableModule = 'education' | 'experience' | 'projects' | 'skills' | 'awards';
type Collection = RepeatableModule | 'focus' | 'status';
export type GuideOverrides = Partial<Record<EditorModule, ReadonlySet<string>>>;

const fieldKey = (field: string, language: Language, item?: string) => language + ':' + bilingualFieldKey({field, item});
export const guideFieldCleared = (overrides: GuideOverrides, module: EditorModule, field: string, language: Language, item?: string) =>
  overrides[module]?.has(fieldKey(language === 'shared' ? 'shared:' + field : field, language, item));
const collectionKey = (group: Collection) => 'collection:' + group;
const repeatable = ['education', 'experience', 'projects', 'skills', 'awards'] as const;
const isRepeatable = (module: EditorModule): module is RepeatableModule =>
  repeatable.some(group => group === module);

// A cleared field or deleted collection can match the empty draft again.
// Keep that preview-only intent separately until the module is undone.
export function updateGuideOverrides(overrides: GuideOverrides, before: LocalDraft, after: LocalDraft, module: EditorModule, undo: boolean): GuideOverrides {
  const previous = overrides[module];
  if (undo) {
    if (!previous) return overrides;
    const next = {...overrides};
    delete next[module];
    return next;
  }
  const next = new Set(previous);
  const deleted = (group: Collection, before: readonly unknown[], after: readonly unknown[]) => {
    if (before.length && !after.length) next.add(collectionKey(group));
  };
  if (isRepeatable(module)) {
    deleted(module, before[module], after[module]);
  } else {
    if (module === 'contact') {
      deleted('focus', before.contact.focus, after.contact.focus);
      deleted('status', before.contact.status, after.contact.status);
    }
  }
  const updatedFields = collectEditorFields(after, module);
  for (const [key, field] of collectEditorFields(before, module)) {
    const updated = updatedFields.get(key);
    // A deleted record or method is already excluded by its stable ID.
    if (field.item && !updated) continue;
    if (field.field === 'methods') continue;
    for (const language of [...editorLocales, 'shared'] as const) {
      const beforeValue = (field.editValues ?? field.values)[language];
      const afterValue = updated && (updated.editValues ?? updated.values)[language];
      if ((beforeValue?.trim() || (field.editValues && field.values[language]?.trim())) && !afterValue?.trim() &&
        (afterValue !== undefined || !field.item)) {
        next.add(fieldKey(field.field, language, field.item));
      }
    }
  }
  return next.size === (previous?.size ?? 0) ? overrides : {...overrides, [module]: next};
}

export function buildPreview(draft: LocalDraft, overrides: GuideOverrides, showExamples: boolean) {
  const examples = new Map<EditorModule, Set<string>>();
  const mark = (module: EditorModule, key: string) => {
    const group = examples.get(module) ?? new Set<string>();
    group.add(key);
    examples.set(module, group);
  };
  const useExample = (module: EditorModule, key: string) => showExamples && !overrides[module]?.has(key);
  function fill<T extends Record<string, string | null | undefined>>(values: T, example: Partial<T>, module: EditorModule, language: Language, prefix = '', item?: string): T {
    if (!showExamples) return values;
    const merged = {...values};
    for (const field in example) {
      const value = example[field];
      const key = fieldKey(prefix + field, language, item);
      if (!values[field]?.trim() && value?.trim() && useExample(module, key)) {
        merged[field] = value;
        mark(module, key);
      }
    }
    return merged;
  }
  function translated<T extends Record<string, string | null | undefined>>(values: Partial<Record<ContentLocale, T>>, example: Partial<Record<ContentLocale, T>>, module: EditorModule, prefix = '', item?: string) {
    const merge = (locale: ContentLocale) => fill(values[locale] ?? {} as T, example[locale] ?? {}, module, locale, prefix, item);
    return {zh: merge('zh'), en: merge('en')};
  }
  function rows<T extends {clientId: string; translations: DraftTranslations<Record<string, string | null>>}>(values: readonly T[], example: readonly T[], module: EditorModule, group: Collection) {
    const key = collectionKey(group);
    if (values.length) return values.map(row => {
      const item = (module === 'contact' ? group + ':' : '') + row.clientId;
      const hints = guideRecord(module, draft, item) ?? {};
      return {...row, translations: translated(row.translations, hints, module, '', item)};
    });
    if (!example.length || !useExample(module, key)) return values;
    mark(module, key);
    return example;
  }
  const education = draft.education.map(row => ({
    ...row,
    translations: {
      // Preset titles are real editor values, even when derived from the category.
      zh: {...row.translations.zh, title: educationTitle(row, 'zh')},
      en: {...row.translations.en, title: educationTitle(row, 'en')},
    },
  }));
  const projects = draft.projects.map(row => {
    const methods = (locale: ContentLocale) => row.methods[locale].map(method => {
      const field = 'method:' + locale + ':' + method.clientId;
      return {...method, value: fill({[field]: method.value}, {[field]: guideMethod(locale)}, 'projects', locale, '', row.clientId)[field] ?? ''};
    });
    return {...row, methods: {zh: methods('zh'), en: methods('en')}};
  });
  const guide = fillingGuide;
  const content: LocalDraft = showExamples ? {
    profile: {
      shared: fill(draft.profile.shared, guide.profile.shared, 'profile', 'shared', 'shared:'),
      translations: translated(draft.profile.translations, guide.profile.translations, 'profile'),
    },
    introduction: {
      zh: fill({introduction: draft.introduction.zh}, {introduction: guide.introduction.zh}, 'introduction', 'zh').introduction,
      en: fill({introduction: draft.introduction.en}, {introduction: guide.introduction.en}, 'introduction', 'en').introduction,
    },
    education: rows(education, guide.education, 'education', 'education'),
    experience: rows(draft.experience, guide.experience, 'experience', 'experience'),
    projects: rows(projects, guide.projects, 'projects', 'projects'),
    skills: rows(draft.skills, guide.skills, 'skills', 'skills'),
    awards: rows(draft.awards, guide.awards, 'awards', 'awards'),
    contact: {
      translations: translated(draft.contact.translations, guide.contact.translations, 'contact'),
      focus: rows(draft.contact.focus, guide.contact.focus, 'contact', 'focus'),
      status: rows(draft.contact.status, guide.contact.status, 'contact', 'status'),
    },
    links: {
      shared: fill(draft.links.shared, guide.links.shared, 'links', 'shared', 'shared:'),
      translations: translated(draft.links.translations, guide.links.translations, 'links'),
    },
    'site-text': {
      navigation: translated(draft['site-text'].navigation, guide['site-text'].navigation, 'site-text', 'nav:'),
      translations: translated(draft['site-text'].translations, guide['site-text'].translations, 'site-text'),
    },
  } : draft;
  return {
    content,
    exampleField: (module: EditorModule, field: string, language: Language, item?: string) =>
      examples.get(module)?.has(fieldKey(language === 'shared' ? 'shared:' + field : field, language, item)) || undefined,
    exampleCollection: (module: EditorModule, group: Collection) => examples.get(module)?.has(collectionKey(group)) || undefined,
  };
}

export type SitePreview = ReturnType<typeof buildPreview>;
