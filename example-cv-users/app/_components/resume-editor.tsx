'use client';

import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {
  cancelModule, emptyDraft, INTRODUCTION_LIMIT, moduleFromHash,
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
import {RecordField} from './repeatable-editor';
import {FieldMatrix, PairedField} from './paired-field';
import type {EditFeedback} from '../../lib/editor/bilingual-review';
import {DashboardShell, UnsavedDot} from './dashboard';
import {FullSitePreview} from './full-site-preview';
import {useUiLocale} from './ui-locale';
import {FieldFeedbackContext} from './field-feedback';
import {useWorkspaceDraft} from './workspace-draft';
import {DraftDeletionScope} from './confirm-draft-deletion';

type WorkspaceMode = 'split' | 'edit' | 'preview';

function EditorModeSwitcher({options, selected, select, label, dirty = []}: {
  options: readonly [string, string][]; selected: string; select: (value: string) => void; label: string; dirty?: readonly EditorModule[];
}) {
  return <div className="editor-switch" role="group" aria-label={label}>
    {options.map(([key, caption]) => <button key={key} className="dashboard-action dashboard-action-text" type="button" data-view-option={key}
      aria-pressed={selected === key} onClick={() => select(key)}>{caption}{dirty.some(module => module === key) && <UnsavedDot/>}</button>)}
  </div>;
}

function EditorPanel({children, subNavigation, mode, module, dirtyModules, titles, cancel, setFocused}: {
  children: ReactNode; subNavigation?: ReactNode; mode: WorkspaceMode; module: EditorModule; dirtyModules: readonly EditorModule[];
  titles: Record<EditorModule, string>; cancel: () => void; setFocused: (field?: EditFeedback) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const body = useRef<HTMLDivElement>(null);
  const dirty = dirtyModules.includes(module);
  const names = dirtyModules.map(key => titles[key]);
  const separator = locale === 'zh' ? '、' : ', ';
  const concise = names.slice(0, 3).join(separator);
  const remaining = names.length > 3 ? text('，共 ' + names.length + ' 个栏目', ' (' + names.length + ' sections)') : '';
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = 0; }, [module]);
  return <section className="editor-pane" data-mode={mode} aria-label={text('内容编辑', 'Edit content')}>
    <DraftDeletionScope key={module} actions={<>
      <div className="editor-change-summary">
        <p role="status" data-dirty={!!names.length}>{names.length ? text('未保存：', 'Unsaved: ') + concise + remaining : text('暂无修改', 'No changes')}</p>
        {remaining && <details className="editor-change-details" key={module}>
          <summary>{text('查看全部', 'Show all')}</summary>
          <ul>{names.map(name => <li key={name}>{name}</li>)}</ul>
        </details>}
      </div>
      <div className="editor-action-buttons">
        <button className="dashboard-action dashboard-action-text" type="button" onClick={cancel} disabled={!dirty}>{text('撤销修改', 'Undo changes')}</button>
        <button type="button" className="editor-save dashboard-action dashboard-action-secondary" disabled>{text('保存草稿', 'Save draft')}</button>
      </div>
    </>}>
      {subNavigation}
      <div className="editor-pane-body" ref={body}><div className="editor-form-grid" onFocusCapture={event => {
        const {editField: field, editLocale: locale, editItem: item} = event.target.dataset;
        if (field && (locale === 'zh' || locale === 'en' || locale === 'shared')) setFocused({module, field, locale, item});
      }} onBlurCapture={event => {
        if (event.target.dataset.editField) setFocused();
      }}>{children}</div></div>
    </DraftDeletionScope>
  </section>;
}

export function ResumeEditor({initialDraft = emptyDraft, interactivePreview}: {initialDraft?: LocalDraft; interactivePreview?: boolean}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [module, setModule] = useState<EditorModule>('profile');
  const [previewLocale, setPreviewLocale] = useState<ContentLocale>('zh');
  const [choice, setMode] = useState<Exclude<WorkspaceMode, 'split'>>('edit');
  const [wide, setWide] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<EditFeedback>();
  const mode = wide ? 'split' : choice;
  const {draft, update: setDraft, dirtyModules, modified, fields} = useWorkspaceDraft(initialDraft, module);
  const contactArea = module === 'contact' || module === 'links' || module === 'site-text';
  const activeSection = contactArea ? 'contact' : module;
  const titles: Record<EditorModule, string> = {
    profile: text('个人资料', 'Profile'),
    introduction: text('个人介绍', 'Introduction'),
    education: text('教育经历', 'Education'),
    experience: text('工作经历', 'Experience'),
    projects: text('项目经历', 'Projects'),
    skills: text('技能', 'Skills'),
    awards: text('荣誉奖项', 'Awards'),
    contact: text('联系栏', 'Contact'),
    links: text('公开链接', 'Public links'),
    'site-text': text('网站文案', 'Website copy'),
  };

  useLayoutEffect(() => {
    // Same-document navigation keeps all module drafts in memory. Other hashes
    // belong to the existing Dashboard skip and navigation links.
    const select = () => {
      const requested = moduleFromHash(location.hash);
      if (requested) setModule(requested);
    };
    select();
    // The client router can commit a new document fragment after this mount.
    const frame = requestAnimationFrame(select);
    const navigation = (window as Window & {navigation?: EventTarget}).navigation;
    window.addEventListener('hashchange', select);
    window.addEventListener('popstate', select);
    navigation?.addEventListener('currententrychange', select);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', select);
      window.removeEventListener('popstate', select);
      navigation?.removeEventListener('currententrychange', select);
    };
  }, []);

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    setWide(element.clientWidth >= 1000);
    const observer = new ResizeObserver(([box]) => setWide(box.contentRect.width >= 1000));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <DashboardShell section={activeSection}>
    <div className="resume-editor" ref={workspace}>
      <header className="editor-heading">
        <h1>{contactArea ? text('联系与链接', 'Contact & links') : titles[module]}</h1>
        <div className="editor-view-switch">
          <EditorModeSwitcher options={[[ 'edit', text('编辑', 'Edit') ], [ 'preview', text('预览', 'Preview') ]]}
            selected={choice} select={value => {setFocused(undefined);setMode(value === 'preview' ? 'preview' : 'edit');}}
            label={text('工作区视图', 'Workspace view')}/>
        </div>
      </header>
      <div className="editor-columns" data-mode={mode}>
        <FieldFeedbackContext.Provider value={fields}>
          <EditorPanel mode={mode} module={module} dirtyModules={dirtyModules} titles={titles} setFocused={setFocused} cancel={() => setDraft(current => cancelModule(current, module, initialDraft))}
            subNavigation={contactArea && <div className="editor-contact-areas">
              <EditorModeSwitcher options={[
                ['contact', text('联系栏', 'Contact')], ['links', text('公开链接', 'Public links')], ['site-text', text('网站文字', 'Site text')],
              ]} selected={module} dirty={dirtyModules} select={section => {location.hash = section;}} label={text('联系与链接区域', 'Contact and links areas')}/>
            </div>}>
            {module === 'profile' ? <ProfileFields profile={draft.profile}
              onChange={profile => setDraft(current => ({...current, profile}))}/> : module === 'education' ?
              <EducationEditor rows={draft.education} contentLocale={locale}
                onChange={education => setDraft(current => ({...current, education}))}/> :
            module === 'experience' ?
              <ExperienceEditor rows={draft.experience} contentLocale={locale}
                onChange={experience => setDraft(current => ({...current, experience}))}/> :
            module === 'projects' ?
              <ProjectsEditor rows={draft.projects} contentLocale={locale}
                onChange={projects => setDraft(current => ({...current, projects}))}/> :
            module === 'skills' ?
              <SkillsEditor rows={draft.skills} contentLocale={locale}
                onChange={skills => setDraft(current => ({...current, skills}))}/> :
            module === 'awards' ?
              <AwardsEditor rows={draft.awards} contentLocale={locale}
                onChange={awards => setDraft(current => ({...current, awards}))}/> :
            module === 'contact' ?
              <ContactEditor draft={draft.contact} contentLocale={locale}
                onChange={contact => setDraft(current => ({...current, contact}))}/> :
            module === 'links' ?
              <SiteLinksEditor draft={draft.links}
                onChange={links => setDraft(current => ({...current, links}))}/> :
            module === 'site-text' ?
              <SiteTextEditor draft={draft['site-text']}
                onChange={siteText => setDraft(current => ({...current, 'site-text': siteText}))}/> :
              <div className="editor-introduction">
                <PairedField identity={{field: 'introduction'}} label={text('个人介绍', 'Introduction')} value={language => draft.introduction[language]} multiline long hideLegend ai
                  maxLength={INTRODUCTION_LIMIT}
                  onChange={(language, value) => setDraft(current => ({...current, introduction: {...current.introduction, [language]: value}}))}
                  count={value => value.length + ' / 20,000'}
                  error={value => validIntroduction(value) ? undefined : text('内容含无效字符或超过长度上限。',
                    'The introduction contains invalid characters or exceeds the length limit.')}/>
              </div>}
          </EditorPanel>
        </FieldFeedbackContext.Provider>
        <section className="editor-preview" data-mode={mode} aria-label={text('网站预览', 'Website preview')}>
          <FullSitePreview modified={modified} focused={focused?.module === module ? focused : undefined} interactiveLinks={interactivePreview} draft={draft} locale={previewLocale} module={module === 'links' ? 'profile' : activeSection} onLocaleChange={setPreviewLocale}/>
        </section>
      </div>
    </div>
  </DashboardShell>;
}

function ProfileFields({profile, onChange}: {profile: LocalDraft['profile']; onChange: (profile: LocalDraft['profile']) => void}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const localized = (key: keyof typeof profileLocalized) => {
    const [zh, en, limit] = profileLocalized[key];
    return <PairedField identity={{field: key}} label={text(zh, en)} maxLength={limit} value={language => profile.translations[language][key]}
      onChange={(language, value) => onChange({...profile, translations: {
        ...profile.translations, [language]: {...profile.translations[language], [key]: value},
      }})}/>;
  };
  const shared = (key: keyof typeof profileShared) => {
    const [zh, en, limit] = profileShared[key];
    return <RecordField identity={{field: key}} label={text(zh, en)} maxLength={limit} value={profile.shared[key]} sharedRow
      compact={key === 'avatarInitials' || key === 'graduationValue'}
      onChange={value => onChange({...profile, shared: {...profile.shared, [key]: value}})}/>;
  };
  return <>
    <fieldset className="editor-fields profile-group">
      <legend>{text('基本资料', 'Personal details')}</legend>
      <FieldMatrix>
        {localized('name')}
        {localized('avatarLabel')}
      </FieldMatrix>
      {shared('avatarInitials')}
      {shared('graduationValue')}
    </fieldset>
    <fieldset className="editor-fields profile-group">
      <legend>{text('网站文案', 'Website copy')}</legend>
      <FieldMatrix>
        {localized('navAboutLabel')}
        {localized('graduationLabel')}
        {localized('emailActionLabel')}
        {localized('contactFocusHeading')}
        {localized('contactStatusHeading')}
      </FieldMatrix>
    </fieldset>
    <fieldset className="editor-fields profile-group">
      <legend>{text('页脚', 'Footer')}</legend>
      {shared('footerName')}
      {shared('copyright')}
    </fieldset>
  </>;
}
