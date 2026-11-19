import type {ContentLocale} from './draft';
import {safeHttpUrl, type DraftTranslations} from './records.ts';

export type PublicLinkText = {linkedInLabel: string; linkedInHref: string};
export type LinksDraft = {
  shared: {
    email: string;
    emailLabel: string;
    github: string;
    githubLabel: string;
    linkedInDisplayName: string;
    linkedInLabel: string;
  };
  translations: DraftTranslations<PublicLinkText>;
};

export const emptyLinks: LinksDraft = {
  shared: {email: '', emailLabel: '', github: '', githubLabel: '', linkedInDisplayName: '', linkedInLabel: ''},
  translations: {},
};

// Store the mailbox only. This also excludes display names, lists and mailto headers.
export function safePublicEmail(raw: string): string | undefined {
  const email = raw.trim();
  if (email.length > 254 || /[\r\n]/u.test(raw)) return;
  const [local, domain, extra] = email.split('@');
  if (extra !== undefined || !local || local.length > 64 || !domain) return;
  const dotAtom = /^[a-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/i;
  const labels = domain.split('.');
  if (dotAtom.test(local) && labels.length >= 2 && labels.every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return email;
}

export function linkedInUrlsDiffer(draft: LinksDraft) {
  const zh = draft.translations.zh?.linkedInHref;
  const en = draft.translations.en?.linkedInHref;
  return zh !== undefined && en !== undefined && zh !== en;
}

export function publicLinksDisplay(draft: LinksDraft, locale: ContentLocale) {
  return {
    email: safePublicEmail(draft.shared.email),
    emailLabel: draft.shared.emailLabel,
    github: safeHttpUrl(draft.shared.github),
    githubLabel: draft.shared.githubLabel,
    linkedInHref: safeHttpUrl(draft.translations[locale]?.linkedInHref),
    linkedInDisplayName: draft.shared.linkedInDisplayName,
    linkedInActionLabel: draft.shared.linkedInLabel,
    linkedInContactLabel: draft.translations[locale]?.linkedInLabel ?? '',
  };
}
