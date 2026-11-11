import {binding,PROJECT} from './binding.mjs';
import * as core from '../../../lib/business/r3-verifier.mjs';
export const createRegisteredGrantService=(options={})=>core.createRegisteredGrantService({binding,...options});
export const createR3Issuer=(options={})=>core.createR3Issuer({binding,...options});
