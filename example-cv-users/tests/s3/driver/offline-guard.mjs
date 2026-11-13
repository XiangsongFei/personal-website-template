// Rehearsal installs this before application imports. Any external dispatch is
// fatal; filesystem writes are confined by CLI to its newly owned temp tree.
import child from 'node:child_process';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
let attempts=0;
const deny=()=>{attempts++;const e=Error('OFFLINE_EXTERNAL_IO');e.code='OFFLINE_EXTERNAL_IO';throw e;};
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[key]=deny;
for(const mod of [net,tls])for(const key of ['connect','createConnection','createServer'])if(key in mod)mod[key]=deny;
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;
for(const mod of [http,https])for(const key of ['request','get','createServer'])mod[key]=deny;
dgram.createSocket=deny;globalThis.fetch=deny;syncBuiltinESMExports();
process.once('exit',()=>{if(attempts)process.exitCode=1;process.stderr.write(JSON.stringify({offlineExternalIoAttempts:attempts})+'\n');});
