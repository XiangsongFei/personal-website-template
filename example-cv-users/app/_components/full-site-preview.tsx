'use client';

import {useLayoutEffect, useRef, type ReactNode} from 'react';
import {contactDisplay, contactStatusLabels} from '../../lib/editor/contact';
import {educationDisplay, projectDisplay, skillTitle} from '../../lib/editor/records';
import type {ContentLocale, LocalDraft} from '../../lib/editor/draft';
import {publicLinksDisplay} from '../../lib/editor/site-links';
import {editableNavigationSections, previewSections, sectionTitleFields, siteNavigationLabel, type PreviewSection} from '../../lib/editor/site-text';

import {PreviewIcon} from './preview-icons';
import './public-preview.css';

function Action({kind, children, marker, reference}: {
  kind: 'mail' | 'file' | 'linkedin' | 'github'; children: ReactNode; marker?: string; reference?: string;
}) {
  return <span className="public-action" data-preview-public-link={marker} aria-disabled="true" title={reference}>
    <PreviewIcon kind={kind}/><span>{children}</span><PreviewIcon kind="external"/>
  </span>;
}

function Bullets({value, locale}: {value?: string; locale: ContentLocale}) {
  if (!value?.trim()) return null;
  const separator = value.includes('\n') ? /\r?\n/ : locale === 'zh' ? /[；。]/ : /\.\s+(?=[A-Z])/;
  return <ul className="public-bullets">{value.split(separator).map((line, index) =>
    line.trim() && <li key={index}>{line.trim()}</li>)}</ul>;
}

export function FullSitePreview({draft, locale, module, onLocaleChange}: {
  draft: LocalDraft; locale: ContentLocale; module: PreviewSection; onLocaleChange: (locale: ContentLocale) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
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
    return Object.values(values).some(value => value.trim()) ? [{...values, clientId: row.clientId}] : [];
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
    return title.trim() || items.trim() ? [{clientId: row.clientId, title, items}] : [];
  });

  const awards = draft.awards.flatMap(row => {
    const {name = '', year = ''} = row.translations[locale] ?? {};
    return name.trim() || year.trim() ? [{clientId: row.clientId, name, year}] : [];
  });

  function position(section: PreviewSection, moduleEntry = false) {
    const owner = viewport.current;
    const target = owner?.querySelector<HTMLElement>(`[data-site-section="${section}"]`);
    if (!owner || !owner.clientHeight || !target) return false;
    if (moduleEntry) owner.style.removeProperty('--site-preview-end-space');
    const top = owner.scrollTop + target.getBoundingClientRect().top - owner.getBoundingClientRect().top
      - (navigation.current?.offsetHeight ?? 0);
    // Short sections near the end still align under the preview navigation.
    if (moduleEntry && section !== 'profile') {
      const extra = Math.ceil(top - (owner.scrollHeight - owner.clientHeight));
      if (extra > 0) owner.style.setProperty('--site-preview-end-space', extra + 'px');
    }
    owner.scrollTop = top;
    return true;
  }

  useLayoutEffect(() => {
    const owner = viewport.current;
    if (!owner) return;
    const measure = () => {
      if (!owner.clientWidth) return;
      const compact = owner.clientWidth < 440;
      owner.dataset.siteLayout = compact ? 'mobile' : 'desktop';
      owner.style.setProperty('--public-preview-scale', String(compact ? 1 : Math.min(owner.clientWidth / 980, 1)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(owner);
    return () => observer.disconnect();
  }, []);

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
  }, [module]);

  const emptyContent = <p className="public-placeholder">{text('暂无本地内容', 'No local content')}</p>;
  const introduction = draft.introduction[locale].split(/\r?\n/).filter(line => line.trim());
  const pdfLabel = siteText?.portfolioLabel;
  const linkedInName = links.linkedInDisplayName.trim() ? links.linkedInDisplayName : links.linkedInHref;
  const hasContactDetails = contact.availability.trim() || contact.focus.length || contact.status.length || links.email || links.linkedInHref;
  const navButton = (key: PreviewSection, className?: string) => <button type="button" className={className} key={key}
    data-preview-nav={key} onClick={() => position(key, true)}>{navLabel(key)}</button>;

  return <div className="site-preview-viewport public-preview" ref={viewport} tabIndex={0}
    role="region" aria-label={text('个人网站预览内容', 'Personal website preview content')} lang={locale === 'zh' ? 'zh-CN' : 'en'}>
    <nav className="site-preview-nav" ref={navigation} aria-label={text('预览网站导航', 'Preview website navigation')}>
      <div className="public-nav public-canvas">
        {navButton('profile', 'public-nav-home')}
        <div className="public-nav-links">{editableNavigationSections.map(key => navButton(key))}</div>
        <button type="button" className="public-nav-language" aria-label={text('切换预览语言', 'Switch preview language')}
          onClick={() => onLocaleChange(locale === 'zh' ? 'en' : 'zh')}>{locale === 'zh' ? 'EN' : '中文'}</button>
      </div>
    </nav>
    <article className="site-preview-page public-canvas">
      <header className="public-hero" data-site-section="profile" aria-labelledby="site-preview-name">
        <div className="public-hero-copy">
          <h1 id="site-preview-name">{profile.name.trim() ? profile.name : text('你的名字', 'Your name')}</h1>
          <div className="public-intro" data-site-section="introduction">
            {introduction.length ? introduction.map((line, index) => <p key={index}>{line}</p>) : emptyContent}
          </div>
          <div className="public-actions">
            {(links.email || profile.emailActionLabel.trim()) && <Action kind="mail">{profile.emailActionLabel.trim() ? profile.emailActionLabel : text('邮箱', 'Email')}</Action>}
            {pdfLabel?.trim() && <span data-preview-pdf-label title={text('PDF 尚未开放', 'PDF unavailable')}>
              <Action kind="file">{pdfLabel} · {text('未开放', 'Unavailable')}</Action></span>}
            {links.linkedInHref && <Action kind="linkedin" marker="linkedin-action" reference={links.linkedInHref}>{links.linkedInActionLabel.trim() ? links.linkedInActionLabel : 'LinkedIn'}</Action>}
            {links.github && <Action kind="github" marker="github" reference={links.github}>{links.githubLabel.trim() ? links.githubLabel : 'GitHub'}</Action>}
          </div>
          {(shared.graduationValue.trim() || profile.graduationLabel.trim()) && <div className="public-graduation">
            <span>{profile.graduationLabel.trim() ? profile.graduationLabel : text('毕业时间', 'Graduation')}</span>
            {shared.graduationValue.trim() && <b>{shared.graduationValue}</b>}
          </div>}
        </div>
        <div className="public-portrait" role="img" aria-label={profile.avatarLabel.trim() || text('头像占位，上传尚未开放', 'Portrait placeholder, upload unavailable')}>
          {shared.avatarInitials.trim() || '—'}
        </div>
      </header>

      <section className="public-section public-education public-timeline" data-site-section="education">
        <h2>{sectionTitle('education')}</h2>
        {education.length ? education.map(({clientId, title, categoryTitle, program, period, grade, courseTitle, courseDescription}) =>
          <article key={clientId} data-preview-entry={clientId}>
            <div>
              {title.trim() && <h3>{title}</h3>}
              {categoryTitle.trim() && categoryTitle !== title && <p className="public-secondary">{categoryTitle}</p>}
              {program.trim() && <p>{program}</p>}
              {courseTitle.trim() && <p className="public-course">{courseTitle}</p>}
              {courseDescription.trim() && <p className="public-course-detail">{courseDescription}</p>}
            </div>
            <div className="public-date">{period.trim() && <b>{period}</b>}
              {grade.split(' · ').map((line, index) => line.trim() && <span key={index}>{line}</span>)}</div>
          </article>) : emptyContent}
      </section>
      <section className="public-section public-work public-timeline" data-site-section="experience">
        <h2>{sectionTitle('experience')}</h2>
        {experience.length ? experience.map(({clientId, title, organization, period, location, description}) =>
          <article key={clientId} data-preview-entry={clientId}>
            <div className="public-entry-copy">
              {(organization?.trim() || title?.trim()) && <h3>{organization?.trim() ? organization : title}</h3>}
              {period?.trim() && <b className="public-mobile-date">{period}</b>}
              {organization?.trim() && title?.trim() && <p className="public-subtitle">{title}</p>}
              {location?.trim() && <p className="public-secondary">{location}</p>}
              <Bullets value={description} locale={locale}/>
            </div>
            <div className="public-date">{period?.trim() && <b>{period}</b>}</div>
          </article>) : emptyContent}
      </section>
      <section className="public-section public-work public-projects public-timeline" data-site-section="projects">
        <h2>{sectionTitle('projects')}</h2>
        {projects.length ? projects.map(({clientId, title, subtitle, period, description, href, methods}) =>
          <article key={clientId} data-preview-entry={clientId}>
            <div className="public-entry-copy">
              {title.trim() && <h3>{title}</h3>}
              {period.trim() && <b className="public-mobile-date">{period}</b>}
              {subtitle.trim() && <p className="public-subtitle">{subtitle}</p>}
              {!!methods.length && <p className="public-methods">{methods.map((method, index) =>
                <span key={method.clientId}>{index > 0 && ' · '}<span data-preview-method={method.clientId}>{method.value}</span></span>)}</p>}
              <Bullets value={description} locale={locale}/>
              {href && <span className="public-project-link" data-preview-project-url aria-disabled="true" title={href}>
                {siteText?.kaggleLabel?.trim() ? siteText.kaggleLabel : text('项目链接', 'Project URL')} <PreviewIcon kind="external"/>
              </span>}
            </div>
            <div className="public-date">{period.trim() && <b>{period}</b>}</div>
          </article>) : emptyContent}
      </section>
      <section className="public-section public-skills" data-site-section="skills">
        <h2>{sectionTitle('skills')}</h2>
        <div className="public-skill-grid">{skills.length ? skills.map(({clientId, title, items}) =>
          <div key={clientId} data-preview-entry={clientId}>
            {title.trim() && <h3>{title}</h3>}{items.trim() && <p>{items}</p>}
          </div>) : emptyContent}</div>
      </section>
      <section className="public-section public-awards public-timeline" data-site-section="awards">
        <h2>{sectionTitle('awards')}</h2>
        {awards.length ? awards.map(({clientId, name, year}) =>
          <article key={clientId} data-preview-entry={clientId}>
            {name.trim() ? <h3>{name}</h3> : <span/>}
            <div className="public-date">{year.trim() && <b>{year}</b>}</div>
          </article>) : emptyContent}
      </section>
      <footer className="public-contact" data-site-section="contact">
        <p className="public-contact-label">{contact.contactLabel.trim() ? contact.contactLabel : labels('contact')}</p>
        {contact.availability.trim() && <h2>{contact.availability}</h2>}
        {(links.email || links.linkedInHref) && <dl className="public-contact-links">
          {links.email && <div><dt>{links.emailLabel.trim() ? links.emailLabel : text('邮箱', 'Email')}</dt>
            <dd data-preview-public-link="email">{links.email} <PreviewIcon kind="external"/></dd></div>}
          {links.linkedInHref && <div><dt>{links.linkedInContactLabel.trim() ? links.linkedInContactLabel : 'LinkedIn'}</dt>
            <dd data-preview-public-link="linkedin" title={links.linkedInHref}>{linkedInName} <PreviewIcon kind="external"/></dd></div>}
        </dl>}
        {!hasContactDetails && <p className="public-placeholder">{text('暂无本地联系信息', 'No local contact details')}</p>}
        <div className="public-footer-meta">
          <span>{shared.footerName}</span>
          <span data-preview-updated-label={siteText?.updatedAtLabel?.trim() ? '' : undefined}>
            {siteText?.updatedAtLabel?.trim() && <>{siteText.updatedAtLabel} · {text('暂无已确认更新时间', 'No confirmed update date')}</>}
          </span>
          <span>{shared.copyright}</span>
        </div>
        {(profile.contactFocusHeading.trim() || contact.focus.length > 0 || profile.contactStatusHeading.trim() || contact.status.length > 0) &&
          <div className="public-contact-extension">
            <div>
              {(profile.contactFocusHeading.trim() || contact.focus.length > 0) &&
                <h3>{profile.contactFocusHeading.trim() ? profile.contactFocusHeading : text('职业关注方向', 'Career interests')}</h3>}
              <div className="public-focus-list">{contact.focus.map(({row, title, detail}) =>
                <div key={row.clientId} data-preview-focus={row.clientId}>
                  {title.trim() && <p>{title}</p>}{detail.trim() && <span>{detail}</span>}
                </div>)}</div>
            </div>
            <div>
              {(profile.contactStatusHeading.trim() || contact.status.length > 0) &&
                <h3>{profile.contactStatusHeading.trim() ? profile.contactStatusHeading : text('当前状态', 'Current status')}</h3>}
              <div className="public-status-list">{contact.status.map(({row, title, detail}) =>
                <div key={row.clientId} className="public-status" data-preview-status={row.clientId} data-status-type={row.statusType}>
                  <span role="img" aria-label={contactStatusLabels[row.statusType][locale]} title={contactStatusLabels[row.statusType][locale]}>
                    <PreviewIcon kind={row.statusType}/>
                  </span>
                  <div>{title.trim() && <p>{title}</p>}{detail.trim() && <span>{detail}</span>}</div>
                </div>)}</div>
            </div>
          </div>}
      </footer>
    </article>
    <div className="public-preview-scroll-space" aria-hidden="true"/>
  </div>;
}
