import {readFileSync, openSync, fstatSync, closeSync, constants} from 'node:fs';
import {exact, uuid} from '../../lib/business/protocol.mjs';

const excluded = new Set(['tkehttvppaqkybqehjbn','makwjnbubmrmopjhzror']);
export function isolatedRef(value) {
  if (typeof value !== 'string' || !/^[a-z]{20}$/.test(value) || excluded.has(value))
    throw new Error('ISOLATED_PROJECT_REQUIRED');
  return value;
}
export function connectionScope(value) {
  const project = isolatedRef(value.project);
  const origin = new URL(value.privateOrigin);
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(value.publishableKey) ||
      origin.protocol !== 'https:' || origin.origin !== value.privateOrigin || origin.hostname !== '127.0.0.1' ||
      !origin.port || Number(origin.port)<1024) throw new Error('INVALID_HOSTED_CONNECTION');
  return Object.freeze({project,publishableKey:value.publishableKey,privateOrigin:value.privateOrigin,
    url:'https://' + project + '.supabase.co'});
}
export function configuration(value) {
  exact(value,['project','publishableKey','privateOrigin','alice','bob','aliceSite','bobSite','entry','requestId','expectedDraftRevision']);
  const binding=connectionScope(value);
  if (![value.alice,value.bob,value.aliceSite,value.bobSite,value.entry,value.requestId].every(uuid) ||
      value.alice === value.bob || value.aliceSite === value.bobSite || value.expectedDraftRevision !== 0)
    throw new Error('INVALID_HOSTED_ACCEPTANCE_CONFIGURATION');
  return Object.freeze({...value,...binding});
}
export function privateFile(path) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=fstatSync(fd);
    if (!stat.isFile() || stat.uid!==process.getuid() || (stat.mode&0o077)!==0 || stat.size>1024*1024)
      throw new Error('PRIVATE_FILE_REQUIRED');
    return readFileSync(fd,'utf8');
  } finally {closeSync(fd);}
}
