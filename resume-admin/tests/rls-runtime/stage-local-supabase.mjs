// TEST ONLY: create an isolated, disposable Supabase project for local tests.
// Resource cleanup is limited to Docker IDs created by this invocation and
// verified with this run's unique Compose project label.
/* global console, process, URL */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = redactSecrets(`${result.stdout ?? ""}${result.stderr ?? ""}`).trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout ?? "";
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
  const output = run("supabase", ["--workdir", context.stagedRoot, ...args], {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", ...options.env },
    stdio: options.stdio ?? (args[0] === "start" ? "pipe" : "inherit"),
  });
  if (args[0] === "start" && output.trim()) console.log(redactSecrets(output));
  return output;
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
    writeFileSync(ownershipPath, JSON.stringify({ projectId, stageRoot, ports, preexisting: beforeManifest, created: resources }, null, 2));
    runSupabase(context, ["start"]);
    started = true;
    Object.assign(resources, identifyOwnedResources(projectId, before));
    writeFileSync(ownershipPath, JSON.stringify({ projectId, stageRoot, ports, preexisting: beforeManifest, created: resources }, null, 2));
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
  if (options.has("--cleanup-manifest") && process.argv.length === 4) {
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
      console.log(`Running SQL tests in disposable project ${context.projectId} at ${context.dbUrl.replace(/:[^:@/]+@/, ":***@")}`);
      supabase(["db", "reset", "--local"]);
      supabase(["test", "db", "--local"]);
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
