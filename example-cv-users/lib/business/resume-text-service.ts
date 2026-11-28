import {accountContext} from './identity.mjs';
import {deny, uuid} from './protocol.mjs';
import {
  emptyTextContent, InvalidResumeText, isTextSection, textCommand, textCommandDigest,
  textReceiptKey, validateTextContent, type TextCommand, type TextReceiptKey, type TextSection, type TextSnapshot,
} from '../editor/resume-text.ts';

export interface ResumeTextRepository {
  mine(handle: object): Promise<unknown>;
  read(handle: object, siteId: string, section: TextSection): Promise<unknown>;
  save(handle: object, command: TextCommand): Promise<unknown>;
  receipt(handle: object, key: TextReceiptKey): Promise<unknown>;
}
type Wire = {schema_version?: unknown; site?: {id?: unknown} | null; state?: unknown; requestId?: unknown;
  digest?: unknown; snapshot?: unknown; siteId?: unknown; section?: unknown; revision?: unknown; content?: unknown};

const unknown = () => deny('COMMIT_UNKNOWN',503) as never;

function snapshot(value: unknown, siteId: string, section: TextSection): TextSnapshot {
  const row = value as Wire | undefined;
  if (row?.siteId!==siteId || row.section!==section || typeof row.revision!=='number' ||
      !Number.isSafeInteger(row.revision) || row.revision<0) return unknown();
  try {
    const content = row.content===null && row.revision===0 ? emptyTextContent(section) : validateTextContent(section,row.content);
    return {siteId,section,revision:row.revision,content};
  } catch { return unknown(); }
}

export function createResumeTextService(repository: ResumeTextRepository) {
  async function mine(handle: object): Promise<string|null> {
    accountContext(handle);
    const result=await repository.mine(handle) as Wire | undefined;
    if (result?.schema_version!==1) return unknown();
    if (result.site===null) return null;
    if (typeof result.site?.id!=='string' || !uuid(result.site.id)) return unknown();
    return result.site.id;
  }
  async function owned(handle: object, target: string) {
    if (await mine(handle)!==target) deny('BUSINESS_DENIED',403);
  }
  function parsed<T>(parse: (value: unknown) => T, value: unknown): T {
    try { return parse(value); }
    catch (e) {
      if (e instanceof InvalidResumeText) return deny('INVALID_INPUT',400) as never;
      throw e;
    }
  }
  function receipt(value: unknown, key: TextReceiptKey) {
    const result=value as Wire | undefined;
    if (result?.state==='unknown') return {state:'unknown'} as const;
    if (result?.state!=='saved' || result.requestId!==key.requestId || result.digest!==key.digest) return unknown();
    const saved=snapshot(result.snapshot,key.siteId,key.section);
    if(saved.revision!==key.expectedRevision+1) return unknown();
    return {state:'saved',requestId:key.requestId,digest:key.digest,snapshot:saved} as const;
  }
  return {
    async read(handle: object, section: unknown) {
      if (!isTextSection(section)) return deny('INVALID_INPUT',400) as never;
      const siteId=await mine(handle);
      if (siteId===null) return {state:'no-site'} as const;
      return snapshot(await repository.read(handle,siteId,section),siteId,section);
    },
    async save(handle: object,value: unknown) {
      const command=parsed(textCommand,value);
      await owned(handle,command.siteId);
      const result=receipt(await repository.save(handle,command),{...command,digest:await textCommandDigest(command)});
      if (result.state!=='saved' || JSON.stringify(result.snapshot.content)!==JSON.stringify(command.content)) return unknown();
      return result;
    },
    async reconcile(handle: object,value: unknown) {
      const key=parsed(textReceiptKey,value);
      await owned(handle,key.siteId);
      return receipt(await repository.receipt(handle,key),key);
    },
  };
}
