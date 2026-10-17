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

const safeImageServices = new Map([
  ["library/kong", "kong"], ["supabase/postgres", "db"], ["supabase/gotrue", "auth"],
  ["supabase/realtime", "realtime"], ["supabase/storage-api", "storage"],
  ["postgrest/postgrest", "rest"], ["supabase/postgres-meta", "pg_meta"],
  ["darthsim/imgproxy", "imgproxy"], ["supabase/edge-runtime", "functions"],
  ["timberio/vector", "vector"], ["supabase/supavisor", "supavisor"],
  ["supabase/studio", "studio"], ["axllent/mailpit", "mailpit"], ["supabase/logflare", "analytics"],
  ["supabase/cli/postgres", "db"], ["supabase/cli/auth", "auth"],
  ["supabase/cli/realtime", "realtime"], ["supabase/cli/storage", "storage"],
  ["supabase/cli/postgrest", "rest"], ["supabase/cli/pgmeta", "pg_meta"],
  ["supabase/cli/imgproxy", "imgproxy"], ["supabase/cli/edge-runtime", "functions"],
  ["supabase/cli/vector", "vector"], ["supabase/cli/pooler", "supavisor"],
  ["supabase/cli/studio", "studio"], ["supabase/cli/mailpit", "mailpit"],
  ["supabase/cli/analytics", "analytics"],
]);
const safeImageRegistries = new Set(["docker.io", "index.docker.io", "registry-1.docker.io", "ghcr.io", "public.ecr.aws"]);

function parseSafeImageReference(value, explicitRegistry) {
  const reference = String(value ?? "").trim();
  if (!reference || reference.length > 512 || /[\s?#\\]/.test(reference)) return null;
  const digestSeparator = reference.indexOf("@");
  const imageReference = digestSeparator === -1 ? reference : reference.slice(0, digestSeparator);
  const digest = digestSeparator === -1 ? "" : reference.slice(digestSeparator);
  if (digest && !/^@sha256:[a-f0-9]{64}$/i.test(digest)) return null;
  const safeRegistryPrefix = /^(docker\.io|index\.docker\.io|registry-1\.docker\.io|ghcr\.io|public\.ecr\.aws)\/(.+)$/i.exec(imageReference);
  let registry = safeRegistryPrefix?.[1].toLowerCase() ?? explicitRegistry?.toLowerCase();
  const repositoryAndTag = safeRegistryPrefix?.[2] ?? imageReference;
  const match = /^(?<repository>[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+)(?::(?<tag>[a-z0-9_][a-z0-9_.-]{0,127}))?$/i.exec(repositoryAndTag);
  if (!match || (registry && !safeImageRegistries.has(registry))) return null;
  const repository = match.groups.repository.toLowerCase();
  const service = safeImageServices.get(repository);
  if (!registry) {
    // Docker's unqualified reference defaults to Docker Hub; only infer that for
    // exact, known Supabase CLI image repositories.
    if (!service) return null;
    registry = "docker.io";
  }
  if (["index.docker.io", "registry-1.docker.io"].includes(registry)) registry = "docker.io";
  if (!service) return null;
  const image = `${repository}${match.groups.tag ? `:${match.groups.tag}` : ""}`;
  return { registry, image, service };
}

function startupImageDiagnostic(output) {
  const text = String(output);
  const references = [
    /\bpull access denied for\s+["']?([^\s"',;]+)["']?/i,
    /\bfailed to pull(?: image)?\s+["']?([^\s"',;]+)["']?/i,
    /\bfailed to resolve reference\s+["']([^"']+)["']/i,
  ];
  for (const pattern of references) {
    const match = pattern.exec(text);
    if (!match) continue;
    const image = parseSafeImageReference(match[1]);
    if (image) return formatStartupImageDiagnostic(image);
  }

  // Supabase CLI 2.119.0 aggregates pull failures as:
  // "failed to pull docker image from all registries: <candidate> attempt N: <stderr>; ...".
  // Parse only candidate markers in that known envelope; never inspect or emit their stderr.
  const aggregate = /\bfailed to pull docker image from all registries:\s*/i.exec(text);
  if (aggregate) {
    const attempts = /([^\s;,]+)\s+attempt\s+\d+\s*:/gi;
    attempts.lastIndex = aggregate.index + aggregate[0].length;
    let attempt;
    while ((attempt = attempts.exec(text)) !== null) {
      const image = parseSafeImageReference(attempt[1]);
      if (image) return formatStartupImageDiagnostic(image);
    }
  }

  // Docker commonly reports registry requests as a quoted /v2/<repo>/manifests/<tag>
  // URL. Parse it, then emit only validated registry/image components.
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    try {
      const url = new URL(match[0]);
      if (url.username || url.password || url.search || url.hash || !safeImageRegistries.has(url.hostname.toLowerCase())) continue;
      const endpoint = /^\/v2\/(.+)\/(?:manifests|blobs)\/([^/]+)$/.exec(url.pathname);
      if (!endpoint) continue;
      const reference = `${endpoint[1]}:${endpoint[2]}`;
      const image = parseSafeImageReference(reference, url.hostname);
      if (image) return formatStartupImageDiagnostic(image);
    } catch {
      // Invalid or credential-bearing URLs are intentionally omitted.
    }
  }
  return "";
}

function formatStartupImageDiagnostic(image) {
  const fields = [`registry=${image.registry}`, `image=${image.image}`];
  if (image.service) fields.push(`service=${image.service}`);
  return `Startup image: ${fields.join(" ")}`;
}

function classifyStartFailure(output) {
  const text = String(output).toLowerCase();
  const categories = [
    [/address already in use|port is already allocated|bind:.*address/, "port-allocation"],
    [/no space left on device|disk quota exceeded/, "disk-capacity"],
    [/cannot allocate memory|out of memory|oomkilled/, "memory-pressure"],
    [/toomanyrequests|too many requests|rate limit exceeded/, "image-pull-rate-limit"],
    [/pull access denied|unauthorized|authentication required/, "image-pull-authentication"],
    [/manifest unknown|no matching manifest|image .* not found/, "image-unavailable"],
    [/tls handshake timeout|i\/o timeout|context deadline exceeded|connection reset by peer/, "network-timeout"],
    [/network .* (?:not found|already exists|has active endpoints)|network id .* not found/, "network-provisioning"],
    [/unhealthy|health check|healthcheck/, "service-health"],
    [/timed out waiting|startup timed out|failed to start services/, "service-start-timeout"],
    [/failed to pull|pulling .* failed/, "image-pull"],
    [/failed to create (?:docker )?container|error response from daemon.*container/, "container-create"],
    [/failed to create (?:docker )?network|error response from daemon.*network/, "network-provisioning"],
    [/failed to start .*container|container .*failed to start|failed creating container/, "container-start"],
  ];
  return categories.find(([pattern]) => pattern.test(text))?.[1] ?? "unclassified-start-failure";
}

function containerDiagnostic(container, projectId) {
  const name = container?.Name?.replace(/^\//, "") ?? "";
  const prefix = "supabase_";
  const service = name.startsWith(prefix)
    ? ["db", "auth", "rest", "realtime", "storage", "imgproxy", "kong", "pg_meta", "studio", "functions", "analytics", "vector", "supavisor"]
      .find((candidate) => name.startsWith(`${prefix}${candidate}_${projectId}`)) ?? "unknown"
    : "unknown";
  const state = container?.State ?? {};
  const safeStatus = ["created", "restarting", "running", "removing", "paused", "exited", "dead"].includes(state.Status)
    ? state.Status : "unknown";
  const health = ["starting", "healthy", "unhealthy"].includes(state.Health?.Status)
    ? state.Health.Status : "none";
  const exitCode = Number.isInteger(state.ExitCode) ? state.ExitCode : "none";
  const detail = state.Error ? classifyStartFailure(state.Error) : "none";
  return `container service=${service} state=${safeStatus} exit_code=${exitCode} health=${health} oom_killed=${state.OOMKilled === true} detail=${detail}`;
}

function collectStartupContainerDiagnostics(projectId, before) {
  try {
    const owned = identifyOwnedResources(projectId, before).containers;
    if (owned.length === 0) return "Startup containers: none created or ownership could not be established.";
    const summaries = owned.slice(0, 20).map((id) => {
      const container = verifyOwnedResource("containers", id, projectId, before);
      return containerDiagnostic(container, projectId);
    });
    const overflow = owned.length > summaries.length ? `\nAdditional owned containers omitted: ${owned.length - summaries.length}.` : "";
    return `Startup container diagnostics (${summaries.length}):\n${summaries.join("\n")}${overflow}`;
  } catch {
    return "Startup container diagnostics unavailable; ownership was not proven.";
  }
}

function startupFailure(error, diagnostics) {
  const category = error?.startupFailureCategory ?? "unclassified-start-failure";
  const exitCode = Number.isInteger(error?.startupExitCode) ? error.startupExitCode : "unavailable";
  const image = error?.startupImageDiagnostic ? `\n${error.startupImageDiagnostic}` : "";
  return `${safeStartFailure}\nStartup failure category: ${category}${image}\nSupabase CLI exit code: ${exitCode}\n${diagnostics}`;
}

function run(command, args, options = {}) {
  const { spawn = spawnSync, discardOutput = false, failureMessage, sqlDiagnostics = false, startDiagnostics = false, ...spawnOptions } = options;
  const result = spawn(command, args, { encoding: "utf8", ...spawnOptions });
  if (result.error) {
    const error = new Error(failureMessage ?? `${command} could not be started; output suppressed.`);
    if (startDiagnostics) error.startupFailureCategory = "process-launch-failure";
    throw error;
  }
  if (result.status !== 0) {
    if (failureMessage) {
      const diagnostics = sqlDiagnostics ? summarizeSqlFailure(`${result.stdout ?? ""}\n${result.stderr ?? ""}`) : "";
      const error = new Error(`${failureMessage}${diagnostics ? `\n${diagnostics}` : ""}`);
      if (startDiagnostics) {
        const startOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
        error.startupFailureCategory = classifyStartFailure(startOutput);
        error.startupImageDiagnostic = startupImageDiagnostic(startOutput);
        error.startupExitCode = result.status;
      }
      throw error;
    }
    const detail = redactSecrets(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return discardOutput ? "" : result.stdout ?? "";
}

function summarizeSqlFailure(output) {
  const safe = redactSecrets(output)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-db-url]")
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[redacted-key]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]");
  return safe.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /\.test\.sql\b|^not ok\b|^# (?:Failed|Looks like)|\b(?:ERROR|FATAL):\s|^Test Summary Report|^Result: FAIL/i.test(line))
    .slice(0, 60).map((line) => line.slice(0, 300)).join("\n");
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
  let output;
  try {
    output = run("supabase", ["--workdir", context.stagedRoot, "--network-id", context.dockerNetworkId, ...args], {
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", ...options.env },
      stdio: "pipe",
      discardOutput: args[0] !== "status",
      failureMessage: args[0] === "start" ? safeStartFailure : `Supabase ${args[0]} failed; CLI output suppressed.`,
      sqlDiagnostics: args[0] === "test" && args[1] === "db",
      startDiagnostics: args[0] === "start",
    });
  } catch (error) {
    if (args[0] === "start") throw new Error(startupFailure(error, collectStartupContainerDiagnostics(context.projectId, context.preexistingResources)));
    throw error;
  }
  if (args[0] === "start") console.log("Isolated Supabase startup completed; validating published port bindings.");
  if (args[0] === "db" && args[1] === "reset") console.log("Isolated local database reset completed.");
  if (args[0] === "test" && args[1] === "db") console.log("Staged local SQL tests passed.");
  return output;
}

function runSecuritySelfTests() {
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
    stdio: "pipe", discardOutput: true, failureMessage: safeStartFailure, startDiagnostics: true,
  }), (error) => error.message === safeStartFailure
    && error.startupFailureCategory === "unclassified-start-failure"
    && error.startupExitCode === 1
    && !error.message.includes("generated-") && !error.message.includes("sb_secret_"));
  assert.equal(classifyStartFailure("failed to pull image: unauthorized: password=private"), "image-pull-authentication");
  assert.equal(classifyStartFailure("daemon reported no space left on device"), "disk-capacity");
  assert.equal(startupImageDiagnostic("pull access denied for library/kong:2.8.1, repository does not exist or may require 'docker login'"),
    "Startup image: registry=docker.io image=library/kong:2.8.1 service=kong");
  assert.equal(startupImageDiagnostic('Head "https://ghcr.io/v2/supabase/cli/auth/manifests/v2.197.0": unauthorized'),
    "Startup image: registry=ghcr.io image=supabase/cli/auth:v2.197.0 service=auth");
  const validDigest = "a".repeat(64);
  const aggregatePullFailure = `failed to pull docker image from all registries: ghcr.io/supabase/cli/postgres:15.8.1@sha256:${validDigest} attempt 0: unauthorized: token=first-secret; docker.io/supabase/postgres:15.8.1 attempt 1: password=second-secret`;
  assert.equal(startupImageDiagnostic(aggregatePullFailure),
    "Startup image: registry=ghcr.io image=supabase/cli/postgres:15.8.1 service=db");
  assert.equal(startupImageDiagnostic(`failed to pull docker image from all registries: docker.io/supabase/postgres:15.8.1 attempt 0: denied; ghcr.io/supabase/cli/postgres:15.8.1@sha256:${validDigest} attempt 1: unauthorized`),
    "Startup image: registry=docker.io image=supabase/postgres:15.8.1 service=db");
  assert.equal(startupImageDiagnostic(`failed to pull docker image from all registries: ghcr.io/supabase/cli/postgres:15.8.1@sha256:${"a".repeat(63)} attempt 0: unauthorized`), "");
  assert.equal(startupImageDiagnostic(`failed to pull docker image from all registries: ghcr.io/supabase/cli/postgres:15.8.1@sha256:${"g".repeat(64)} attempt 0: unauthorized`), "");
  assert.equal(startupImageDiagnostic("failed to pull docker image from all registries: public.ecr.aws/untrusted/private:tag@sha256:" + validDigest + " attempt 0: unauthorized"), "");
  assert.equal(startupImageDiagnostic("failed to pull docker image from all registries: private.registry.invalid/supabase/postgres:tag@sha256:" + validDigest + " attempt 0: unauthorized"), "");
  assert.equal(startupImageDiagnostic("failed to pull docker image from all registries: https://user:secret@ghcr.io/v2/supabase/cli/auth/manifests/v2.197.0?token=secret attempt 0: unauthorized"), "");
  const safeAggregateFailure = startupFailure(
    Object.assign(new Error(aggregatePullFailure), {
      startupFailureCategory: "image-pull-authentication",
      startupImageDiagnostic: startupImageDiagnostic(aggregatePullFailure),
      startupExitCode: 1,
    }),
    "Startup containers: none created or ownership could not be established.",
  );
  assert.match(safeAggregateFailure, /registry=ghcr\.io image=supabase\/cli\/postgres:15\.8\.1 service=db/);
  assert.doesNotMatch(safeAggregateFailure, /first-secret|second-secret|password|token=/);
  assert.equal(startupImageDiagnostic("pull access denied for private.registry.invalid/team/image:tag, unauthorized"), "");
  assert.equal(startupImageDiagnostic('Head "https://ghcr.io/v2/untrusted/private-package/manifests/secret-tag": unauthorized'), "");
  assert.equal(startupImageDiagnostic('Head "https://user:token@ghcr.io/v2/supabase/cli/auth/manifests/v2.197.0?token=secret": unauthorized'), "");
  const safeImageFailure = startupFailure(
    Object.assign(new Error("raw token=secret"), {
      startupFailureCategory: "image-pull-authentication", startupImageDiagnostic: startupImageDiagnostic("pull access denied for library/kong:2.8.1, unauthorized"), startupExitCode: 1,
    }),
    "Startup containers: none created or ownership could not be established.",
  );
  assert.match(safeImageFailure, /registry=docker\.io image=library\/kong:2\.8\.1 service=kong/);
  assert.doesNotMatch(safeImageFailure, /token=secret|password|docker login/);
  const safeContainerSummary = containerDiagnostic({
    Name: "/supabase_db_pr1-123-abcd",
    State: { Status: "exited", ExitCode: 137, OOMKilled: true, Error: "postgresql://postgres:secret@host/db token=private", Health: { Status: "unhealthy" } },
  }, "pr1-123-abcd");
  assert.match(safeContainerSummary, /service=db state=exited exit_code=137 health=unhealthy oom_killed=true detail=unclassified-start-failure/);
  assert.doesNotMatch(safeContainerSummary, /secret|private|postgresql:|host/);
  const safeStartupFailure = startupFailure(
    Object.assign(new Error(cliCredentials), { startupFailureCategory: "image-pull-authentication", startupExitCode: 1 }),
    `Startup container diagnostics (1):\n${safeContainerSummary}`,
  );
  assert.match(safeStartupFailure, /Startup failure category: image-pull-authentication/);
  assert.match(safeStartupFailure, /Supabase CLI exit code: 1/);
  assert.doesNotMatch(safeStartupFailure, /generated-|sb_secret_|secret|private|postgresql:|host/);
  assert.throws(() => run("supabase", ["test", "db"], {
    spawn: () => ({ status: 1, stdout: `tests/version_history_introduction_read.test.sql .. not ok 3 - denied scope\nERROR: ${cliCredentials}`,
      stderr: "" }),
    stdio: "pipe", failureMessage: "Supabase test failed; CLI output suppressed.", sqlDiagnostics: true,
  }), (error) => error.message.includes("version_history_introduction_read.test.sql")
    && !error.message.includes("generated-db-password") && !error.message.includes("sb_secret_"));

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
  context.projectId = projectId;
  context.preexistingResources = before;
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
    const containerNames = resources.containers.map((id) => dockerJson(["inspect", id])[0]?.Name?.replace(/^\//, ""));
    const dbContainer = containerNames.find((name) => name?.startsWith(`supabase_db_${projectId}`));
    const authContainer = containerNames.find((name) => name?.startsWith(`supabase_auth_${projectId}`));
    if (!dbContainer || !authContainer) throw new Error("Could not identify this run's uniquely labelled database and Auth containers");
    const resolved = { ...context, ...status, projectId, dbContainer, authContainer };
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
