'use client';

import {useLayoutEffect, useRef} from 'react';
import {educationDisplay} from '../../lib/editor/records';
import type {ContentLocale, EditorModule, LocalDraft} from '../../lib/editor/draft';

const sections = {
  profile: ['个人资料', 'Profile'],
  introduction: ['个人介绍', 'Introduction'],
  education: ['教育经历', 'Education'],
  experience: ['工作经历', 'Experience'],
  projects: ['项目经历', 'Projects'],
  skills: ['技能', 'Skills'],
  awards: ['荣誉奖项', 'Awards'],
  contact: ['联系与链接', 'Contact'],
} as const;
type PreviewSection = keyof typeof sections;
const sectionKeys = Object.keys(sections) as PreviewSection[];
const laterSections = ['projects', 'skills', 'awards'] as const;

export function FullSitePreview({draft, locale, module}: {
  draft: LocalDraft; locale: ContentLocale; module: EditorModule;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const labels = (key: PreviewSection) => sections[key][locale === 'zh' ? 0 : 1];
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const profile = draft.profile.translations[locale];
  const shared = draft.profile.shared;
  const education = draft.education.flatMap(row => {
    const values = educationDisplay(row, locale);
    return Object.values(values).some(value => value.trim()) ? [{...values, clientId: row.clientId}] : [];
  });

  const experience = draft.experience.flatMap(row => {
    const values = row.translations[locale];
    if (!values || !Object.values(values).some(value => value?.trim())) return [];
    return [{...values, clientId: row.clientId}];
  });

  function position(section: PreviewSection, moduleEntry = false) {
    const owner = viewport.current;
    const target = owner?.querySelector<HTMLElement>(`[data-site-section="${section}"]`);
    if (!owner || !owner.clientHeight || !target) return false;
    if (moduleEntry) owner.style.removeProperty('--site-preview-end-space');
    const top = owner.scrollTop + target.getBoundingClientRect().top - owner.getBoundingClientRect().top
      - (navigation.current?.offsetHeight ?? 0);
    // Short sections near the end still align under the preview navigation.
    if (moduleEntry && (section === 'education' || section === 'experience')) {
      const extra = Math.ceil(top - (owner.scrollHeight - owner.clientHeight));
      if (extra > 0) owner.style.setProperty('--site-preview-end-space', extra + 'px');
    }
    owner.scrollTop = top;
    return true;
  }

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

  return <div className="site-preview-viewport" ref={viewport} tabIndex={0}
    role="region" aria-label={text('个人网站预览内容', 'Personal website preview content')} lang={locale === 'zh' ? 'zh-CN' : 'en'}>
    <nav className="site-preview-nav" ref={navigation} aria-label={text('预览网站导航', 'Preview website navigation')}>
      {sectionKeys.map(key => <button type="button" key={key} onClick={() => position(key)}>
        {key === 'profile' && profile.navAboutLabel.trim() ? profile.navAboutLabel : labels(key)}
      </button>)}
    </nav>
    <article className="site-preview-page">
      <section data-site-section="profile" aria-labelledby="site-preview-name">
        <div className="site-preview-hero">
          <div>
            <p className="site-preview-kicker">{text('个人网站', 'Personal website')}</p>
            <h3 id="site-preview-name">{profile.name.trim() ? profile.name : text('你的名字', 'Your name')}</h3>
            {shared.graduationValue.trim() && <p><strong>{profile.graduationLabel.trim() || text('毕业时间', 'Graduation')}</strong> · {shared.graduationValue}</p>}
            {profile.emailActionLabel.trim() && <p className="site-preview-muted">{profile.emailActionLabel}</p>}
          </div>
          <div className="site-preview-portrait" role="img" aria-label={profile.avatarLabel.trim() || text('头像占位', 'Portrait placeholder')}>
            {shared.avatarInitials.trim() || '—'}
          </div>
        </div>
      </section>
      <section data-site-section="introduction">
        <h3>{labels('introduction')}</h3>
        <p className={draft.introduction[locale].trim() ? 'site-preview-prose' : 'site-preview-muted'}>
          {draft.introduction[locale].trim() ? draft.introduction[locale] : text('在这里介绍你自己和职业方向。', 'Introduce yourself and your professional focus here.')}
        </p>
      </section>
      <section data-site-section="education">
        <h3>{labels('education')}</h3>
        {education.length > 0 ? <ol className="site-preview-records">
          {education.map(({clientId, title, categoryTitle, program, period, grade, courseTitle, courseDescription}) =>
            <li key={clientId} data-preview-entry={clientId}>
              {categoryTitle.trim() && categoryTitle !== title && <p className="site-preview-muted">{categoryTitle}</p>}
              {title.trim() && <h4>{title}</h4>}
              {program.trim() && <p>{program}</p>}
              {(period.trim() || grade.trim()) && <p className="site-preview-muted">{[period, grade].filter(value => value.trim()).join(' · ')}</p>}
              {courseTitle.trim() && <h4>{courseTitle}</h4>}
              {courseDescription.trim() && <p className="site-preview-prose">{courseDescription}</p>}
            </li>)}
        </ol> : <p className="site-preview-muted">{text('暂无本地内容', 'No local content')}</p>}
      </section>
      <section data-site-section="experience">
        <h3>{labels('experience')}</h3>
        {experience.length > 0 ? <ol className="site-preview-records">
          {experience.map(({clientId, title, organization, period, location, description}) =>
            <li key={clientId} data-preview-entry={clientId}>
              {title?.trim() && <h4>{title}</h4>}
              {organization?.trim() && <p>{organization}</p>}
              {(period?.trim() || location?.trim()) && <p className="site-preview-muted">{[period, location].filter(value => value?.trim()).join(' · ')}</p>}
              {description?.trim() && <p className="site-preview-prose">{description}</p>}
            </li>)}
        </ol> : <p className="site-preview-muted">{text('暂无本地内容', 'No local content')}</p>}
      </section>
      {laterSections.map(key => <section data-site-section={key} key={key}>
        <h3>{labels(key)}</h3>
        <p className="site-preview-muted">{text('暂无本地内容', 'No local content')}</p>
      </section>)}
      <section data-site-section="contact">
        <h3>{labels('contact')}</h3>
        {profile.contactFocusHeading.trim() && <h4>{profile.contactFocusHeading}</h4>}
        {profile.contactStatusHeading.trim() && <h4>{profile.contactStatusHeading}</h4>}
        <p className="site-preview-muted">{text('暂无本地联系信息', 'No local contact details')}</p>
      </section>
      <footer>{[shared.footerName, shared.copyright].filter(value => value.trim()).join(' · ') || 'EXAMPLE_CV'}</footer>
    </article>
  </div>;
}
