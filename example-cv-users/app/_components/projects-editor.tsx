'use client';

import {useId} from 'react';
import type {ContentLocale} from '../../lib/editor/draft';
import {
  editTranslation, moveRecord, newProject, removeRecord, safeProjectUrl, updateProjectMethods,
  type ProjectDraft, type ProjectMethodDraft, type ProjectText,
} from '../../lib/editor/records';
import {RecordField, RepeatableEditor} from './repeatable-editor';
import {useUiLocale} from './ui-locale';

function ProjectMethods({methods, contentLocale, onChange}: {
  methods: readonly ProjectMethodDraft[];
  contentLocale: ContentLocale;
  onChange: (methods: readonly ProjectMethodDraft[]) => void;
}) {
  const {locale} = useUiLocale();
  const text = (zh: string, en: string) => locale === 'zh' ? zh : en;
  const heading = useId();
  return <section className="project-methods" aria-labelledby={heading} data-method-locale={contentLocale}>
    <h3 id={heading}>{contentLocale === 'zh' ? text('中文方法', 'Chinese methods') : text('英文方法', 'English methods')}</h3>
    <button type="button" className="record-add" onClick={() =>
      onChange([...methods, {clientId: 'local-' + crypto.randomUUID(), position: methods.length, value: ''}])
    }>{text('＋ 添加方法', '＋ Add method')}</button>
    {methods.length === 0 ? <p className="editor-note">{text('暂无方法。', 'No methods yet.')}</p> :
      <ol className="method-list">
        {methods.map((method, index) => {
          const label = text('方法', 'Method') + ' ' + (index + 1);
          return <li className="record-header method-row" key={method.clientId} data-method-id={method.clientId} data-position={method.position}>
            <label className="editor-field method-field">{label}
              <input value={method.value} autoComplete="off" maxLength={500} onChange={event => {
                const value = event.target.value;
                onChange(methods.map(item => item.clientId === method.clientId ? {...item, value} : item));
              }}/>
            </label>
            <div className="record-actions" role="group" aria-label={label}>
              <button type="button" disabled={index === 0}
                onClick={() => onChange(moveRecord(methods, method.clientId, -1))}>{text('上移', 'Move up')}</button>
              <button type="button" disabled={index === methods.length - 1}
                onClick={() => onChange(moveRecord(methods, method.clientId, 1))}>{text('下移', 'Move down')}</button>
              <button type="button" onClick={() => onChange(removeRecord(methods, method.clientId))}>{text('删除', 'Delete')}</button>
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
  const urlId = useId();
  return <RepeatableEditor rows={rows} onChange={onChange} create={newProject}
    caption={(row, index) => (index + 1) + '. ' + (row.translations[contentLocale]?.title?.trim() || text('项目经历', 'Project'))}
    addLabel={text('＋ 添加项目', '＋ Add project')}
    emptyLabel={text('暂无项目。', 'No projects yet.')}
    fields={(row, update) => {
      const values = row.translations[contentLocale];
      const href = values?.href ?? '';
      const invalid = Boolean(href.trim() && !safeProjectUrl(href));
      function change(key: keyof ProjectText, value: string) {
        update({...row, translations: editTranslation(row.translations, contentLocale, {[key]: value})});
      }
      const field = (key: keyof ProjectText, label: string, multiline = false) => <RecordField
        label={label} value={values?.[key] ?? ''} multiline={multiline} onChange={value => change(key, value)}/>;
      return <>
        <div className="editor-fields record-field-grid">
          {field('title', text('项目名称', 'Project name'))}
          {field('subtitle', text('副标题', 'Subtitle'))}
          {field('period', text('时间范围', 'Period'))}
          <div className="editor-field">
            <label htmlFor={urlId}>{text('项目链接', 'Project URL')}</label>
            <input id={urlId} type="url" value={href} maxLength={2048} autoComplete="off"
              aria-invalid={invalid || undefined} aria-describedby={invalid ? urlId + '-error' : undefined}
              onChange={event => change('href', event.target.value)}/>
            {invalid && <p className="editor-note" id={urlId + '-error'} role="status">
              {text('请输入不含账号或密码的完整 HTTP 或 HTTPS 链接。', 'Enter a full HTTP or HTTPS URL without credentials.')}
            </p>}
          </div>
        </div>
        {field('description', text('项目描述', 'Project description'), true)}
        <ProjectMethods methods={row.methods[contentLocale]} contentLocale={contentLocale}
          onChange={methods => update(updateProjectMethods(row, contentLocale, methods))}/>
      </>;
    }}/>
}
