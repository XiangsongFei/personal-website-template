'use client';

import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {contactDisplay, contactStatusLabels} from '../../lib/editor/contact';
import {educationCategory, educationDisplay, projectDisplay, skillCategory, skillTitle} from '../../lib/editor/records';
import type {EditFeedback} from '../../lib/editor/bilingual-review';
import type {ContentLocale, EditorModule} from '../../lib/editor/draft';
import {mailPreviewDestination, platformPreviewDestination, previewDestination, type PreviewDestination} from '../../lib/editor/preview-links';
import type {SitePreview} from '../../lib/editor/preview-model';
import {publicLinksDisplay} from '../../lib/editor/site-links';
import {editableNavigationSections, previewSections, sectionTitleFields, siteNavigationLabel, type PreviewSection} from '../../lib/editor/site-text';

import {PreviewIcon} from './preview-icons';
import {PreviewContactNetwork} from './preview-contact-network';
import './public-preview.css';

// Match the public site's phone layout at the preview pane's actual width.
const phoneWidth = 640;
const splitCanvasWidth = 736;
const navigationClearance = 8;

function previewBounds(owner: HTMLElement, nav: HTMLElement | null) {
  const frame = owner.getBoundingClientRect();
  return {top: Math.max(frame.top, nav?.getBoundingClientRect().bottom ?? frame.top) + navigationClearance,
    bottom: frame.bottom};
}

// CSS zoom can make a scroller's units differ from the rendered coordinates.
// Measure the response of this scroller, including when it reaches its end.
function alignPreview(owner: HTMLElement, distance: () => number) {
  let scale = 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const gap = distance();
    if (Math.abs(gap) <= 1.25) break;
    const previous = owner.scrollTop;
    const next = Math.max(0, previous + gap / scale);
    const extra = Math.ceil(next - (owner.scrollHeight - owner.clientHeight));
    if (extra > 0) {
      const space = parseFloat(owner.style.getPropertyValue('--site-preview-end-space')) || 0;
      owner.style.setProperty('--site-preview-end-space', space + extra + 'px');
    }
    owner.scrollTop = next;
    const movement = owner.scrollTop - previous;
    if (!movement) break;
    const measured = (gap - distance()) / movement;
    if (Number.isFinite(measured) && measured > 0) scale = measured;
  }
}

function sameField(left: EditFeedback, right: EditFeedback) {
  return left.module === right.module && left.item === right.item && left.field === right.field && left.locale === right.locale;
}

function PreviewAnchor({href, className, children}: {href: string; className?: string; children: ReactNode}) {
  const external = !href.startsWith('mailto:');
  return <a className={className} href={href} target={external ? '_blank' : undefined}
    rel={external ? 'noopener noreferrer' : undefined}>{children}</a>;
}

function Action({kind, children, marker, valueKey, unavailable, href, example, exampleLabel, status}: {
  kind: 'mail' | 'file' | 'linkedin' | 'github'; children: ReactNode;
  marker?: string; valueKey?: string; unavailable?: string; href?: string;
  example?: boolean; exampleLabel?: boolean; status?: string;
}) {
  const contents = <><PreviewIcon kind={kind}/><span><PreviewText field={valueKey} example={exampleLabel}>{children}</PreviewText>
    {status && <small className="public-action-status">{status}</small>}</span><PreviewIcon kind="external"/></>;
  const address = marker === 'github' ? 'github' : marker === 'linkedin-action' ? 'linkedInHref' : marker === 'contact-cta' ? 'email' : undefined;
  if (href) return <span data-preview-public-link={marker} data-preview-value={address} data-preview-example-destination={example} title={unavailable}>
    <PreviewAnchor className="public-action" href={href}>{contents}</PreviewAnchor>
  </span>;
  return <span className="public-action" data-preview-public-link={marker} data-preview-value={address}
    data-preview-example={example} aria-disabled="true" title={unavailable}>{contents}</span>;
}

function ProjectPreviewLink({href, unavailable, children}: {href?: string; unavailable?: string; children: ReactNode}) {
  return href ? <div data-preview-project-url data-preview-value="href"><PreviewAnchor className="public-project-link" href={href}>{children}</PreviewAnchor></div>
    : <span className="public-project-link" data-preview-project-url data-preview-value="href" aria-disabled="true" title={unavailable}>{children}</span>;
}

function ContactPreviewLink({href, unavailable, children}: {href?: string; unavailable?: string; children: ReactNode}) {
  const contents = <>{children} <PreviewIcon kind="external"/></>;
  return href ? <PreviewAnchor href={href}>{contents}</PreviewAnchor> : <span aria-disabled="true" title={unavailable}>{contents}</span>;
}

function PreviewText({field, example, children}: {field?: string; example?: boolean; children: ReactNode}) {
  return <span data-preview-ink data-preview-value={field} data-preview-example={example}>{children}</span>;
}

function Bullets({value, locale, example}: {value?: string; locale: ContentLocale; example?: boolean}) {
  if (!value?.trim()) return null;
  const separator = value.includes('\n') ? /\r?\n/ : locale === 'zh' ? /[；。]/ : /\.\s+(?=[A-Z])/;
  return <ul className="public-bullets">{value.split(separator).map((line, index) =>
    line.trim() && <li key={index}><PreviewText field="description" example={example}>{line.trim()}</PreviewText></li>)}</ul>;
}

function previewFieldNodes(viewport: HTMLElement, {module, item, locale, field: key}: EditFeedback) {
  const field = key.replace(/^shared:/, '');
  const value = (name: string) => `[data-preview-value="${CSS.escape(name)}"]`;
  const nodes = (selector: string) => viewport.querySelectorAll<HTMLElement>(selector);
  if (module === 'site-text' && field.startsWith('nav:')) {
    return nodes(`[data-preview-nav="${CSS.escape(field.slice(4))}"]`);
  }
  if (module === 'links' && field === 'linkedInLabel' && locale === 'shared') return nodes(value('linkedInButtonLabel'));
  if (module === 'links' && field === 'linkedInHref') return nodes('[data-preview-public-link="linkedin"], ' + value('linkedInHref'));
  if (module === 'profile' && field === 'avatarLabel') return [];
  if (module === 'profile' && field === 'name') return nodes('#site-preview-name ' + value('name'));
  if (module === 'introduction') return nodes('.public-intro:has(' + value('introduction') + ')');
  if (module === 'projects' && field === 'methods') return [];
  if (module === 'contact' && item) {
    const [group, ...id] = item.split(':');
    const marker = group === 'focus' ? 'data-preview-focus' : 'data-preview-status';
    return nodes(`[${marker}="${CSS.escape(id.join(':'))}"] ${value(field)}`);
  }
  if (!item) return nodes(value(field));
  const row = `[data-site-section="${module}"] [data-preview-entry="${CSS.escape(item)}"]`;
  if (field === 'description') return nodes(`${row} .public-bullets:has(${value(field)})`);
  if (field.startsWith('method:')) {
    const methodId = field.slice(field.indexOf(':', 7) + 1);
    return nodes(`${row} [data-preview-method="${CSS.escape(methodId)}"]`);
  }
  return nodes(`${row} ${value(field)}`);
}

function fitTimelineDates(owner: HTMLElement) {
  const dates = Array.from(owner.querySelectorAll<HTMLElement>('[data-preview-value="period"], .public-date [data-preview-value="year"]'))
    .filter(date => date.getClientRects().length);
  for (const date of dates) date.style.removeProperty('--preview-date-scale');
  const mobile = owner.dataset.siteLayout === 'mobile';
  const availableFraction = mobile && owner.clientWidth < 376 ? 1 : .64;
  const text = document.createRange();
  const scales = dates.map(date => {
    text.selectNodeContents(date);
    const width = text.getBoundingClientRect().width;
    const available = (date.closest('article')?.getBoundingClientRect().width ?? 0) * availableFraction;
    return available && width > available ? available / width : 1;
  });
  for (const [index, scale] of scales.entries()) {
    if (scale < 1) dates[index].style.setProperty('--preview-date-scale', String(scale));
  }
}

export function FullSitePreview({preview, locale, module, onLocaleChange, modified, focused, showExamples}: {
  preview: SitePreview; locale: ContentLocale; module: PreviewSection; onLocaleChange: (locale: ContentLocale) => void;
  modified?: readonly EditFeedback[]; focused?: EditFeedback; showExamples?: boolean;
}) {
  const draft = preview.content;
  const [contactOverride, setContactOverride] = useState<{module: PreviewSection; expanded: boolean}>();
  const contactExpanded = contactOverride?.module === module ? contactOverride.expanded : module === 'contact';
  const viewport = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const anchoredSection = useRef<PreviewSection>(module);
  const followSection = useRef(true);
  const correction = useRef(0);
  const pendingSection = useRef<PreviewSection>(undefined);
  const fieldReveal = useRef<{target: EditFeedback; handled: boolean; fallback: boolean; manual: boolean} | null>(null);
  const languageAnchor = useRef<{section: PreviewSection; offset: number} | null>(null);
  const labels = (key: PreviewSection) => previewSections[key][locale === 'zh' ? 0 : 1];
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const example = (module: EditorModule, field: string, language: ContentLocale | 'shared' = locale) =>
    preview.exampleField(module, field, language);
  const recordText = (module: EditorModule, item: string, field: string, value: ReactNode) =>
    <PreviewText example={preview.exampleField(module, field, locale, item)}>{value}</PreviewText>;
  const unavailable = (destination: PreviewDestination) => destination.status === 'example'
    ? destination.href ? text('平台首页示例', 'Platform homepage example') : text('填写示例，无可访问地址', 'Filling example · no destination')
    : destination.status === 'invalid' ? text('地址无效，请在编辑区检查', 'Invalid address · check the editor') : undefined;
  const profile = draft.profile.translations[locale];
  const shared = draft.profile.shared;
  const contact = contactDisplay(draft.contact, locale);
  const links = publicLinksDisplay(draft.links, locale);
  const email = mailPreviewDestination(draft.links.shared.email, example('links', 'email', 'shared'));
  const github = platformPreviewDestination(draft.links.shared.github, example('links', 'github', 'shared'), 'github');
  const linkedIn = platformPreviewDestination(draft.links.translations[locale]?.linkedInHref, example('links', 'linkedInHref'), 'linkedin');
  const siteText = draft['site-text'].translations[locale];
  const navLabel = (section: PreviewSection) => {
    const value = section === 'profile' ? profile.navAboutLabel : siteNavigationLabel(draft['site-text'], locale, section);
    return value?.trim() ? value : labels(section);
  };
  const sectionTitle = (section: keyof typeof sectionTitleFields) => {
    const value = siteText?.[sectionTitleFields[section]];
    return value?.trim() ? value : labels(section);
  };
  const education = draft.education.flatMap(row => {
    const values = educationDisplay(row, locale);
    return Object.values(values).some(value => value.trim()) ? [{...values, clientId: row.clientId, summerSchool: educationCategory(row) === 'summerSchool', custom: educationCategory(row) === 'custom'}] : [];
  });

  const experience = draft.experience.flatMap(row => {
    const values = row.translations[locale];
    if (!values || !Object.values(values).some(value => value?.trim())) return [];
    return [{...values, clientId: row.clientId}];
  });

  const projects = draft.projects.flatMap(row => {
    const values = projectDisplay(row, locale);
    const destination = previewDestination(row.translations[locale]?.href,
      preview.exampleCollection('projects', 'projects') || preview.exampleField('projects', 'href', locale, row.clientId));
    const hasContent = [values.title, values.subtitle, values.period, values.description].some(value => value.trim());
    return hasContent || destination || values.methods.length ? [{...values, destination, clientId: row.clientId}] : [];
  });

  const skills = draft.skills.flatMap(row => {
    const title = skillTitle(row, locale);
    const items = row.translations[locale]?.items ?? '';
    return title.trim() || items.trim() ? [{clientId: row.clientId, title, items, custom: skillCategory(row) === 'custom'}] : [];
  });

  const awards = draft.awards.flatMap(row => {
    const {name = '', year = ''} = row.translations[locale] ?? {};
    return name.trim() || year.trim() ? [{clientId: row.clientId, name, year}] : [];
  });

  function align(owner: HTMLElement, target: HTMLElement, offset = 0) {
    cancelAnimationFrame(correction.current);
    const update = () => {
      if (!target.isConnected || !owner.clientHeight) return;
      alignPreview(owner, () => target.getBoundingClientRect().top - previewBounds(owner, navigation.current).top + offset);
    };
    update();
    correction.current = requestAnimationFrame(update);
  }

  function position(section: PreviewSection, offset = 0) {
    const owner = viewport.current;
    const target = owner?.querySelector<HTMLElement>(`[data-site-section="${section}"]`);
    if (!owner || !owner.clientHeight || !target) return false;
    cancelAnimationFrame(correction.current);
    owner.style.removeProperty('--site-preview-end-space');
    anchoredSection.current = section;
    followSection.current = true;
    if (section === 'profile' && offset === 0) {
      owner.scrollTop = 0;
    } else align(owner, target, offset);
    return true;
  }

  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner) return;
    let measuredWidth = 0;
    let measuredHeight = 0;
    const measure = () => {
      const style = getComputedStyle(owner);
      const width = owner.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd);
      const height = owner.clientHeight;
      if (width === measuredWidth && height === measuredHeight) return;
      if (width > 0 && width !== measuredWidth) {
        const split = style.getPropertyValue('--editor-split').trim() === '1';
        const scaled = split && width < splitCanvasWidth;
        owner.dataset.siteLayout = !split && width <= phoneWidth ? 'mobile' : 'desktop';
        owner.style.setProperty('--public-canvas-width', scaled ? splitCanvasWidth + 'px' : 'min(100%, 1100px)');
        owner.style.setProperty('--public-canvas-scale', scaled ? String(width / splitCanvasWidth) : '1');
        fitTimelineDates(owner);
      }
      measuredWidth = width;
      measuredHeight = height;
      if (followSection.current) position(anchoredSection.current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(owner);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(correction.current);
    };
  }, []);

  useLayoutEffect(() => { setContactOverride(undefined); }, [module]);

  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner) return;
    // A hidden single-column pane has no layout. Position it once it opens.
    if (fieldReveal.current) fieldReveal.current.handled = true;
    if (position(module)) return;
    const observer = new ResizeObserver(() => {
      if (position(module)) observer.disconnect();
    });
    observer.observe(owner);
    return () => observer.disconnect();
  }, [module]);

  useLayoutEffect(() => {
    if (!pendingSection.current) return;
    const section = pendingSection.current;
    pendingSection.current = undefined;
    position(section);
  }, [contactExpanded]);

  useLayoutEffect(() => {
    if (followSection.current) position(anchoredSection.current);
  }, [showExamples]);

  function switchLanguage() {
    const owner = viewport.current;
    if (!owner) return;
    const {top} = previewBounds(owner, navigation.current);
    const sections = Array.from(owner.querySelectorAll<HTMLElement>('[data-site-section]'));
    const profileSection = sections[0];
    const current = sections.reverse().find(section => section.getBoundingClientRect().top <= top + 1.25) ?? profileSection;
    if (current) {
      languageAnchor.current = {
        section: current.dataset.siteSection as PreviewSection,
        offset: Math.max(0, top - current.getBoundingClientRect().top),
      };
    }
    onLocaleChange(locale === 'zh' ? 'en' : 'zh');
  }

  useLayoutEffect(() => {
    if (!languageAnchor.current) return;
    const {section, offset} = languageAnchor.current;
    languageAnchor.current = null;
    position(section, offset);
  }, [locale]);

  const dateContent = JSON.stringify([
    education.map(entry => entry.period), experience.map(entry => entry.period),
    projects.map(entry => entry.period), awards.map(entry => entry.year),
  ]);
  useLayoutEffect(() => { if (viewport.current) fitTimelineDates(viewport.current); }, [dateContent]);

  // Reveal a matching field once per focus, including a value that first appears while typing.
  // Keep manual preview scrolling and the separately selected preview language intact.
  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner || !focused) {
      fieldReveal.current = null;
      return;
    }
    const previous = fieldReveal.current;
    if (!previous || !sameField(previous.target, focused) || (previous.manual && previous.target !== focused)) {
      fieldReveal.current = {target: focused, handled: false, fallback: false, manual: false};
    }
    const request = fieldReveal.current;
    if (!request) return;
    request.target = focused;
    if (request.handled || !owner.clientHeight || (focused.locale !== 'shared' && focused.locale !== locale)) return;
    const matches = Array.from(previewFieldNodes(owner, focused));
    if (!contactExpanded && (matches.some(node => node.closest('.public-contact-extension[hidden]')) ||
      (focused.module === 'contact' && focused.item))) {
      setContactOverride({module, expanded: true});
      return;
    }
    if (focused.module === 'profile' && focused.field === 'avatarLabel') {
      const portrait = owner.querySelector<HTMLElement>('.public-portrait');
      if (portrait) matches.push(portrait);
    }
    const {top, bottom} = previewBounds(owner, navigation.current);
    const inView = (node: HTMLElement) => {
      if (node.closest('.site-preview-nav')) return true;
      const bounds = node.getBoundingClientRect();
      return bounds.top >= top - 1.25 && bounds.top + Math.min(bounds.height, bottom - top) <= bottom + 1.25;
    };
    const visible = matches.filter(node => node.getClientRects().length && (node.textContent?.trim() || node.querySelector('svg')));
    if (visible.length) {
      request.handled = true;
      if (visible.some(inView)) return;
      const target = visible.find(node => focused.module === 'links' && node.closest('.public-contact')) ?? visible[0];
      followSection.current = false;
      align(owner, target);
    } else if (!request.fallback) {
      request.fallback = true;
      const headingSection = Object.entries(sectionTitleFields).find(([, key]) => key === focused.field)?.[0] as PreviewSection | undefined;
      const targetSection = headingSection ?? (focused.module === 'links' || focused.module === 'site-text' ? 'contact' : focused.module);
      const section = owner.querySelector<HTMLElement>(`[data-site-section="${targetSection}"]`);
      const row = focused.item && section?.querySelector<HTMLElement>(`[data-preview-entry="${CSS.escape(focused.item)}"]`);
      const target = row || section;
      if (target && !inView(target)) {
        followSection.current = false;
        align(owner, target);
      }
    }
  }, [focused, draft, locale, contactExpanded]);

  function preserveManualScroll() {
    cancelAnimationFrame(correction.current);
    followSection.current = false;
    if (fieldReveal.current) {
      fieldReveal.current.handled = true;
      fieldReveal.current.manual = true;
    }
  }

  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner || !modified?.length) return;
    const marked = new Set<HTMLElement>();
    for (const change of modified) {
      if (change.locale !== 'shared' && change.locale !== locale) continue;
      const active = focused && sameField(focused, change);
      for (const node of previewFieldNodes(owner, change)) {
        const textNodes = node.matches('[data-preview-ink]') ? [node] : node.querySelectorAll<HTMLElement>('[data-preview-ink]');
        for (const ink of textNodes) {
          if (ink.closest('[data-preview-example]') || !ink.textContent?.trim() ||
            (change.module !== 'site-text' && ink.closest('[data-preview-example-record]'))) continue;
          if (active || !marked.has(ink)) ink.dataset.previewEditFeedback = active ? 'active' : 'modified';
          marked.add(ink);
        }
      }
    }
    return () => {for (const node of marked) delete node.dataset.previewEditFeedback;};
  }, [preview, focused, locale, modified, contactExpanded]);

  const emptyContent = <p className="public-placeholder">{text('暂无本地内容', 'No local content')}</p>;
  const introduction = draft.introduction[locale].split(/\r?\n/).filter(line => line.trim());
  const pdfLabel = siteText?.portfolioLabel;
  const pdfUnavailable = text('PDF 文件功能尚未开放', 'PDF files are not available yet');
  const contactHint = email?.status === 'invalid'
    ? text('请检查编辑区的公开邮箱地址。', 'Check the public email address in the editor.')
    : text('请在公开链接中填写邮箱地址以启用邮件。', 'Enter a public email address in Public links to enable email.');
  const emailExampleHint = email?.status === 'example' && email.href ? text('填写示例邮箱', 'Example email address') : undefined;
  const exampleLinkedInName = example('links', 'linkedInDisplayName', 'shared');
  const useLinkedInName = links.linkedInDisplayName.trim() && !exampleLinkedInName;
  const linkedInName = useLinkedInName ? links.linkedInDisplayName : links.linkedInHref ?? 'LinkedIn';
  function goToSection(key: PreviewSection) {
    const expandContact = key === 'contact';
    if (expandContact === contactExpanded) {
      position(key);
    } else {
      // Position after React commits the height of the contact details.
      pendingSection.current = key;
      setContactOverride({module, expanded: expandContact});
    }
  }
  const navButton = (key: PreviewSection, className?: string) => <button type="button" className={className} key={key}
    data-preview-nav={key} data-preview-value={key === 'profile' ? 'navAboutLabel' : undefined} aria-expanded={key === 'contact' ? contactExpanded : undefined}
    data-preview-example={key === 'profile' ? example('profile', 'navAboutLabel') : example('site-text', 'nav:' + key)}
    onClick={() => goToSection(key)}><PreviewText>{navLabel(key)}</PreviewText></button>;

  return <div className="site-preview-viewport public-preview" ref={viewport} tabIndex={0}
    onWheel={preserveManualScroll} onPointerDown={preserveManualScroll} onTouchStart={preserveManualScroll}
    onKeyDown={event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) preserveManualScroll();
    }}
    role="region" aria-label={text('个人网站预览内容', 'Personal website preview content')} lang={locale === 'zh' ? 'zh-CN' : 'en'}>
    <nav className="site-preview-nav" ref={navigation} aria-label={text('预览网站导航', 'Preview website navigation')}>
      <div className="public-nav public-canvas">
        {navButton('profile', 'public-nav-home')}
        <div className="public-nav-links">{editableNavigationSections.map(key => navButton(key))}</div>
        <button type="button" className="public-nav-language" aria-label={text('切换预览语言', 'Switch preview language')}
          onClick={switchLanguage}>{locale === 'zh' ? 'EN' : '中文'}</button>
      </div>
    </nav>
    <article className="site-preview-page public-canvas">
      <header className="public-hero" data-site-section="profile" aria-labelledby="site-preview-name">
        <div className="public-hero-copy">
          <h1 id="site-preview-name"><PreviewText field="name" example={example('profile', 'name')}>{profile.name.trim() ? profile.name : text('你的名字', 'Your name')}</PreviewText></h1>
          <div className="public-intro" data-site-section="introduction" data-preview-example={example('introduction', 'introduction')}>
            {introduction.length ? introduction.map((line, index) => <p key={index}><PreviewText field="introduction">{line}</PreviewText></p>) : emptyContent}
          </div>
          <div className="public-actions">
            <Action kind="mail" marker="contact-cta" valueKey="emailActionLabel" href={email?.href}
              example={email?.status === 'example' || undefined} exampleLabel={example('profile', 'emailActionLabel')}
              unavailable={email?.href ? emailExampleHint : contactHint}>
              {profile.emailActionLabel.trim() ? profile.emailActionLabel : text('联系我', 'Get in touch')}</Action>
            {pdfLabel?.trim() && <span data-preview-pdf-label>
              <Action kind="file" valueKey="portfolioLabel" unavailable={pdfUnavailable} exampleLabel={example('site-text', 'portfolioLabel')}
                status={text('未开放', 'Unavailable')}>
                {pdfLabel}
              </Action>
            </span>}
            {linkedIn && <Action kind="linkedin" marker="linkedin-action" unavailable={unavailable(linkedIn)} valueKey="linkedInButtonLabel"
              href={linkedIn.href} example={linkedIn.status === 'example' || undefined}
              exampleLabel={example('links', 'linkedInLabel', 'shared')}>
              {links.linkedInActionLabel.trim() ? links.linkedInActionLabel : 'LinkedIn'}</Action>}
            {github && <Action kind="github" marker="github" unavailable={unavailable(github)} valueKey="githubLabel"
              href={github.href} example={github.status === 'example' || undefined}
              exampleLabel={example('links', 'githubLabel', 'shared')}>
              {links.githubLabel.trim() ? links.githubLabel : 'GitHub'}</Action>}
          </div>
          {(shared.graduationValue.trim() || profile.graduationLabel.trim()) && <div className="public-graduation">
            <PreviewText field="graduationLabel" example={example('profile', 'graduationLabel')}>{profile.graduationLabel.trim() ? profile.graduationLabel : text('毕业时间', 'Graduation')}</PreviewText>
            {shared.graduationValue.trim() && <b data-preview-value="graduationValue"><PreviewText example={example('profile', 'graduationValue', 'shared')}>{shared.graduationValue}</PreviewText></b>}
          </div>}
        </div>
        <div className="public-portrait" data-preview-value="avatarInitials" data-preview-example={example('profile', 'avatarInitials', 'shared')}
          role="img" aria-label={profile.avatarLabel.trim() || text('头像占位，上传尚未开放', 'Portrait placeholder, upload unavailable')}>
          {shared.avatarInitials.trim() ? <PreviewText>{shared.avatarInitials}</PreviewText> : '—'}
        </div>
      </header>

      <section className="public-section public-education public-timeline" data-site-section="education" data-empty={!education.length}>
        <h2 data-preview-value={sectionTitleFields.education} data-preview-example={example('site-text', sectionTitleFields.education)}><PreviewText>{sectionTitle('education')}</PreviewText></h2>
        {education.map(({clientId, title, categoryTitle, program, period, grade, courseTitle, courseDescription, summerSchool, custom}) =>
          <article key={clientId} className={summerSchool ? 'public-summer-school' : undefined} data-preview-entry={clientId}
            data-preview-example-record={preview.exampleCollection('education', 'education')}>
            <div>
              {title.trim() && <h3 data-preview-value="title">{recordText('education', clientId, 'title', title)}</h3>}
              {categoryTitle.trim() && categoryTitle !== title && <p className="public-secondary" data-preview-value={custom ? "customCategoryLabel" : "category"}>{recordText('education', clientId, 'customCategoryLabel', categoryTitle)}</p>}
              {program.trim() && <p className="public-program" data-preview-value="program">{recordText('education', clientId, 'program', program)}</p>}
              {courseTitle.trim() && <p className="public-course" data-preview-value="courseTitle">{recordText('education', clientId, 'courseTitle', courseTitle)}</p>}
              {courseDescription.trim() && <p className="public-course-detail" data-preview-value="courseDescription">{recordText('education', clientId, 'courseDescription', courseDescription)}</p>}
            </div>
            <div className="public-date">{period.trim() && <b data-preview-value="period">{recordText('education', clientId, 'period', period)}</b>}
              {grade.trim() && <div className="public-grades" data-preview-value="grade">{(summerSchool ? [grade] : grade.split(' · ')).map((line, index) =>
                line.trim() && <span key={index}>{recordText('education', clientId, 'grade', line)}</span>)}</div>}</div>
          </article>)}
      </section>
      <section className="public-section public-work public-timeline" data-site-section="experience" data-empty={!experience.length}>
        <h2 data-preview-value={sectionTitleFields.experience} data-preview-example={example('site-text', sectionTitleFields.experience)}><PreviewText>{sectionTitle('experience')}</PreviewText></h2>
        {experience.map(({clientId, title, organization, period, location, description}) =>
          <article key={clientId} data-preview-entry={clientId} data-preview-example-record={preview.exampleCollection('experience', 'experience')}>
            <div className="public-entry-copy">
              {(organization?.trim() || title?.trim()) && <h3 data-preview-value={organization?.trim() ? "organization" : "title"}>{organization?.trim() ? recordText('experience', clientId, 'organization', organization) : recordText('experience', clientId, 'title', title)}</h3>}
              {period?.trim() && <b className="public-mobile-date" data-preview-value="period">{recordText('experience', clientId, 'period', period)}</b>}
              {organization?.trim() && title?.trim() && <p className="public-subtitle" data-preview-value="title">{recordText('experience', clientId, 'title', title)}</p>}
              {location?.trim() && <p className="public-secondary" data-preview-value="location">{recordText('experience', clientId, 'location', location)}</p>}
              <Bullets value={description} locale={locale} example={preview.exampleField('experience', 'description', locale, clientId)}/>
            </div>
            <div className="public-date">{period?.trim() && <b data-preview-value="period">{recordText('experience', clientId, 'period', period)}</b>}</div>
          </article>)}
      </section>
      <section className="public-section public-work public-projects public-timeline" data-site-section="projects" data-empty={!projects.length}>
        <h2 data-preview-value={sectionTitleFields.projects} data-preview-example={example('site-text', sectionTitleFields.projects)}><PreviewText>{sectionTitle('projects')}</PreviewText></h2>
        {projects.map(({clientId, title, subtitle, period, description, destination, methods}) =>
          <article key={clientId} data-preview-entry={clientId} data-preview-example-record={preview.exampleCollection('projects', 'projects')}>
            <div className="public-entry-copy">
              {title.trim() && <h3 data-preview-value="title">{recordText('projects', clientId, 'title', title)}</h3>}
              {period.trim() && <b className="public-mobile-date" data-preview-value="period">{recordText('projects', clientId, 'period', period)}</b>}
              {subtitle.trim() && <p className="public-subtitle" data-preview-value="subtitle">{recordText('projects', clientId, 'subtitle', subtitle)}</p>}
              {!!methods.length && <p className="public-methods" data-preview-value="methods">{methods.map((method, index) =>
                <span key={method.clientId}>{index > 0 && ' · '}<span data-preview-method={method.clientId}>{recordText('projects', clientId, 'method:' + locale + ':' + method.clientId, method.value)}</span></span>)}</p>}
              <Bullets value={description} locale={locale} example={preview.exampleField('projects', 'description', locale, clientId)}/>
              {destination && <ProjectPreviewLink href={destination.href} unavailable={unavailable(destination)}>
                <PreviewText field="kaggleLabel" example={example('site-text', 'kaggleLabel')}>{siteText?.kaggleLabel?.trim() ? siteText.kaggleLabel : text('项目链接', 'Project URL')}</PreviewText> <PreviewIcon kind="external"/>
              </ProjectPreviewLink>}
            </div>
            <div className="public-date">{period.trim() && <b data-preview-value="period">{recordText('projects', clientId, 'period', period)}</b>}</div>
          </article>)}
      </section>
      <section className="public-section public-skills" data-site-section="skills" data-empty={!skills.length}>
        <h2 data-preview-value={sectionTitleFields.skills} data-preview-example={example('site-text', sectionTitleFields.skills)}><PreviewText>{sectionTitle('skills')}</PreviewText></h2>
        <div className="public-skill-grid">{skills.map(({clientId, title, items, custom}) =>
          <div key={clientId} data-preview-entry={clientId} data-preview-example-record={preview.exampleCollection('skills', 'skills')}>
            {title.trim() && <h3 data-preview-value={custom ? "title" : "category"}>{recordText('skills', clientId, 'title', title)}</h3>}{items.trim() && <p data-preview-value="items">{recordText('skills', clientId, 'items', items)}</p>}
          </div>)}</div>
      </section>
      <section className="public-section public-awards public-timeline" data-site-section="awards" data-empty={!awards.length}>
        <h2 data-preview-value={sectionTitleFields.awards} data-preview-example={example('site-text', sectionTitleFields.awards)}><PreviewText>{sectionTitle('awards')}</PreviewText></h2>
        {awards.map(({clientId, name, year}) =>
          <article key={clientId} data-preview-entry={clientId} data-preview-example-record={preview.exampleCollection('awards', 'awards')}>
            {name.trim() ? <h3 data-preview-value="name">{recordText('awards', clientId, 'name', name)}</h3> : <span/>}
            <div className="public-date">{year.trim() && <b data-preview-value="year">{recordText('awards', clientId, 'year', year)}</b>}</div>
          </article>)}
      </section>
      <footer className="public-contact" data-site-section="contact">
        <p className="public-contact-label" data-preview-value="contactLabel" data-preview-example={example('contact', 'contactLabel')}><PreviewText>{contact.contactLabel.trim() ? contact.contactLabel : labels('contact')}</PreviewText></p>
        {contact.availability.trim() && <h2 data-preview-value="availability" data-preview-example={example('contact', 'availability')}><PreviewText>{contact.availability}</PreviewText></h2>}
        {(email || linkedIn) && <dl className="public-contact-links">
          {email && <div><dt data-preview-value="emailLabel" data-preview-example={example('links', 'emailLabel', 'shared')}><PreviewText>{links.emailLabel.trim() ? links.emailLabel : text('邮箱', 'Email')}</PreviewText></dt>
            <dd data-preview-public-link="email" data-preview-value="email" data-preview-example={example('links', 'email', 'shared')}
              title={emailExampleHint}>
              {email.href ? <PreviewAnchor href={email.href}><PreviewText>{links.email}</PreviewText> <PreviewIcon kind="external"/></PreviewAnchor>
                : <span aria-disabled="true" title={unavailable(email)}>{links.email ?? text('无效邮箱', 'Invalid email')} <PreviewIcon kind="external"/></span>}
            </dd></div>}
          {linkedIn && <div><dt data-preview-value="linkedInLabel">
            <PreviewText example={example('links', 'linkedInLabel')}>{links.linkedInContactLabel.trim() || 'LinkedIn'}</PreviewText>
          </dt>
            <dd data-preview-public-link="linkedin" data-preview-value="linkedInDisplayName" data-preview-example-destination={linkedIn.status === 'example' || undefined}>
              <ContactPreviewLink href={linkedIn.href} unavailable={unavailable(linkedIn)}>
                <PreviewText example={!useLinkedInName && linkedIn.status === 'example' || undefined}>{linkedInName}</PreviewText>
              </ContactPreviewLink>
            </dd></div>}
        </dl>}
        {contactExpanded && !email?.href && <p className="public-contact-guide">{contactHint}</p>}
        <div className="public-footer-meta">
          <PreviewText field="footerName" example={example('profile', 'footerName', 'shared')}>{shared.footerName}</PreviewText>
          <span data-preview-value="updatedAtLabel" data-preview-example={example('site-text', 'updatedAtLabel')} data-preview-updated-label={siteText?.updatedAtLabel?.trim() ? '' : undefined}>
            {siteText?.updatedAtLabel?.trim() && <PreviewText>{siteText.updatedAtLabel} · —</PreviewText>}
          </span>
          <PreviewText field="copyright" example={example('profile', 'copyright', 'shared')}>{shared.copyright}</PreviewText>
        </div>
        {(profile.contactFocusHeading.trim() || contact.focus.length > 0 || profile.contactStatusHeading.trim() || contact.status.length > 0) &&
          <div className="public-contact-extension" hidden={!contactExpanded}>
            <div>
              {(profile.contactFocusHeading.trim() || contact.focus.length > 0) &&
                <h3 data-preview-value="contactFocusHeading" data-preview-example={example('profile', 'contactFocusHeading')}><PreviewText>{profile.contactFocusHeading.trim() ? profile.contactFocusHeading : text('职业关注方向', 'Career interests')}</PreviewText></h3>}
              <div className="public-focus-list">{contact.focus.map(({row, title, detail}) =>
                <div key={row.clientId} data-preview-focus={row.clientId} data-preview-example-record={preview.exampleCollection('contact', 'focus')}>
                  {title.trim() && <p data-preview-value="title">{recordText('contact', 'focus:' + row.clientId, 'title', title)}</p>}{detail.trim() && <span data-preview-value="detail">{recordText('contact', 'focus:' + row.clientId, 'detail', detail)}</span>}
                </div>)}</div>
            </div>
            <div>
              {(profile.contactStatusHeading.trim() || contact.status.length > 0) &&
                <h3 data-preview-value="contactStatusHeading" data-preview-example={example('profile', 'contactStatusHeading')}><PreviewText>{profile.contactStatusHeading.trim() ? profile.contactStatusHeading : text('当前状态', 'Current status')}</PreviewText></h3>}
              <div className="public-status-list">{contact.status.map(({row, title, detail}) =>
                <div key={row.clientId} className="public-status" data-preview-status={row.clientId} data-status-type={row.statusType}
                  data-preview-example-record={preview.exampleCollection('contact', 'status')}>
                  <span data-preview-value="statusType" role="img" aria-label={contactStatusLabels[row.statusType][locale]} title={contactStatusLabels[row.statusType][locale]}>
                    <PreviewIcon kind={row.statusType}/>
                  </span>
                  <div>{title.trim() && <p data-preview-value="title">{recordText('contact', 'status:' + row.clientId, 'title', title)}</p>}{detail.trim() && <span data-preview-value="detail">{recordText('contact', 'status:' + row.clientId, 'detail', detail)}</span>}</div>
                </div>)}</div>
            </div>
            <PreviewContactNetwork/>
          </div>}
      </footer>
    </article>
    <div className="public-preview-scroll-space" aria-hidden="true"/>
  </div>;
}
