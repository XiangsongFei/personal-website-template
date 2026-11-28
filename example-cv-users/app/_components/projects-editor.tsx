'use client';

import {useId, useRef} from 'react';
import type {ContentLocale} from '../../lib/editor/draft';
import {
  editTranslation, moveRecord, newProject, removeRecord, safeProjectUrl, updateProjectMethods,
  type ProjectDraft, type ProjectMethodDraft, type ProjectText,
} from '../../lib/editor/records';
import {RecordField, RepeatableEditor} from './repeatable-editor';
import {ReviewField, useFieldFeedback} from './field-feedback';
import {editorLocales} from '../../lib/editor/bilingual-review';
import {FieldMatrix, PairedField} from './paired-field';
import {useUiLocale} from './ui-locale';
import {ConfirmDraftDeletion} from './confirm-draft-deletion';

function ProjectMethods({item, methods, contentLocale, onChange}: {
  item: string; methods: readonly ProjectMethodDraft[];
  contentLocale: ContentLocale;
  onChange: (methods: readonly ProjectMethodDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const heading = useId();
  const feedback = useFieldFeedback({item, field: 'methods'}, contentLocale);
  const add = useRef<HTMLButtonElement>(null);
  return <section className="project-methods" data-field-modified={feedback.modified || undefined} aria-labelledby={heading} aria-describedby={feedback.reminderId} data-method-locale={contentLocale}>
    <h3 id={heading}>{contentLocale === 'zh' ? text('中文方法', 'Chinese methods') : text('英文方法', 'English methods')}</h3>
    {feedback.reminderId && feedback.acknowledge && <ReviewField id={feedback.reminderId} onConfirm={feedback.acknowledge}>{feedback.reminder}</ReviewField>}
    <button type="button" className="record-add dashboard-action dashboard-action-text" ref={add} onClick={() =>
      onChange([...methods, {clientId: 'local-' + crypto.randomUUID(), position: methods.length, value: ''}])
    }>{text('＋ 添加方法', '＋ Add method')}</button>
    {methods.length === 0 ? <p className="editor-note">{text('暂无方法。', 'No methods yet.')}</p> :
      <ol className="method-list">
        {methods.map((method, index) => {
          const label = text('方法', 'Method') + ' ' + (index + 1);
          return <li className="record-header method-row" key={method.clientId} data-method-id={method.clientId} data-position={method.position}>
            <div className="method-field">
              <RecordField label={label} lang={contentLocale === 'zh' ? 'zh-CN' : 'en'} value={method.value}
                identity={{item, field: 'method:' + contentLocale + ':' + method.clientId}} language={contentLocale}
                onChange={value => onChange(methods.map(entry => entry.clientId === method.clientId ? {...entry, value} : entry))}/>
            </div>
            <div className="record-actions" role="group" aria-label={label}>
              <button type="button" className="dashboard-action dashboard-action-text" disabled={index === 0}
                onClick={() => onChange(moveRecord(methods, method.clientId, -1))}>{text('上移', 'Move up')}</button>
              <button type="button" className="dashboard-action dashboard-action-text" disabled={index === methods.length - 1}
                onClick={() => onChange(moveRecord(methods, method.clientId, 1))}>{text('下移', 'Move down')}</button>
              <ConfirmDraftDeletion method title={method.value.trim() || label} onConfirm={() => {
                onChange(removeRecord(methods, method.clientId));
                add.current?.focus();
              }}/>
            </div>
          </li>;
        })}
      </ol>}
  </section>;
}

export function ProjectsEditor({rows, contentLocale, onChange}: {
  rows: readonly ProjectDraft[]; contentLocale: ContentLocale; onChange: (rows: readonly ProjectDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  return <RepeatableEditor rows={rows} onChange={onChange} create={newProject}
    caption={row => (row.translations[contentLocale]?.title?.trim() || text('项目经历', 'Project'))}
    addLabel={text('＋ 添加项目', '＋ Add project')}
    emptyLabel={text('暂无项目。', 'No projects yet.')}
    fields={(row, update) => {
      function change(language: ContentLocale, key: keyof ProjectText, value: string) {
        update({...row, translations: editTranslation(row.translations, language, {[key]: value})});
      }
      const field = (key: keyof ProjectText, label: string, multiline = false) => <PairedField
        identity={{item: row.clientId, field: key}} label={label} value={language => row.translations[language]?.[key] ?? ''} multiline={multiline} long={multiline} ai={multiline}
        onChange={(language, value) => change(language, key, value)}/>;
      return <>
        <div className="editor-fields record-field-grid">
          <FieldMatrix>
            {field('title', text('项目名称', 'Project name'))}
            {field('subtitle', text('副标题', 'Subtitle'))}
            {field('period', text('时间范围', 'Period'))}
          </FieldMatrix>
          <PairedField identity={{item: row.clientId, field: 'href'}} label={text('项目链接', 'Project URL')} type="url" maxLength={2048}
            value={language => row.translations[language]?.href ?? ''} onChange={(language, value) => change(language, 'href', value)}
            error={value => value.trim() && !safeProjectUrl(value)
              ? text('请输入不含账号或密码的完整 HTTP 或 HTTPS 链接。', 'Enter a full HTTP or HTTPS URL without credentials.') : undefined}/>
        </div>
        {field('description', text('项目描述', 'Project description'), true)}
        <div className="project-method-columns">
          {editorLocales.map(language => <ProjectMethods key={language} item={row.clientId} methods={row.methods[language]} contentLocale={language}
            onChange={methods => update(updateProjectMethods(row, language, methods))}/>)}
        </div>
      </>;
    }}/>
}
