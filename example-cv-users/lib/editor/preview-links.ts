import {safeHttpUrl} from './records.ts';
import {safePublicEmail} from './site-links.ts';

// Only illustrative destinations used in the isolated local workspace.
const demonstrationHosts = new Set(['example.com', 'example.net', 'example.org', 'github.com', 'www.linkedin.com']);

export function demoPreviewUrl(value: string | undefined) {
  const href = safeHttpUrl(value);
  if (!href) return;
  const url = new URL(href);
  if (!url.port && demonstrationHosts.has(url.hostname)) return href;
}

export function demoPreviewMailto(value: string | undefined) {
  const email = safePublicEmail(value ?? '');
  if (!email) return;
  const [mailbox, domain] = email.split('@');
  if (domain.toLowerCase() === 'example.invalid') return `mailto:${encodeURIComponent(mailbox)}@${domain}`;
}
