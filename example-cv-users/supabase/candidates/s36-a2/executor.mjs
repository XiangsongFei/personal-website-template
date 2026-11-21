import { checkNativeAuth, checkSourceCatalog } from '../s36-a1/preparation.mjs';
import { a50, fail, limits, manifest, phaseBudget, phaseSql, sources, verifiedSql } from './plan.mjs';
import { boundHost, checkedResources, consumeJournal, digestEvidence, referenceBundle, validSid, validateProfile,
  verifyCatalog, verifyReference } from './evidence.mjs';
import { frameQuery, readFrame } from './sql-wire.mjs';

const sameBackend = (a, b) => a && b && a.pid === b.pid && a.start === b.start;
const validBackend = lease => Number.isSafeInteger(lease?.pid) && lease.pid > 0 && lease.pid <= 2147483647 &&
  typeof lease.start === 'string' && /^[0-9]{1,12}(?:\.[0-9]{1,6})?$/.test(lease.start);

function settingsMatch(lease, sid) {
  return lease.statementMs === '5s' && lease.lockMs === '1s' && lease.transactionMs === '12s' &&
    lease.idleMs === '8s' && (sid === null || lease.expectedSid === sid);
}

const idle = receipt => receipt.ownedWorkers === 0 && receipt.unrelatedClients === 0 && receipt.activeBackends === 0;

function identitySql(previous) {
  const ended = previous ? `NOT EXISTS(SELECT FROM pg_catalog.pg_stat_activity p WHERE p.pid=${previous.pid}
    AND extract(epoch FROM p.backend_start)=${previous.start}::numeric)` : 'NULL';
  return `SELECT pg_catalog.jsonb_build_object(
  'systemIdentifier',(pg_catalog.pg_control_system()).system_identifier::text,
  'pid',pg_catalog.pg_backend_pid(),'start',extract(epoch FROM a.backend_start)::text,
  'database',current_database(),'version',current_setting('server_version_num'),
  'local',inet_client_addr() IS NULL,'sessionRole',session_user,'role',current_user,
  'roleOid',(SELECT oid::int FROM pg_catalog.pg_roles WHERE rolname=session_user),
  'readOnly',current_setting('transaction_read_only')='on',
  'statementMs',current_setting('statement_timeout'),'lockMs',current_setting('lock_timeout'),
  'transactionMs',current_setting('transaction_timeout'),'idleMs',current_setting('idle_in_transaction_session_timeout'),
  'expectedSid',current_setting('ecv_s36_a1.expected_system_identifier',true),'priorEnded',${ended})::text
  FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_catalog.pg_backend_pid()`;
}

function oneObject(lines) {
  if (lines.length !== 1) fail('OBSERVATION_SHAPE');
  return JSON.parse(lines[0]);
}

function meter(phase, clock) {
  const plan = phaseBudget(phase);
  let now = clock();
  if (!Number.isFinite(now)) fail('CLOCK_INVALID');
  const endWork = now + plan.workMs;
  const endReserve = endWork + plan.reserveMs;
  const spent = {sql: 0, connections: 0, docker: 0, native: 0};
  const reserved = {...spent};
  const time = () => {
    const next = clock();
    if (!Number.isFinite(next) || next < now) fail('CLOCK_INVALID');
    now = next;
    return next;
  };
  return {
    time,
    deadline(milliseconds, reserve) {
      return Math.min(time() + milliseconds, reserve ? endReserve : endWork);
    },
    charge(cost, reserve) {
      const used = reserve ? reserved : spent;
      const cap = reserve ? plan.reserve : plan.normal;
      for (const [unit, count] of Object.entries(cost)) {
        if (used[unit] + count > cap[unit]) fail('BUDGET_EXCEEDED');
      }
      for (const [unit, count] of Object.entries(cost)) used[unit] += count;
    },
    snapshot: () => ({normal: {...spent}, reserve: {...reserved}}),
  };
}

async function bounded(invoke, deadline, time) {
  const duration = deadline - time();
  if (duration <= 0) fail('DEADLINE_EXCEEDED');
  const controller = new AbortController();
  let timer;
  try {
    const result = await Promise.race([
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('DEADLINE_EXCEEDED'));
        }, duration);
      }),
      invoke({signal: controller.signal, deadline}),
    ]);
    if (time() >= deadline) fail('DEADLINE_EXCEEDED');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// A future isolated supervisor provides the trusted approval check, a durable
// exclusive journal and a separately audited adapter. There is no default
// adapter, executable entrypoint, Docker socket, SQL client, or auto-approval.
export function createExecutor({profile: targetProfile, transport, ledger, load, authorize, clock = () => performance.now()}) {
  const profile = structuredClone(targetProfile);
  validateProfile(profile);
  if (!['observe', 'hostAction', 'openSession'].every(key => typeof transport?.[key] === 'function') ||
      typeof authorize !== 'function' || typeof load !== 'function' || typeof ledger?.record !== 'function') {
    fail('EXECUTOR_NOT_BOUND');
  }
  const scope = digestEvidence(profile);
  let phase = 'R0', activePhase = null, busy = false, stopped = false, stopAttempted = false;
  let resource = null, sid = null, dispatchedMutation = false, priorBackend = null, budget = null, failure = null, reconciled = false;
  let expectedReferenceDigest = null, nativeAttestation = null, reference = null, reference01 = null;
  let lifetimeDeadline = Infinity, lastTick = -Infinity;
  const receipts = [];

  function time() {
    const now = clock();
    if (!Number.isFinite(now) || now < lastTick) fail('CLOCK_INVALID');
    lastTick = now;
    return now;
  }

  async function call(invoke, costs, milliseconds, reserve = false, end = Infinity) {
    const deadline = Math.min(budget.deadline(milliseconds, reserve), end, lifetimeDeadline);
    if (deadline <= budget.time()) fail('DEADLINE_EXCEEDED');
    budget.charge(costs, reserve);
    return bounded(invoke, deadline, budget.time);
  }

  async function observe(reserve = false, allowStopped = false, end = Infinity) {
    const receipt = await call(options => transport.observe({
      profile: structuredClone(profile), resource: structuredClone(resource), ...options,
    }), {docker: 4}, 6000, reserve, end);
    boundHost(profile, receipt, resource, allowStopped);
    if (sid !== null && receipt.systemIdentifier !== sid) fail('HOST_SID_MISMATCH');
    return receipt;
  }

  function begin(id) {
    ledger.record({kind: 'BEGIN', id, phase: activePhase, runId: profile.runId, scope, sid,
      target: resource && digestEvidence(resource)});
  }

  function end(receipt) {
    const record = {...receipt, kind: 'END', phase: activePhase, runId: profile.runId, sid, scope};
    ledger.record(record);
    return Object.freeze({...record, digest: digestEvidence(record)});
  }

  async function hostAction(id, {reserve = false, timeout = 10_000, native = false} = {}) {
    const observed = await observe(reserve);
    if (!idle(observed)) fail('ACTIVE_FOREIGN_WORK');
    begin(id);
    const reply = await call(options => {
      dispatchedMutation = true;
      return transport.hostAction({
        id, profile: structuredClone(profile), resource: structuredClone(resource), sid,
        limits: structuredClone(limits), observed: structuredClone(observed.resource ?? null),
        artifactSha: native || id === 'STAGE_AUTH' ? sources.auth.binary_sha256 : null, ...options,
      });
    }, {docker: 1, native: native ? 1 : 0}, timeout, reserve);
    if (reply?.id !== id || reply.runId !== profile.runId || reply.ended !== true || reply.exitCode !== 0 || (resource && reply.containerId !== resource.containerId)) {
      fail('HOST_ACTION_UNCONFIRMED');
    }
    if (id === 'STAGE_AUTH' && reply.artifact_sha256 !== sources.auth.binary_sha256) fail('AUTH_ARTIFACT_DRIFT');
    if (native) {
      if (reply.artifact_sha256 !== sources.auth.binary_sha256 || reply.command !== 'auth migrate' ||
          reply.role !== 'supabase_auth_admin' || reply.systemIdentifier !== sid || reply.localSocket !== true) fail('NATIVE_AUTH_SCOPE_DENIED');
      nativeAttestation = {artifact_sha256: reply.artifact_sha256, archive_sha256: sources.auth.archive_sha256,
        linux_arm64_manifest: sources.auth.arm64_manifest};
    }
    end({id, status: 'ACK'});
  }

  async function proveExit(id, backend, expectedSid, reserve, end = Infinity) {
    if (!validBackend(backend) || !validSid(expectedSid)) fail('BACKEND_OBSERVATION_UNBOUND');
    const window = Math.min(budget.deadline(7500, reserve), end);
    const observer = await call(options => transport.openSession({
      id: id + '_EXIT', role: 'supabase_admin', readOnly: true, resource: structuredClone(resource),
      profile: structuredClone(profile), sid: expectedSid, limits: structuredClone(limits), ...options,
    }), {connections: 1, docker: 1}, 4500, reserve, window);
    let trusted = false;
    try {
      const frame = frameQuery(identitySql(backend));
      const raw = await call(options => observer.exchange(frame.input, options), {sql: 1}, 5500, reserve, window);
      const reply = readFrame(frame.marker, raw);
      if (reply.sqlstate !== '00000') return false;
      const lease = oneObject(reply.lines);
      trusted = lease.priorEnded === true && validBackend(lease) && !sameBackend(lease, backend) &&
        lease.systemIdentifier === expectedSid && lease.local === true && lease.role === 'supabase_admin' &&
        lease.sessionRole === lease.role && lease.roleOid === 10 && lease.readOnly === true &&
        lease.database === 'postgres' && lease.version === '170011' && settingsMatch(lease, expectedSid);
    } finally {
      const closed = await call(options => observer.close({discard: !trusted, ...options}), {}, 3000, reserve, window);
      if (closed !== true) trusted = false;
    }
    return trusted;
  }

  async function sqlAction(step, statements, reserve = false) {
    const stepEnd = budget.deadline(step.timeoutMs, reserve);
    const host = await observe(reserve, false, stepEnd);
    if (!idle(host)) fail('ACTIVE_FOREIGN_WORK');
    begin(step.id);
    const readOnly = step.terminal === 'ROLLBACK' && !step.fault;
    let session, lease, dispatched = false, terminal = null, first = null, acknowledgedFault = false, rollbackSafe = false;
    const query = async (sql, asReserve = reserve) => {
      const frame = frameQuery(sql);
      const raw = await call(options => session.exchange(frame.input, options), {sql: 1}, limits.statementMs + 500,
        asReserve, asReserve && !reserve ? Infinity : stepEnd);
      return readFrame(frame.marker, raw);
    };
    const output = [];
    try {
      session = await call(options => transport.openSession({
        id: step.id, role: step.role, readOnly, resource: structuredClone(resource),
        profile: structuredClone(profile), sid, limits: structuredClone(limits), ...options,
      }), {connections: 1, docker: 1}, 4500, reserve, stepEnd);
      const binding = await query(identitySql());
      if (binding.sqlstate !== '00000') fail('SQL_IDENTITY_UNCONFIRMED');
      const identity = oneObject(binding.lines);
      if (!validBackend(identity) || !validSid(identity.systemIdentifier) || profile.excludedSids.includes(identity.systemIdentifier) ||
          identity.systemIdentifier !== host.systemIdentifier || (sid !== null && identity.systemIdentifier !== sid) || sameBackend(identity, priorBackend) ||
          identity.database !== 'postgres' || identity.version !== '170011' || identity.local !== true ||
          identity.sessionRole !== step.role || identity.role !== step.role || identity.readOnly !== readOnly ||
          !settingsMatch(identity, sid) || (step.role === 'supabase_admin' && identity.roleOid !== 10)) fail('SQL_IDENTITY_DENIED');
      lease = identity;
      dispatched = true;
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const last = i === statements.length - 1;
        const emergencyRollback = acknowledgedFault && last && budget.time() >= stepEnd;
        const reply = await query(statement, reserve || emergencyRollback);
        const intentionalFault = step.fault && i === statements.length - 2;
        if (intentionalFault && reply.sqlstate === '22012') {
          acknowledgedFault = true;
          continue;
        }
        if (reply.sqlstate !== '00000' || intentionalFault) {
          rollbackSafe = i > 0 && !last;
          first = {code: intentionalFault ? 'FAULT_NOT_OBSERVED' : 'SQL_REFUSED', sqlstate: reply.sqlstate, statement: i + 1};
          fail(first.code);
        }
        if ((i === 0 || last) && (reply.lines.length !== 1 || reply.lines[0] !== (last ? step.terminal : 'BEGIN'))) {
          fail('TERMINAL_TAG_UNPROVEN');
        }
        if (last) terminal = step.terminal;
        if (emergencyRollback) {
          first = {code: 'WORK_DEADLINE_ROLLBACK', sqlstate: null, statement: i + 1};
          break;
        }
        output.push(reply.lines);
      }
    } catch {
      first ??= {code: 'DISPATCH_UNCERTAIN', sqlstate: null, statement: null};
      if (rollbackSafe && !reserve) {
        try {
          const reply = await query('ROLLBACK', true);
          if (reply.sqlstate === '00000' && reply.lines.length === 1 && reply.lines[0] === 'ROLLBACK') terminal = 'ROLLBACK';
        } catch { /* No second rollback or phase retry. */ }
      }
    }
    let exited = false;
    // An unauthenticated or unknown session cannot be promoted to a terminal receipt.
    if (session) {
      try {
        const closed = await call(options => session.close({discard: !terminal, ...options}), {},
          3000, reserve || first !== null);
        if (closed === true && terminal && validBackend(lease)) {
          exited = await proveExit(step.id, lease, lease.systemIdentifier, reserve || first !== null,
            first ? Infinity : stepEnd);
        }
      } catch { /* A missing independent proof leaves the action UNKNOWN. */ }
    }
    const status = !terminal || !exited ? 'UNKNOWN' : first ? 'STOP' : 'ACK';
    const receipt = end({
      id: step.id, status, terminal, acknowledgedFault, exited, first, dispatched,
      backend: validBackend(lease) ? {pid: lease.pid, start: lease.start} : null,
      systemIdentifier: validSid(lease?.systemIdentifier) ? lease.systemIdentifier : null,
      outputDigest: status === 'ACK' ? digestEvidence(output) : null,
    });
    receipts.push(receipt);
    if (status !== 'ACK') {
      failure = receipt;
      return null;
    }
    priorBackend = receipt.backend;
    return {receipt, output, applicationAuthOpen: host.applicationAuthOpen};
  }

  function verifyInitial(result) {
    const observed = oneObject(result.output.at(-2));
    if (digestEvidence(observed.versions) !== digestEvidence([...sources.auth.initial_versions].sort())) fail('INITIAL_AUTH_LEDGER_DENIED');
    sid = result.receipt.systemIdentifier;
    if (!validSid(sid) || profile.excludedSids.includes(sid)) fail('TARGET_SID_DENIED');
  }

  function verifySqlResult(step, result, approval) {
    const readback = result.output.at(-2);
    if (step.id === 'AUTH_READBACK') {
      checkNativeAuth({...oneObject(readback), ...nativeAttestation, application_auth_open: result.applicationAuthOpen});
    }
    if (step.id === 'A07') verifyCatalog('A07', oneObject(readback), approval.expectations, approval.referenceDigest);
    if (step.id === 'REF_01') {
      reference01 = {catalog: oneObject(readback), receipt: result.receipt.digest};
      checkSourceCatalog('A50', reference01.catalog);
      ledger.record({kind: 'REF_CATALOG', name: 'A50', runId: profile.runId, sid, ...reference01});
    }
    if (step.id === 'REF_02') {
      const after02 = {catalog: oneObject(readback), receipt: result.receipt.digest};
      reference = referenceBundle(profile, sid, digestEvidence(resource), reference01, after02);
      ledger.record({kind: 'REF_CATALOG', name: 'A07', runId: profile.runId, sid, ...after02});
    }
    if (step.id === 'A09') {
      const gates = oneObject(readback);
      if (gates.kind !== 'closed_readback' || gates.root_closed !== true || gates.write_enabled !== false ||
          gates.public_read_enabled !== false || gates.outbox_enabled !== false) fail('CLOSED_GATE_UNPROVEN');
    }
  }

  const state = () => ({
    next: phase, stopped, sid: sid ?? 'NOT_YET_OBSERVED', failure: failure?.status ?? null,
    targetDigest: resource && digestEvidence(resource),
    failureDetail: structuredClone(failure),
    receipts: structuredClone(receipts), spent: budget?.snapshot() ?? null,
    reference: stopped && !failure ? structuredClone(reference) : null,
  });
  async function exclusive(operation) {
    if (busy) fail('EXECUTION_IN_PROGRESS');
    busy = true;
    try { return await operation(); } finally { busy = false; }
  }

  return Object.freeze({
    state,
    run(request) {
      return exclusive(async () => {
        const approval = structuredClone(request);
        if (stopped || failure || !phase || approval?.phase !== phase || approval.authorized !== true ||
            approval.runId !== profile.runId || approval.profileDigest !== scope ||
            approval.budgetDigest !== digestEvidence(phaseBudget(phase)) ||
            authorize(structuredClone(approval)) !== true) fail('PHASE_NOT_AUTHORIZED');
        if (phase !== 'R0' && (approval.sid !== sid || approval.targetDigest !== digestEvidence(resource))) {
          fail('APPROVAL_TARGET_UNBOUND');
        }
        if (phase === 'R2') verifyReference(profile, sid, digestEvidence(resource), approval.expectations, approval.referenceDigest);
        const sql = phaseSql[phase].map(step => [step, verifiedSql(step, load)]);
        if (phase === 'R2') verifiedSql(a50, load);
        const nextBudget = meter(phase, time);
        if (phase !== 'R0' && time() >= lifetimeDeadline) fail('DEADLINE_EXCEEDED');
        const current = phase;
        if (current === 'R0') {
          const windows = [phaseBudget('R0'), phaseBudget('R1'),
            phaseBudget(profile.runId === manifest.reference_run_id ? 'REF' : 'R2')];
          lifetimeDeadline = time() + windows.reduce((sum, window) => sum + window.workMs, 0) + windows.at(-1).reserveMs;
          consumeJournal(ledger, scope);
        }
        budget = nextBudget;
        if (current === 'R2') expectedReferenceDigest = approval.referenceDigest;
        activePhase = current;
        // Mark this phase consumed durably before any I/O. It cannot be retried.
        ledger.record({kind: 'PHASE', phase, runId: profile.runId, scope, approval: digestEvidence(approval)});
        phase = null;
        try {
          if (current === 'R0') {
            const empty = await observe();
            if (empty.nameCollisions !== 0 || empty.ownedWorkers !== 0 || empty.unrelatedClients !== 0) fail('BOOTSTRAP_SCOPE_DENIED');
            for (const id of ['CREATE_NETWORK', 'CREATE_VOLUME', 'CREATE_POSTGRES', 'START_POSTGRES']) await hostAction(id);
            const target = await observe();
            if (target.running !== true || !idle(target)) fail('BOOTSTRAP_UNCONFIRMED');
            const binding = checkedResources(profile, target.resource);
            boundHost(profile, target, binding);
            resource = binding;
          } else if (current === 'R1') {
            await hostAction('STAGE_AUTH');
            await hostAction('MIGRATE_NATIVE_AUTH', {native: true, timeout: 150_000});
          }
          for (const [step, statements] of sql) {
            const result = await sqlAction(step, statements);
            if (!result) return state();
            try {
              if (step.id === 'R0_BIND') verifyInitial(result);
              else verifySqlResult(step, result, approval);
              if (step.id === 'A09' && reference) reference.reference.close = result.receipt.digest;
            } catch (error) {
              failure = {status: 'STOP', id: step.id, code: error.message, receipt: result.receipt.digest};
              ledger.record({kind: 'HOLD', phase: current, runId: profile.runId, ...failure});
              return state();
            }
          }
          ledger.record({kind: 'PHASE_END', phase: current, runId: profile.runId, sid,
            target: digestEvidence(resource), status: 'CLOSED_CHECKPOINT'});
          phase = current === 'R0' ? 'R1' : current === 'R1' ?
            (profile.runId === manifest.reference_run_id ? 'REF' : 'R2') : null;
        } catch (error) {
          failure ??= {status: dispatchedMutation ? 'UNKNOWN' : 'STOP', id: current, terminal: null, exited: false,
            code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'UNCONFIRMED'};
          ledger.record({kind: 'HOLD', phase: current, runId: profile.runId, status: failure.status, code: failure.code});
        }
        return state();
      });
    },
    reconcile(request) {
      return exclusive(async () => {
        const approval = structuredClone(request);
        if (stopped || reconciled || !failure?.backend || !sid || failure.systemIdentifier !== sid ||
            !receipts.some(r => r.id === 'A03' && r.status === 'ACK' && r.terminal === 'COMMIT') ||
            !['A04', 'A06'].includes(failure.id) || approval?.phase !== 'A50' ||
            approval.authorized !== true || approval.runId !== profile.runId || approval.profileDigest !== scope ||
            approval.failureDigest !== failure.digest || approval.referenceDigest !== expectedReferenceDigest ||
            approval.sid !== sid || approval.targetDigest !== digestEvidence(resource) || authorize(structuredClone(approval)) !== true) fail('RECONCILE_NOT_AUTHORIZED');
        verifyReference(profile, sid, digestEvidence(resource), approval.expectations, approval.referenceDigest);
        const statements = verifiedSql(a50, load);
        const original = failure;
        reconciled = true;
        activePhase = 'A50';
        ledger.record({kind: 'PHASE', phase: activePhase, runId: profile.runId, scope, approval: digestEvidence(approval)});
        try {
          const observed = await observe(true);
          if (!idle(observed)) fail('ORIGINAL_BACKEND_UNPROVEN');
          if (!(await proveExit('A50_ORIGINAL', original.backend, sid, true))) fail('ORIGINAL_BACKEND_UNPROVEN');
          const result = await sqlAction(a50, statements, true);
          failure = original;
          if (result) {
            verifyCatalog('A50', oneObject(result.output.at(-2)), approval.expectations, approval.referenceDigest);
            if (original.status === 'STOP' && original.terminal === 'ROLLBACK' && original.exited) {
              failure = {...original, status: 'PARTIAL_CLOSED'};
            }
          }
        } catch (error) {
          failure = original;
          ledger.record({kind: 'HOLD', phase: activePhase, runId: profile.runId, status: original.status,
            code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'RECONCILIATION_UNCONFIRMED'});
        }
        ledger.record({kind: 'PHASE_END', phase: activePhase, runId: profile.runId, status: failure.status});
        return state();
      });
    },
    stopOwned(request) {
      return exclusive(async () => {
        const approval = structuredClone(request);
        if (stopped || stopAttempted || !resource || !sid || approval?.phase !== 'CLOSE' || approval.authorized !== true ||
            approval.runId !== profile.runId || approval.profileDigest !== scope || approval.sid !== sid ||
            approval.targetDigest !== digestEvidence(resource) || authorize(structuredClone(approval)) !== true) {
          fail('STOP_NOT_AUTHORIZED');
        }
        stopAttempted = true;
        phase = null;
        activePhase = 'CLOSE';
        ledger.record({kind: 'PHASE', phase: activePhase, runId: profile.runId, scope, approval: digestEvidence(approval)});
        try {
          const before = await observe(true);
          if (!idle(before)) fail('SAFE_STOP_UNPROVEN');
          await hostAction('STOP_OWNED', {reserve: true, timeout: 18_000});
          const after = await observe(true, true);
          if (after.running !== false || after.pid !== 0 || !idle(after)) fail('STOP_UNCONFIRMED');
          const stop = end({id: 'VERIFY_STOP', status: 'ACK', target: digestEvidence(resource)});
          if (reference) reference.reference.stop = stop.digest;
          stopped = true;
        } catch (error) {
          failure = {...failure, status: 'UNKNOWN',
            code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'STOP_UNCONFIRMED'};
          ledger.record({kind: 'HOLD', phase: activePhase, runId: profile.runId, status: failure.status, code: failure.code});
        }
        return state();
      });
    },
  });
}
