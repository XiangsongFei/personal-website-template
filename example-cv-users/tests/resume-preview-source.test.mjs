import test from 'node:test';
import assert from 'node:assert/strict';
import {resumePreviewSource} from '../lib/editor/resume-preview-source.ts';
import {emptyDraft} from '../lib/editor/draft.ts';
import {textSections,emptyTextContent} from '../lib/editor/resume-text.ts';

test('local, complete private, and published previews preserve separate versions and guide policy',()=>{
  const siteId=crypto.randomUUID();
  const local={kind:'local',draft:emptyDraft,guides:{},showExamples:true};
  const visible=resumePreviewSource(local,'zh');
  assert.ok(visible.preview.exampleField('introduction','introduction','zh'));
  const introduction={state:'ready',siteId,revision:5,record:{id:crypto.randomUUID(),position:0,translations:{zh:'私有已保存',en:'Saved'}}};
  const sections=textSections.map(section=>({siteId,section,revision:1,content:emptyTextContent(section)}));
  const privateSource={kind:'saved',siteId,introduction,sections};
  const saved=resumePreviewSource(privateSource,'en');
  assert.equal(saved.preview.content.introduction.zh,'私有已保存');
  assert.equal(saved.locale,'en');
  assert.equal(saved.revisions.introduction,5);
  assert.equal(saved.preview.exampleField('profile','name','en'),undefined);
  const published={kind:'published',revision:2,draft:{...emptyDraft,introduction:{zh:'公开旧版本',en:'Published'}}};
  assert.equal(resumePreviewSource(published,'zh').preview.content.introduction.zh,'公开旧版本');
  assert.equal(resumePreviewSource(published,'zh').revision,2);
  assert.equal(resumePreviewSource({...privateSource,sections:sections.slice(1)},'zh'),undefined);
  assert.equal(resumePreviewSource({...privateSource,sections:[...sections,sections[0]]},'zh'),undefined);
  assert.equal(resumePreviewSource({...privateSource,sections:[{...sections[0],siteId:crypto.randomUUID()},...sections.slice(1)]},'zh'),undefined);
});
