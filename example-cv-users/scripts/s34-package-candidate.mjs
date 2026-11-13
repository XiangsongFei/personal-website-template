// Local file packaging only. Never runs a service, Docker, Auth or database tool.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyFrozenFiles} from '../tests/s3/clean-candidate/service.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const frozen=await readFile(root+'tests/s3/clean-candidate/frozen.json');
const manifest=JSON.parse(frozen);
await verifyFrozenFiles(manifest);
const destination=resolve(root,'outputs/s34-clean-candidate-business-20261112-v5');
await mkdir(dirname(destination),{recursive:true});
await mkdir(destination); // Fail on an existing candidate: never overwrite evidence.
for(const path of [...Object.keys(manifest.files),'tests/s3/clean-candidate/frozen.json']) {
 await mkdir(dirname(destination+'/'+path),{recursive:true});
 const raw=path.endsWith('/frozen.json')?frozen:await readFile(root+path);
 if(!path.endsWith('/frozen.json')&&createHash('sha256').update(raw).digest('hex')!==manifest.files[path])throw Error('SOURCE_CHANGED_DURING_PACKAGE');
 await writeFile(destination+'/'+path,raw,{flag:'wx',mode:0o444});
}
console.log(JSON.stringify({status:'PACKAGED_NOT_STARTED',destination,image:manifest.image.status,secretFiles:0}));
