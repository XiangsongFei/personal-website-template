import {P14R_SCOPE,TAIL_SCOPE,isContinuation,profilePin} from './contract.mjs';
import {need} from './state.mjs';
import {REMAINING_SCOPE} from './contract.mjs';
export const BUSINESS_SCOPE='S34-P02-P16',P01_SCOPE='S34-P01-ONLY';
export function effectScope(a,scope=a.scope){
 need([BUSINESS_SCOPE,P01_SCOPE,REMAINING_SCOPE,TAIL_SCOPE,P14R_SCOPE].includes(scope)&&a.scope===scope,'EXECUTION_SCOPE');
 if(scope===P14R_SCOPE){need(a.acceptedEffects?.aliceResetAndCascade===true&&a.acceptedEffects?.temporaryMaintenanceAndCheck===true&&a.acceptedEffects?.stopNewCandidate===true&&a.acceptedEffects?.preserveCharlieAndBob===true&&a.acceptedEffects?.exactAliceRecoveryCascade===true&&a.acceptedEffects?.charlieFixtureAndContainment===false&&a.acceptedEffects?.existingCharlieCredentialUpdate===false,'P14R_EFFECT_AUTHORIZATION');return scope;}
 const effects=['aliceResetAndCascade','charlieFixtureAndContainment','temporaryMaintenanceAndCheck'];
 need(effects.every(k=>a.acceptedEffects?.[k]===(scope!==P01_SCOPE))&&a.acceptedEffects?.stopNewCandidate===true,'EFFECT_AUTHORIZATION');
 if(isContinuation(scope))need(a.acceptedEffects.existingCharlieCredentialUpdate===true&&a.acceptedEffects.historicalLookupReadOnly===true,'REMAINING_EFFECT_AUTHORIZATION');
 return scope;
}
