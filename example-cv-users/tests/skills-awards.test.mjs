import test from 'node:test';
import assert from 'node:assert/strict';
import {editTranslation, newSkill, skillCategory, skillPresetTitles, skillTitle} from '../lib/editor/records.ts';
import {cancelModule, emptyDraft} from '../lib/editor/draft.ts';

test('skill presets infer only an exact bilingual legacy title pair', () => {
  for (const [category, titles] of Object.entries(skillPresetTitles)) {
    const row = {...newSkill('local-test',0),translations:{zh:{title:titles.zh},en:{title:titles.en}}};
    assert.equal(skillCategory(row),category);
    assert.equal(skillTitle(row,'en'),titles.en);
    const mismatch = {...row,translations:editTranslation(row.translations,'en',{title:'Personal group'})};
    assert.equal(skillCategory(mismatch),'custom');
    assert.equal(skillTitle(mismatch,'en'),'Personal group');
  }
  const explicitEmpty = {...newSkill('local-empty',0),translations:{zh:{title:''},en:{title:'Programming'}}};
  assert.equal(skillCategory(explicitEmpty),'custom');
  assert.equal(skillTitle(explicitEmpty,'zh'),'');
});

test('preset selections preserve custom titles, raw skills text and other modules', () => {
  const row={...newSkill('local-test',0),translations:{zh:{title:'我的分类',items:'甲，乙、丙\n—'},en:{title:'My category',items:'A; B & <C>'}}};
  const preset={...row,category:'tools'};
  assert.equal(skillTitle(preset,'zh'),'工具');
  assert.equal(skillTitle(preset,'en'),'Tools');
  assert.equal(preset.translations,row.translations);
  const custom={...preset,category:'custom'};
  assert.equal(skillTitle(custom,'zh'),'我的分类');
  assert.equal(skillTitle(custom,'en'),'My category');
  assert.equal(custom.translations.zh.items,'甲，乙、丙\n—');
  assert.equal(custom.translations.en.items,'A; B & <C>');
  const draft={...emptyDraft,skills:[custom],introduction:{zh:'保留',en:''}};
  assert.deepEqual(cancelModule(draft,'skills').skills,[]);
  assert.equal(cancelModule(draft,'skills').introduction,draft.introduction);
});
