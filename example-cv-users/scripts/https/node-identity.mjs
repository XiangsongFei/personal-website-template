import {readFileSync,realpathSync,lstatSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PIN} from './identity.mjs';
// Check this running process, not argv[0], process.title or another temporary Node.
export function assertCurrentNode() {
  if(process.platform!=='darwin'||process.versions.node!==PIN.nodeVersion||!Number.isSafeInteger(process.pid)||process.pid<=0)throw Error('existing_node_required');
  const executable=realpathSync(process.execPath), before=lstatSync(executable);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==process.getuid()||(before.mode&0o022)!==0)throw Error('node_identity_metadata_denied');
  const digest=createHash('sha256').update(readFileSync(executable)).digest('hex'),after=statSync(executable);
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||digest!==PIN.nodeExecutableSha256)throw Error('node_identity_digest_denied');
  return {pid:process.pid,version:process.versions.node,executableSha256:digest};
}
