// Catch only graceful, handleable process stops. SIGKILL/host loss cannot run
// finally; their issued records remain UNKNOWN and prohibit replay.
export function stopSignals(target=process){
 const controller=new AbortController();let count=0;
 const stop=()=>{count++;if(!controller.signal.aborted)controller.abort();};
 target.on('SIGINT',stop);target.on('SIGTERM',stop);
 return {signal:controller.signal,get count(){return count;},dispose(){target.removeListener('SIGINT',stop);target.removeListener('SIGTERM',stop);}};
}
