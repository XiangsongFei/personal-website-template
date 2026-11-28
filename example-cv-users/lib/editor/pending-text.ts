import {uuid} from '../business/protocol.mjs';
import {isTextSection, type TextReceiptKey, type TextSection} from './resume-text.ts';

export type PendingSection=TextSection|'introduction';
export type PendingKey<S extends PendingSection=PendingSection>=Omit<TextReceiptKey,'section'>&{section:S};
export function pendingKey<S extends PendingSection>(input: unknown, section: S): PendingKey<S> {
  const value=input as Partial<PendingKey<S>>|null;
  if(!value || typeof value!=='object' || Object.keys(value).length!==5 || !Object.hasOwn(value,'section') || value.section!==section ||
     typeof value.siteId!=='string'||!uuid(value.siteId)||typeof value.requestId!=='string'||!uuid(value.requestId)||
     typeof value.expectedRevision!=='number'||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||
     typeof value.digest!=='string'||!(/^[a-f0-9]{64}$/).test(value.digest)) throw Error('INVALID_PENDING_RECEIPT');
  return {section,siteId:value.siteId,requestId:value.requestId,expectedRevision:value.expectedRevision,digest:value.digest};
}

const prefix = 'ecv:pending-text:v1:';
const storageKey = (scope: string, section: PendingSection) => {
  if (!/^[a-f0-9]{64}$/.test(scope) || !(section==='introduction'||isTextSection(section))) throw Error('INVALID_PENDING_SCOPE');
  return prefix+scope+':'+section;
};

// Only an opaque work scope and the receipt locator persist across documents.
export function readPendingText<S extends PendingSection>(storage: Storage, scope: string, section: S) {
  try {
    const raw=storage.getItem(storageKey(scope,section));
    return raw===null ? undefined : pendingKey(JSON.parse(raw),section);
  } catch {return undefined;}
}
export function recordPendingText(storage: Storage, scope: string, value: PendingKey) {
  const next=pendingKey(value,value.section);
  const key=storageKey(scope,next.section);
  if (storage.getItem(key)!==null) return false;
  storage.setItem(key,JSON.stringify(next));
  return storage.getItem(key)===JSON.stringify(next);
}
export function removePendingText(storage: Storage, scope: string, value: PendingKey) {
  const current=readPendingText(storage,scope,value.section);
  if(current?.requestId===value.requestId && current.digest===value.digest)
    storage.removeItem(storageKey(scope,value.section));
}
export function removePendingScope(storage: Storage, scope: string) {
  const scopePrefix=prefix+scope+':';
  for(let i=storage.length-1;i>=0;i--){
    const key=storage.key(i);
    if(key?.startsWith(scopePrefix)) storage.removeItem(key);
  }
}
