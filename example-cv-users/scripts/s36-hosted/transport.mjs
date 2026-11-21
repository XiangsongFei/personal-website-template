import {request as httpsRequest} from 'node:https';
import {Readable} from 'node:stream';

export function privateTransport(origin,tls) {
  return {fetch(url,options) {
    if (new URL(url).origin !== origin || options.method !== 'POST' || options.redirect !== 'manual')
      throw new Error('PRIVATE_ORIGIN_MISMATCH');
    return new Promise((resolve,reject) => {
      const req = httpsRequest(url, {...tls, method:'POST', headers:options.headers,
        signal:options.signal, agent:false, rejectUnauthorized:true, minVersion:'TLSv1.2'}, res => {
        // Authenticate the server with the private test CA and SAN via Node HTTPS.
        resolve(new Response(Readable.toWeb(res), {status:res.statusCode}));
      });
      req.on('error',reject);
      req.end(options.body);
    });
  }};
}
