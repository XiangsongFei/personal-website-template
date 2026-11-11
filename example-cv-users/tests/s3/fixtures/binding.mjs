// Synthetic OFFLINE fixture only. Never imported by production composition.
import {createBusinessBinding} from '../../../lib/business/binding.mjs';
export const PROJECT='ecv-s33a-20261109-7dd22a81';
export const authIssuer='http://127.0.0.1:56321/auth/v1';
export const privateHost='api.'+PROJECT+'.internal.test',privateOrigin='https://'+privateHost,registrarHost='pg.'+PROJECT+'.internal.test';
export const binding=createBusinessBinding({project:PROJECT,authIssuer,privateOrigin,registrarHost,socketPath:"/run/ecv-s33a-internal/postgrest.sock",testOnly:true});
