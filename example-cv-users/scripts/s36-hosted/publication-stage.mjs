import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicationProject} from './target.mjs';

const sha = value=>createHash('sha256').update(value).digest('hex');
const candidate = fileURLToPath(new URL('../../supabase/candidates/',import.meta.url));
const files = ['publication-target','publication-catalog','publication-generation','publication-acl',
  'publication-observe','publication-public-probe','publication-outbox-probe'];
const historicalManifest = JSON.parse(readFileSync(join(candidate,'s36-a1','sources.json')));
const {source,source_sha256:expected}=historicalManifest.text_sql.find(item=>item.part==='02');

export function verifyPublicationStage(stageDir, expectedManifest) {
  const manifestBytes=readFileSync(join(stageDir,'manifest.json'));
  if(sha(manifestBytes)!==expectedManifest) throw new Error('PUBLICATION_STAGE_MANIFEST_DRIFT');
  const manifest=JSON.parse(manifestBytes);
  if(manifest.project!==publicationProject || manifest.serverVersionNum!==170012 ||
      manifest.status!=='PUBLICATION_PREPARED_REAL_NOT_RUN' || manifest.closedInstall!==source ||
      manifest.sql?.[source]!==expected)
    throw new Error('PUBLICATION_STAGE_SCOPE_MISMATCH');
  for(const name of [source,...files.map(file=>file+'.sql')]) {
    if(sha(readFileSync(join(stageDir,name)))!==manifest.sql[name])
      throw new Error('PUBLICATION_STAGE_SQL_DRIFT: '+name);
  }
  return manifest;
}

export function stagePublication(frozen02Path,output) {
  const frozen=readFileSync(frozen02Path);
  if(sha(frozen)!==expected) throw new Error('FROZEN_02_SOURCE_DRIFT');
  const sections=[[source,frozen],...files.map(name=>[name+'.sql',readFileSync(join(candidate,'s36-hosted',name+'.sql'))])];
  const manifest={project:publicationProject,serverVersionNum:170012,status:'PUBLICATION_PREPARED_REAL_NOT_RUN',
    closedInstall:source,sql:Object.fromEntries(sections.map(([name,sql])=>[name,sha(sql)])),
    budget:{newAuthUsers:0,newSites:0,existingUserPasswordLogins:3,proofGenerations:1,grants:2,
      negativePublishAttempts:4,publish:1,saveDraft:1,withdraw:1,publicProbeTransactions:4,outboxProbeTransactions:1,
      operatorAclEnable:1,operatorAclClose:1,externalDestinations:0}};
  mkdirSync(output,{mode:0o700});
  for(const [name,sql] of sections) writeFileSync(join(output,name),sql,{flag:'wx',mode:0o600});
  writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==4) throw new Error('Usage: publication-stage.mjs <frozen-02-sql> <new-private-output-directory>');
  console.log(JSON.stringify(stagePublication(...process.argv.slice(2)),null,2));
}
