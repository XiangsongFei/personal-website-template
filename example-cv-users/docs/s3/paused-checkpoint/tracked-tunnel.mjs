import net from 'node:net';

// The caller supplies the exact frozen hostname and proxy port. Never fall back or reconnect.
export function trackedTunnel(host,upstreamPort,proxyPort,log) {
  const sockets=new Set();
  let used=false;
  const listener=net.createServer(client=>{
    if(used){ client.destroy();return; }
    used=true;
    log('accepted');
    const upstream=net.connect({host:'127.0.0.1',port:proxyPort,family:4});
    const end=()=>{client.destroy();upstream.destroy();};
    for(const socket of [client,upstream]){
      sockets.add(socket);
      socket.once('error',e=>{log(socket===client?'client-error':'proxy-error',e.code);end();});
      socket.once('close',()=>{sockets.delete(socket);end();});
    }
    upstream.setTimeout(8000,()=>{log('proxy-timeout');end();});
    let header=Buffer.alloc(0);
    const startup=Buffer.from('0000000804d2162f','hex');
    const headers=data=>{
      header=Buffer.concat([header,data]);
      const cut=header.indexOf('\r\n\r\n');
      if(header.length>8192){log('proxy-header-over-limit');end();return;}
      if(cut<0)return;
      const status=/^HTTP\/1\.[01] (\d{3})\b/.exec(header.toString('latin1',0,cut));
      log('CONNECT',status?.[1]??'invalid');
      if(status?.[1]!=='200'||cut+4!==header.length){end();return;}
      upstream.off('data',headers);
      let first=Buffer.alloc(0);
      const startupRead=chunk=>{
        first=Buffer.concat([first,chunk]);
        if(first.length<8)return;
        if(!first.equals(startup)){log('unexpected-negotiation');end();return;}
        client.off('data',startupRead);
        upstream.once('data',response=>{
          log('SSLRequest-answer',response.equals(Buffer.from('S'))?'S':'other');
          if(!response.equals(Buffer.from('S'))){end();return;}
          upstream.setTimeout(0);
          client.write(response);
          client.pipe(upstream);upstream.pipe(client);
        });
        log('SSLRequest');
        upstream.write(first);
      };
      client.on('data',startupRead);
    };
    upstream.on('data',headers);
    upstream.once('connect',()=>{
      log('proxy-tcp');
      const target=host+':'+upstreamPort;
      upstream.write('CONNECT '+target+' HTTP/1.1\r\nHost: '+target+'\r\n\r\n');
    });
  });
  return {
    start:()=>new Promise((resolve,reject)=>listener.once('error',reject).listen(0,'127.0.0.1',()=>resolve(listener.address().port))),
    close:async()=>{for(const s of sockets)s.destroy();if(listener.listening)await new Promise((resolve,reject)=>listener.close(err=>err?reject(err):resolve()));}
  };
}
