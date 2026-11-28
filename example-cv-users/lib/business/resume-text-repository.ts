import {createBusinessBinding, businessBinding} from './binding.mjs';
import {createS36RpcTransport} from './s36-rpc-transport.mjs';
import {checkRpc} from './private-rpc.mjs';
import {deny} from './protocol.mjs';
import type {ResumeTextRepository} from './resume-text-service.ts';

export function createResumeTextRepository({project,authIssuer,endpoint,identity,mtls}: {
  project:string; authIssuer:string; endpoint:string;
  identity:{verifyAccount: (...args: never[]) => unknown}; mtls: Pick<Fetcher,'fetch'>;
}): ResumeTextRepository {
  const settings={project,authIssuer,privateOrigin:endpoint,registrarHost:new URL(endpoint).hostname,testOnly:true};
  const binding=createBusinessBinding(settings);
  const rpc=createS36RpcTransport({scope:businessBinding(binding),project,endpoint,mtls,identity,enabled:true,
    rpcResponseLimit:()=>200_000,
    checkRpc(name:string,input:object) {
      if(name==='get_my_site') return checkRpc(name,input,binding);
      if(!['read_resume_text','save_resume_text','read_resume_text_operation'].includes(name)) deny('INVALID_INPUT',400);
    },
  });
  return {
    mine: handle=>rpc(handle,'get_my_site',{}),
    read: (handle,target,section_key)=>rpc(handle,'read_resume_text',{target,section_key}),
    save: (handle,input)=>rpc(handle,'save_resume_text',{input,canonical:JSON.stringify(input)}),
    receipt: (handle,key)=>rpc(handle,'read_resume_text_operation',{target:key.siteId,section_key:key.section,
      operation_id:key.requestId,request_digest:key.digest,basis:key.expectedRevision}),
  };
}
