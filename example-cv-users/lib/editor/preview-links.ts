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
  // Fictional project and contact details have no usable destination.
  if (isExample) return {status: 'example'};
  const href = validate(value);
  return href ? {href} : {status: 'invalid'};
}

const platformHomes = {github: 'https://github.com/', linkedin: 'https://www.linkedin.com/'} as const;

export function platformPreviewDestination(value: string | undefined, isExample: boolean | undefined, platform: keyof typeof platformHomes): PreviewDestination | undefined {
  const home = platformHomes[platform];
  if (isExample && value === home) return {href: home, status: 'example'};
  return previewDestination(value, isExample);
}

export function mailPreviewDestination(value: string | undefined, isExample: boolean | undefined): PreviewDestination | undefined {
  if (isExample && value === 'chen@example.org') return {href: 'mailto:chen@example.org', status: 'example'};
  return previewDestination(value, isExample, publicEmailMailto);
}
