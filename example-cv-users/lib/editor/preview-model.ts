import {collectEditorFields, editorLocales} from './bilingual-review.ts';
import type {ContentLocale, EditorModule, LocalDraft} from './draft.ts';
import {fillingGuide} from './filling-guide.ts';

type Language = ContentLocale | 'shared';
type RepeatableModule = 'education' | 'experience' | 'projects' | 'skills' | 'awards';
type Collection = RepeatableModule | 'focus' | 'status';
export type GuideOverrides = Partial<Record<EditorModule, ReadonlySet<string>>>;

const fieldKey = (field: string, language: Language) => language + ':' + field;
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
    const updatedFields = collectEditorFields(after, module);
    for (const [key, field] of collectEditorFields(before, module)) {
      if (field.item) continue;
      const updated = updatedFields.get(key);
      for (const language of [...editorLocales, 'shared'] as const) {
        if (field.values[language]?.trim() && !updated?.values[language]?.trim()) {
          next.add(fieldKey(field.field, language));
        }
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
  function fill<T extends Record<string, string | undefined>>(values: T, example: Partial<T>, module: EditorModule, language: Language, prefix = ''): T {
    if (!showExamples) return values;
    const merged = {...values};
    for (const field in example) {
      const value = example[field];
      const key = fieldKey(prefix + field, language);
      if (!values[field]?.trim() && value?.trim() && useExample(module, key)) {
        merged[field] = value;
        mark(module, key);
      }
    }
    return merged;
  }
  function translated<T extends Record<string, string | undefined>>(values: Partial<Record<ContentLocale, T>>, example: Partial<Record<ContentLocale, T>>, module: EditorModule, prefix = '') {
    const merge = (locale: ContentLocale) => fill(values[locale] ?? {} as T, example[locale] ?? {}, module, locale, prefix);
    return {zh: merge('zh'), en: merge('en')};
  }
  function rows<T>(values: readonly T[], example: readonly T[], module: EditorModule, group: Collection) {
    const key = collectionKey(group);
    if (values.length || !example.length || !useExample(module, key)) return values;
    mark(module, key);
    return example;
  }
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
    education: rows(draft.education, guide.education, 'education', 'education'),
    experience: rows(draft.experience, guide.experience, 'experience', 'experience'),
    projects: rows(draft.projects, guide.projects, 'projects', 'projects'),
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
    exampleField: (module: EditorModule, field: string, language: Language) =>
      examples.get(module)?.has(fieldKey(language === 'shared' ? 'shared:' + field : field, language)) || undefined,
    exampleCollection: (module: EditorModule, group: Collection) => examples.get(module)?.has(collectionKey(group)) || undefined,
  };
}

export type SitePreview = ReturnType<typeof buildPreview>;
