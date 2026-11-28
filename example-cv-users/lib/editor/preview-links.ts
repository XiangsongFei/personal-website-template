import {safeHttpUrl} from './records.ts';
import {safePublicEmail} from './site-links.ts';

export function publicEmailMailto(value: string | undefined) {
  const email = safePublicEmail(value ?? '');
  if (!email) return;
  const [mailbox, domain] = email.split('@');
  const encoded = encodeURIComponent(mailbox).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return `mailto:${encoded}@${domain}`;
}

export type PreviewDestination = {href?: string; status?: 'example' | 'invalid'};

export function previewDestination(
  value: string | undefined, isExample: boolean | undefined, validate = safeHttpUrl,
): PreviewDestination | undefined {
  if (!value?.trim()) return;
  // The filling guide's reserved addresses illustrate what to type. Its
  // fictional project and contact details have no usable destination.
  if (isExample) return {status: 'example'};
  const href = validate(value);
  return href ? {href} : {status: 'invalid'};
}
