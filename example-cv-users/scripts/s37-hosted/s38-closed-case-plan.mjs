// Frozen closed-case shape from the original S3.8 A14/B52 plan.
import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const name = value => typeof value === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(value);
const fail = () => { throw Error('S38_CLOSED_EXECUTOR_PLAN'); };
const lanes = Object.freeze({ A: { count: 14, owners: 1, files: 1, prefixes: ['s37e1', 's37e2'] },
  B: { count: 52, owners: 2, files: 2, prefixes: ['s37h1', 's37h2'] } });
const prefixes = [...lanes.A.prefixes, ...lanes.B.prefixes];
const rpcKinds = new Map([['read_introduction', 'text'], ...prefixes.flatMap(prefix => [
  [prefix + '_read_file', 'read'], [prefix + '_file_access', 'history'], [prefix + '_file_command', 'prepare'],
])]);

function plain(value) {
  return value && Object.getPrototypeOf(value) === Object.prototype;
}

function freezeBody(rpc, args, sqlstate, reason) {
  const kind = rpcKinds.get(rpc);
  if (!kind || !plain(args)) fail();
  const pinned = kind === 'text' ? { target: args.target } : kind === 'read' ?
    { target: args.target, asset_id: args.asset_id, storage_version: args.storage_version } :
    { target_run: args.target_run, target_site: args.target_site, operation: kind, input: {} };
  const expected = kind === 'text' ? ['PT503', 'NOT_CONFIGURED'] : ['42501', 'BUSINESS_DENIED'];
  if (Object.keys(args).length !== Object.keys(pinned).length ||
      Object.entries(pinned).some(([key, value]) => key === 'input' ?
        (!plain(args.input) || Object.keys(args.input).length !== 0) :
        (key === 'operation' ? args.operation !== value : !uuid(value))) ||
      expected[0] !== sqlstate || expected[1] !== reason) fail();
  return JSON.stringify(pinned);
}

export function freezeS38ClosedCases(laneName, cases, { requireFull = false, fixture = false } = {}) {
  const lane = Object.hasOwn(lanes, laneName) ? lanes[laneName] : null;
  if (!lane || !Array.isArray(cases) || !cases.length || cases.length > lane.count ||
      (requireFull && cases.length !== lane.count) ||
      new Set(cases.map(item => item?.requestId)).size !== cases.length ||
      new Set(cases.map(item => item?.caseId)).size !== cases.length) fail();
  return Object.freeze(cases.map(item => {
    const { caseId, requestId, uid, sid, rpc, args, sqlstate, reason, branches, definitionSha256,
      decisionRole, identityBasis, decisionFunction = 'site_api.' + rpc } = item ?? {};
    if (![requestId, uid, sid].every(uuid) || !name(rpc) || !name(decisionRole) ||
        !digest(definitionSha256) || typeof caseId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(caseId) ||
        !Array.isArray(branches) || !branches.length || branches.length > 8 ||
        !branches.every(name) || typeof identityBasis !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(identityBasis) ||
        !/^site_(?:api|private|storage)\.[a-z_][a-z0-9_]{0,62}$/.test(decisionFunction) ||
        (fixture && decisionFunction !== 'site_api.' + rpc)) fail();
    if (rpc !== 'read_introduction' && !lane.prefixes.some(prefix => rpc.startsWith(prefix + '_'))) fail();
    const body = freezeBody(rpc, args, sqlstate, reason);
    const bound = Object.freeze({ caseId, requestId, uid, sid, rpc, sqlstate, reason, branches: Object.freeze([...branches]),
      definitionSha256, decisionFunction, decisionRole, identityBasis, bodySha256: sha(body) });
    return Object.freeze({ ...bound, body, requestSha256: sha(JSON.stringify(bound)) });
  }));
}

// Inputs are already resolved and pinned by a trusted caller. This planner
// never creates a UID, SID, request UUID, file or hosted test target.
export function buildS38ClosedPlan({ lane: laneName, actors, files, otherSite = null, edgeRun, requestIds, sourceRules } = {}) {
  const lane = Object.hasOwn(lanes, laneName) ? lanes[laneName] : null;
  if (!lane || actors?.length !== lane.owners || files?.length !== lane.files ||
      !Array.isArray(actors) || !Array.isArray(files) || !Array.isArray(requestIds) ||
      requestIds.length !== lane.count || !plain(sourceRules) || Object.keys(sourceRules).length !== lane.count ||
      !actors.every(actor => [actor?.uid, actor?.sid, actor?.site].every(uuid)) ||
      !['uid', 'sid', 'site'].every(field => new Set(actors.map(actor => actor[field])).size === actors.length) ||
      !files.every(file => [file?.asset, file?.version, file?.run].every(uuid)) ||
      !['asset', 'version', 'run'].every(field => new Set(files.map(file => file[field])).size === files.length) ||
      !uuid(edgeRun) || files.some(file => file.run === edgeRun) ||
      (laneName === 'A' ? !uuid(otherSite) || otherSite === actors[0].site : otherSite !== null)) fail();

  const cases = [];
  for (const [index, actor] of actors.entries()) {
    const sites = [['same', actor.site], ['cross', laneName === 'A' ? otherSite : actors[1 - index].site]];
    const add = (id, rpc, args, sqlstate, reason) => {
      const caseId = 'business-owner-' + (index + 1) + '-' + id;
      const rule = Object.hasOwn(sourceRules, caseId) ? sourceRules[caseId] : null;
      if (!plain(rule)) fail();
      const { branches, definitionSha256, decisionRole, decisionFunction, identityBasis } = rule;
      cases.push({ caseId, requestId: requestIds[cases.length], uid: actor.uid, sid: actor.sid, rpc, args,
        sqlstate, reason, branches, definitionSha256, decisionRole, decisionFunction, identityBasis });
    };
    for (const [relation, target] of sites) add(relation + '-text', 'read_introduction', { target }, 'PT503', 'NOT_CONFIGURED');
    for (const [fileIndex, file] of files.entries()) {
      const layers = [['s3m8', lane.prefixes[0], file.run], ['s3edge', lane.prefixes[1], edgeRun]];
      for (const [relation, target] of sites) {
        for (const [layer, prefix, run] of layers) {
          const stem = relation + '-file-' + (fileIndex + 1) + '-' + layer;
          add(stem + '-read', prefix + '_read_file',
            { target, asset_id: file.asset, storage_version: file.version }, '42501', 'BUSINESS_DENIED');
          for (const [operation, verb] of [['history', 'access'], ['prepare', 'command']]) {
            add(stem + '-' + operation, prefix + '_file_' + verb,
              { target_run: run, target_site: target, operation, input: {} }, '42501', 'BUSINESS_DENIED');
          }
        }
      }
    }
  }
  freezeS38ClosedCases(laneName, cases, { requireFull: true });
  return Object.freeze(cases.map(item => Object.freeze({ ...item, branches: Object.freeze([...item.branches]),
    args: Object.freeze({ ...item.args, ...(item.args.input && { input: Object.freeze({}) }) }) })));
}
