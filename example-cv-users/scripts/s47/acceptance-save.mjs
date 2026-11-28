// The journal receives only operation metadata. The original command stays in memory.
export function createAcceptanceSave({journal, inspect, reconcile, allowed = () => true}) {
  let blocked = false;
  return {
    get blocked() { return blocked; },
    async run(identity, attempt, send, validate) {
      if (blocked) throw Error('SAVE_BLOCKED_AFTER_UNCERTAINTY');
      const {siteId, command} = attempt.body;
      const pending = {
        requestId: command.request_id, digest: await attempt.digest, siteId,
        basisRevision: command.expected_draft_revision, ...identity,
      };
      journal({outcome:'pending', ...pending});
      try {
        const response = await send();
        const result = await validate(response);
        if (result) {
          journal({outcome:'confirmed', ...pending});
          return {outcome:'confirmed', response, result};
        }
        if ([400,401,403,409].includes(response.status) &&
            ['INVALID_INPUT','IDENTITY_REQUIRED','BUSINESS_DENIED','REQUEST_CONFLICT','WORKSPACE_CHANGED'].includes(response.value?.code)) {
          journal({outcome:'rejected', ...pending, status:response.status, code:response.value.code});
          return {outcome:'rejected', response};
        }
        journal({outcome:'uncertain', ...pending, status:response.status});
      } catch {
        journal({outcome:'uncertain', ...pending});
      }
      blocked = true;
      if (!allowed()) {
        journal({outcome:'unknown', ...pending, reason:'scope-or-budget'});
        return {outcome:'unknown'};
      }
      let response, result, observed;
      try {
        response = await reconcile(attempt);
        result = await validate(response);
      } catch {
        journal({outcome:'reconciliation-unavailable', ...pending});
      }
      if (allowed()) {
        try { observed = await inspect(pending); }
        catch { journal({outcome:'observation-unavailable', ...pending}); }
      }
      const outcome = result && observed?.state === 'committed' ? 'reconciled' :
        observed?.state === 'committed' ? 'committed-without-application-receipt' :
        observed?.state === 'rolled-back' ? 'rolled-back' : 'unknown';
      journal({outcome, ...pending, observed, lookupStatus:response?.status});
      return {outcome, response, result};
    },
  };
}
