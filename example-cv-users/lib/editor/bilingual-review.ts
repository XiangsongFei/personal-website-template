import type {ContentLocale, EditorModule, LocalDraft} from './draft.ts';
import {educationTitle, skillCategory} from './records.ts';

export const editorLocales = ['zh', 'en'] as const;
export type FieldKey = {item?: string; field: string};
type FieldValues = Partial<Record<ContentLocale | 'shared', string>>;
type Field = FieldKey & {values: FieldValues; bilingual?: boolean; editValues?: FieldValues};
export type EditorFields = ReadonlyMap<string, Field>;
export type Review = {source: ContentLocale; pending: boolean};
export type Reviews = ReadonlyMap<string, Review>;
export type EditFeedback = FieldKey & {module: EditorModule; locale: ContentLocale | 'shared'};

export function bilingualFieldKey({item, field}: FieldKey): string {
  return JSON.stringify([item ?? '', field]);
}

export const otherLocale = (locale: ContentLocale): ContentLocale => locale === 'zh' ? 'en' : 'zh';

type Translations = Partial<Record<ContentLocale, Record<string, string | null | undefined>>>;

export function collectEditorFields(draft: LocalDraft, module: EditorModule): EditorFields {
  const fields = new Map<string, Field>();
  const add = (field: string, values: FieldValues, item?: string, bilingual = false, editValues?: FieldValues) => {
    const key = {item, field};
    fields.set(bilingualFieldKey(key), {...key, values, bilingual, editValues});
  };
  const shared = (values: Record<string, string | null | undefined>, item?: string) => {
    for (const [field, value] of Object.entries(values)) add('shared:' + field, {shared: value ?? ''}, item);
  };
  const translations = (values: Translations, item?: string, prefix = '') => {
    const keys = new Set([...Object.keys(values.zh ?? {}), ...Object.keys(values.en ?? {})]);
    for (const key of keys) add(prefix + key, {zh: values.zh?.[key] ?? '', en: values.en?.[key] ?? ''}, item, true);
  };

  switch (module) {
    case 'profile':
      shared(draft.profile.shared);
      translations(draft.profile.translations);
      break;
    case 'introduction':
      add('introduction', draft.introduction, undefined, true);
      break;
    case 'links':
      shared(draft.links.shared);
      translations(draft.links.translations);
      break;
    case 'site-text':
      translations(draft['site-text'].translations);
      translations(draft['site-text'].navigation, undefined, 'nav:');
      break;
    case 'contact':
      translations(draft.contact.translations);
      for (const row of draft.contact.focus) translations(row.translations, 'focus:' + row.clientId);
      for (const row of draft.contact.status) {
        const item = 'status:' + row.clientId;
        translations(row.translations, item);
        shared({statusType: row.statusType}, item);
      }
      break;
    case 'skills':
      for (const row of draft.skills) {
        translations(row.translations, row.clientId);
        shared({category: skillCategory(row)}, row.clientId);
      }
      break;
    default:
      for (const row of draft[module]) {
        translations(row.translations, row.clientId);
        if ('entryType' in row) {
          shared({category: row.category}, row.clientId);
          add('title', {zh: educationTitle(row, 'zh'), en: educationTitle(row, 'en')}, row.clientId, true,
            {zh: row.translations.zh?.title, en: row.translations.en?.title});
        }
        if ('methods' in row) {
          for (const locale of editorLocales) {
            for (const method of row.methods[locale]) {
              add('method:' + locale + ':' + method.clientId, {[locale]: method.value}, row.clientId);
            }
          }
          const group = (locale: ContentLocale) => {
            const list = row.methods[locale];
            return list.length ? JSON.stringify(list.map(method => [method.clientId, method.value])) : '';
          };
          add('methods', {zh: group('zh'), en: group('en')}, row.clientId, true);
        }
      }
  }
  return fields;
}

const valueAt = (fields: EditorFields, key: string, locale: keyof FieldValues) => fields.get(key)?.values[locale] ?? '';

export function fieldModified(current: EditorFields, baseline: EditorFields, key: FieldKey, locale: keyof FieldValues) {
  const id = bilingualFieldKey(locale === 'shared' ? {...key, field: 'shared:' + key.field} : key);
  return valueAt(current, id, locale) !== valueAt(baseline, id, locale);
}

export function modifiedEditorFields(draft: LocalDraft, baseline: LocalDraft, modules: readonly EditorModule[]): EditFeedback[] {
  return modules.flatMap(module => {
    const current = collectEditorFields(draft, module);
    const original = collectEditorFields(baseline, module);
    return [...current].flatMap(([key, field]) => (['zh', 'en', 'shared'] as const).flatMap(locale =>
      valueAt(current, key, locale) === valueAt(original, key, locale) ? [] : [{module, item: field.item, field: field.field, locale}]));
  });
}
export function reviewChanges(previous: EditorFields, current: EditorFields, baseline: EditorFields, reviews: Reviews) {
  const next = new Map<string, Review>();
  const changed: (FieldKey & {locale: keyof FieldValues})[] = [];
  const locales = [...editorLocales, 'shared'] as const;
  for (const [key, field] of current) {
    const editedValue = (locale: keyof FieldValues) => field.editValues
      ? previous.get(key)?.editValues?.[locale] !== field.editValues[locale]
      : valueAt(previous, key, locale) !== valueAt(current, key, locale);
    for (const locale of locales) {
      if (editedValue(locale)) {
        changed.push({item: field.item, field: field.field, locale});
      }
    }
    if (!field.bilingual) continue;
    const edited = editorLocales.filter(editedValue);
    const dirty = (locale: ContentLocale) => valueAt(current, key, locale) !== valueAt(baseline, key, locale);
    const review = reviews.get(key);

    if (edited.length === 2) {
      // A joint change completes the pair in one operation.
      continue;
    }
    if (review && dirty(review.source)) {
      const pending = edited[0] === review.source ? true : edited.length ? false : review.pending;
      next.set(key, {source: review.source, pending});
    } else if (edited[0] && dirty(edited[0])) {
      next.set(key, {source: edited[0], pending: true});
    }
  }
  return {reviews: next, changed};
}
