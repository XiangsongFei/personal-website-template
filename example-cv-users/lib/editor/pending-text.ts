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

const prefix='ecv:pending-text:v1:';
function sectionPrefix(scope:string,section:PendingSection) {
  if(!/^[a-f0-9]{64}$/.test(scope)||!(section==='introduction'||isTextSection(section))) throw Error('INVALID_PENDING_SCOPE');
  return prefix+scope+':'+section+':';
}
function fromStorage<S extends PendingSection>(storage:Storage,key:string,section:S) {
  const raw=storage.getItem(key);
  return raw===null?undefined:pendingKey(JSON.parse(raw),section);
}

// Keep a separate key per request. Two tabs racing to reserve a section may
// each journal an attempt, but neither can overwrite the other's locator.
export function readPendingText<S extends PendingSection>(storage:Storage,scope:string,section:S) {
  try {
    const stem=sectionPrefix(scope,section);
    for(let i=0;i<storage.length;i++){
      const key=storage.key(i);
      if(key?.startsWith(stem)){
        const value=fromStorage(storage,key,section);
        if(value&&key===stem+value.requestId)return value;
      }
    }
  } catch {return undefined;}
}
export function recordPendingText(storage:Storage,scope:string,value:PendingKey) {
  const next=pendingKey(value,value.section);
  if(readPendingText(storage,scope,next.section)) return false;
  const key=sectionPrefix(scope,next.section)+next.requestId;
  if(storage.getItem(key)!==null)return false;
  storage.setItem(key,JSON.stringify(next));
  return storage.getItem(key)===JSON.stringify(next);
}
export function removePendingText(storage:Storage,scope:string,value:PendingKey) {
  const key=sectionPrefix(scope,value.section)+value.requestId;
  const current=fromStorage(storage,key,value.section);
  if(current?.requestId===value.requestId&&current.digest===value.digest&&current.siteId===value.siteId)
    storage.removeItem(key);
}
export function removePendingScope(storage:Storage,scope:string) {
  if(!/^[a-f0-9]{64}$/.test(scope))return;
  const scopePrefix=prefix+scope+':';
  for(let i=storage.length-1;i>=0;i--){
    const key=storage.key(i);
    if(key?.startsWith(scopePrefix))storage.removeItem(key);
  }
}
