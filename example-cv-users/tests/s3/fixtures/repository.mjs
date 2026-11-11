import {binding,PROJECT} from './binding.mjs';
import * as core from '../../../lib/business/repository.mjs';
export const createRpcRepository=(options={})=>core.createRpcRepository({binding,...options});
