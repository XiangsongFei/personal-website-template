import {isTextSection, textReceiptKey, type TextReceiptKey, type TextSection} from './resume-text.ts';

const prefix = 'ecv:pending-text:v1:';
const storageKey = (scope: string, section: TextSection) => {
  if (!/^[a-f0-9]{64}$/.test(scope) || !isTextSection(section)) throw Error('INVALID_PENDING_SCOPE');
  return prefix+scope+':'+section;
};

// Only an opaque work scope and the receipt locator persist across documents.
export function readPendingText(storage: Storage, scope: string, section: TextSection) {
  try {
    const raw=storage.getItem(storageKey(scope,section));
    return raw===null ? undefined : textReceiptKey(JSON.parse(raw));
  } catch {return undefined;}
}
export function recordPendingText(storage: Storage, scope: string, value: TextReceiptKey) {
  const next=textReceiptKey(value);
  const key=storageKey(scope,next.section);
  if (storage.getItem(key)!==null) return false;
  storage.setItem(key,JSON.stringify(next));
  return storage.getItem(key)===JSON.stringify(next);
}
export function removePendingText(storage: Storage, scope: string, value: TextReceiptKey) {
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
