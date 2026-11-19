'use client';

import {useLayoutEffect, useEffect, useState, type ReactNode} from 'react';
import {
  cancelModule, editorModules, emptyDraft, INTRODUCTION_LIMIT, moduleFromHash, moduleIsDirty,
  profileLocalized, profileShared, validIntroduction, type ContentLocale,
  type EditorModule, type LocalDraft,
} from '../../lib/editor/draft';
import {EducationEditor} from './education-editor';
import {ExperienceEditor} from './experience-editor';
import {ProjectsEditor} from './projects-editor';
import {SkillsEditor} from './skills-editor';
import {AwardsEditor} from './awards-editor';
import {ContactEditor} from './contact-editor';
import {SiteLinksEditor} from './site-links-editor';
import {SiteTextEditor} from './site-text-editor';
import {EditorAiActions} from './repeatable-editor';
import {DashboardShell} from './dashboard';
import {FullSitePreview} from './full-site-preview';
import {useUiLocale} from './ui-locale';

function EditorModeSwitcher({options, selected, select, label}: {
  options: readonly [string, string][]; selected: string; select: (value: string) => void; label: string;
}) {
  return <div className="editor-switch" role="group" aria-label={label}>
    {options.map(([key, caption]) => <button key={key} type="button"
      aria-pressed={selected === key} onClick={() => select(key)}>{caption}</button>)}
  </div>;
}

function EditorField({label, value, maxLength, onChange}: {
  label: string; value: string; maxLength: number; onChange: (text: string) => void;
}) {
  return <label className="editor-field">{label}
    <input value={value} maxLength={maxLength} autoComplete="off" onChange={event => onChange(event.target.value)}/>
  </label>;
}

function EditorPanel({children, mode, dirty, hasChanges, cancel}: {
  children: ReactNode; mode: 'edit' | 'preview'; dirty: boolean; hasChanges: boolean; cancel: () => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <section className="editor-pane" data-mode={mode} aria-labelledby="editor-panel-heading">
    <div className="editor-pane-body">
      <h2 id="editor-panel-heading">{text('内容编辑', 'Edit content')}</h2>
      {children}
    </div>
    <div className="editor-actions">
      <p role="status">{hasChanges ? text('本地有未保存的修改', 'Unsaved local changes') : text('暂无本地修改', 'No local changes')}</p>
      <div>
        <button type="button" onClick={cancel} disabled={!dirty}>{text('取消本模块修改', 'Discard section changes')}</button>
        <button type="button" className="editor-save" disabled aria-describedby="editor-save-reason">
          {text('保存草稿', 'Save draft')}
        </button>
      </div>
      <small id="editor-save-reason">{text('保存服务尚未开放', 'Saving is unavailable')}</small>
    </div>
  </section>;
}

export function ResumeEditor() {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [module, setModule] = useState<EditorModule>('profile');
  const [contentLocale, setContentLocale] = useState<ContentLocale>('zh');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [draft, setDraft] = useState<LocalDraft>(emptyDraft);
  const contactArea = module === 'contact' || module === 'links' || module === 'site-text';
  const activeSection = contactArea ? 'contact' : module;
  const dirty = moduleIsDirty(draft, module);
  const hasChanges = (Object.keys(editorModules) as EditorModule[]).some(key => moduleIsDirty(draft, key));
  const titles: Record<EditorModule, string> = {
    profile: text('个人资料', 'Profile'),
    introduction: text('个人介绍', 'Introduction'),
    education: text('教育经历', 'Education'),
    experience: text('工作经历', 'Experience'),
    projects: text('项目经历', 'Projects'),
    skills: text('技能', 'Skills'),
    awards: text('荣誉奖项', 'Awards'),
    contact: text('联系与链接', 'Contact & links'),
    links: text('联系与链接', 'Contact & links'),
    'site-text': text('联系与链接', 'Contact & links'),
  };
  const introduction = draft.introduction[contentLocale];
  const introValid = validIntroduction(introduction);

  useLayoutEffect(() => {
    // Same-document navigation keeps all module drafts in memory. Other hashes
    // belong to the existing Dashboard skip and navigation links.
    const select = () => {
      const requested = moduleFromHash(location.hash);
      if (requested) setModule(requested);
    };
    select();
    window.addEventListener('hashchange', select);
    return () => window.removeEventListener('hashchange', select);
  }, []);

  useEffect(() => {
    if (!hasChanges) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges]);

  return <DashboardShell section={activeSection}>
    <div className="resume-editor">
      <header className="editor-heading">
        <h1>{titles[module]}</h1>
        <p>{text('本地工作区 · 输入仅保留在当前页面', 'Local workspace · Your edits stay on this page')}</p>
      </header>
      <div className="editor-modes">
        <EditorModeSwitcher options={[[ 'edit', text('编辑', 'Edit') ], [ 'preview', text('完整网站预览', 'Full website preview') ]]}
          selected={mode} select={value => setMode(value === 'preview' ? 'preview' : 'edit')}
          label={text('工作区视图', 'Workspace view')}/>
      </div>
      <div className="editor-columns">
        <EditorPanel mode={mode} dirty={dirty} hasChanges={hasChanges} cancel={() => setDraft(current => cancelModule(current, module))}>
          {contactArea && <div className="editor-contact-areas">
            <EditorModeSwitcher options={[
              ['contact', text('联系栏', 'Contact')], ['links', text('公开链接', 'Public links')], ['site-text', text('网站文字', 'Site text')],
            ]} selected={module} select={section => {location.hash = section;}} label={text('联系与链接区域', 'Contact and links areas')}/>
          </div>}
          <div className="editor-language">
            <span>{text('内容语言', 'Content language')}</span>
            <EditorModeSwitcher options={[[ 'zh', '中文' ], [ 'en', 'English' ]]} selected={contentLocale}
              select={value => setContentLocale(value === 'en' ? 'en' : 'zh')} label={text('内容语言', 'Content language')}/>
          </div>
          {module === 'profile' ? <>
            <fieldset className="editor-fields">
              <legend>{text('显示内容', 'Display content')} · {contentLocale === 'zh' ? '中文' : 'English'}</legend>
              {Object.entries(profileLocalized).map(([field, [zh, en, limit]]) => {
                const key = field as keyof typeof profileLocalized;
                return <EditorField key={key} label={text(zh, en)} maxLength={limit} value={draft.profile.translations[contentLocale][key]}
                  onChange={value => setDraft(current => ({...current, profile: {...current.profile, translations: {
                    ...current.profile.translations, [contentLocale]: {...current.profile.translations[contentLocale], [key]: value},
                  }}}))}/>;
              })}
            </fieldset>
            <fieldset className="editor-fields">
              <legend>{text('共享信息', 'Shared details')}</legend>
              {Object.entries(profileShared).map(([field, [zh, en, limit]]) => {
                const key = field as keyof typeof profileShared;
                return <EditorField key={key} label={text(zh, en)} maxLength={limit} value={draft.profile.shared[key]}
                  onChange={value => setDraft(current => ({...current, profile: {
                    ...current.profile, shared: {...current.profile.shared, [key]: value},
                  }}))}/>;
              })}
            </fieldset>
            <p className="editor-note">{text('头像上传尚未开放。职业定位可在个人介绍中编辑。', 'Photo upload is unavailable. Describe your professional focus in Introduction.')}</p>
          </> : module === 'education' ?
            <EducationEditor rows={draft.education} contentLocale={contentLocale}
              onChange={education => setDraft(current => ({...current, education}))}/> :
          module === 'experience' ?
            <ExperienceEditor rows={draft.experience} contentLocale={contentLocale}
              onChange={experience => setDraft(current => ({...current, experience}))}/> :
          module === 'projects' ?
            <ProjectsEditor rows={draft.projects} contentLocale={contentLocale}
              onChange={projects => setDraft(current => ({...current, projects}))}/> :
          module === 'skills' ?
            <SkillsEditor rows={draft.skills} contentLocale={contentLocale}
              onChange={skills => setDraft(current => ({...current, skills}))}/> :
          module === 'awards' ?
            <AwardsEditor rows={draft.awards} contentLocale={contentLocale}
              onChange={awards => setDraft(current => ({...current, awards}))}/> :
          module === 'contact' ?
            <ContactEditor draft={draft.contact} contentLocale={contentLocale}
              onChange={contact => setDraft(current => ({...current, contact}))}/> :
          module === 'links' ?
            <SiteLinksEditor draft={draft.links} contentLocale={contentLocale}
              onChange={links => setDraft(current => ({...current, links}))}/> :
          module === 'site-text' ?
            <SiteTextEditor draft={draft['site-text']} contentLocale={contentLocale}
              onChange={siteText => setDraft(current => ({...current, 'site-text': siteText}))}/> :
            <div className="editor-introduction">
            <div className="editor-field-heading">
              <label htmlFor="editor-intro-text">{contentLocale === 'zh' ? '中文介绍' : 'English introduction'}</label>
              <EditorAiActions reasonId="editor-ai-reason"/>
            </div>
            <textarea id="editor-intro-text" value={introduction} maxLength={INTRODUCTION_LIMIT}
              aria-describedby="editor-intro-guidance" aria-invalid={!introValid || undefined}
              onChange={event => {
                const value = event.target.value;
                setDraft(current => ({...current, introduction: {...current.introduction, [contentLocale]: value}}));
              }}/>
            <p id="editor-intro-guidance" className="editor-note">{text('纯文本。支持换行。', 'Plain text. Line breaks are preserved.')} <span>{introduction.length} / 20,000</span></p>
            {!introValid && <p role="alert">{text('内容含无效字符或超过长度上限。', 'The introduction contains invalid characters or exceeds the length limit.')}</p>}
            <p id="editor-ai-reason" className="editor-note">{text('AI 优化与生成尚未开放。', 'AI refinement and generation are unavailable.')}</p>
          </div>}
        </EditorPanel>
        <section className="editor-preview" data-mode={mode} aria-labelledby="editor-preview-heading">
          <div className="editor-preview-heading">
            <h2 id="editor-preview-heading">{text('完整网站预览', 'Full website preview')}</h2>
            <p>{text('本地预览 · 未保存、未发布', 'Local preview · Unsaved and unpublished')}</p>
          </div>
          <FullSitePreview draft={draft} locale={contentLocale} module={module === 'links' ? 'profile' : activeSection}/>
        </section>
      </div>
    </div>
  </DashboardShell>;
}
