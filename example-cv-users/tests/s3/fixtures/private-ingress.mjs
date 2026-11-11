import {binding,PROJECT} from './binding.mjs';
import * as core from '../../../lib/business/private-ingress.node.mjs';
export const handlePrivateRpc=(request,options)=>core.handlePrivateRpc(request,{binding,...options});
export const createPrivateRpcServer=(options={})=>core.createPrivateRpcServer({binding,...options});
