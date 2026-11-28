'use client';

import {useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {
  emptyDraft, INTRODUCTION_LIMIT,
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
import {SiteTextEditor, SiteTextField} from './site-text-editor';
import {RecordField} from './repeatable-editor';
import {FieldMatrix, PairedField} from './paired-field';
import type {EditFeedback} from '../../lib/editor/bilingual-review';
import {DashboardShell, UnsavedDot} from './dashboard';
import {FullSitePreview} from './full-site-preview';
import {useUiLocale} from './ui-locale';
import {FieldFeedbackContext} from './field-feedback';
import {isTextSection} from '../../lib/editor/resume-text';
import {useWorkspaceDraft} from './workspace-draft';
import {DraftDeletionScope} from './confirm-draft-deletion';
import {mountEditorSections, selectEditorSection} from './editor-section-history';
import {resumePreviewSource} from '../../lib/editor/resume-preview-source';
import {customSectionTitle, sectionTitleField, type SiteTextDraft} from '../../lib/editor/site-text';

type WorkspaceMode = 'split' | 'edit' | 'preview';

function EditorModeSwitcher<Choice extends string>({options, selected, select, label, dirty = []}: {
  options: readonly [Choice, string][]; selected: string; select: (value: Choice) => void; label: string; dirty?: readonly EditorModule[];
}) {
  return <div className="editor-switch" role="group" aria-label={label}>
    {options.map(([key, caption]) => <button key={key} className="dashboard-action dashboard-action-text" type="button" data-view-option={key}
      aria-pressed={selected === key} onClick={() => select(key)}>{caption}{dirty.some(module => module === key) && <UnsavedDot/>}</button>)}
  </div>;
}

function EditorPanel({children, subNavigation, mode, module, dirtyModules, titles, hasCustomNames, canUndo, cancel, setFocused, saveAction, saveMessage}: {
  children: ReactNode; subNavigation?: ReactNode; mode: WorkspaceMode; module: EditorModule; dirtyModules: readonly EditorModule[];
  titles: Record<EditorModule, string>; hasCustomNames: boolean;
  saveAction?: {label: string; run: () => void; enabled: boolean}; saveMessage?: string;
  canUndo: boolean; cancel: () => void; setFocused: (field?: EditFeedback) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const body = useRef<HTMLDivElement>(null);
  const names = dirtyModules.map(key => titles[key]);
  const separator = locale === 'zh' ? '、' : ', ';
  const concise = names.slice(0, 3).join(separator);
  const remaining = names.length > 3 ? text('，共 ' + names.length + ' 个栏目', ' (' + names.length + ' sections)') : '';
  const summary = names.length ? text('未保存：', 'Unsaved: ') + concise + remaining : text('暂无修改', 'No changes');
  const revealField = (event: {target: EventTarget}) => {
    if (!(event.target instanceof HTMLElement)) return;
    const {editField: field, editLocale: locale, editItem: item} = event.target.dataset;
    if (field && (locale === 'zh' || locale === 'en' || locale === 'shared')) {
      setFocused({module: !item && field === sectionTitleField(module) ? 'site-text' : module, field, locale, item});
    }
  };
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = 0; }, [module]);
  return <section className="editor-pane" data-mode={mode} aria-label={text('内容编辑', 'Edit content')}>
    <DraftDeletionScope key={module} actions={<>
      <div className="editor-change-summary">
        <p role="status" data-dirty={!!names.length} className={hasCustomNames ? 'dashboard-custom-label' : undefined}
          title={hasCustomNames ? names.join(separator) : undefined}>{summary}</p>
        {saveMessage && <p role="status">{saveMessage}</p>}
        {remaining && <details className="editor-change-details" key={module}>
          <summary>{text('查看全部', 'Show all')}</summary>
          <ul>{dirtyModules.map(key => <li key={key}>{titles[key]}</li>)}</ul>
        </details>}
      </div>
      <div className="editor-action-buttons">
        <button className="dashboard-action dashboard-action-text" type="button" onClick={cancel} disabled={!canUndo}>{text('撤销修改', 'Undo changes')}</button>
        <button type="button" className="editor-save dashboard-action dashboard-action-secondary"
          disabled={!saveAction?.enabled} onClick={saveAction?.run}>{saveAction?.label ?? text('保存草稿', 'Save draft')}</button>
      </div>
    </>}>
      {subNavigation}
      <div className="editor-pane-body" ref={body}><div className="editor-form-grid" onFocusCapture={revealField}
        onClickCapture={revealField} onChange={revealField} onBlurCapture={event => {
        if (event.target.dataset.editField) setFocused();
      }}>{children}</div></div>
    </DraftDeletionScope>
  </section>;
}

function TextEditGate({disabled,children}: {disabled:boolean;children:ReactNode}) {
  return disabled ? <fieldset disabled style={{display:'contents'}}>{children}</fieldset> : <>{children}</>;
}

export function ResumeEditor({initialDraft = emptyDraft, introductionEnabled = false, resumeTextEnabled = false}: {initialDraft?: LocalDraft; introductionEnabled?: boolean; resumeTextEnabled?: boolean}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const [module, setModule] = useState<EditorModule>('profile');
  const [previewLocale, setPreviewLocale] = useState<ContentLocale>('zh');
  const [showExamples, setShowExamples] = useState(true);
  const [choice, setMode] = useState<Exclude<WorkspaceMode, 'split'>>('edit');
  const [wide, setWide] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<EditFeedback>();
  const mode = wide ? 'split' : choice;
  const {scope, draft, update: setDraft, undo, guideOverrides, dirtyModules, modified, fields, siteTextFields, siteTextReady, persistence, textPersistence} = useWorkspaceDraft(initialDraft, module, introductionEnabled, resumeTextEnabled);
  const intro = introductionEnabled && module === 'introduction' ? persistence.state : undefined;
  const readiness = intro?.state;
  const outcome = intro?.state === 'ready' ? intro.outcome : undefined;
  const pending = intro?.state === 'ready' && !!(intro.attempt||intro.pending);
  const retryUnsent = intro?.state === 'ready' && intro.retryUnsent;
  const saveAction = intro?.state === 'ready' ? {
    label: pending && !retryUnsent && outcome !== 'saving' ? text('核对保存结果', 'Check save status') : text('保存草稿', 'Save draft'),
    run: () => void persistence.save(),
    enabled: outcome !== 'saving' && outcome !== 'conflict' && outcome !== 'advanced' &&
      (pending || (dirtyModules.includes('introduction') && Object.values(draft.introduction).every(validIntroduction))),
  } : readiness === 'read-error' || readiness === 'session-expiring' ? {
    label: text('重新读取', 'Retry read'), run: () => void persistence.refresh(), enabled: true,
  } : undefined;
  const saveMessage = introductionEnabled && module === 'introduction' ? ({
    loading: text('正在读取个人介绍。', 'Reading your introduction.'),
    'no-site': text('此账户没有可编辑的网站。', 'This account has no editable website.'),
    'session-expiring': text('请在另一个标签页打开工作台以续期，然后返回本页重试。',
      'Open the dashboard in another tab to renew your session, then return here to retry.'),
    'read-error': text('暂时无法读取个人介绍。', 'Your introduction could not be read.'),
    unavailable: text('个人介绍服务尚未开放。', 'Introduction service is unavailable.'),
    denied: text('当前权限无法访问此草稿。', 'Your current permissions do not allow access to this draft.'),
    unsupported: text('此介绍含多条记录，当前编辑器无法加载。', 'This introduction contains multiple records that this editor cannot load.'),
    saving: text('正在核对保存回执。', 'Confirming the save receipt.'),
    unknown: text('保存结果待核对，修改仍保留。', 'The save is unconfirmed. Your edits are still here.'),
    conflict: text('另一个会话已更新草稿。请保留当前修改，再读取最新版本。', 'Another session updated the draft. Keep a copy of your edits before reloading.'),
    advanced: text('原保存有回执，另一个会话已提交更新版本。请保留当前修改，再读取最新版本。',
      'The save has a receipt and a newer version exists. Keep a copy of your edits before reloading.'),
    invalid: text('提交内容无效或超过双语总长度限制。', 'The submission is invalid or exceeds the combined text size limit.'),
    saved: text('已保存个人介绍。', 'Introduction saved.'),
    ready: undefined,
  }[outcome ?? readiness ?? 'loading']) : undefined;
  const usesText = resumeTextEnabled && isTextSection(module);
  const textState=textPersistence.state;
  const textReady=!!textState?.snapshot;
  const textAction=usesText ? {
    label:textState?.pending ? text('核对保存结果','Check save status') :
      textReady ? text('保存草稿','Save draft') : text('重新读取','Retry read'),
    run:()=>void (textReady?textPersistence.save():textPersistence.refresh()),
    enabled:textReady ? textState?.phase!=='saving' && textState?.phase!=='conflict' &&
      (!!textState?.pending||textPersistence.dirty) :
      ['failure','renewal'].includes(textState?.phase??'loading'),
  } : undefined;
  const textMessage=usesText ? ({
    loading:text('正在读取草稿。','Reading your draft.'),
    failure:text('暂时无法读取草稿。','Your draft could not be read.'),
    'no-site':text('此账户没有可编辑的网站。','This account has no editable website.'),
    renewal:text('请在另一个标签页打开工作台以续期，然后返回本页重试。','Open the dashboard in another tab to renew your session, then retry.'),
    denied:text('当前权限无法访问此草稿。','Your current permissions do not allow access to this draft.'),
    saving:text('正在核对保存回执。','Confirming the save receipt.'),
    unknown:text('保存结果待核对。','The save is unconfirmed.'),
    conflict:text('另一个会话已更新草稿。请保留当前修改，再读取最新版本。','Another session updated the draft. Keep a copy of your edits before reloading.'),
    invalid:text('提交内容无效或超过限制。','The submission is invalid or exceeds its limits.'),
    saved:text('已保存草稿。','Draft saved.'),
    ready:undefined,
  }[textState?.phase??'loading']) : undefined;
  const preview=useMemo(()=>resumePreviewSource({kind:'local',draft,guides:guideOverrides,showExamples},previewLocale)!.preview,
    [draft,guideOverrides,showExamples,previewLocale]);
  const heading = sectionTitleField(module);
  const updateSiteText = (siteText: SiteTextDraft) => setDraft(current => ({...current, 'site-text': siteText}));
  const contactArea = module === 'contact' || module === 'links' || module === 'site-text';
  const activeSection = contactArea ? 'contact' : module;
  const custom = customSectionTitle(draft, activeSection, locale);
  const title = (module: EditorModule, zh: string, en: string) => customSectionTitle(draft, module, locale) ?? text(zh, en);
  const titles: Record<EditorModule, string> = {
    profile: text('个人资料', 'Profile'),
    introduction: text('个人介绍', 'Introduction'),
    education: title('education', '教育经历', 'Education'),
    experience: title('experience', '工作经历', 'Experience'),
    projects: title('projects', '项目经历', 'Projects'),
    skills: title('skills', '技能', 'Skills'),
    awards: title('awards', '荣誉奖项', 'Awards'),
    contact: title('contact', '联系栏', 'Contact'),
    links: text('公开链接', 'Public links'),
    'site-text': text('网站文案', 'Website copy'),
  };

  useLayoutEffect(() => mountEditorSections(scope, setModule), [scope]);

  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    setWide(element.clientWidth >= 1000);
    const observer = new ResizeObserver(([box]) => setWide(box.contentRect.width >= 1000));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <DashboardShell section={activeSection} editorDraft={draft}>
    <div className="resume-editor" ref={workspace}>
      <header className="editor-heading">
        <h1 className={custom ? 'dashboard-custom-label' : undefined} title={custom}>{custom ?? (contactArea ? text('联系与链接', 'Contact & links') : titles[module])}</h1>
        <div className="editor-view-switch">
          <EditorModeSwitcher options={[[ 'edit', text('编辑', 'Edit') ], [ 'preview', text('预览', 'Preview') ]]}
            selected={choice} select={value => {setFocused(undefined);setMode(value === 'preview' ? 'preview' : 'edit');}}
            label={text('工作区视图', 'Workspace view')}/>
        </div>
      </header>
      <div className="editor-columns" data-mode={mode}>
        <FieldFeedbackContext.Provider value={fields}>
          <EditorPanel mode={mode} module={module} dirtyModules={dirtyModules} titles={titles} setFocused={setFocused}
            saveAction={textAction??saveAction} saveMessage={textMessage??saveMessage}
            hasCustomNames={dirtyModules.some(key => customSectionTitle(draft, key, locale))}
            canUndo={dirtyModules.includes(module) || !!guideOverrides[module]} cancel={undo}
            subNavigation={contactArea && <div className="editor-contact-areas">
              <EditorModeSwitcher options={[
                ['contact', text('联系栏', 'Contact')], ['links', text('公开链接', 'Public links')], ['site-text', text('网站文字', 'Site text')],
              ]} selected={module} dirty={dirtyModules} select={selectEditorSection} label={text('联系与链接区域', 'Contact and links areas')}/>
            </div>}>
            <TextEditGate disabled={usesText&&!textReady}>
            {heading && <FieldFeedbackContext.Provider value={siteTextFields}>
              <fieldset className="editor-fields" disabled={!siteTextReady}>
                <legend>{text('栏目标题', 'Section title')}</legend>
                <FieldMatrix>
                  <SiteTextField draft={draft['site-text']} onChange={updateSiteText} field={heading} label={text('栏目标题', 'Section title')}/>
                </FieldMatrix>
                {resumeTextEnabled && <p className="editor-note">{text('在「网站文字」中保存栏目标题。','Save section titles in Site text.')}</p>}
              </fieldset>
            </FieldFeedbackContext.Provider>}
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
              <SiteTextEditor draft={draft['site-text']} onChange={updateSiteText}/> :
              <div className="editor-introduction">
                <PairedField identity={{field: 'introduction'}} label={text('个人介绍', 'Introduction')} value={language => draft.introduction[language]} multiline long hideLegend ai
                  maxLength={INTRODUCTION_LIMIT} disabled={introductionEnabled && readiness !== 'ready'}
                  onChange={(language, value) => setDraft(current => ({...current, introduction: {...current.introduction, [language]: value}}))}
                  count={value => value.length + ' / 20,000'}
                  error={value => validIntroduction(value) ? undefined : text('内容含无效字符或超过长度上限。',
                    'The introduction contains invalid characters or exceeds the length limit.')}/>
              </div>}
            </TextEditGate>
          </EditorPanel>
        </FieldFeedbackContext.Provider>
        <section className="editor-preview" data-mode={mode} data-preview-source={showExamples ? 'mixed' : 'draft'} aria-label={text('网站预览', 'Website preview')}>
          <div className="editor-preview-guide">
            {showExamples && <span>{text('灰色为填写示例，不会保存', 'Gray text is an example and won’t be saved')}</span>}
            <button type="button" className="dashboard-action dashboard-action-text"
              onClick={() => setShowExamples(show => !show)}>
              {showExamples ? text('隐藏示例', 'Hide examples') : text('显示示例', 'Show examples')}
            </button>
          </div>
          <FullSitePreview modified={modified} focused={focused?.module === module || (focused?.module === 'site-text' && focused.field === heading) ? focused : undefined}
            preview={preview} showExamples={showExamples}
            locale={previewLocale} module={module === 'links' ? 'profile' : activeSection} onLocaleChange={setPreviewLocale}/>
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
