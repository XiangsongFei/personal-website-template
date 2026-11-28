import {createSession} from '../auth/session';
import type {UsersEnv} from '../config';
import {BusinessError, deny} from '../business/protocol.mjs';
import {createResumeTextRepository} from '../business/resume-text-repository.ts';
import {createResumeTextService} from '../business/resume-text-service.ts';
import {pendingKey} from '../editor/pending-text.ts';
import {isTextSection, resumeTextPath} from '../editor/resume-text.ts';
import {parseIntroduction,workspaceScopeHeader} from '../editor/introduction-dto.ts';
import {authorizeDraft, introductionEnabled, readDraftCommand} from './introduction-server.ts';

export {resumeTextPath};
const endpoint='https://users.resume.example.invalid';
export function resumeTextEnabled(env: UsersEnv) {
  return env.USERS_MODE==='isolated' && env.USERS_RESUME_TEXT_MODE==='synthetic' &&
    typeof env.USERS_RESUME_TEXT_RPC?.fetch==='function';
}
export async function resumeTextAPI(request: Request, env: UsersEnv) {
  const headers=new Headers({'Cache-Control':'private, no-store','CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',Vary:'Cookie'});
  try {
    const url=new URL(request.url);
    const suffix=url.pathname.slice(resumeTextPath.length+1);
    const read=(request.method==='GET'||request.method==='HEAD') && isTextSection(suffix);
    const save=request.method==='POST' && suffix==='save';
    const reconcile=request.method==='POST' && suffix==='operation';
    const introductionReceipt=request.method==='POST' && suffix==='introduction-receipt' && introductionEnabled(env);
    if(!resumeTextEnabled(env)||url.origin!==env.USERS_APP_ORIGIN||url.search||!url.pathname.startsWith(resumeTextPath+'/')||
        !(read||save||reconcile||introductionReceipt)) return deny('NOT_FOUND',404);
    if(request.headers.get('sec-fetch-site')==='cross-site' || (!read &&
        (request.headers.get('origin')!==url.origin||request.headers.get('content-type')!=='application/json')))
      return deny('BUSINESS_DENIED',403);
    const session=createSession(env,request.headers.get('cookie')??'','account',{allowRefresh:false});
    const auth=await authorizeDraft(env,session);
    if(request.headers.get(workspaceScopeHeader)!==auth.scope) return deny('WORKSPACE_CHANGED',409);
    headers.set(workspaceScopeHeader,auth.scope);
    if(request.method==='HEAD') return new Response(null,{headers});
    const repository=createResumeTextRepository({...auth,endpoint,mtls:env.USERS_RESUME_TEXT_RPC!});
    if(introductionReceipt){
      const body=await readDraftCommand(request,2048);
      let key;
      try {key=pendingKey(body,'introduction');}
      catch {return deny('INVALID_INPUT',400);}
      const result=await repository.introductionReceipt(auth.handle,key) as
        {state?:string;requestId?:string;digest?:string;draft?:unknown}|undefined;
      if(result?.state==='unknown') return Response.json({state:'unknown'},{headers});
      const draft=parseIntroduction(result?.draft);
      if(result?.state!=='saved'||result.requestId!==key.requestId||result.digest!==key.digest||
          draft?.siteId!==key.siteId||!draft.record||![key.expectedRevision,key.expectedRevision+1].includes(draft.revision))
        return deny('COMMIT_UNKNOWN',503);
      return Response.json({state:'saved',requestId:key.requestId,digest:key.digest,draft},{headers});
    }
    const service=createResumeTextService(repository);
    const result=read ? await service.read(auth.handle,suffix) : await (save ? service.save : service.reconcile)(
      auth.handle,await readDraftCommand(request,161_000));
    return Response.json(result,{headers});
  } catch(e) {
    const status=e instanceof BusinessError?e.status:503;
    const code=e instanceof BusinessError?e.code:'BUSINESS_UNAVAILABLE';
    if(code==='SESSION_REFRESH_REQUIRED') headers.set('X-Workspace-Session-Renewal','required');
    return request.method==='HEAD' ? new Response(null,{headers,status}) : Response.json({code},{headers,status});
  }
}
