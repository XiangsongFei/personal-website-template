import test from 'node:test';
import assert from 'node:assert/strict';
import {awardYearsDiffer, editTranslation, moveRecord, newAward, newSkill, removeRecord, skillCategory, skillPresetTitles, skillTitle} from '../lib/editor/records.ts';
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


test('award years can differ, and only the edited locale is updated', () => {
  const row = newAward('local-first', 0);
  const zh = {name:'合成奖项',year:'2025 年'};
  const en = {name:'Long synthetic award '.repeat(80),year:'2024'};
  const translations = editTranslation(editTranslation(row.translations,'zh',zh),'en',en);
  const bilingual = {...row,translations};
  assert.equal(awardYearsDiffer(bilingual),true);
  assert.equal(awardYearsDiffer({...row,translations:{zh}}),false);
  const cleared = {...bilingual,translations:editTranslation(translations,'en',{year:''})};
  assert.equal(awardYearsDiffer(cleared),true);
  assert.deepEqual(cleared.translations.zh,zh);
  assert.equal(cleared.translations.en.name,en.name);
  assert.equal(cleared.translations.en.year,'');
  const ordered = moveRecord([cleared,newAward('local-second',1)],row.clientId,1);
  assert.equal(ordered[1].translations,cleared.translations);
  assert.equal(ordered[1].position,1);
  const remaining = removeRecord(ordered,'local-second');
  assert.equal(remaining[0].position,0);
  assert.equal(remaining[0].translations,cleared.translations);
  const draft={...emptyDraft,awards:remaining,skills:[newSkill('local-skill',0)]};
  assert.deepEqual(cancelModule(draft,'awards').awards,[]);
  assert.equal(cancelModule(draft,'awards').skills,draft.skills);
});
