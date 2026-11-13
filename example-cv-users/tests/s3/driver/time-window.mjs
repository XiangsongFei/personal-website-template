// One process-local, immutable translation of a protected UTC authority.
// Monotonic values are never serialized and never reconstructed by Meter.
export const WINDOW_MS=1200000,RESERVE_MS=90000;
const issued=new WeakSet(),realIssued=new WeakSet();
const systemClock=()=>performance.now(),systemWallClock=Date.now;
function check(ok,code){if(!ok){const e=Error(code);e.code=code;throw e;}}
export function utcNanoseconds(value){
 check(typeof value==='string','TIME_FORMAT');
 const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(?:Z|\+00:00)$/.exec(value);
 check(m,'TIME_FORMAT');const ms=Date.parse(m[1]+'Z');
 check(Number.isSafeInteger(ms)&&ms>=0&&new Date(ms).toISOString().slice(0,19)===m[1],'TIME_CALENDAR');
 return BigInt(ms)*1000000n+BigInt((m[2]??'').padEnd(9,'0'));
}
export function normalizedAuthority(a){
 const begin=utcNanoseconds(a.windowStartedAt),end=utcNanoseconds(a.expiresAt);
 check(end>begin&&end-begin<=BigInt(WINDOW_MS)*1000000n,'TIME_WINDOW_CAP');
 // Start rounds UP and expiry DOWN: normalization cannot extend authority.
 const startMs=Number((begin+999999n)/1000000n),expiresMs=Number(end/1000000n);
 check(Number.isSafeInteger(startMs)&&Number.isSafeInteger(expiresMs)&&expiresMs-startMs>RESERVE_MS,'TIME_CLEANUP_RESERVE');
 return Object.freeze({startNs:begin.toString(),expiresNs:end.toString(),startMs,expiresMs});
}
export function createTimeWindow(a,authoritySha256,{clock=systemClock,wallClock=systemWallClock}={}){
 check(/^[a-f0-9]{64}$/.test(authoritySha256??''),'TIME_AUTHORITY_DIGEST');const authority=normalizedAuthority(a);
 // Read mono BEFORE wall. A Date.now bucket can hide <1ms: using its upper
 // bound and flooring mono conservatively shortens, never extends, the window.
 const mono=Math.floor(clock()),wall=wallClock();
 check(Number.isSafeInteger(mono)&&Number.isSafeInteger(wall),'TIME_CLOCK');
 check(wall>=authority.startMs&&wall<authority.expiresMs,'TIME_EXPIRED_OR_FUTURE');
 const deadline=mono+(authority.expiresMs-(wall+1)),start=deadline-(authority.expiresMs-authority.startMs);
 check(deadline-mono>RESERVE_MS,'TIME_CLEANUP_RESERVE');
 const result=Object.freeze({version:1,runId:a.runId,authoritySha256,authority,start,deadline,clock,wallClock});issued.add(result);if(clock===systemClock&&wallClock===systemWallClock)realIssued.add(result);return result;
}
export function isTimeWindow(w){return issued.has(w)&&Object.isFrozen(w);}
export function assertTimeWindow(w,{approval,digest,startedAt,deadlineAt,clock,requireSystemClock=false}={}){
 check(isTimeWindow(w),'TIME_CONTEXT_REQUIRED');check(!requireSystemClock||realIssued.has(w),'REAL_CLOCK_REQUIRED');
 if(approval)check(w.runId===approval.runId&&w.authoritySha256===digest&&JSON.stringify(w.authority)===JSON.stringify(normalizedAuthority(approval)),'TIME_AUTHORITY_MISMATCH');
 check(startedAt===undefined||startedAt===w.start,'DEADLINE_OVERRIDE');
 check(deadlineAt===undefined||deadlineAt===w.deadline,'DEADLINE_OVERRIDE');
 check(clock===undefined||clock===w.clock,'CLOCK_OVERRIDE');
 const wall=w.wallClock();check(wall>=w.authority.startMs&&wall<w.authority.expiresMs,'TIME_EXPIRED_OR_FUTURE');
 check(w.clock()<w.deadline,'DEADLINE_STOP');return w;
}
