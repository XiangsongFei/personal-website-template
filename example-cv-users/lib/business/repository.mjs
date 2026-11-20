import {businessBinding} from './binding.mjs';
import { BusinessError, deny } from './protocol.mjs';
import { checkRpc } from './private-rpc.mjs';
import { boundAccountContext, withCredential } from './identity.mjs';
const known = new Map([['42501',['BUSINESS_DENIED',403]],['22023',['INVALID_INPUT',400]],
  ['PT409',['REQUEST_CONFLICT',409]],['PT503',['NOT_CONFIGURED',503]]]);
async function bounded(operation, milliseconds) {
  const controller = new AbortController(); let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new BusinessError('COMMIT_UNKNOWN', 503));
  }, milliseconds); });
  try { return await Promise.race([operation(controller.signal), deadline]); }
  finally { clearTimeout(timer); }
}
// Only the server composition root supplies the client-certificate binding and Auth adapter.
export function createRpcRepository({ binding, enabled = false, project, endpoint, mtls, identity, timeoutMs = 10000 } = {}) {
  const scope=businessBinding(binding);const {project:PROJECT,authIssuer,privateOrigin}=scope??{};
  const configured = !!scope && enabled === true && project === PROJECT && endpoint === privateOrigin &&
    typeof mtls?.fetch === 'function' && typeof identity?.verifyAccount === 'function' &&
    Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 20000;
  async function rpc(handle, name, input) {
    if (!configured) deny('NOT_CONFIGURED', 503);
    const who = boundAccountContext(handle, identity, authIssuer);
    checkRpc(name, input,binding);
    const proof = input.envelope?.proof;
    if (proof && (proof.uid !== who.uid || proof.session_id !== who.session_id)) deny();
    return withCredential(handle, token => bounded(async signal => {
      let response;
      try {
        response = await mtls.fetch(privateOrigin + '/rpc/' + name, { method: 'POST', redirect: 'manual',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(input), signal });
        if (response.status >= 300 && response.status < 400) deny('COMMIT_UNKNOWN', 503);
        const reader = response.body?.getReader(); if (!reader) deny('COMMIT_UNKNOWN', 503);
        const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', size = 0;
        try { for (;;) { const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > 65536) deny('COMMIT_UNKNOWN', 503); text += decoder.decode(value, { stream: true }); } }
        finally { await reader.cancel().catch(() => {}); }
        const data = JSON.parse(text + decoder.decode());
        if (!response.ok) { const info = known.get(data?.code); if (info && info[1] === response.status) deny(...info); deny('COMMIT_UNKNOWN', 503); }
        if (response.status !== 200 || !data || Array.isArray(data) || typeof data !== 'object') deny('COMMIT_UNKNOWN', 503);
        return data;
      } catch (e) { if (e instanceof BusinessError) throw e; deny('COMMIT_UNKNOWN', 503); }
    }, timeoutMs));
  }
  return Object.freeze({
    grant: (h, e) => rpc(h, 'apply_business_grant', { envelope: e }),
    create: (h, p) => rpc(h, 'create_site', { input: p }),
    readOperation: (h, p) => rpc(h, 'read_create_operation', { input: p }),
    mine: h => rpc(h, 'get_my_site', {}),
    readIntroduction: (h, target) => rpc(h, 'read_introduction', { target })
  });
}
