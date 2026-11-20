import {readFileSync, lstatSync} from 'node:fs';
import {exact, uuid} from '../../lib/business/protocol.mjs';

const excluded = new Set(['tkehttvppaqkybqehjbn','makwjnbubmrmopjhzror']);
export function isolatedRef(value) {
  if (typeof value !== 'string' || !/^[a-z]{20}$/.test(value) || excluded.has(value))
    throw new Error('ISOLATED_PROJECT_REQUIRED');
  return value;
}
export function configuration(value) {
  exact(value,['project','publishableKey','privateOrigin','alice','bob','aliceSite','bobSite','entry','requestId','expectedDraftRevision']);
  const project = isolatedRef(value.project);
  const origin = new URL(value.privateOrigin);
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(value.publishableKey) ||
      origin.protocol !== 'https:' || origin.origin !== value.privateOrigin || origin.hostname !== '127.0.0.1' ||
      !origin.port || Number(origin.port)<1024 ||
      ![value.alice,value.bob,value.aliceSite,value.bobSite,value.entry,value.requestId].every(uuid) ||
      value.alice === value.bob || value.aliceSite === value.bobSite ||
      value.expectedDraftRevision !== 0) throw new Error('INVALID_HOSTED_ACCEPTANCE_CONFIGURATION');
  return Object.freeze({...value, url:'https://' + project + '.supabase.co'});
}
export function privateFile(path) {
  const stat=lstatSync(path);
  if (!stat.isFile() || stat.uid!==process.getuid() || (stat.mode&0o077)!==0)
    throw new Error('PRIVATE_FILE_REQUIRED');
  return readFileSync(path,'utf8');
}
