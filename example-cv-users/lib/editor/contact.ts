import type {ContentLocale} from './draft';
import type {DraftTranslations, OrderedDraftRecord} from './records';

export const contactStatusLabels = {
  study: {zh: '在读', en: 'Study'},
  graduation: {zh: '毕业', en: 'Graduation'},
  open: {zh: '开放机会', en: 'Open'},
} as const;
export type ContactStatusType = keyof typeof contactStatusLabels;

type ContactText = {contactLabel: string; availability: string};
type ContactItemText = {title: string; detail: string};
export type FocusDraft = OrderedDraftRecord & {translations: DraftTranslations<ContactItemText>};
export type StatusDraft = FocusDraft & {statusType: ContactStatusType};
export type ContactDraft = {
  translations: DraftTranslations<ContactText>;
  focus: readonly FocusDraft[];
  status: readonly StatusDraft[];
};

export const emptyContact: ContactDraft = {translations: {}, focus: [], status: []};

export function newFocus(clientId: string, position: number): FocusDraft {
  return {clientId, position, translations: {}};
}

export function newStatus(clientId: string, position: number): StatusDraft {
  return {...newFocus(clientId, position), statusType: 'open'};
}

function contactItemDisplay<T extends FocusDraft>(rows: readonly T[], locale: ContentLocale) {
  return rows.flatMap(row => {
    const {title = '', detail = ''} = row.translations[locale] ?? {};
    return title.trim() || detail.trim() ? [{row, title, detail}] : [];
  });
}

export function contactDisplay(contact: ContactDraft, locale: ContentLocale) {
  const {contactLabel = '', availability = ''} = contact.translations[locale] ?? {};
  return {
    contactLabel,
    availability,
    focus: contactItemDisplay(contact.focus, locale),
    status: contactItemDisplay(contact.status, locale),
  };
}
