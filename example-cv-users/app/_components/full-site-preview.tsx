'use client';

import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {contactDisplay, contactStatusLabels} from '../../lib/editor/contact';
import {educationCategory, educationDisplay, projectDisplay, skillCategory, skillTitle} from '../../lib/editor/records';
import type {EditFeedback} from '../../lib/editor/bilingual-review';
import type {ContentLocale, LocalDraft} from '../../lib/editor/draft';
import {demoPreviewMailto, demoPreviewUrl} from '../../lib/editor/preview-links';
import {publicLinksDisplay} from '../../lib/editor/site-links';
import {editableNavigationSections, previewSections, sectionTitleFields, siteNavigationLabel, type PreviewSection} from '../../lib/editor/site-text';

import {PreviewIcon} from './preview-icons';
import {PreviewContactNetwork} from './preview-contact-network';
import './public-preview.css';

// Match the public site's phone layout at the preview pane's actual width.
const phoneWidth = 640;
const splitCanvasWidth = 736;

function PreviewAnchor({href, className, children}: {href: string; className?: string; children: ReactNode}) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function Action({kind, children, marker, valueKey, reference, href, onActivate}: {
  kind: 'mail' | 'file' | 'linkedin' | 'github'; children: ReactNode;
  marker?: string; valueKey?: string; reference?: string; href?: string; onActivate?: () => void;
}) {
  const contents = <><PreviewIcon kind={kind}/><span data-preview-value={valueKey}>{children}</span><PreviewIcon kind="external"/></>;
  if (onActivate) return <button type="button" className="public-action" data-preview-public-link={marker} onClick={onActivate}>{contents}</button>;
  const address = marker === 'github' ? 'github' : marker === 'linkedin-action' ? 'linkedInHref' : undefined;
  if (href) return <span data-preview-public-link={marker} data-preview-value={address}>
    <PreviewAnchor className="public-action" href={href}>{contents}</PreviewAnchor>
  </span>;
  return <span className="public-action" data-preview-public-link={marker} data-preview-value={address} aria-disabled="true" title={reference}>{contents}</span>;
}

function ProjectPreviewLink({href, reference, children}: {href?: string; reference: string; children: ReactNode}) {
  return href ? <div data-preview-project-url data-preview-value="href"><PreviewAnchor className="public-project-link" href={href}>{children}</PreviewAnchor></div>
    : <span className="public-project-link" data-preview-project-url data-preview-value="href" aria-disabled="true" title={reference}>{children}</span>;
}

function ContactPreviewLink({href, children}: {href?: string; children: ReactNode}) {
  const contents = <>{children} <PreviewIcon kind="external"/></>;
  return href ? <PreviewAnchor href={href}>{contents}</PreviewAnchor> : contents;
}

function PreviewText({field, children}: {field: string; children: ReactNode}) {
  return <span data-preview-value={field}>{children}</span>;
}

function Bullets({value, locale}: {value?: string; locale: ContentLocale}) {
  if (!value?.trim()) return null;
  const separator = value.includes('\n') ? /\r?\n/ : locale === 'zh' ? /[；。]/ : /\.\s+(?=[A-Z])/;
  return <ul className="public-bullets">{value.split(separator).map((line, index) =>
    line.trim() && <li key={index}><PreviewText field="description">{line.trim()}</PreviewText></li>)}</ul>;
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

export function FullSitePreview({draft, locale, module, onLocaleChange, interactiveLinks = false, modified, focused}: {
  draft: LocalDraft; locale: ContentLocale; module: PreviewSection; onLocaleChange: (locale: ContentLocale) => void; interactiveLinks?: boolean; modified?: readonly EditFeedback[]; focused?: EditFeedback;
}) {
  const [contactOverride, setContactOverride] = useState<boolean | null>(null);
  const contactExpanded = contactOverride ?? module === 'contact';
  const viewport = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const anchoredSection = useRef<PreviewSection>(module);
  const fieldReveal = useRef<{target: EditFeedback; handled: boolean} | null>(null);
  const languageAnchor = useRef<{section: PreviewSection; offset: number} | null>(null);
  const labels = (key: PreviewSection) => previewSections[key][locale === 'zh' ? 0 : 1];
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const profile = draft.profile.translations[locale];
  const shared = draft.profile.shared;
  const contact = contactDisplay(draft.contact, locale);
  const links = publicLinksDisplay(draft.links, locale);
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
    const hasContent = [values.title, values.subtitle, values.period, values.description].some(value => value.trim());
    return hasContent || values.href || values.methods.length ? [{...values, clientId: row.clientId}] : [];
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

  function position(section: PreviewSection, addEndSpace = false, offset = 0) {
    const owner = viewport.current;
    const target = owner?.querySelector<HTMLElement>(`[data-site-section="${section}"]`);
    if (!owner || !owner.clientHeight || !target) return false;
    if (addEndSpace) owner.style.removeProperty('--site-preview-end-space');
    const top = owner.scrollTop + target.getBoundingClientRect().top - owner.getBoundingClientRect().top
      - (navigation.current?.getBoundingClientRect().height ?? 0) - (section === 'profile' ? 0 : 8) + offset;
    // Short sections near the end still align under the preview navigation.
    if (addEndSpace && section !== 'profile') {
      const extra = Math.ceil(top - (owner.scrollHeight - owner.clientHeight));
      if (extra > 0) owner.style.setProperty('--site-preview-end-space', extra + 'px');
    }
    owner.scrollTop = top;
    anchoredSection.current = section;
    return true;
  }

  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner) return;
    let measuredWidth = 0;
    const measure = () => {
      const style = getComputedStyle(owner);
      const width = owner.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd);
      if (width === measuredWidth) return;
      measuredWidth = width;
      if (!width) return;
      const split = getComputedStyle(owner).getPropertyValue('--editor-split').trim() === '1';
      const scaled = split && width < splitCanvasWidth;
      owner.dataset.siteLayout = !split && width <= phoneWidth ? 'mobile' : 'desktop';
      owner.style.setProperty('--public-canvas-width', scaled ? splitCanvasWidth + 'px' : 'min(100%, 1100px)');
      owner.style.setProperty('--public-canvas-scale', scaled ? String(width / splitCanvasWidth) : '1');
      fitTimelineDates(owner);
      position(anchoredSection.current, true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(owner);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => { setContactOverride(null); }, [module]);

  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner) return;
    // A hidden single-column pane has no layout. Position it once it opens.
    if (position(module, true)) return;
    const observer = new ResizeObserver(() => {
      if (position(module, true)) observer.disconnect();
    });
    observer.observe(owner);
    return () => observer.disconnect();
  }, [module, contactExpanded]);

  function switchLanguage() {
    const navBottom = navigation.current?.getBoundingClientRect().bottom ?? 0;
    const sections = Array.from(viewport.current?.querySelectorAll<HTMLElement>('[data-site-section]') ?? []);
    const profileSection = sections[0];
    const current = sections.reverse().find(section => section.getBoundingClientRect().top <= navBottom + 1) ?? profileSection;
    if (current) {
      languageAnchor.current = {
        section: current.dataset.siteSection as PreviewSection,
        offset: Math.max(0, navBottom - current.getBoundingClientRect().top),
      };
    }
    onLocaleChange(locale === 'zh' ? 'en' : 'zh');
  }

  useLayoutEffect(() => {
    if (!languageAnchor.current) return;
    const {section, offset} = languageAnchor.current;
    languageAnchor.current = null;
    position(section, true, offset);
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
    if (fieldReveal.current?.target !== focused) fieldReveal.current = {target: focused, handled: false};
    const request = fieldReveal.current;
    if (request.handled || !owner.clientHeight || (focused.locale !== 'shared' && focused.locale !== locale)) return;
    const matches = Array.from(previewFieldNodes(owner, focused));
    if (focused.module === 'profile' && matches.some(node => node.closest('.public-contact-extension[hidden]'))) {
      setContactOverride(true);
      return;
    }
    const visible = matches.filter(node => node.getClientRects().length && (node.textContent?.trim() || node.querySelector('svg')));
    const target = visible.find(node => node.closest('.public-contact') && focused.module === 'links') ?? visible[0];
    if (!target) return;
    request.handled = true;
    if (target.closest('.site-preview-nav')) return;
    const frame = owner.getBoundingClientRect();
    const nav = navigation.current?.getBoundingClientRect();
    const y = (nav?.bottom ?? frame.top) + 8;
    const bounds = target.getBoundingClientRect();
    const required = Math.min(bounds.height, Math.max(0, frame.bottom - y));
    if (bounds.top >= y - 1 && bounds.top + required <= frame.bottom + 1) return;
    owner.scrollTop += bounds.top - y;
  }, [focused, draft, locale, contactExpanded]);

  function preserveManualScroll() {
    if (fieldReveal.current) fieldReveal.current.handled = true;
  }

  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner || !modified?.length) return;
    const marked = new Set<HTMLElement>();
    for (const change of modified) {
      if (change.locale !== 'shared' && change.locale !== locale) continue;
      const active = focused?.module === change.module && focused.item === change.item &&
        focused.field === change.field && focused.locale === change.locale;
      for (const node of previewFieldNodes(owner, change)) {
        if (active || !marked.has(node)) node.dataset.previewEditFeedback = active ? 'active' : 'modified';
        marked.add(node);
      }
    }
    return () => {for (const node of marked) delete node.dataset.previewEditFeedback;};
  }, [draft, focused, locale, modified, contactExpanded]);

  const emptyContent = <p className="public-placeholder">{text('暂无本地内容', 'No local content')}</p>;
  const introduction = draft.introduction[locale].split(/\r?\n/).filter(line => line.trim());
  const pdfLabel = siteText?.portfolioLabel;
  const linkedInName = links.linkedInDisplayName.trim() ? links.linkedInDisplayName : links.linkedInHref;
  const externalHref = (value: string | undefined) => interactiveLinks ? demoPreviewUrl(value) : undefined;
  const mailto = interactiveLinks ? demoPreviewMailto(links.email) : undefined;
  function goToSection(key: PreviewSection) {
    setContactOverride(key === 'contact');
    requestAnimationFrame(() => position(key, true));
  }
  const navButton = (key: PreviewSection, className?: string) => <button type="button" className={className} key={key}
    data-preview-nav={key} data-preview-value={key === 'profile' ? 'navAboutLabel' : undefined} aria-expanded={key === 'contact' ? contactExpanded : undefined}
    onClick={() => goToSection(key)}>{navLabel(key)}</button>;

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
          <h1 id="site-preview-name"><PreviewText field="name">{profile.name.trim() ? profile.name : text('你的名字', 'Your name')}</PreviewText></h1>
          <div className="public-intro" data-site-section="introduction">
            {introduction.length ? introduction.map((line, index) => <p key={index}><PreviewText field="introduction">{line}</PreviewText></p>) : emptyContent}
          </div>
          <div className="public-actions">
            {(links.email || profile.emailActionLabel.trim()) && <Action kind="mail" marker="contact-cta" valueKey="emailActionLabel" onActivate={interactiveLinks ? () => goToSection('contact') : undefined}>{profile.emailActionLabel.trim() ? profile.emailActionLabel : text('邮箱', 'Email')}</Action>}
            {pdfLabel?.trim() && <span data-preview-pdf-label title={text('PDF 尚未开放', 'PDF unavailable')}>
              <Action kind="file" valueKey="portfolioLabel">{pdfLabel}</Action></span>}
            {links.linkedInHref && <Action kind="linkedin" marker="linkedin-action" reference={links.linkedInHref} valueKey="linkedInButtonLabel" href={externalHref(links.linkedInHref)}>{links.linkedInActionLabel.trim() ? links.linkedInActionLabel : 'LinkedIn'}</Action>}
            {links.github && <Action kind="github" marker="github" reference={links.github} valueKey="githubLabel" href={externalHref(links.github)}>{links.githubLabel.trim() ? links.githubLabel : 'GitHub'}</Action>}
          </div>
          {(shared.graduationValue.trim() || profile.graduationLabel.trim()) && <div className="public-graduation">
            <span data-preview-value="graduationLabel">{profile.graduationLabel.trim() ? profile.graduationLabel : text('毕业时间', 'Graduation')}</span>
            {shared.graduationValue.trim() && <b data-preview-value="graduationValue">{shared.graduationValue}</b>}
          </div>}
        </div>
        <div className="public-portrait" data-preview-value="avatarInitials" role="img" aria-label={profile.avatarLabel.trim() || text('头像占位，上传尚未开放', 'Portrait placeholder, upload unavailable')}>
          {shared.avatarInitials.trim() || '—'}
        </div>
      </header>

      <section className="public-section public-education public-timeline" data-site-section="education" data-empty={!education.length}>
        <h2 data-preview-value={sectionTitleFields.education}>{sectionTitle('education')}</h2>
        {education.map(({clientId, title, categoryTitle, program, period, grade, courseTitle, courseDescription, summerSchool, custom}) =>
          <article key={clientId} className={summerSchool ? 'public-summer-school' : undefined} data-preview-entry={clientId}>
            <div>
              {title.trim() && <h3 data-preview-value="title">{title}</h3>}
              {categoryTitle.trim() && categoryTitle !== title && <p className="public-secondary" data-preview-value={custom ? "customCategoryLabel" : "category"}>{categoryTitle}</p>}
              {program.trim() && <p className="public-program" data-preview-value="program">{program}</p>}
              {courseTitle.trim() && <p className="public-course" data-preview-value="courseTitle">{courseTitle}</p>}
              {courseDescription.trim() && <p className="public-course-detail" data-preview-value="courseDescription">{courseDescription}</p>}
            </div>
            <div className="public-date">{period.trim() && <b data-preview-value="period">{period}</b>}
              {grade.trim() && <div className="public-grades" data-preview-value="grade">{(summerSchool ? [grade] : grade.split(' · ')).map((line, index) =>
                line.trim() && <span key={index}>{line}</span>)}</div>}</div>
          </article>)}
      </section>
      <section className="public-section public-work public-timeline" data-site-section="experience" data-empty={!experience.length}>
        <h2 data-preview-value={sectionTitleFields.experience}>{sectionTitle('experience')}</h2>
        {experience.map(({clientId, title, organization, period, location, description}) =>
          <article key={clientId} data-preview-entry={clientId}>
            <div className="public-entry-copy">
              {(organization?.trim() || title?.trim()) && <h3 data-preview-value={organization?.trim() ? "organization" : "title"}>{organization?.trim() ? organization : title}</h3>}
              {period?.trim() && <b className="public-mobile-date" data-preview-value="period">{period}</b>}
              {organization?.trim() && title?.trim() && <p className="public-subtitle" data-preview-value="title">{title}</p>}
              {location?.trim() && <p className="public-secondary" data-preview-value="location">{location}</p>}
              <Bullets value={description} locale={locale}/>
            </div>
            <div className="public-date">{period?.trim() && <b data-preview-value="period">{period}</b>}</div>
          </article>)}
      </section>
      <section className="public-section public-work public-projects public-timeline" data-site-section="projects" data-empty={!projects.length}>
        <h2 data-preview-value={sectionTitleFields.projects}>{sectionTitle('projects')}</h2>
        {projects.map(({clientId, title, subtitle, period, description, href, methods}) =>
          <article key={clientId} data-preview-entry={clientId}>
            <div className="public-entry-copy">
              {title.trim() && <h3 data-preview-value="title">{title}</h3>}
              {period.trim() && <b className="public-mobile-date" data-preview-value="period">{period}</b>}
              {subtitle.trim() && <p className="public-subtitle" data-preview-value="subtitle">{subtitle}</p>}
              {!!methods.length && <p className="public-methods" data-preview-value="methods">{methods.map((method, index) =>
                <span key={method.clientId}>{index > 0 && ' · '}<span data-preview-method={method.clientId}>{method.value}</span></span>)}</p>}
              <Bullets value={description} locale={locale}/>
              {href && <ProjectPreviewLink href={externalHref(href)} reference={href}>
                <span data-preview-value="kaggleLabel">{siteText?.kaggleLabel?.trim() ? siteText.kaggleLabel : text('项目链接', 'Project URL')}</span> <PreviewIcon kind="external"/>
              </ProjectPreviewLink>}
            </div>
            <div className="public-date">{period.trim() && <b data-preview-value="period">{period}</b>}</div>
          </article>)}
      </section>
      <section className="public-section public-skills" data-site-section="skills" data-empty={!skills.length}>
        <h2 data-preview-value={sectionTitleFields.skills}>{sectionTitle('skills')}</h2>
        <div className="public-skill-grid">{skills.map(({clientId, title, items, custom}) =>
          <div key={clientId} data-preview-entry={clientId}>
            {title.trim() && <h3 data-preview-value={custom ? "title" : "category"}>{title}</h3>}{items.trim() && <p data-preview-value="items">{items}</p>}
          </div>)}</div>
      </section>
      <section className="public-section public-awards public-timeline" data-site-section="awards" data-empty={!awards.length}>
        <h2 data-preview-value={sectionTitleFields.awards}>{sectionTitle('awards')}</h2>
        {awards.map(({clientId, name, year}) =>
          <article key={clientId} data-preview-entry={clientId}>
            {name.trim() ? <h3 data-preview-value="name">{name}</h3> : <span/>}
            <div className="public-date">{year.trim() && <b data-preview-value="year">{year}</b>}</div>
          </article>)}
      </section>
      <footer className="public-contact" data-site-section="contact">
        <p className="public-contact-label" data-preview-value="contactLabel">{contact.contactLabel.trim() ? contact.contactLabel : labels('contact')}</p>
        {contact.availability.trim() && <h2 data-preview-value="availability">{contact.availability}</h2>}
        {(links.email || links.linkedInHref) && <dl className="public-contact-links">
          {links.email && <div><dt data-preview-value="emailLabel">{links.emailLabel.trim() ? links.emailLabel : text('邮箱', 'Email')}</dt>
            <dd data-preview-public-link="email" data-preview-value="email">{mailto ? <PreviewAnchor href={mailto}>{links.email} <PreviewIcon kind="external"/></PreviewAnchor>
              : <>{links.email} <PreviewIcon kind="external"/></>}</dd></div>}
          {links.linkedInHref && <div><dt data-preview-value="linkedInLabel">{links.linkedInContactLabel.trim() ? links.linkedInContactLabel : 'LinkedIn'}</dt>
            <dd data-preview-public-link="linkedin" data-preview-value="linkedInDisplayName" title={links.linkedInHref}>
              <ContactPreviewLink href={externalHref(links.linkedInHref)}>{linkedInName}</ContactPreviewLink>
            </dd></div>}
        </dl>}
        <div className="public-footer-meta">
          <span data-preview-value="footerName">{shared.footerName}</span>
          <span data-preview-value="updatedAtLabel" data-preview-updated-label={siteText?.updatedAtLabel?.trim() ? '' : undefined}>
            {siteText?.updatedAtLabel?.trim() && <>{siteText.updatedAtLabel} · —</>}
          </span>
          <span data-preview-value="copyright">{shared.copyright}</span>
        </div>
        {(profile.contactFocusHeading.trim() || contact.focus.length > 0 || profile.contactStatusHeading.trim() || contact.status.length > 0) &&
          <div className="public-contact-extension" hidden={!contactExpanded}>
            <div>
              {(profile.contactFocusHeading.trim() || contact.focus.length > 0) &&
                <h3 data-preview-value="contactFocusHeading">{profile.contactFocusHeading.trim() ? profile.contactFocusHeading : text('职业关注方向', 'Career interests')}</h3>}
              <div className="public-focus-list">{contact.focus.map(({row, title, detail}) =>
                <div key={row.clientId} data-preview-focus={row.clientId}>
                  {title.trim() && <p data-preview-value="title">{title}</p>}{detail.trim() && <span data-preview-value="detail">{detail}</span>}
                </div>)}</div>
            </div>
            <div>
              {(profile.contactStatusHeading.trim() || contact.status.length > 0) &&
                <h3 data-preview-value="contactStatusHeading">{profile.contactStatusHeading.trim() ? profile.contactStatusHeading : text('当前状态', 'Current status')}</h3>}
              <div className="public-status-list">{contact.status.map(({row, title, detail}) =>
                <div key={row.clientId} className="public-status" data-preview-status={row.clientId} data-status-type={row.statusType}>
                  <span data-preview-value="statusType" role="img" aria-label={contactStatusLabels[row.statusType][locale]} title={contactStatusLabels[row.statusType][locale]}>
                    <PreviewIcon kind={row.statusType}/>
                  </span>
                  <div>{title.trim() && <p data-preview-value="title">{title}</p>}{detail.trim() && <span data-preview-value="detail">{detail}</span>}</div>
                </div>)}</div>
            </div>
            <PreviewContactNetwork/>
          </div>}
      </footer>
    </article>
    <div className="public-preview-scroll-space" aria-hidden="true"/>
  </div>;
}
