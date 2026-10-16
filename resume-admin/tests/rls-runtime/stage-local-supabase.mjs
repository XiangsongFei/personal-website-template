// TEST ONLY: create an isolated, disposable Supabase project for local tests.
// Resource cleanup is limited to Docker IDs created by this invocation and
// verified with this run's unique Compose project label.
/* global console, process, URL */
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer, isIP } from "node:net";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const utilityDir = dirname(fileURLToPath(import.meta.url));
const sourceProject = resolve(utilityDir, "supabase");
const excludedMigrations = new Set([
  "20261031130000_test_profile_signing_probe.sql",
  "20261031140000_retire_test_profile_signing_probe.sql",
]);

const safeStartFailure = "Supabase start failed; CLI output suppressed.";

function run(command, args, options = {}) {
  const { spawn = spawnSync, discardOutput = false, failureMessage, ...spawnOptions } = options;
  const result = spawn(command, args, { encoding: "utf8", ...spawnOptions });
  if (result.error) throw new Error(failureMessage ?? `${command} could not be started; output suppressed.`);
  if (result.status !== 0) {
    if (typeof failureMessage === "function") throw new Error(failureMessage(result));
    if (failureMessage) throw new Error(failureMessage);
    const detail = redactSecrets(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return discardOutput ? "" : result.stdout ?? "";
}

function summarizeSqlTestFailure(result, databaseOutput = "") {
  const rawOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${databaseOutput}`;
  let output = "";
  let inEscape = false;
  for (const character of rawOutput) {
    const code = character.charCodeAt(0);
    if (!inEscape && code === 27) {
      inEscape = true;
      continue;
    }
    if (inEscape) {
      if (code >= 0x40 && code <= 0x7e) inEscape = false;
      continue;
    }
    output += character;
  }
  const exitCode = Number.isInteger(result.status) ? result.status : "unknown";
  const assertionNumbers = [...new Set([...output.matchAll(/^\s*not ok\s+(\d+)(?:\s|$)/gim)].map((match) => match[1]))];
  const errorLines = output.split(/\r?\n/).filter((line) => /\b(?:ERROR|FATAL):/i.test(line));
  const errors = errorLines.join("\n").toLowerCase();
  const sqlLocations = [...new Map([...output.matchAll(/(?:^|[\\/])([A-Za-z0-9_.-]+\.sql):(\d+):\s*(?:ERROR|FATAL):/gim)]
    .map((match) => [`${match[1]}:${match[2]}`, `${match[1]}:${match[2]}`]))].map(([, location]) => location);
  const sqlStates = [...new Set(errorLines.flatMap((line) => [
    ...line.matchAll(/\bSQLSTATE\s*[:=]?\s*([0-9A-Z]{5})\b/gi),
    ...line.matchAll(/\b(?:ERROR|FATAL):\s*([0-9A-Z]{5}):/gi),
    ...line.matchAll(/\b([0-9A-Z]{5})\s+(?:ERROR|FATAL):/gi),
  ].map((match) => match[1].toUpperCase())))];
  const syntaxToken = errors.match(/syntax error at or near ["']([a-z_]+)["']/i)?.[1]?.toUpperCase();
  const errorCategory = /\bsyntax error\b/i.test(errors) ? `syntax error${syntaxToken ? ` near ${syntaxToken}` : ""}`
    : /\bpermission denied\b/i.test(errors) ? "permission denied"
      : /\bdoes not exist\b/i.test(errors) ? "missing database object"
        : /\b(?:cannot|could not) roll ?back\b/i.test(errors) ? "rollback error"
          : /current transaction is aborted/i.test(errors) ? "transaction aborted"
            : /\b(?:violates .* constraint|duplicate key)\b/i.test(errors) ? "constraint violation"
              : /\b(?:invalid input syntax|cannot cast|out of range)\b/i.test(errors) ? "invalid input or cast"
                : /\b(?:canceling statement|statement timeout|query canceled)\b/i.test(errors) ? "query canceled or timed out"
                  : errorLines.length ? "PostgreSQL error"
                    : null;
  const categorySqlState = errorCategory === "syntax error" || errorCategory?.startsWith("syntax error near ") ? "42601"
    : errorCategory === "permission denied" ? "42501" : null;
  const reportedSqlStates = sqlStates.length ? sqlStates : categorySqlState ? [categorySqlState] : [];
  const details = [];
  if (assertionNumbers.length) details.push(`failed assertion number(s): ${assertionNumbers.join(", ")}`);
  if (sqlLocations.length) details.push(`SQL error location(s): ${sqlLocations.join(", ")}`);
  if (errorCategory) details.push(`error category: ${errorCategory}`);
  if (reportedSqlStates.length) details.push(`SQLSTATE: ${reportedSqlStates.join(", ")}${sqlStates.length ? "" : " (standard code for this PostgreSQL category)"}`);
  return `Supabase test db failed (exit status ${exitCode})${details.length ? `; ${details.join("; ")}` : "; no allowlisted diagnostics found; output suppressed."}`;
}

function isOwnedDiagnosticContainer(container, context) {
  const id = resourceId(container, "containers");
  const name = container?.Name?.replace(/^\//, "");
  return typeof id === "string" && !context.preexistingContainerIds.has(id)
    && labelProject(container, "containers") === context.projectId
    && typeof name === "string" && name.includes(context.projectId);
}

function readOwnedSqlContainerLogs(context) {
  try {
    const ownedContainers = listKind("containers").filter((container) => isOwnedDiagnosticContainer(container, context));
    return ownedContainers.map((container) => {
      const logs = spawnSync("docker", ["logs", resourceId(container, "containers")], { encoding: "utf8" });
      return logs.error ? "" : `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`;
    }).join("\n");
  } catch {
    return "";
  }
}

function enableOwnedDatabaseErrorCodes(context, resources) {
  const databaseId = context.dbContainerId;
  if (typeof databaseId !== "string" || !resources.containers.includes(databaseId)) {
    throw new Error("Could not verify this run's disposable database container; SQL tests were not run");
  }
  const database = dockerJson(["inspect", databaseId])[0];
  if (!database || !isOwnedDiagnosticContainer(database, context)
    || !database.Name?.replace(/^\//, "").startsWith("supabase_db_")) {
    throw new Error("Could not verify this run's disposable database container; SQL tests were not run");
  }
  verifyOwnedResource("containers", databaseId, context.projectId, context.preexistingResources);

  const settings = [
    "ALTER SYSTEM SET log_error_verbosity = 'verbose'",
    "ALTER SYSTEM SET log_line_prefix = '%m [%p] %e '",
  ];
  for (const setting of settings) {
    run("docker", ["exec", databaseId, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", setting], {
      stdio: "pipe", discardOutput: true,
      failureMessage: "Could not configure sanitized PostgreSQL error-code diagnostics; SQL tests were not run",
    });
  }
  run("docker", ["exec", databaseId, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", "SELECT pg_catalog.pg_reload_conf()"], {
    stdio: "pipe", discardOutput: true,
    failureMessage: "Could not reload sanitized PostgreSQL error-code diagnostics; SQL tests were not run",
  });
}

function redactSecrets(output) {
  return output
    .replace(/("(?:PUBLISHABLE_KEY|SECRET_KEY|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)"\s*:\s*")[^"]+("?)/g, "$1[redacted]$2")
    .replace(/^((?:PUBLISHABLE_KEY|SECRET_KEY|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)=).*$/gm, "$1[redacted]");
}

function dockerJson(args) {
  const output = run("docker", args);
  return output.trim() ? JSON.parse(output) : [];
}

function snapshot() {
  return {
    containers: new Set(run("docker", ["ps", "-aq", "--no-trunc"]).trim().split(/\s+/).filter(Boolean)),
    volumes: new Set(run("docker", ["volume", "ls", "-q"]).trim().split(/\s+/).filter(Boolean)),
    networks: new Set(run("docker", ["network", "ls", "-q", "--no-trunc"]).trim().split(/\s+/).filter(Boolean)),
  };
}

function listKind(kind) {
  const command = kind === "containers" ? ["ps", "-aq", "--no-trunc"]
    : kind === "volumes" ? ["volume", "ls", "-q"] : ["network", "ls", "-q", "--no-trunc"];
  const ids = run("docker", command).trim().split(/\s+/).filter(Boolean);
  return ids.map((id) => {
    const inspectArgs = kind === "volumes" ? ["volume", "inspect", id]
      : kind === "networks" ? ["network", "inspect", id]
        : ["inspect", id];
    const raw = run("docker", inspectArgs);
    return JSON.parse(raw)[0];
  });
}

function labelProject(resource, kind) {
  const labels = kind === "containers" ? resource.Config?.Labels : resource.Labels;
  return labels?.["com.docker.compose.project"] ?? null;
}

function resourceId(resource, kind) {
  return kind === "volumes" ? resource.Name : resource.Id ?? resource.ID;
}

function identifyOwnedResources(projectId, before) {
  const result = { containers: [], volumes: [], networks: [] };
  for (const kind of Object.keys(result)) {
    for (const resource of listKind(kind)) {
      const id = resourceId(resource, kind);
      const wasPresent = before[kind].has(id);
      const name = kind === "containers" ? resource.Name?.replace(/^\//, "") : resource.Name;
      const nameMentionsProject = typeof name === "string" && name.includes(projectId);
      const labelMatches = labelProject(resource, kind) === projectId;
      if (nameMentionsProject && !labelMatches) {
        throw new Error(`Resource name suggests project ${projectId} but its ownership label does not; leaving it untouched`);
      }
      if (!labelMatches) continue;
      if (wasPresent) throw new Error(`Refusing to touch pre-existing ${kind} resource for unique project ${projectId}`);
      result[kind].push(id);
    }
  }
  return result;
}

function verifyOwnedResource(kind, id, projectId, before) {
  if (before[kind].has(id)) throw new Error(`Refusing to clean pre-existing ${kind} resource ${id}`);
  const inspectArgs = kind === "volumes" ? ["volume", "inspect", id]
    : kind === "networks" ? ["network", "inspect", id]
      : ["inspect", id];
  const resource = dockerJson(inspectArgs)[0];
  if (!resource || labelProject(resource, kind) !== projectId) {
    throw new Error(`Ownership could not be verified for ${kind} resource ${id}; leaving it untouched`);
  }
  return resource;
}

function isLoopbackHostIp(hostIp) {
  if (typeof hostIp !== "string" || isIP(hostIp) === 0) return false;
  if (isIP(hostIp) === 4) return hostIp.split(".")[0] === "127";
  return hostIp.toLowerCase() === "::1";
}

function validateLoopbackPublishedPorts(container) {
  const name = container?.Name?.replace(/^\//, "") ?? "unknown container";
  const requested = container?.HostConfig?.PortBindings;
  const actual = container?.NetworkSettings?.Ports;
  if (!container?.HostConfig || (requested !== null && (typeof requested !== "object" || Array.isArray(requested)))
    || !actual || typeof actual !== "object" || Array.isArray(actual)) {
    throw new Error(`Docker port metadata is missing or malformed for ${name}; refusing to use the local database`);
  }

  const requestedMap = requested ?? {};
  const keys = new Set([...Object.keys(requestedMap), ...Object.keys(actual)]);
  for (const portKey of keys) {
    const requestedBindings = requestedMap[portKey];
    const actualBindings = actual[portKey];
    if (requestedBindings == null && actualBindings == null) continue;
    if (!Array.isArray(requestedBindings) || requestedBindings.length === 0
      || !Array.isArray(actualBindings) || actualBindings.length === 0) {
      throw new Error(`Docker port metadata is ambiguous for ${name} (${portKey}); refusing to use the local database`);
    }
    const normalizeBindings = (bindings, requireHostIp) => bindings.map((binding) => {
      const hasHostPort = typeof binding?.HostPort === "string"
        && (binding.HostPort === "" || (/^\d+$/.test(binding.HostPort)
          && Number(binding.HostPort) >= 1 && Number(binding.HostPort) <= 65535));
      const hasHostIp = typeof binding?.HostIp === "string";
      if (!binding || typeof binding !== "object" || !hasHostPort
        || (requireHostIp && !isLoopbackHostIp(binding.HostIp))
        || (!requireHostIp && hasHostIp && binding.HostIp !== "" && !isLoopbackHostIp(binding.HostIp))) {
        throw new Error(`Docker published a non-loopback or unverifiable port for ${name} (${portKey}); refusing to use the local database`);
      }
      return `${binding.HostIp?.toLowerCase() ?? ""}:${binding.HostPort}`;
    }).sort();
    const requestedNormalized = normalizeBindings(requestedBindings, false);
    const actualNormalized = normalizeBindings(actualBindings, true);
    const actualPorts = actualNormalized.map((binding) => binding.split(":").pop()).sort();
    const requestedPorts = requestedNormalized.map((binding) => binding.split(":").pop()).filter(Boolean);
    if (requestedPorts.some((port) => !actualPorts.includes(port))) {
      throw new Error(`Docker port metadata disagrees for ${name} (${portKey}); refusing to use the local database`);
    }
  }
}

function verifyLoopbackNetwork(network, projectId) {
  if (!network || network.Driver !== "bridge" || network.EnableIPv6 !== false
    || labelProject(network, "networks") !== projectId
    || network.Options?.["com.docker.network.bridge.host_binding_ipv4"] !== "127.0.0.1") {
    throw new Error("Could not prove the staging Docker network is loopback-only; Supabase services were not started");
  }
}

function verifyDockerHostBindingPlatform(operatingSystem) {
  if (typeof operatingSystem !== "string" || !/(?:linux|ubuntu|debian|fedora|centos|alpine)/i.test(operatingSystem)
    || /docker desktop|windows/i.test(operatingSystem)) {
    throw new Error("Cannot establish a pre-start loopback port-binding guarantee for this Docker engine; Supabase services were not started");
  }
}

function createLoopbackNetwork(projectId) {
  const networkName = `pr1-supabase-${projectId}`;
  const createdId = run("docker", [
    "network", "create", "--driver", "bridge",
    "--label", `com.docker.compose.project=${projectId}`,
    "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
    networkName,
  ]).trim();
  if (!createdId) throw new Error("Docker did not return an ID for the isolated loopback network");
  const network = dockerJson(["network", "inspect", createdId])[0];
  verifyLoopbackNetwork(network, projectId);
  return { id: network.Id ?? createdId, name: network.Name ?? networkName };
}

function cleanupOwnedResources(resources, projectId, before) {
  const current = identifyOwnedResources(projectId, before);
  for (const kind of Object.keys(resources)) {
    const recorded = new Set(resources[kind]);
    for (const id of current[kind]) {
      if (!recorded.has(id)) throw new Error(`Unrecorded ${kind} resource ${id} belongs to this run; leaving all resources untouched`);
    }
    for (const id of recorded) verifyOwnedResource(kind, id, projectId, before);
  }

  for (const id of resources.containers) {
    verifyOwnedResource("containers", id, projectId, before);
    const state = dockerJson(["inspect", id])[0]?.State;
    if (state?.Running) run("docker", ["stop", id]);
    verifyOwnedResource("containers", id, projectId, before);
    run("docker", ["rm", id]);
  }
  for (const id of resources.volumes) {
    verifyOwnedResource("volumes", id, projectId, before);
    run("docker", ["volume", "rm", id]);
  }
  for (const id of resources.networks) {
    verifyOwnedResource("networks", id, projectId, before);
    run("docker", ["network", "rm", id]);
  }
}

function cleanupFromManifest(manifestPath) {
  const absolutePath = resolve(manifestPath);
  const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  const stageRoot = resolve(manifest.stageRoot ?? "");
  const expectedManifest = join(stageRoot, "ownership.json");
  if (absolutePath !== expectedManifest || !stageRoot.startsWith(`${tmpdir()}/pr1-supabase-`)
    || !/^pr1-\d+-[a-f0-9]+$/.test(manifest.projectId ?? "")) {
    throw new Error("Cleanup refused: manifest does not identify a staging utility project in the temporary directory");
  }
  const before = Object.fromEntries(Object.entries(manifest.preexisting ?? {}).map(([key, values]) => [key, new Set(values)]));
  if (!["containers", "volumes", "networks"].every((key) => before[key] instanceof Set)) {
    throw new Error("Cleanup refused: manifest lacks the original Docker resource snapshot");
  }
  const resources = identifyOwnedResources(manifest.projectId, before);
  writeFileSync(absolutePath, JSON.stringify({ ...manifest, created: resources }, null, 2));
  cleanupOwnedResources(resources, manifest.projectId, before);
  rmSync(stageRoot, { recursive: true, force: true });
  console.log(`Removed only ownership-verified resources for ${manifest.projectId}.`);
}

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a loopback port"));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function uniquePorts() {
  const ports = [];
  while (ports.length < 5) {
    const port = await availablePort();
    if (!ports.includes(port)) ports.push(port);
  }
  return { api: ports[0], db: ports[1], shadow: ports[2], analytics: ports[3], vector: ports[4] };
}

function stageProject(stageRoot, projectId, ports) {
  const stagedSupabase = join(stageRoot, "supabase");
  cpSync(sourceProject, stagedSupabase, {
    recursive: true,
    filter: (source) => !source.includes("/.temp") && !source.includes("/node_modules"),
  });
  const migrationDir = join(stagedSupabase, "migrations");
  for (const migration of excludedMigrations) rmSync(join(migrationDir, migration));

  const configPath = join(stagedSupabase, "config.toml");
  let config = readFileSync(configPath, "utf8");
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  const replaceSetting = (section, key, value) => {
    const lines = config.split(/(?<=\n)/);
    const start = lines.findIndex((line) => line.trim() === `[${section}]`);
    if (start < 0) throw new Error(`Missing [${section}] in staged Supabase config`);
    let end = start + 1;
    while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1;
    const setting = new RegExp(`^(${key}\\s*=\\s*)\\d+`, "m");
    const block = lines.slice(start, end).join("");
    if (!setting.test(block)) throw new Error(`Missing ${section}.${key} in staged Supabase config`);
    lines.splice(start, end - start, block.replace(setting, `$1${value}`));
    config = lines.join("");
  };
  replaceSetting("api", "port", ports.api);
  replaceSetting("db", "port", ports.db);
  replaceSetting("db", "shadow_port", ports.shadow);
  replaceSetting("analytics", "port", ports.analytics);
  replaceSetting("analytics", "vector_port", ports.vector);
  config = config.replaceAll("http://127.0.0.1:55421", `http://127.0.0.1:${ports.api}`);
  writeFileSync(configPath, config);

  const sourceMigrations = readdirSync(join(sourceProject, "migrations")).filter((name) => name.endsWith(".sql")).sort();
  const expected = sourceMigrations.filter((name) => !excludedMigrations.has(name));
  const stagedMigrations = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
  if (JSON.stringify(stagedMigrations) !== JSON.stringify(expected)) {
    throw new Error("Staged migration manifest differs from source order minus the two approved signing-probe migrations");
  }
  for (const migration of expected) {
    const source = readFileSync(join(sourceProject, "migrations", migration));
    const staged = readFileSync(join(migrationDir, migration));
    if (!source.equals(staged)) throw new Error(`Staged migration content differs: ${migration}`);
  }
  for (const migration of excludedMigrations) {
    if (existsSync(join(migrationDir, migration))) throw new Error(`Excluded migration unexpectedly staged: ${migration}`);
  }
  return { stagedSupabase, stagedRoot: stageRoot, migrationManifest: stagedMigrations, ports };
}

function runSupabase(context, args, options = {}) {
  const isSqlTest = args[0] === "test" && args[1] === "db";
  const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", ...options.env };
  const output = run("supabase", ["--workdir", context.stagedRoot, "--network-id", context.dockerNetworkId,
    ...(isSqlTest ? ["--debug"] : []), ...args], {
    env,
    stdio: "pipe",
    discardOutput: args[0] !== "status",
    failureMessage: args[0] === "start" ? safeStartFailure
      : isSqlTest ? (result) => summarizeSqlTestFailure(result, readOwnedSqlContainerLogs(context))
        : `Supabase ${args[0]} failed; CLI output suppressed.`,
  });
  if (args[0] === "start") console.log("Isolated Supabase startup completed; validating published port bindings.");
  if (args[0] === "db" && args[1] === "reset") console.log("Isolated local database reset completed.");
  if (args[0] === "test" && args[1] === "db") console.log("Staged local SQL tests passed.");
  return output;
}

function runSecuritySelfTests() {
  const sqlFailureSummary = summarizeSqlTestFailure({
    status: 1,
    stdout: "not ok 14 - a PR-controlled assertion description containing a secret",
    stderr: "psql:/tmp/private/version_history_v1_read.test.sql:188: ERROR: sensitive SQL and connection data must not appear",
  });
  assert.match(sqlFailureSummary, /exit status 1/);
  assert.match(sqlFailureSummary, /assertion number\(s\): 14/);
  assert.match(sqlFailureSummary, /version_history_v1_read\.test\.sql:188/);
  assert.doesNotMatch(sqlFailureSummary, /PR-controlled|sensitive SQL|connection data|private/);

  const categorizedFailure = summarizeSqlTestFailure({
    status: 1,
    stderr: "psql:/tmp/private/version_history_v1_read.test.sql:296: ERROR: cannot rollback while a transaction is active; SQLSTATE: 25001; secret-value",
  });
  assert.match(categorizedFailure, /rollback error/);
  assert.match(categorizedFailure, /SQLSTATE: 25001/);
  assert.doesNotMatch(categorizedFailure, /private|cannot rollback|secret-value/);

  const syntaxFailure = summarizeSqlTestFailure({
    status: 1,
    stderr: "psql:/tmp/private/version_history_v1_read.test.sql:296: ERROR: syntax error at or near \"ROLLBACK\"; SQLSTATE: 42601",
  });
  assert.match(syntaxFailure, /syntax error near ROLLBACK/);
  assert.match(syntaxFailure, /SQLSTATE: 42601/);
  assert.doesNotMatch(syntaxFailure, /private|syntax error at or near/);

  const verboseClientFailure = summarizeSqlTestFailure({ status: 1,
    stderr: "psql:/tmp/private/version_history_v1_read.test.sql:296: ERROR:  42601: syntax error at or near \"ROLLBACK\"\nSTATEMENT: ROLLBACK; secret-value" });
  assert.match(verboseClientFailure, /version_history_v1_read\.test\.sql:296/);
  assert.match(verboseClientFailure, /syntax error near ROLLBACK/);
  assert.match(verboseClientFailure, /SQLSTATE: 42601/);
  assert.doesNotMatch(verboseClientFailure, /private|STATEMENT|secret-value/);

  const databaseLogFailure = summarizeSqlTestFailure({ status: 1, stdout: "" },
    "2026-10-16 14:00:00 UTC [42] ERROR:  42601: syntax error at or near \"ROLLBACK\"\nSTATEMENT: ROLLBACK; secret-value");
  assert.match(databaseLogFailure, /syntax error near ROLLBACK/);
  assert.match(databaseLogFailure, /SQLSTATE: 42601/);
  assert.doesNotMatch(databaseLogFailure, /STATEMENT|secret-value/);

  const prefixedSqlState = summarizeSqlTestFailure({ status: 1, stdout: "" },
    "2026-10-16 14:00:00 UTC [42] 42P01 ERROR: relation \"private_table\" does not exist\nSTATEMENT: SELECT secret_value");
  assert.match(prefixedSqlState, /error category: missing database object/);
  assert.match(prefixedSqlState, /SQLSTATE: 42P01/);
  assert.doesNotMatch(prefixedSqlState, /private_table|secret_value|STATEMENT/);

  const diagnosticContext = {
    projectId: "pr1-123-abcd",
    preexistingContainerIds: new Set(["preexisting"]),
  };
  const diagnosticContainer = (id, name, project) => ({
    Id: id,
    Name: `/${name}`,
    Config: { Labels: { "com.docker.compose.project": project } },
  });
  assert.equal(isOwnedDiagnosticContainer(diagnosticContainer("created", "supabase_db_pr1-123-abcd", "pr1-123-abcd"), diagnosticContext), true);
  assert.equal(isOwnedDiagnosticContainer(diagnosticContainer("preexisting", "supabase_db_pr1-123-abcd", "pr1-123-abcd"), diagnosticContext), false);
  assert.equal(isOwnedDiagnosticContainer(diagnosticContainer("foreign", "supabase_db_other", "other"), diagnosticContext), false);

  const opaqueFailureSummary = summarizeSqlTestFailure({ status: 1, stdout: "credential=hidden", stderr: "" });
  assert.match(opaqueFailureSummary, /no allowlisted diagnostics found/);
  assert.doesNotMatch(opaqueFailureSummary, /credential|hidden/);

  const validContainer = (hostIp) => ({
    Name: "/supabase_db_pr1-test",
    HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: hostIp, HostPort: "55422" }] } },
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: hostIp, HostPort: "55422" }] } },
  });

  validateLoopbackPublishedPorts(validContainer("127.0.0.1"));
  validateLoopbackPublishedPorts(validContainer("127.0.0.2"));
  validateLoopbackPublishedPorts(validContainer("::1"));
  validateLoopbackPublishedPorts({
    Name: "/supabase_kong_pr1-test",
    HostConfig: { PortBindings: { "8000/tcp": [{ HostIp: "", HostPort: "55421" }] } },
    NetworkSettings: { Ports: { "8000/tcp": [
      { HostIp: "127.0.0.1", HostPort: "55421" },
      { HostIp: "::1", HostPort: "55421" },
    ] } },
  });
  for (const hostIp of ["0.0.0.0", "::", "192.168.1.15", "fe80::1", "not-an-ip"]) {
    assert.throws(() => validateLoopbackPublishedPorts(validContainer(hostIp)), /non-loopback or unverifiable/);
  }
  verifyLoopbackNetwork({
    Driver: "bridge", EnableIPv6: false,
    Labels: { "com.docker.compose.project": "pr1-test" },
    Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" },
  }, "pr1-test");
  verifyDockerHostBindingPlatform("Ubuntu 24.04.3 LTS");
  verifyDockerHostBindingPlatform("Linux");
  for (const operatingSystem of ["Docker Desktop", "Windows Server", "", null]) {
    assert.throws(() => verifyDockerHostBindingPlatform(operatingSystem), /pre-start loopback port-binding guarantee/);
  }
  for (const network of [
    { Driver: "bridge", EnableIPv6: false, Labels: { "com.docker.compose.project": "pr1-test" }, Options: { "com.docker.network.bridge.host_binding_ipv4": "0.0.0.0" } },
    { Driver: "bridge", EnableIPv6: true, Labels: { "com.docker.compose.project": "pr1-test" }, Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" } },
    { Driver: "bridge", EnableIPv6: false, Labels: {}, Options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" } },
    { Driver: "bridge", EnableIPv6: false, Labels: { "com.docker.compose.project": "pr1-test" }, Options: {} },
  ]) {
    assert.throws(() => verifyLoopbackNetwork(network, "pr1-test"), /Could not prove/);
  }
  assert.throws(() => validateLoopbackPublishedPorts({
    Name: "/supabase_db_pr1-test", HostConfig: { PortBindings: {} },
  }), /metadata is missing or malformed/);
  validateLoopbackPublishedPorts({
    Name: "/supabase_api_pr1-test", HostConfig: { PortBindings: null },
    NetworkSettings: { Ports: { "8080/tcp": null } },
  });
  assert.throws(() => validateLoopbackPublishedPorts({
    Name: "/supabase_db_pr1-test", HostConfig: {}, NetworkSettings: { Ports: {} },
  }), /metadata is missing or malformed/);
  assert.throws(() => validateLoopbackPublishedPorts({
    ...validContainer("127.0.0.1"),
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1" }] } },
  }), /non-loopback or unverifiable/);
  assert.throws(() => validateLoopbackPublishedPorts({
    ...validContainer("127.0.0.1"),
    NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55423" }] } },
  }), /metadata disagrees/);

  const cliCredentials = [
    "API URL: http://127.0.0.1:55421",
    "DB URL: postgresql://postgres:generated-db-password@127.0.0.1:55422/postgres",
    "Publishable: sb_publishable_generated-key",
    "Secret: sb_secret_generated-key",
    "JWT secret: generated-jwt-secret",
    "S3 Access Key: generated-s3-access-key",
    "S3 Secret Key: generated-s3-secret-key",
  ].join("\n");
  const successOutput = run("supabase", ["start"], {
    spawn: () => ({ status: 0, stdout: cliCredentials, stderr: cliCredentials }),
    stdio: "pipe", discardOutput: true,
  });
  assert.equal(successOutput, "");
  assert.throws(() => run("supabase", ["start"], {
    spawn: () => ({ status: 1, stdout: cliCredentials, stderr: cliCredentials }),
    stdio: "pipe", discardOutput: true, failureMessage: safeStartFailure,
  }), (error) => error.message === safeStartFailure && !error.message.includes("generated-") && !error.message.includes("sb_secret_"));

  console.log("Staging security self-tests passed (Docker bindings and suppressed Supabase CLI credentials).");
}

function verifyLocalStatus(context) {
  const output = runSupabase(context, ["status", "-o", "json"], { stdio: "pipe" });
  let status;
  try {
    status = JSON.parse(output);
  } catch {
    throw new Error("Supabase status did not return parseable JSON; database commands were not run");
  }
  const apiUrl = status.API_URL ?? status.api_url ?? status.apiUrl;
  const dbUrl = status.DB_URL ?? status.db_url ?? status.dbUrl;
  if (!apiUrl || !dbUrl) throw new Error("Supabase status omitted API or database endpoint; database commands were not run");
  const api = new URL(apiUrl);
  const database = new URL(dbUrl);
  if (api.hostname !== "127.0.0.1" || Number(api.port) !== context.ports.api
    || database.hostname !== "127.0.0.1" || Number(database.port) !== context.ports.db) {
    throw new Error("Supabase status endpoint did not match this run's loopback ports; database commands were not run");
  }
  return { apiUrl, dbUrl };
}

export async function withStagedLocalSupabase(callback) {
  const dockerOperatingSystem = run("docker", ["info", "--format", "{{.OperatingSystem}}"])
    .trim();
  verifyDockerHostBindingPlatform(dockerOperatingSystem);
  const token = `${Date.now()}-${randomBytes(6).toString("hex")}`;
  const projectId = `pr1-${token}`;
  const stageRoot = mkdtempSync(join(tmpdir(), `pr1-supabase-${token}-`));
  const ports = await uniquePorts();
  let context;
  try {
    context = stageProject(stageRoot, projectId, ports);
  } catch (error) {
    rmSync(stageRoot, { recursive: true, force: true });
    throw error;
  }
  const before = snapshot();
  const beforeManifest = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, [...value]]));
  const ownershipPath = join(stageRoot, "ownership.json");
  const resources = { containers: [], volumes: [], networks: [] };
  let started = false;
  let callbackError;
  let cleanupFailure;
  try {
    const preexisting = identifyOwnedResources(projectId, before);
    if (Object.values(preexisting).some((items) => items.length > 0)) throw new Error("Generated project identity already exists; refusing startup");
    const loopbackNetwork = createLoopbackNetwork(projectId);
    resources.networks.push(loopbackNetwork.id);
    context.dockerNetworkId = loopbackNetwork.id;
    verifyLoopbackNetwork(dockerJson(["network", "inspect", loopbackNetwork.id])[0], projectId);
    writeFileSync(ownershipPath, JSON.stringify({ projectId, stageRoot, ports, preexisting: beforeManifest, created: resources }, null, 2));
    runSupabase(context, ["start"]);
    started = true;
    Object.assign(resources, identifyOwnedResources(projectId, before));
    writeFileSync(ownershipPath, JSON.stringify({ projectId, stageRoot, ports, preexisting: beforeManifest, created: resources }, null, 2));
    for (const id of resources.containers) validateLoopbackPublishedPorts(dockerJson(["inspect", id])[0]);
    verifyLoopbackNetwork(dockerJson(["network", "inspect", loopbackNetwork.id])[0], projectId);
    console.log("Supabase published ports are loopback-only.");
    const status = verifyLocalStatus(context);
    const containerRecords = resources.containers.map((id) => ({ id, container: dockerJson(["inspect", id])[0] }));
    const databaseRecords = containerRecords.filter(({ container }) =>
      container?.Name?.replace(/^\//, "").startsWith(`supabase_db_${projectId}`));
    const authRecords = containerRecords.filter(({ container }) =>
      container?.Name?.replace(/^\//, "").startsWith(`supabase_auth_${projectId}`));
    if (databaseRecords.length !== 1 || authRecords.length !== 1) {
      throw new Error("Could not identify this run's uniquely labelled database and Auth containers");
    }
    const dbContainer = databaseRecords[0].container.Name.replace(/^\//, "");
    const dbContainerId = databaseRecords[0].id;
    const authContainer = authRecords[0].container.Name.replace(/^\//, "");
    const resolved = { ...context, ...status, projectId, dbContainer, dbContainerId, authContainer,
      preexistingResources: before, preexistingContainerIds: before.containers };
    enableOwnedDatabaseErrorCodes(resolved, resources);
    await callback(resolved, (args) => runSupabase(resolved, args));
  } catch (error) {
    callbackError = error;
  } finally {
    try {
      Object.assign(resources, identifyOwnedResources(projectId, before));
      if (started || resources.containers.length || resources.volumes.length || resources.networks.length) {
        writeFileSync(ownershipPath, JSON.stringify({ projectId, stageRoot, ports, preexisting: beforeManifest, created: resources }, null, 2));
        cleanupOwnedResources(resources, projectId, before);
      }
      rmSync(stageRoot, { recursive: true, force: true });
    } catch (error) {
      console.error(`Local Supabase cleanup stopped because ownership or removal could not be verified. Resources were left untouched where verification failed. Ownership manifest: ${ownershipPath}`);
      if (callbackError) console.error(`Test failure: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`);
      cleanupFailure = error;
    }
  }
  if (cleanupFailure) throw cleanupFailure;
  if (callbackError) throw callbackError;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Set(process.argv.slice(2));
  if (options.size === 1 && options.has("--security-self-test")) {
    try {
      runSecuritySelfTests();
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Staging security self-tests failed.");
      process.exitCode = 1;
    }
  } else if (options.has("--cleanup-manifest") && process.argv.length === 4) {
    try {
      cleanupFromManifest(process.argv[3]);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  } else if (options.size !== 1 || !options.has("--sql")) {
    console.error("Usage: node stage-local-supabase.mjs --sql | --cleanup-manifest <owned-manifest>");
    process.exitCode = 2;
  } else {
    withStagedLocalSupabase(async (context, supabase) => {
      console.log(`Running SQL tests in disposable project ${context.projectId} on local port ${context.ports.db}.`);
      supabase(["db", "reset", "--local"]);
      supabase(["test", "db", "--local"]);
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
