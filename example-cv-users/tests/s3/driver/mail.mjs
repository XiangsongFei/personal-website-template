import {SERVICES,assertServiceBindings} from './bindings.mjs';
import {command} from './io.mjs';
import {need,DriverStop} from './state.mjs';
export function mailInvocation(path){
 assertServiceBindings();need(path==='/api/v1/messages'||/^\/api\/v1\/message\/[A-Za-z0-9_-]+$/.test(path),'MAIL_PATH');
 return {argv:['docker','--context','desktop-linux','exec','-i',SERVICES.mail.carrier,'/usr/bin/nc','-w','5',SERVICES.mail.ip,String(SERVICES.mail.port)],input:`GET ${path} HTTP/1.1\r\nHost: ${SERVICES.mail.ip}:${SERVICES.mail.port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n`};
}
export function parseMailResponse(raw){
 const limit=1048576;need(raw.length<=limit+32768,'MAIL_LIMIT',true);const at=raw.indexOf('\r\n\r\n');need(at>0&&at<=24576,'MAIL_HEADERS',true);
 const [status,...lines]=raw.subarray(0,at).toString('latin1').split('\r\n');need(/^HTTP\/1\.[01] 200(?: |$)/.test(status),'MAIL_STATUS',true);const h={};
 for(const line of lines){const m=/^([A-Za-z0-9-]+):[ \t]*([^\r\n]*)$/.exec(line);need(m&&!Object.hasOwn(h,m[1].toLowerCase()),'MAIL_HEADERS',true);h[m[1].toLowerCase()]=m[2].trim();}
 need(h['content-type']?.split(';')[0]==='application/json'&&!h['content-encoding'],'MAIL_IDENTITY',true);let body=raw.subarray(at+4);
 if(h['transfer-encoding']){
  need(h['transfer-encoding']==='chunked'&&!h['content-length'],'MAIL_FRAMING',true);let pos=0,total=0,chunks=[];
  for(;;){const end=body.indexOf('\r\n',pos);need(end>=pos&&/^[0-9a-fA-F]{1,8}$/.test(body.subarray(pos,end).toString()),'MAIL_FRAMING',true);const n=parseInt(body.subarray(pos,end).toString(),16);pos=end+2;if(n===0){need(body.subarray(pos).equals(Buffer.from('\r\n')),'MAIL_FRAMING',true);break;}total+=n;need(total<=limit&&pos+n+2<=body.length&&body.subarray(pos+n,pos+n+2).equals(Buffer.from('\r\n')),'MAIL_FRAMING',true);chunks.push(body.subarray(pos,pos+n));pos+=n+2;}body=Buffer.concat(chunks);
 }else need(/^\d+$/.test(h['content-length']??'')&&Number(h['content-length'])===body.length&&body.length<=limit,'MAIL_FRAMING',true);
 try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));need(v&&typeof v==='object'&&!Array.isArray(v),'MAIL_FORMAT');return v;}catch{throw new DriverStop('MAIL_FORMAT',true);}
}
export async function mailJson(path,{run=command}={}){const {argv,input}=mailInvocation(path),r=await run(argv,input,{timeout:8000,maxBytes:1081344});need(r.code===0&&r.stderr.length===0,'MAIL_UNKNOWN',true);return parseMailResponse(r.stdout);}
