import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDraft} from '../lib/editor/draft.ts';
import {applyTextContent, emptyTextContent, textCommand, textCommandDigest, textContent, validateTextContent} from '../lib/editor/resume-text.ts';
import {readPendingText, recordPendingText, removePendingText, removePendingScope} from '../lib/editor/pending-text.ts';
import {newFocus, newStatus} from '../lib/editor/contact.ts';
import {fillingGuide} from '../lib/editor/filling-guide.ts';

const uuid=()=>crypto.randomUUID();
const scope='a'.repeat(64);
test('profile and website shared and bilingual fields round-trip with explicit empty values',async()=>{
  const draft=structuredClone(emptyDraft);
  draft.profile.shared.footerName='Shared';
  draft.profile.translations.zh.name='示例甲';
  draft.profile.translations.en.name='Alpha';
  draft['site-text'].translations={zh:{educationLabel:'自定义',kaggleLabel:''},en:{educationLabel:'Custom'}};
  for(const section of ['profile','site-text']){
    const content=textContent(section,draft);
    assert.deepEqual(applyTextContent(emptyDraft,section,content)[section],draft[section]);
  }
  const command=textCommand({siteId:uuid(),section:'profile',requestId:uuid(),expectedRevision:0,content:textContent('profile',draft)});
  assert.match(await textCommandDigest(command),/^[a-f0-9]{64}$/);
  assert.notEqual(await textCommandDigest({...command,section:'site-text'}),await textCommandDigest(command));
});
test('contact preserves distinct ordered collections and excludes filling guide IDs',()=>{
  const draft=structuredClone(emptyDraft);
  const focus=newFocus('local-'+uuid(),0), status=newStatus('local-'+uuid(),0);
  draft.contact.focus=[{...focus,translations:{en:{title:'Focus'},zh:{detail:''}}}];
  draft.contact.status=[{...status,statusType:'study',translations:{zh:{title:'在读'}}}];
  const content=textContent('contact',draft);
  assert.deepEqual(applyTextContent(emptyDraft,'contact',content).contact,draft.contact);
  assert.deepEqual(emptyTextContent('contact'),{translations:{},focus:[],status:[]});
  assert.throws(()=>textContent('contact',fillingGuide),/INVALID_RESUME_TEXT/);
});
test('validator fails closed on added fields, unsafe URLs and key relocation',()=>{
  const links=structuredClone(emptyDraft.links);
  links.shared.email='alice@example.invalid';
  links.shared.github='https://github.com/alice';
  assert.deepEqual(validateTextContent('links',links),links);
  for(const value of ['javascript:alert(1)','https://somebody@abc.invalid','#contact']){
    assert.throws(()=>validateTextContent('links',{...links,shared:{...links.shared,github:value}}),/INVALID_RESUME_TEXT/);
  }
  assert.throws(()=>validateTextContent('site-text',{...emptyDraft['site-text'],assets:[]}),/INVALID_RESUME_TEXT/);
  assert.throws(()=>validateTextContent('profile',{...emptyDraft.profile,ownerId:uuid()}),/INVALID_RESUME_TEXT/);
});
function storage() {
  const entries=new Map();
  return {get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,
    getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k),entries};
}
test('operation marker survives document lifecycle and permits original lookup only for its scope',()=>{
  const local=storage();
  const marker={siteId:uuid(),section:'links',expectedRevision:4,requestId:uuid(),digest:'b'.repeat(64)};
  assert.equal(recordPendingText(local,scope,marker),true);
  assert.equal(recordPendingText(local,scope,{...marker,requestId:uuid()}),false);
  assert.deepEqual(readPendingText(local,scope,'links'),marker);
  assert.equal(readPendingText(local,'b'.repeat(64),'links'),undefined);
  assert.doesNotMatch(JSON.stringify([...local.entries]),/cookie|token|email|content/i);
  removePendingText(local,scope,{...marker,digest:'c'.repeat(64)});
  assert.deepEqual(readPendingText(local,scope,'links'),marker);
  removePendingScope(local,scope);
  assert.equal(readPendingText(local,scope,'links'),undefined);
});
