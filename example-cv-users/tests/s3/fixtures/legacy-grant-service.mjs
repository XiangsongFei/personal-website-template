// Offline PRE-M5 model only. Never used by the registered admission runtime.
import {accountContext,loginContext} from '../../../lib/business/identity.mjs';
export function createGrantService({ signer, repository }) {
  return Object.freeze({
    async issue(receipt, epoch) { const { handle } = loginContext(receipt);
      return repository.grant(handle, await signer.sign({ action: 'issue', receipt, epoch })); },
    async renew(handle, epoch) { accountContext(handle);
      return repository.grant(handle, await signer.sign({ action: 'renew', handle, epoch })); },
    async revoke(handle, epoch) { accountContext(handle);
      return repository.grant(handle, await signer.sign({ action: 'revoke', handle, epoch })); }
  });
}
