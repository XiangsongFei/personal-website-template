import {sha256, uuid} from '../business/protocol.mjs';
import {emptyDraft, profileLocalized, profileShared, type LocalDraft} from './draft.ts';
import {contactStatusLabels} from './contact.ts';
import {editableNavigationSections, sectionTitleFields} from './site-text.ts';
import {safePublicEmail} from './site-links.ts';
import {safeHttpUrl} from './records.ts';

export const singletonTextSections = ['profile', 'contact', 'links', 'site-text'] as const;
export type SingletonTextSection = typeof singletonTextSections[number];
export type TextSection = SingletonTextSection;
export const textSections: readonly TextSection[] = singletonTextSections;
export const resumeTextPath='/api/sites/resume-text';
const limit = 160_000;
type Shape = Record<string, unknown>;
type Validator = (value: unknown) => unknown;

export class InvalidResumeText extends Error {
  constructor() { super('INVALID_RESUME_TEXT'); }
}
function invalid(): never { throw new InvalidResumeText(); }
function object(value: unknown): Shape {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return invalid();
  return value as Shape;
}
function keys(source: Shape, allowed: readonly string[]) {
  if (Object.keys(source).some(key => !allowed.includes(key))) invalid();
}
const string = (max: number, format?: (value: string) => unknown): Validator => value => {
  if (typeof value !== 'string' || value.length > max || /[\u0000\uD800-\uDFFF]/u.test(value) ||
      (value !== '' && format && !format(value))) return invalid();
  return value;
};
const strings = (fields: readonly string[], max: number) =>
  Object.fromEntries(fields.map(field => [field, string(max)]));
const shaped = (validators: Record<string, Validator>, required = false): Validator => value => {
  const source = object(value);
  const fields = Object.keys(validators);
  keys(source, fields);
  if (required && fields.length !== Object.keys(source).length) invalid();
  return Object.fromEntries(fields.filter(field => Object.hasOwn(source, field))
    .map(field => [field, validators[field](source[field])]));
};
const translated = (fields: Record<string, Validator>, required = false) => {
  const language = shaped(fields, required);
  return shaped({zh: language, en: language}, required);
};
const oneOf = (values: readonly unknown[]): Validator => value => values.includes(value) ? value : invalid();
const id: Validator = value => uuid(value) ? value : invalid();
function recordList(value: unknown, fields: Record<string, Validator>) {
  if (!Array.isArray(value) || value.length > 100) return invalid();
  const exact = shaped({id, position: value => Number.isSafeInteger(value) ? value : invalid(), ...fields}, true);
  const unique = new Set<unknown>();
  return Array.from(value, (value, position) => {
    const item = exact(value) as Shape;
    if (item.position !== position || unique.has(item.id)) return invalid();
    unique.add(item.id);
    return item;
  });
}

const contactItem = {translations: translated(strings(['title','detail'], 20_000))};
const validators: Record<TextSection, Validator> = {
  profile: shaped({
    shared: shaped(Object.fromEntries(Object.entries(profileShared).map(([key, [, , max]]) => [key, string(max)])), true),
    translations: translated(Object.fromEntries(Object.entries(profileLocalized).map(([key, [, , max]]) => [key, string(max)])), true),
  }, true),
  contact: shaped({
    translations: translated(strings(['contactLabel','availability'],20_000)),
    focus: value => recordList(value,contactItem),
    status: value => recordList(value,{...contactItem,statusType:oneOf(Object.keys(contactStatusLabels))}),
  }, true),
  links: shaped({
    shared: shaped({...strings(['emailLabel','githubLabel','linkedInDisplayName','linkedInLabel'],200),
      email: string(254,safePublicEmail), github: string(2048,safeHttpUrl)},true),
    translations: translated({linkedInLabel:string(200),linkedInHref:string(2048,safeHttpUrl)}),
  }, true),
  'site-text': shaped({
    navigation: translated(strings(editableNavigationSections,200)),
    translations: translated(strings([...Object.values(sectionTitleFields),'kaggleLabel','portfolioLabel','updatedAtLabel'],200)),
  }, true),
};

type RecordNode = {clientId: string; position: number};
type WireRecord<T extends RecordNode> = Omit<T,'clientId'> & {id:string};
const recordToWire = <T extends RecordNode>({clientId, ...item}: T) => ({id:clientId.replace(/^local-/, ''), ...item});
const recordToEditor = <T extends {id:string;position:number}>({id, ...item}: T) => ({clientId:'local-'+id, ...item});

export function isTextSection(value: unknown): value is TextSection {
  return textSections.some(section => section === value);
}
export function wireRecordScopes(section: TextSection, validated: unknown): Array<{id:string; scope:string}> {
  if (section==='contact') {
    const row=validated as Record<'focus'|'status',{id:string}[]>;
    return (['focus','status'] as const).flatMap(scope=>row[scope].map(({id})=>({id,scope})));
  }
  return [];
}
export function validateTextContent(section: TextSection, value: unknown): unknown {
  const result = validators[section](value);
  if (new TextEncoder().encode(JSON.stringify(result)).length>limit) invalid();
  const ids=wireRecordScopes(section,result);
  if(new Set(ids.map(row=>row.id)).size!==ids.length) invalid();
  return result;
}
export function textContent(section: TextSection, draft: LocalDraft): unknown {
  if (section === 'contact') {
    const {focus,status,translations}=draft.contact;
    return validateTextContent(section,{translations,focus:focus.map(recordToWire),status:status.map(recordToWire)});
  }
  return validateTextContent(section,draft[section]);
}
export function applyTextContent(draft: LocalDraft, section: TextSection, value: unknown): LocalDraft {
  const content = validateTextContent(section,value);
  if (section === 'contact') {
    const {focus,status,translations}=content as {focus:WireRecord<LocalDraft['contact']['focus'][number]>[];status:WireRecord<LocalDraft['contact']['status'][number]>[];translations:LocalDraft['contact']['translations']};
    return {...draft,contact:{translations,focus:focus.map(recordToEditor),status:status.map(recordToEditor)}};
  }
  return {...draft,[section]:content};
}
export function emptyTextContent(section: TextSection) { return textContent(section,emptyDraft); }

export type TextCommand = {
  siteId: string; section: TextSection; requestId: string; expectedRevision: number; content: unknown;
};
export type TextSnapshot = {siteId:string; section:TextSection; revision:number; content:unknown};
export type TextReceiptKey = Pick<TextCommand,'siteId'|'section'|'requestId'|'expectedRevision'> & {digest:string};
export function textCommand(value: unknown): TextCommand {
  const source=object(value);
  keys(source,['siteId','section','requestId','expectedRevision','content']);
  const {siteId,section,requestId,expectedRevision}=source;
  if (typeof siteId!=='string' || !uuid(siteId) || !isTextSection(section) ||
      typeof requestId!=='string' || !uuid(requestId) ||
      typeof expectedRevision!=='number' || !Number.isSafeInteger(expectedRevision) || expectedRevision<0) return invalid();
  return {siteId,section,requestId,expectedRevision,content:validateTextContent(section,source.content)};
}
export const textCommandDigest = (command: TextCommand) =>
  sha256(new TextEncoder().encode(JSON.stringify(command)));
export function textReceiptKey(value: unknown): TextReceiptKey {
  const source=object(value);
  keys(source,['siteId','section','requestId','expectedRevision','digest']);
  const {siteId,section,requestId,expectedRevision,digest}=source;
  if (typeof siteId!=='string' || !uuid(siteId) || !isTextSection(section) ||
      typeof requestId!=='string' || !uuid(requestId) || typeof expectedRevision!=='number' ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision<0 || typeof digest!=='string' ||
      !/^[a-f0-9]{64}$/.test(digest)) return invalid();
  return {siteId,section,requestId,expectedRevision,digest};
}

export function parseTextSnapshot(value: unknown, section: TextSection): TextSnapshot | undefined {
  try {
    const row=object(value);
    const {siteId,revision}=row;
    if (typeof siteId!=='string'||!uuid(siteId)||row.section!==section||typeof revision!=='number'||
        !Number.isSafeInteger(revision)||revision<0) return;
    return {siteId,section,revision,content:validateTextContent(section,row.content)};
  } catch {return undefined;}
}
