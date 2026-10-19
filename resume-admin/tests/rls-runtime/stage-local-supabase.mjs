// TEST ONLY: create an isolated, disposable Supabase project for local tests.
// Resource cleanup is limited to Docker IDs created by this invocation and
// verified with this run's unique Compose project label.
/* global console, process, URL */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer, isIP } from "node:net";
import { accessSync, chmodSync, constants as fsConstants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";

const utilityDir = dirname(fileURLToPath(import.meta.url));
const sourceProject = resolve(utilityDir, "supabase");
const excludedMigrations = new Set([
  "20261031130000_test_profile_signing_probe.sql",
  "20261031140000_retire_test_profile_signing_probe.sql",
]);

const safeStartFailure = "Supabase start failed; CLI output suppressed.";
// These tags are from Supabase CLI 2.119.0's embedded compose template. Their
// GHCR manifest digests were checked against the matching public ECR manifests.
// Supabase mirrors each upstream image as ghcr.io/supabase/<last path segment>,
// which matches the CLI's GHCR fallback. Pulling by digest and tagging that
// reference lets normal registry resolution reuse the verified image locally.
const verifiedSupabaseImages = [
  ["supabase/postgres", "17.11.0.002", "0450166354dc9c1d25f0322ac8b580774d4fb0184d2b087f6e4fe9499c66cf53"],
  ["supabase/kong", "2.8.1", "1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d"],
  ["postgrest/postgrest", "v16.4", "d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df"],
  ["supabase/postgres-meta", "v0.99.0", "9a079ac1c94d89629262822a4bd1902d5b1be4adb464e5a0a8fd078aaed72158"],
  ["darthsim/imgproxy", "v3.26.0", "f3130cc154e8584643581ad7ba53970ec779e7e974f98b121854bba2a46b3b76"],
  ["supabase/edge-runtime", "v1.77.1", "645d0e45446181f3e9d87efeef637b494615f32365befff00e2d2b0fe8535fef"],
  ["timberio/vector", "0.58.0-alpine", "5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773"],
  ["supabase/supavisor", "2.9.13", "07f1a6098ffc04b80263bca4eb5c3e7bd2e03dfd1fc465aa108d7329000a1a4e"],
  ["supabase/gotrue", "v2.197.0", "1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b"],
  ["supabase/realtime", "v2.140.3", "f66c721c71b576f5854c78f86df0c78a98368d900dcf62e4ddd96c6913139999"],
  ["supabase/storage-api", "v1.79.28", "1f6c99d3952d78d57129802aa2ae8a80d75e327492cf24742fd0aeaf90967b96"],
  ["supabase/logflare", "1.50.15", "a82f96c8845c1bcab128cfe17b4e325943ab949b657e9629a0bcc66f1d363179"],
].map(([repository, tag, digest]) => {
  const image = repository.split("/").at(-1);
  const mirror = `supabase/${image}`;
  return {
    repository,
    source: `ghcr.io/${mirror}@sha256:${digest}`,
    target: `ghcr.io/${mirror}:${tag}`,
  };
});

function classifyVerifiedImagePullFailure(output, launchFailed = false) {
  if (launchFailed) return "docker-cli-launch-failure";
  const text = String(output).toLowerCase();
  if (/toomanyrequests|too many requests|rate limit exceeded|429\s+too many requests/.test(text)) return "image-pull-rate-limit";
  if (/pull access denied|unauthorized|authentication required|requested access to the resource is denied|invalid token|forbidden|\b(?:401|403)\b/.test(text)) return "image-pull-authentication";
  if (/manifest unknown|no matching manifest|not found|name unknown/.test(text)) return "image-unavailable";
  if (/tls handshake timeout|i\/o timeout|context deadline exceeded|connection reset by peer|network is unreachable/.test(text)) return "network-timeout";
  return "unclassified-pull-failure";
}

function prefetchVerifiedSupabaseImages(spawn = spawnSync) {
  for (const { repository, source, target } of verifiedSupabaseImages) {
    const image = repository.split("/").at(-1);
    const inspectImageId = (reference) => {
      const inspected = spawn("docker", ["image", "inspect", "--format", "{{.Id}}", reference], { encoding: "utf8", stdio: "pipe" });
      const imageId = inspected?.stdout?.trim();
      return !inspected.error && inspected.status === 0 && /^sha256:[a-f0-9]{64}$/.test(imageId ?? "") ? imageId : null;
    };
    let imageId = inspectImageId(source);
    if (!imageId) {
      const pulled = spawn("docker", ["pull", source], { encoding: "utf8", stdio: "pipe" });
      if (pulled.error || pulled.status !== 0) {
        const detail = classifyVerifiedImagePullFailure(`${pulled?.stdout ?? ""}\n${pulled?.stderr ?? ""}`, Boolean(pulled?.error));
        throw new Error(`Verified Supabase image preload failed; image=${image}; detail=${detail}`);
      }
      imageId = inspectImageId(source);
      if (!imageId) throw new Error(`Verified Supabase image cache verification failed; image=${image}; detail=image-cache-verify-failure`);
    }
    const tagged = spawn("docker", ["image", "tag", imageId, target], { encoding: "utf8", stdio: "pipe" });
    if (tagged.error || tagged.status !== 0) {
      throw new Error(`Verified Supabase image cache setup failed; image=${image}; detail=image-cache-tag-failure`);
    }
    if (inspectImageId(target) !== imageId) {
      throw new Error(`Verified Supabase image cache setup failed; image=${image}; detail=image-cache-tag-verification-failure`);
    }
  }
  console.log(`Preloaded ${verifiedSupabaseImages.length} verified Supabase images from GHCR.`);
}

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
const safeTerminationSignals = new Set(Object.keys(osConstants.signals));

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
  // Tags and digests are deliberately omitted from all diagnostics.
  const image = repository;
  return { registry, image, service };
}

const safeStartupErrorCodes = new Set([
  "StartWorkdirError", "StartConfigLoadError", "StartInvalidConfigError",
  "ImagePrepullError", "DockerRunError", "DockerLifecycleInspectError", "DockerLifecycleListError", "NetworkCreateError", "DbSetupError",
]);
const safeDbSetupReasons = new Set([
  "database", "filesystem", "invalid_config", "docker_daemon", "config", "registry_pull", "image_inspect",
]);

const startupDiagnosticEnums = {
  version: ["expected", "different", "unparseable", "probe-failed"],
  stdout: ["empty", "non-json", "json-lines", "mixed", "multiline-json"],
  stderr: ["empty", "non-json", "json-lines", "mixed", "multiline-json"],
  shape: ["matched", "json-shape-mismatch", "no-json", "unavailable"],
  code: ["allowlisted", "missing", "invalid-type", "not-allowlisted", "no-matched-error", "unavailable"],
  source: ["structured-messages", "fallback-text", "unavailable"],
  setupReason: ["database", "filesystem", "invalid_config", "docker_daemon", "config", "registry_pull", "image_inspect", "unavailable"],
};

function safeStartupMetadata(metadata = {}) {
  const labels = ["CLI version verification", "Startup stdout format", "Startup stderr format",
    "Startup error shape", "Startup first error code status", "Startup classification source", "Supabase DB setup reason"];
  return Object.entries(startupDiagnosticEnums).map(([key, allowed], index) => {
    const fallback = key === "version" ? "probe-failed" : key === "stdout" || key === "stderr" ? "empty" : "unavailable";
    return `${labels[index]}: ${allowed.includes(metadata?.[key]) ? metadata[key] : fallback}`;
  }).join("\n");
}

function startupOutputFormat(output) {
  const lines = String(output ?? "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { format: "empty", hasJson: false };
  const parses = (text) => { try { JSON.parse(text); return true; } catch { return false; } };
  const count = lines.filter(parses).length;
  if (count === lines.length) return { format: "json-lines", hasJson: true };
  if (parses(String(output))) return { format: "multiline-json", hasJson: true };
  return { format: count ? "mixed" : "non-json", hasJson: count > 0 };
}

function startupOutputMetadata(stdout, stderr, errors) {
  try {
    const out = startupOutputFormat(stdout);
    const err = startupOutputFormat(stderr);
    const available = typeof stdout === "string" || typeof stderr === "string";
    return {
      stdout: out.format, stderr: err.format,
      shape: !available ? "unavailable" : errors.length ? "matched"
        : out.hasJson || err.hasJson ? "json-shape-mismatch" : "no-json",
      code: !available ? "unavailable" : errors[0]?.codeStatus ?? "no-matched-error",
      setupReason: errors[0]?.code === "DbSetupError" && safeDbSetupReasons.has(errors[0]?.setupReason)
        ? errors[0].setupReason : "unavailable",
    };
  } catch { return {}; }
}

function probeCliVersion(env, launch = spawn, timeoutMs = 3000) {
  return new Promise((resolveProbe) => {
    let child;
    let timer;
    let done = false;
    let output = "";
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveProbe(status);
    };
    const abort = () => {
      finish("probe-failed");
      try { child?.kill("SIGKILL"); } catch { /* Diagnostic only. */ }
    };
    try {
      child = launch("supabase", ["--version"], { env, stdio: ["ignore", "pipe", "pipe"] });
      timer = setTimeout(abort, timeoutMs);
      child.stdout.on("data", (chunk) => {
        if (output.length + chunk.length > 1024) return abort();
        output += chunk.toString();
      });
      child.stderr.on("data", () => {}); // Never retain or emit stderr.
      child.on("error", abort);
      child.on("close", (code) => {
        if (code !== 0) return finish("probe-failed");
        const version = output.trim();
        finish(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
          ? "unparseable" : version === "2.119.0" ? "expected" : "different");
      });
    } catch { abort(); }
  });
}

function structuredStartupErrors(output) {
  const errors = [];
  for (const line of String(output).split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line);
      if ((parsed?._tag === "Error" || parsed?.type === "error") && typeof parsed.error?.message === "string") {
        errors.push({
          code: safeStartupErrorCodes.has(parsed.error.code) ? parsed.error.code : "unrecognized",
          codeStatus: !Object.hasOwn(parsed.error, "code") ? "missing"
            : typeof parsed.error.code !== "string" ? "invalid-type"
            : safeStartupErrorCodes.has(parsed.error.code) ? "allowlisted" : "not-allowlisted",
          setupReason: parsed.error.code === "DbSetupError" && safeDbSetupReasons.has(parsed.error.reason)
            ? parsed.error.reason : "unavailable",
          message: parsed.error.message,
        });
      }
    } catch {
      // JSON mode can share stderr with Docker pull progress; ignore non-JSON lines.
    }
  }
  return errors;
}

function startupImageDiagnostic(output) {
  const rawText = String(output);
  const structuredMessages = structuredStartupErrors(rawText).map(({ message }) => message);
  const texts = structuredMessages.length > 0 ? structuredMessages : [rawText];
  let rejectedCandidate = false;
  const diagnostic = (image, suffix = "") => ({
    status: "validated",
    line: `${formatStartupImageDiagnostic(image)}${suffix}`,
  });
  const rejected = (candidate) => {
    const image = parseSafeImageReference(candidate);
    if (!image) rejectedCandidate = true;
    return image;
  };
  let foundAggregate = false;
  let foundAttempt = false;
  const aggregateDiagnostics = [];
  for (const text of texts) {
    // CLI 2.119.0 emits one aggregate per failed image. Each lists registry candidates
    // and their attempt errors. Keep only allowlisted image fields and a fixed category.
    const aggregates = [...text.matchAll(/\bfailed to pull docker image from all registries:\s*/gi)];
    for (const [aggregateIndex, aggregate] of aggregates.entries()) {
      foundAggregate = true;
      const bodyStart = aggregate.index + aggregate[0].length;
      const bodyEnd = aggregates[aggregateIndex + 1]?.index ?? text.length;
      const body = text.slice(bodyStart, bodyEnd);
      const attempts = [...body.matchAll(/([^\s;,]+)\s+attempt\s+(\d+)\s*:/gi)];
      for (const [attemptIndex, attempt] of attempts.entries()) {
        foundAttempt = true;
        const image = rejected(attempt[1]);
        if (!image) continue;
        const errorStart = attempt.index + attempt[0].length;
        const errorEnd = attempts[attemptIndex + 1]?.index ?? body.length;
        const category = classifyStartFailure(body.slice(errorStart, errorEnd));
        const suffix = ` attempt=${attempt[2]} detail=${category}`;
        const result = diagnostic(image, suffix);
        const key = `${result.line}`;
        if (!aggregateDiagnostics.some((entry) => entry.key === key)) {
          aggregateDiagnostics.push({ key, line: `Startup image attempt: ${result.line.replace(/^Startup image: /, "")}` });
        }
      }
    }

    const references = [
      /\bpull access denied for\s+["']?([^\s"',;]+)["']?/i,
      /\bfailed to pull(?: image)?\s+["']?([^\s"',;]+)["']?/i,
      /\bfailed to resolve reference\s+["']([^"']+)["']/i,
    ];
    for (const pattern of references) {
      const match = pattern.exec(text);
      if (!match) continue;
      const image = rejected(match[1]);
      if (image) return diagnostic(image);
    }

    if (aggregates.length === 0) {
      // Docker may report a registry request as a quoted /v2/<repo>/manifests/<tag> URL.
      for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
        try {
          const url = new URL(match[0]);
          const endpoint = /^\/v2\/(.+)\/(?:manifests|blobs)\/([^/]+)$/.exec(url.pathname);
          if (!endpoint) continue;
          const reference = `${endpoint[1]}:${endpoint[2]}`;
          if (url.username || url.password || url.search || url.hash || !safeImageRegistries.has(url.hostname.toLowerCase())) {
            rejectedCandidate = true;
            continue;
          }
          const image = parseSafeImageReference(reference, url.hostname);
          if (image) return diagnostic(image);
          rejectedCandidate = true;
        } catch {
          // Invalid or credential-bearing URLs are intentionally omitted.
        }
      }
    }
  }
  if (aggregateDiagnostics.length > 0) {
    return { status: "validated", line: aggregateDiagnostics.slice(0, 20).map((entry) => entry.line).join("\n") };
  }
  if (foundAggregate && !foundAttempt) return { status: "format-mismatch", line: "" };
  if (rejectedCandidate) return { status: "allowlist-rejected", line: "" };
  return { status: "not-found", line: "" };
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

function startupFailure(error, diagnostics, pullDiagnostics = "") {
  const category = error?.startupFailureCategory ?? "unclassified-start-failure";
  const exitCode = Number.isInteger(error?.startupExitCode) ? error.startupExitCode : "unavailable";
  const imageStatus = error?.startupImageDiagnosticStatus ?? "not-found";
  const image = error?.startupImageDiagnostic ? `\n${error.startupImageDiagnostic}` : "";
  const pulls = pullDiagnostics ? `\n${pullDiagnostics}` : "";
  const errorCode = safeStartupErrorCodes.has(error?.startupErrorCode) ? error.startupErrorCode : "unavailable";
  return `${safeStartFailure}\n${safeStartupMetadata(error?.startupMetadata)}\nStartup failure category: ${category}\nSupabase CLI error code: ${errorCode}\nStartup image diagnostic status: ${imageStatus}${image}\nSupabase CLI exit code: ${exitCode}${pulls}\n${diagnostics}`;
}

const pullFailureCategories = new Set([
  "success", "image-pull-rate-limit", "image-pull-authentication", "image-unavailable",
  "network-timeout", "unclassified-pull-failure", "docker-cli-launch-failure",
]);

function classifyDockerPullFailure(output, exitCode) {
  if (exitCode === 0) return "success";
  const text = String(output).toLowerCase();
  if (/toomanyrequests|too many requests|rate limit exceeded|429\s+too many requests/.test(text)) return "image-pull-rate-limit";
  if (/pull access denied|unauthorized|authentication required|requested access to the resource is denied/.test(text)) return "image-pull-authentication";
  if (/manifest unknown|no matching manifest|not found|name unknown/.test(text)) return "image-unavailable";
  if (/tls handshake timeout|i\/o timeout|context deadline exceeded|connection reset by peer|network is unreachable/.test(text)) return "network-timeout";
  return "unclassified-pull-failure";
}

function pullObserverKey(statePath) {
  const key = readFileSync(`${statePath}.key`);
  if (key.length !== 32) throw new Error("Invalid pull observer key");
  return key;
}

function pullObserverMac(key, records) {
  return createHmac("sha256", key).update(JSON.stringify(records)).digest("hex");
}

function initializePullObserverState(statePath) {
  const key = randomBytes(32);
  writeFileSync(`${statePath}.key`, key, { mode: 0o600 });
  writeFileSync(statePath, JSON.stringify({ records: [], mac: pullObserverMac(key, []) }), { mode: 0o600 });
  chmodSync(`${statePath}.key`, 0o600);
  chmodSync(statePath, 0o600);
}

function pullCandidateId(statePath, candidate) {
  try {
    return createHmac("sha256", pullObserverKey(statePath)).update(candidate).digest("hex").slice(0, 24);
  } catch {
    return null;
  }
}

function readPullObserverRecords(diagnosticsPath) {
  let envelope;
  let key;
  try {
    envelope = JSON.parse(readFileSync(diagnosticsPath, "utf8"));
    key = pullObserverKey(diagnosticsPath);
  } catch { return null; }
  if (!envelope || JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(["mac", "records"])
    || !Array.isArray(envelope.records) || !/^[a-f0-9]{64}$/.test(envelope.mac)) return null;
  const actualMac = Buffer.from(envelope.mac, "hex");
  const expectedMac = Buffer.from(pullObserverMac(key, envelope.records), "hex");
  if (!timingSafeEqual(actualMac, expectedMac)) return null;
  const records = envelope.records;
  const validated = [];
  for (const record of records) {
    if (!record || !Number.isSafeInteger(record.order) || record.order !== validated.length + 1
      || !Number.isSafeInteger(record.attempt) || record.attempt < 1
      || !["validated", "allowlist-rejected", "format-mismatch"].includes(record.candidateStatus)
      || !((record.exitCode === null && record.category === null && record.signal === null)
        || (Number.isInteger(record.exitCode) && record.exitCode >= 0 && record.exitCode <= 255
          && record.signal === null && pullFailureCategories.has(record.category))
        || (record.exitCode === null && safeTerminationSignals.has(record.signal)
          && pullFailureCategories.has(record.category)))) return null;
    if (record.candidateStatus === "validated") {
      const expectedKeys = ["attempt", "candidateStatus", "category", "exitCode", "image", "order", "registry", "service", "signal"];
      if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)
        || !expectedKeys.every((key) => Object.hasOwn(record, key))) return null;
      const safe = parseSafeImageReference(`${record.registry}/${record.image}`);
      if (!safe || safe.registry !== record.registry || safe.image !== record.image || safe.service !== record.service) return null;
      const expectedAttempt = validated.filter((previous) => previous.candidateStatus === "validated"
        && previous.registry === safe.registry && previous.image === safe.image).length + 1;
      if (record.attempt !== expectedAttempt) return null;
      validated.push({ order: record.order, attempt: record.attempt, candidateStatus: record.candidateStatus,
        registry: safe.registry, image: safe.image, service: safe.service, exitCode: record.exitCode, category: record.category, signal: record.signal });
    } else {
      const withId = record.candidateStatus === "allowlist-rejected";
      const expectedKeys = withId
        ? ["attempt", "candidateId", "candidateStatus", "category", "exitCode", "order", "signal"]
        : ["attempt", "candidateStatus", "category", "exitCode", "order", "signal"];
      const expectedAttempt = withId
        ? validated.filter((previous) => previous.candidateStatus === "allowlist-rejected" && previous.candidateId === record.candidateId).length + 1
        : 1;
      if ((withId && !/^[a-f0-9]{24}$/.test(record.candidateId))
        || record.attempt !== expectedAttempt || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) return null;
      validated.push({ order: record.order, attempt: record.attempt, candidateStatus: record.candidateStatus,
        ...(withId ? { candidateId: record.candidateId } : {}),
        exitCode: record.exitCode, category: record.category, signal: record.signal });
    }
  }
  return validated;
}

function formatPullObserverDiagnostics(diagnosticsPath) {
  let records;
  try { records = readPullObserverRecords(diagnosticsPath); } catch { records = null; }
  if (records === null) return "Startup pull observer: diagnostics unavailable; unverified fields omitted.";
  if (records.length === 0) return "Startup pull observer: no pull attempts observed.";
  const lines = records.slice(0, 30).map((record) => {
    const imageFields = record.candidateStatus === "validated"
      ? ` registry=${record.registry} image=${record.image} service=${record.service}`
      : ` candidate=${record.candidateStatus}${record.candidateId ? ` candidate_id=${record.candidateId}` : ""}`;
    const exitCode = record.exitCode === null ? "unavailable" : record.exitCode;
    const category = record.category ?? "unclassified-pull-failure";
    const signal = record.signal ? ` signal=${record.signal}` : "";
    return `Startup image pull: order=${record.order} attempt=${record.attempt}${imageFields} exit_code=${exitCode}${signal} detail=${category}`;
  });
  if (records.length > lines.length) lines.push(`Startup image pull: additional attempts omitted=${records.length - lines.length}.`);
  return `Startup pull observer: observed ${records.length} pull attempt(s).\n${lines.join("\n")}`;
}

function updatePullObserverState(statePath, update) {
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + 5000;
  let locked = false;
  while (!locked && Date.now() < deadline) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      locked = true;
    } catch (error) {
      if (error?.code !== "EEXIST") return null;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!locked) return null;
  try {
    const records = readPullObserverRecords(statePath);
    if (records === null) return null;
    const result = update(records);
    const temporaryPath = `${statePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ records, mac: pullObserverMac(pullObserverKey(statePath), records) }), { mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, statePath);
    return result;
  } catch {
    return null;
  } finally {
    try { rmSync(lockPath, { recursive: true, force: true }); } catch {
      // A diagnostic lock cleanup failure must not alter the observed command result.
    }
  }
}

function reservePullObserverAttempt(statePath, candidateStatus, image, candidateId) {
  return updatePullObserverState(statePath, (records) => {
    const order = records.length + 1;
    const attempt = image
      ? records.filter((record) => record.candidateStatus === "validated"
        && record.registry === image.registry && record.image === image.image).length + 1
      : candidateId
        ? records.filter((record) => record.candidateStatus === "allowlist-rejected" && record.candidateId === candidateId).length + 1
        : 1;
    const reservation = {
      order, attempt, candidateStatus, exitCode: null, category: null, signal: null,
      ...(candidateStatus === "validated" ? { registry: image.registry, image: image.image, service: image.service } : {}),
      ...(candidateStatus === "allowlist-rejected" && candidateId ? { candidateId } : {}),
    };
    records.push(reservation);
    return { order, attempt };
  });
}

function completePullObserverAttempt(statePath, order, exitCode, category, signal) {
  updatePullObserverState(statePath, (records) => {
    const record = records.find((entry) => entry.order === order);
    if (record) Object.assign(record, { exitCode, category, signal });
  });
}

function preserveChildTermination(code, signal) {
  if (signal && safeTerminationSignals.has(signal)) {
    try {
      process.kill(process.pid, signal);
      return;
    } catch {
      const signalNumber = osConstants.signals[signal];
      process.exitCode = Number.isInteger(signalNumber) ? 128 + signalNumber : 1;
      return;
    }
  }
  process.exitCode = Number.isInteger(code) ? code : 1;
}

export async function dockerPullObserverMain(args, config) {
  if (!Array.isArray(args) || typeof config?.realDockerPath !== "string") {
    process.exitCode = 127;
    return;
  }
  const isPull = args[0] === "pull";
  const candidateArgument = args.length === 2 ? args[1] : null;
  const image = !isPull || candidateArgument === null ? null : parseSafeImageReference(candidateArgument);
  const candidateStatus = candidateArgument === null ? "format-mismatch" : (image ? "validated" : "allowlist-rejected");
  const candidateId = isPull && candidateStatus === "allowlist-rejected"
    ? pullCandidateId(config.diagnosticsPath, candidateArgument) : null;
  const reservation = isPull && (candidateStatus !== "allowlist-rejected" || candidateId)
    ? reservePullObserverAttempt(config.diagnosticsPath, candidateStatus, image, candidateId) : null;
  const child = spawn(config.realDockerPath, args, isPull
    ? { stdio: ["inherit", "pipe", "pipe"] }
    : { stdio: "inherit" });
  if (!isPull) {
    let launchFailed = false;
    child.once("error", () => { launchFailed = true; });
    child.once("close", (code, signal) => preserveChildTermination(launchFailed ? 127 : code, signal));
    return;
  }

  let captured = "";
  let launchFailed = false;
  const captureLimit = 64 * 1024;
  const capture = (chunk) => {
    if (captured.length < captureLimit) captured += chunk.toString("utf8").slice(0, captureLimit - captured.length);
  };
  child.stdout?.on("data", (chunk) => { process.stdout.write(chunk); capture(chunk); });
  child.stderr?.on("data", (chunk) => { process.stderr.write(chunk); capture(chunk); });
  child.once("error", () => { launchFailed = true; });
  const termination = await new Promise((resolveExit) => {
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  const signal = safeTerminationSignals.has(termination.signal) ? termination.signal : null;
  const exitCode = launchFailed ? 127 : (Number.isInteger(termination.code) ? termination.code : null);
  const category = launchFailed ? "docker-cli-launch-failure" : classifyDockerPullFailure(captured, exitCode);
  if (reservation) completePullObserverAttempt(config.diagnosticsPath, reservation.order, exitCode, category, signal);
  preserveChildTermination(exitCode, signal);
}

function findExecutable(name, pathValue) {
  for (const directory of String(pathValue ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      const resolved = realpathSync(candidate);
      accessSync(resolved, fsConstants.X_OK);
      return resolved;
    } catch {
      // Continue only through the caller's existing PATH entries.
    }
  }
  return null;
}

function writeDockerPullObserver(directory, diagnosticsPath, realDockerPath) {
  const shimPath = join(directory, "docker");
  const moduleUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
  const config = { realDockerPath, diagnosticsPath };
  const source = `#!/usr/bin/env node\nvoid import(${JSON.stringify(moduleUrl)}).then(({ dockerPullObserverMain }) => dockerPullObserverMain(process.argv.slice(2), ${JSON.stringify(config)})).catch(() => { process.exitCode = 127; });\n`;
  writeFileSync(shimPath, source, { mode: 0o700 });
  chmodSync(shimPath, 0o700);
  return shimPath;
}

function installDockerPullObserver(context) {
  const realDockerPath = findExecutable("docker", process.env.PATH);
  if (!realDockerPath) throw new Error("Docker pull observer unavailable; refusing to start without diagnostic coverage");
  const directory = mkdtempSync(join(context.stagedRoot, "docker-pull-observer-"));
  chmodSync(directory, 0o700);
  const diagnosticsPath = join(directory, "pull-attempts.json");
  initializePullObserverState(diagnosticsPath);
  writeDockerPullObserver(directory, diagnosticsPath, realDockerPath);
  return { path: `${directory}${delimiter}${process.env.PATH ?? ""}`, diagnosticsPath };
}

function removeTemporaryStage(stageRoot) {
  rmSync(stageRoot, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const { spawn = spawnSync, discardOutput = false, failureMessage, sqlDiagnostics = false, startDiagnostics = false, ...spawnOptions } = options;
  const commandArgs = startDiagnostics ? ["--output-format", "json", ...args] : args;
  const result = spawn(command, commandArgs, { encoding: "utf8", ...spawnOptions });
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
        const structuredErrors = structuredStartupErrors(startOutput);
        error.startupErrorCode = structuredErrors[0]?.code;
        error.startupMetadata = startupOutputMetadata(result.stdout, result.stderr, structuredErrors);
        if (structuredErrors.length > 0) {
          error.startupMetadata.source = "structured-messages";
          error.startupFailureCategory = classifyStartFailure(structuredErrors.map(({ message }) => message).join("\n"));
        } else {
          error.startupMetadata.source = "fallback-text";
          error.startupFailureCategory = classifyStartFailure(startOutput);
        }
        const imageDiagnostic = startupImageDiagnostic(startOutput);
        error.startupImageDiagnosticStatus = imageDiagnostic.status;
        error.startupImageDiagnostic = imageDiagnostic.line;
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

function supabaseCommandEnv(args, options = {}, pullObserver) {
  return {
    ...process.env,
    SUPABASE_TELEMETRY_DISABLED: "1",
    ...options.env,
    ...(args[0] === "start" ? { SUPABASE_INTERNAL_IMAGE_REGISTRY: "ghcr.io" } : {}),
    ...(pullObserver ? { PATH: pullObserver.path } : {}),
  };
}

function runSupabase(context, args, options = {}) {
  let output;
  let pullObserver;
  try {
    if (args[0] === "start") {
      if (context.startupObserverError) throw context.startupObserverError;
      pullObserver = context.startupPullObserver ?? installDockerPullObserver(context);
    }
    output = run("supabase", ["--workdir", context.stagedRoot, "--network-id", context.dockerNetworkId, ...args], {
      env: supabaseCommandEnv(args, options, pullObserver),
      stdio: "pipe",
      discardOutput: args[0] !== "status",
      failureMessage: args[0] === "start" ? safeStartFailure : `Supabase ${args[0]} failed; CLI output suppressed.`,
      sqlDiagnostics: args[0] === "test" && args[1] === "db",
      startDiagnostics: args[0] === "start",
    });
  } catch (error) {
    if (args[0] === "start") {
      error.startupMetadata = { ...error.startupMetadata, version: context.cliVersionVerification };
      const pullDiagnostics = pullObserver
        ? formatPullObserverDiagnostics(pullObserver.diagnosticsPath)
        : "Startup pull observer: unavailable; no image fields were emitted.";
      throw new Error(startupFailure(error, collectStartupContainerDiagnostics(context.projectId, context.preexistingResources), pullDiagnostics));
    }
    throw error;
  }
  if (args[0] === "start") console.log("Isolated Supabase startup completed; validating published port bindings.");
  if (args[0] === "db" && args[1] === "reset") console.log("Isolated local database reset completed.");
  if (args[0] === "test" && args[1] === "db") console.log("Staged local SQL tests passed.");
  return output;
}

const containerEventRoles = new Set([
  "postgres", "postgres-init", "auth", "auth-init", "realtime", "realtime-init", "storage", "storage-init",
  "rest", "imgproxy", "kong", "pg_meta", "studio", "functions", "analytics", "vector", "supavisor", "mailpit",
]);
const containerEventStates = new Set(["create", "start", "die"]);
const containerEventExitClasses = new Set(["success", "failure", "unavailable"]);
const maxContainerEventLineBytes = 32 * 1024;
const maxContainerEvents = 256;

function containerEventRole(event, projectId) {
  const attributes = event?.Actor?.Attributes;
  if (!attributes || attributes["com.docker.compose.project"] !== projectId) return null;
  const image = parseSafeImageReference(attributes.image);
  if (!image) return null;
  let role = image.service === "db" ? "postgres" : image.service;
  const imageIsCli = image.image.startsWith("supabase/cli/");
  const name = typeof attributes.name === "string" ? attributes.name.replace(/^\//, "") : "";
  const expectedSuffix = `_${projectId}`;
  const projectIndex = name.lastIndexOf(expectedSuffix);
  const afterProject = projectIndex < 0 ? null : name.slice(projectIndex + expectedSuffix.length);
  if (name.startsWith("supabase_") && projectIndex > "supabase_".length
    && afterProject !== null && /^(?:-[1-9]\d*)?$/.test(afterProject)) {
    const serviceName = name.slice("supabase_".length, projectIndex);
    const initRole = /^(auth|realtime|storage)(?:_migrations?|_init|_setup)$/.exec(serviceName)?.[1];
    if (initRole) role = `${initRole}-init`;
    if (/^(?:db|postgres)(?:_migrations?|_init|_setup)$/.test(serviceName)) role = "postgres-init";
  }
  if (imageIsCli && ["postgres", "auth", "realtime", "storage"].includes(role)) role = `${role}-init`;
  return containerEventRoles.has(role) ? role : null;
}

function acceptContainerEvent(observer, line) {
  if (!line) return;
  if (Buffer.byteLength(line) > maxContainerEventLineBytes || observer.eventCount >= maxContainerEvents) {
    observer.complete = false;
    observer.stopReading = true;
    observer.response?.destroy();
    return;
  }
  let event;
  try { event = JSON.parse(line); } catch {
    observer.complete = false;
    return;
  }
  if (event?.Type !== "container") return;
  const attributes = event?.Actor?.Attributes;
  if (attributes?.["com.docker.compose.project"] !== observer.projectId) {
    observer.complete = false;
    return;
  }
  if (!containerEventStates.has(event.Action)) return;
  const role = containerEventRole(event, observer.projectId);
  if (!role) {
    observer.complete = false;
    return;
  }
  let exitClass = "unavailable";
  if (event.Action === "die") {
    const rawExitCode = attributes.exitCode;
    if (typeof rawExitCode === "string" && /^\d{1,3}$/.test(rawExitCode)) {
      exitClass = Number(rawExitCode) === 0 ? "success" : "failure";
    } else {
      observer.complete = false;
    }
  }
  const key = `${role}\t${event.Action}\t${exitClass}`;
  observer.counts.set(key, (observer.counts.get(key) ?? 0) + 1);
  observer.eventCount += 1;
}

function formatContainerEventSummary(observer, complete = observer.complete) {
  const lines = [`Docker container events: observation=${complete ? "complete" : "incomplete"}`];
  for (const [key, count] of [...observer.counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [role, state, exitClass] = key.split("\t");
    if (!containerEventRoles.has(role) || !containerEventStates.has(state) || !containerEventExitClasses.has(exitClass)) continue;
    lines.push(`Docker container event: role=${role} state=${state}${state === "die" ? ` exit=${exitClass}` : ""} count=${count}`);
  }
  return lines.join("\n");
}

async function startDockerContainerEventObserver(projectId, { socketPath = "/var/run/docker.sock", apiVersion, request = httpRequest } = {}) {
  if (!/^pr1-[0-9]+-[a-f0-9]{12}$/.test(projectId)) throw new Error("Docker container event observer refused an invalid isolated project identity");
  if (!/^\d+\.\d+$/.test(apiVersion ?? "")) throw new Error("Docker container event observer could not verify the Engine API version");
  const filters = encodeURIComponent(JSON.stringify({ type: ["container"], label: [`com.docker.compose.project=${projectId}`] }));
  const observer = {
    projectId, counts: new Map(), eventCount: 0, complete: true, ready: false, stopping: false, stopReading: false,
    lastActivity: Date.now(), pending: "", response: null, request: null,
  };
  await new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectReady(error);
      else resolveReady();
    };
    const timer = setTimeout(() => {
      observer.complete = false;
      observer.request?.destroy();
      finish(new Error("Docker container event subscription was not ready"));
    }, 5000);
    try {
      observer.request = request({
        socketPath,
        path: `/v${apiVersion}/events?filters=${filters}`,
        method: "GET",
        headers: { Accept: "application/json" },
      }, (response) => {
        observer.response = response;
        if (response.statusCode !== 200) {
          observer.complete = false;
          response.resume();
          finish(new Error("Docker container event subscription was rejected"));
          return;
        }
        observer.ready = true;
        response.on("data", (chunk) => {
          observer.lastActivity = Date.now();
          if (observer.stopReading) return;
          observer.pending += chunk.toString("utf8");
          if (Buffer.byteLength(observer.pending) > maxContainerEventLineBytes && !observer.pending.includes("\n")) {
            observer.complete = false;
            observer.stopReading = true;
            response.destroy();
            return;
          }
          let newline;
          while ((newline = observer.pending.indexOf("\n")) !== -1) {
            const line = observer.pending.slice(0, newline).trim();
            observer.pending = observer.pending.slice(newline + 1);
            acceptContainerEvent(observer, line);
            if (observer.stopReading) break;
          }
          if (Buffer.byteLength(observer.pending) > maxContainerEventLineBytes) {
            observer.complete = false;
            observer.stopReading = true;
            response.destroy();
          }
        });
        response.on("end", () => {
          if (!observer.stopping) observer.complete = false;
          if (!settled) finish(new Error("Docker container event subscription ended before readiness"));
        });
        response.on("error", () => {
          if (!observer.stopping) observer.complete = false;
          if (!settled) finish(new Error("Docker container event subscription failed"));
        });
        response.on("close", () => {
          if (!observer.stopping) observer.complete = false;
        });
        finish();
      });
      observer.request.on("error", () => {
        if (!observer.stopping) observer.complete = false;
        if (!settled) finish(new Error("Docker container event subscription failed"));
      });
      observer.request.end();
    } catch {
      observer.complete = false;
      finish(new Error("Docker container event subscription failed"));
    }
  });
  return observer;
}

async function stopDockerContainerEventObserver(observer) {
  if (!observer) return "Docker container events: observation=incomplete";
  // Startup runs through synchronous child processes; let queued HTTP event callbacks drain before closing the stream.
  observer.lastActivity = Date.now();
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && Date.now() - observer.lastActivity < 200) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  if (Date.now() >= deadline) observer.complete = false;
  if (observer.pending.trim()) observer.complete = false;
  if (observer.eventCount === 0 || !observer.ready || observer.stopReading) observer.complete = false;
  observer.stopping = true;
  observer.response?.destroy();
  observer.request?.destroy();
  return formatContainerEventSummary(observer);
}

function verifyDockerEventsSocket() {
  if (process.env.DOCKER_HOST) throw new Error("Docker container event observer requires the verified local Unix socket");
  try {
    if (run("docker", ["context", "show"]).trim() !== "default"
      || run("docker", ["context", "inspect", "default", "--format", "{{.Endpoints.docker.Host}}"]).trim() !== "unix:///var/run/docker.sock") {
      throw new Error("Docker context mismatch");
    }
    const apiVersion = run("docker", ["version", "--format", "{{.Server.APIVersion}}"])
      .trim();
    if (!/^\d+\.\d+$/.test(apiVersion)) throw new Error("Docker API version unavailable");
    return apiVersion;
  } catch {
    throw new Error("Docker container event observer could not verify the isolated Docker socket");
  }
}

async function runContainerEventObserverSelfTests() {
  const testRoot = mkdtempSync(join(tmpdir(), "pr1-docker-container-events-self-test-"));
  const socketPath = join("/tmp", `pr1-docker-events-${process.pid}-${randomBytes(4).toString("hex")}.sock`);
  const projectId = "pr1-1234567890123-abcdef123456";
  let activeResponse;
  let requestValid = false;
  const server = createHttpServer((request, response) => {
    const query = new URL(request.url, "http://docker.local");
    const parsed = JSON.parse(query.searchParams.get("filters") ?? "{}");
    requestValid = query.pathname === "/v1.47/events"
      && parsed.type?.length === 1 && parsed.type[0] === "container"
      && parsed.label?.length === 1 && parsed.label[0] === `com.docker.compose.project=${projectId}`;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.flushHeaders();
    activeResponse = response;
  });
  try {
    chmodSync(testRoot, 0o700);
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(socketPath, resolveListen);
    });
    const observer = await startDockerContainerEventObserver(projectId, { socketPath, apiVersion: "1.47" });
    assert.equal(observer.ready, true);
    assert.equal(requestValid, true);
    const makeEvent = (action, service, image, extra = {}) => JSON.stringify({
      Type: "container", Action: action, Actor: { ID: "sensitive-id", Attributes: {
        name: `supabase_${service}_${projectId}`, image, "com.docker.compose.project": projectId,
        private: "hidden-value", url: "https://private.invalid/hidden", ...extra,
      } },
    });
    for (const [service, image, role] of [
      ["db", "ghcr.io/supabase/postgres:17.11.0.002", "postgres"],
      ["realtime_migrations", "ghcr.io/supabase/cli/realtime:2.119.0", "realtime-init"],
      ["storage_migrations", "ghcr.io/supabase/cli/storage:2.119.0", "storage-init"],
      ["auth_migrations", "ghcr.io/supabase/cli/auth:2.119.0", "auth-init"],
    ]) {
      activeResponse.write(`${makeEvent("create", service, image)}\n`);
      activeResponse.write(`${makeEvent("start", service, image)}\n`);
      if (service === "auth_migrations") activeResponse.write(`${makeEvent("die", service, image, { exitCode: "17" })}\n`);
      assert.ok(containerEventRoles.has(role));
    }
    const summary = await stopDockerContainerEventObserver(observer);
    assert.match(summary, /observation=complete/);
    assert.match(summary, /role=postgres state=create count=1/);
    assert.match(summary, /role=realtime-init state=start count=1/);
    assert.match(summary, /role=storage-init state=create count=1/);
    assert.match(summary, /role=auth-init state=die exit=failure count=1/);
    assert.doesNotMatch(summary, /sensitive-id|hidden-value|private\.invalid|17\.11\.0|2\.119\.0|sha256|https?:\/\//i);

    const delayedObserver = await startDockerContainerEventObserver(projectId, { socketPath, apiVersion: "1.47" });
    setTimeout(() => activeResponse.write(`${makeEvent("start", "db", "ghcr.io/supabase/postgres:17.11.0.002")}\n`), 10);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350);
    const delayedSummary = await stopDockerContainerEventObserver(delayedObserver);
    assert.match(delayedSummary, /observation=complete/);
    assert.match(delayedSummary, /role=postgres state=start count=1/);
    assert.doesNotMatch(delayedSummary, /sensitive-id|hidden-value|private\.invalid|17\.11\.0|2\.119\.0|sha256|https?:\/\//i);

    const emptyObserver = await startDockerContainerEventObserver(projectId, { socketPath, apiVersion: "1.47" });
    const emptySummary = await stopDockerContainerEventObserver(emptyObserver);
    assert.match(emptySummary, /observation=incomplete/);
  } finally {
    activeResponse?.destroy();
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(socketPath, { force: true });
    removeTemporaryStage(testRoot);
  }
}

async function runDockerPullObserverSelfTests() {
  const testRoot = mkdtempSync(join(tmpdir(), "pr1-docker-pull-observer-self-test-"));
  try {
    chmodSync(testRoot, 0o700);
    const fakeDocker = join(testRoot, "fake-docker");
    const shimDirectory = mkdtempSync(join(testRoot, "shim-"));
    const diagnosticsPath = join(testRoot, "pull-attempts.json");
    const callsPath = join(testRoot, "calls.jsonl");
    initializePullObserverState(diagnosticsPath);
    writeFileSync(callsPath, "", { mode: 0o600 });
    writeFileSync(fakeDocker, `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.FAKE_DOCKER_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
const finish = () => {
  const stdout = process.env.FAKE_DOCKER_STDOUT ?? "fake docker stdout\\n";
  const stderr = process.env.FAKE_DOCKER_STDERR ?? "fake docker stderr\\n";
  if (process.env.FAKE_DOCKER_SIGNAL) {
    let pendingWrites = 2;
    const terminate = () => { if (--pendingWrites === 0) process.kill(process.pid, process.env.FAKE_DOCKER_SIGNAL); };
    process.stdout.write(stdout, terminate);
    process.stderr.write(stderr, terminate);
  } else {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    process.exit(Number(process.env.FAKE_DOCKER_EXIT ?? 0));
  }
};
const delay = Number(process.env.FAKE_DOCKER_DELAY_MS ?? 0);
if (delay > 0) setTimeout(finish, delay); else finish();
`, { mode: 0o700 });
    chmodSync(fakeDocker, 0o700);
    const shim = writeDockerPullObserver(shimDirectory, diagnosticsPath, fakeDocker);
    const invoke = (args, env = {}) => spawnSync(shim, args, {
      encoding: "utf8", env: { ...process.env, FAKE_DOCKER_CALLS: callsPath, ...env },
    });
    const invokeAsync = (args, env = {}) => new Promise((resolveResult, rejectResult) => {
      const child = spawn(shim, args, { env: { ...process.env, FAKE_DOCKER_CALLS: callsPath, ...env }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", rejectResult);
      child.once("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
    });
    const waitForCallCount = async (expectedCount) => {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const content = readFileSync(callsPath, "utf8").trim();
        if (content && content.split(/\r?\n/).length >= expectedCount) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
      assert.fail(`Timed out waiting for ${expectedCount} synthetic Docker invocation(s)`);
    };

    const firstDigest = `@sha256:${"a".repeat(64)}`;
    const first = `ghcr.io/supabase/postgres:15.8.1${firstDigest}`;
    const second = "docker.io/library/kong:2.8.1";
    for (const [candidate, stderr] of [
      [first, "429 Too Many Requests token=rate-secret"],
      [second, "unauthorized password=auth-secret"],
      [first, "TLS handshake timeout authorization=network-secret"],
    ]) {
      const result = invoke(["pull", candidate], {
        FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_STDOUT: "progress url=https://user:pull-secret@example.invalid/",
        FAKE_DOCKER_STDERR: stderr,
      });
      assert.equal(result.status, 1);
    }
    let records = readPullObserverRecords(diagnosticsPath);
    assert.deepEqual(records.map(({ order, attempt, registry, image, service, exitCode, category, signal }) =>
      ({ order, attempt, registry, image, service, exitCode, category, signal })), [
      { order: 1, attempt: 1, registry: "ghcr.io", image: "supabase/postgres", service: "db", exitCode: 1, category: "image-pull-rate-limit", signal: null },
      { order: 2, attempt: 1, registry: "docker.io", image: "library/kong", service: "kong", exitCode: 1, category: "image-pull-authentication", signal: null },
      { order: 3, attempt: 2, registry: "ghcr.io", image: "supabase/postgres", service: "db", exitCode: 1, category: "network-timeout", signal: null },
    ]);
    const safePulls = formatPullObserverDiagnostics(diagnosticsPath);
    assert.match(safePulls, /order=1 attempt=1 registry=ghcr\.io image=supabase\/postgres service=db exit_code=1 detail=image-pull-rate-limit/);
    assert.match(safePulls, /order=2 attempt=1 registry=docker\.io image=library\/kong service=kong exit_code=1 detail=image-pull-authentication/);
    assert.match(safePulls, /order=3 attempt=2 registry=ghcr\.io image=supabase\/postgres service=db exit_code=1 detail=network-timeout/);
    assert.doesNotMatch(safePulls, /15\.8\.1|sha256/i);
    assert.doesNotMatch(safePulls, /sha256|rate-secret|auth-secret|network-secret|pull-secret|authorization=|https?:\/\//i);
    const storedDiagnostics = readFileSync(diagnosticsPath, "utf8");
    assert.doesNotMatch(storedDiagnostics, /sha256|rate-secret|auth-secret|network-secret|pull-secret|authorization=|https?:\/\//i);

    const callsBeforeConcurrentPulls = readFileSync(callsPath, "utf8").trim().split(/\r?\n/).length;
    const firstConcurrent = invokeAsync(["pull", "ghcr.io/supabase/postgres:15.8.1"], {
      FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_DELAY_MS: "120", FAKE_DOCKER_STDERR: "429 Too Many Requests concurrent-one-secret",
    });
    await waitForCallCount(callsBeforeConcurrentPulls + 1);
    const secondConcurrent = invokeAsync(["pull", "ghcr.io/supabase/postgres:15.8.1"], {
      FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_DELAY_MS: "10", FAKE_DOCKER_STDERR: "unauthorized concurrent-two-secret",
    });
    const concurrentResults = await Promise.all([firstConcurrent, secondConcurrent]);
    assert.deepEqual(concurrentResults.map((result) => result.code), [1, 1]);
    const concurrentRecords = readPullObserverRecords(diagnosticsPath).slice(records.length, records.length + 2);
    assert.deepEqual(concurrentRecords.map(({ order, attempt, category }) => ({ order, attempt, category })), [
      { order: records.length + 1, attempt: 3, category: "image-pull-rate-limit" },
      { order: records.length + 2, attempt: 4, category: "image-pull-authentication" },
    ]);
    assert.doesNotMatch(formatPullObserverDiagnostics(diagnosticsPath), /concurrent-one-secret|concurrent-two-secret/);
    assert.doesNotMatch(readdirSync(testRoot).join("\n"), /\.lock|\.tmp/);

    const categoryCases = [
      ["requested access to the resource is denied", "image-pull-authentication"],
      ["manifest unknown", "image-unavailable"],
      ["connection reset by peer", "network-timeout"],
      ["unexpected private error token=classification-secret", "unclassified-pull-failure"],
    ];
    for (const [stderr, category] of categoryCases) {
      const result = invoke(["pull", "ghcr.io/supabase/gotrue:v2.197.0"], {
        FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_STDOUT: "", FAKE_DOCKER_STDERR: stderr,
      });
      assert.equal(result.status, 1);
      assert.equal(readPullObserverRecords(diagnosticsPath).at(-1).category, category);
    }
    const success = invoke(["pull", "ghcr.io/supabase/realtime:v2.197.0"], {
      FAKE_DOCKER_EXIT: "0", FAKE_DOCKER_STDOUT: "pull-complete", FAKE_DOCKER_STDERR: "",
    });
    assert.equal(success.status, 0);
    assert.equal(readPullObserverRecords(diagnosticsPath).at(-1).category, "success");

    const malicious = "https://user:top-secret@evil.invalid/supabase/postgres:15.8.1?token=secret-value";
    const expectedRejectedOrder = readPullObserverRecords(diagnosticsPath).length + 1;
    const rejected = invoke(["pull", malicious], {
      FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_STDOUT: "", FAKE_DOCKER_STDERR: "unauthorized password=secret-value",
    });
    assert.equal(rejected.status, 1);
    const rejectedRecord = readPullObserverRecords(diagnosticsPath).at(-1);
    assert.deepEqual({ ...rejectedRecord, candidateId: "<opaque>" }, {
      order: expectedRejectedOrder, attempt: 1,
      candidateStatus: "allowlist-rejected", exitCode: 1, category: "image-pull-authentication",
      signal: null, candidateId: "<opaque>",
    });
    assert.match(rejectedRecord.candidateId, /^[a-f0-9]{24}$/);
    assert.doesNotMatch(readFileSync(diagnosticsPath, "utf8"), /evil\.invalid|top-secret|secret-value|sha256|token=/i);
    assert.doesNotMatch(formatPullObserverDiagnostics(diagnosticsPath), /evil\.invalid|top-secret|secret-value|token=|password=/i);
    for (const unsafeTag of ["15.8.1-secret-tag", "15.8.1-ghp_credentialLikeToken123"]) {
      const result = invoke(["pull", `ghcr.io/supabase/postgres:${unsafeTag}`], {
        FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_STDOUT: "", FAKE_DOCKER_STDERR: "image unavailable",
      });
      assert.equal(result.status, 1);
    }
    const afterUnsafeTags = formatPullObserverDiagnostics(diagnosticsPath);
    assert.doesNotMatch(afterUnsafeTags, /secret-tag|ghp_|credentialLikeToken123|15\.8\.1/);
    assert.doesNotMatch(readFileSync(diagnosticsPath, "utf8"), /secret-tag|ghp_|credentialLikeToken123|15\.8\.1/);
    const unknownReference = invoke(["pull", "ghcr.io/untrusted/private-package:latest"], {
      FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_STDOUT: "", FAKE_DOCKER_STDERR: "unauthorized",
    });
    assert.equal(unknownReference.status, 1);
    const unknownRecord = readPullObserverRecords(diagnosticsPath).at(-1);
    assert.equal(unknownRecord.candidateStatus, "allowlist-rejected");
    assert.notEqual(unknownRecord.candidateId, rejectedRecord.candidateId);
    assert.doesNotMatch(formatPullObserverDiagnostics(diagnosticsPath), /untrusted|private-package/);
    const unknownRetry = invoke(["pull", "ghcr.io/untrusted/private-package:latest"], {
      FAKE_DOCKER_EXIT: "0", FAKE_DOCKER_STDOUT: "pull-complete", FAKE_DOCKER_STDERR: "",
    });
    assert.equal(unknownRetry.status, 0);
    const retriedRecord = readPullObserverRecords(diagnosticsPath).at(-1);
    assert.equal(retriedRecord.candidateId, unknownRecord.candidateId);
    assert.equal(retriedRecord.attempt, 2);
    assert.equal(retriedRecord.category, "success");
    assert.match(formatPullObserverDiagnostics(diagnosticsPath), new RegExp(`candidate=allowlist-rejected candidate_id=${unknownRecord.candidateId} exit_code=0 detail=success`));

    const callsBeforeUnknownConcurrent = readFileSync(callsPath, "utf8").trim().split(/\r?\n/).length;
    const concurrentCandidate = "ghcr.io/untrusted/concurrent-private:secret-tag";
    const unknownConcurrentFailure = invokeAsync(["pull", concurrentCandidate], {
      FAKE_DOCKER_EXIT: "1", FAKE_DOCKER_DELAY_MS: "120", FAKE_DOCKER_STDERR: "429 Too Many Requests concurrent-private-secret",
    });
    await waitForCallCount(callsBeforeUnknownConcurrent + 1);
    const unknownConcurrentSuccess = invokeAsync(["pull", concurrentCandidate], {
      FAKE_DOCKER_EXIT: "0", FAKE_DOCKER_DELAY_MS: "10", FAKE_DOCKER_STDERR: "",
    });
    assert.deepEqual((await Promise.all([unknownConcurrentFailure, unknownConcurrentSuccess])).map((result) => result.code), [1, 0]);
    const unknownConcurrentRecords = readPullObserverRecords(diagnosticsPath).slice(-2);
    assert.deepEqual(unknownConcurrentRecords.map(({ attempt, category }) => ({ attempt, category })), [
      { attempt: 1, category: "image-pull-rate-limit" }, { attempt: 2, category: "success" },
    ]);
    assert.equal(unknownConcurrentRecords[0].candidateId, unknownConcurrentRecords[1].candidateId);
    assert.notEqual(unknownConcurrentRecords[0].candidateId, unknownRecord.candidateId);
    assert.doesNotMatch(formatPullObserverDiagnostics(diagnosticsPath), /concurrent-private|secret-tag|private-package|concurrent-private-secret/);
    assert.doesNotMatch(readFileSync(diagnosticsPath, "utf8"), /concurrent-private|secret-tag|private-package|concurrent-private-secret/);
    assert.doesNotMatch(readdirSync(testRoot).join("\n"), /\.lock|\.tmp/);

    const separateDiagnosticsPath = join(testRoot, "separate-pull-attempts.json");
    initializePullObserverState(separateDiagnosticsPath);
    assert.notEqual(pullCandidateId(separateDiagnosticsPath, concurrentCandidate), unknownConcurrentRecords[0].candidateId);
    const originalState = readFileSync(diagnosticsPath, "utf8");
    const tamperedEnvelope = JSON.parse(originalState);
    tamperedEnvelope.records.at(-1).candidateId = "e".repeat(24);
    writeFileSync(diagnosticsPath, JSON.stringify(tamperedEnvelope), { mode: 0o600 });
    assert.match(formatPullObserverDiagnostics(diagnosticsPath), /diagnostics unavailable/);
    assert.equal(invoke(["pull", concurrentCandidate], { FAKE_DOCKER_EXIT: "0" }).status, 0);
    assert.match(formatPullObserverDiagnostics(diagnosticsPath), /diagnostics unavailable/);
    writeFileSync(diagnosticsPath, originalState, { mode: 0o600 });
    assert.notEqual(readPullObserverRecords(diagnosticsPath), null);

    const callCountBeforePassthrough = readFileSync(callsPath, "utf8").trim().split(/\r?\n/).length;
    const passthroughArgs = ["version", "--format", "{{.Client.Version}}", "opaque-arg"];
    const passthrough = invoke(passthroughArgs, {
      FAKE_DOCKER_EXIT: "23", FAKE_DOCKER_STDOUT: "passthrough stdout marker", FAKE_DOCKER_STDERR: "passthrough stderr marker",
    });
    assert.equal(passthrough.status, 23);
    assert.equal(passthrough.stdout, "passthrough stdout marker");
    assert.equal(passthrough.stderr, "passthrough stderr marker");
    const calls = readFileSync(callsPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(calls.length, callCountBeforePassthrough + 1);
    assert.deepEqual(calls.at(-1), passthroughArgs);
    const recordCountBeforeSignals = readPullObserverRecords(diagnosticsPath).length;
    const missingDockerPath = join(testRoot, "missing-docker-executable");
    const launchDiagnosticsPath = join(testRoot, "launch-failure.json");
    const missingShimDirectory = mkdtempSync(join(testRoot, "missing-shim-"));
    initializePullObserverState(launchDiagnosticsPath);
    const missingDockerShim = writeDockerPullObserver(missingShimDirectory, launchDiagnosticsPath, missingDockerPath);

    const nonPullLaunchFailure = spawnSync(missingDockerShim, passthroughArgs, {
      encoding: "utf8", env: { ...process.env, FAKE_DOCKER_CALLS: callsPath },
    });
    assert.equal(nonPullLaunchFailure.status, 127);
    assert.notEqual(nonPullLaunchFailure.status, 254);
    assert.doesNotMatch(nonPullLaunchFailure.stderr, /ENOENT|missing-docker|spawn /);
    assert.deepEqual(readPullObserverRecords(launchDiagnosticsPath), []);
    assert.equal(readPullObserverRecords(diagnosticsPath).length, recordCountBeforeSignals);

    const nonPullSignal = invoke(["version"], {
      FAKE_DOCKER_SIGNAL: "SIGTERM", FAKE_DOCKER_STDOUT: "", FAKE_DOCKER_STDERR: "",
    });
    assert.equal(nonPullSignal.signal, "SIGTERM");
    const pullSignal = invoke(["pull", "ghcr.io/supabase/postgres:15.8.1"], {
      FAKE_DOCKER_SIGNAL: "SIGTERM", FAKE_DOCKER_STDOUT: "", FAKE_DOCKER_STDERR: "unauthorized signal-secret",
    });
    assert.equal(pullSignal.signal, "SIGTERM");
    const signalRecord = readPullObserverRecords(diagnosticsPath).at(-1);
    assert.equal(signalRecord.exitCode, null);
    assert.equal(signalRecord.signal, "SIGTERM");
    assert.equal(signalRecord.category, "image-pull-authentication");
    assert.match(formatPullObserverDiagnostics(diagnosticsPath), /exit_code=unavailable signal=SIGTERM detail=image-pull-authentication/);
    assert.doesNotMatch(formatPullObserverDiagnostics(diagnosticsPath), /signal-secret/);
    assert.equal(readPullObserverRecords(diagnosticsPath).length, recordCountBeforeSignals + 1);

    const launchFailure = spawnSync(missingDockerShim, ["pull", "ghcr.io/supabase/postgres:15.8.1"], {
      encoding: "utf8", env: { ...process.env, FAKE_DOCKER_CALLS: callsPath },
    });
    assert.equal(launchFailure.status, 127);
    assert.equal(readPullObserverRecords(launchDiagnosticsPath).at(-1).category, "docker-cli-launch-failure");
    assert.doesNotMatch(launchFailure.stderr, /ENOENT|missing-docker|spawn /);
    assert.doesNotMatch(readdirSync(testRoot).join("\n"), /\.lock|\.tmp/);

    const stagedRuntimeRoot = mkdtempSync(join(testRoot, "runtime-stage-"));
    const fakeBin = mkdtempSync(join(testRoot, "fake-bin-"));
    const fakeDockerOnPath = join(fakeBin, "docker");
    cpSync(fakeDocker, fakeDockerOnPath);
    chmodSync(fakeDockerOnPath, 0o700);
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = fakeBin;
      const installedObserver = installDockerPullObserver({ stagedRoot: stagedRuntimeRoot });
      assert.equal(installedObserver.path.split(delimiter).slice(1).join(delimiter), fakeBin);
      assert.equal(process.env.PATH, fakeBin);
      assert.equal(existsSync(installedObserver.diagnosticsPath), true);
      assert.equal(existsSync(join(installedObserver.path.split(delimiter)[0], "docker")), true);
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      removeTemporaryStage(stagedRuntimeRoot);
    }
    assert.equal(existsSync(stagedRuntimeRoot), false);

    const finalFailure = startupFailure({
      startupFailureCategory: "image-pull-authentication", startupExitCode: 1,
      startupImageDiagnosticStatus: "not-found",
    }, "Startup containers: none created or ownership could not be established.", formatPullObserverDiagnostics(diagnosticsPath));
    assert.doesNotMatch(finalFailure, /rate-secret|auth-secret|network-secret|pull-secret|classification-secret|secret-value|top-secret|evil\.invalid|sha256|passthrough/);
  } finally {
    removeTemporaryStage(testRoot);
    assert.equal(existsSync(testRoot), false);
  }
}

async function runSecuritySelfTests() {
  // All assertions below expose only booleans or fixed enums on failure.
  const secret = "diagnostic-private-marker";
  const jsonError = (code, message = "address already in use", includeCode = true) => JSON.stringify({
    _tag: "Error", error: { ...(includeCode ? { code } : {}), message },
  });
  const formatCases = [
    ["", "empty"], [" \n\t", "empty"], ["plain text", "non-json"],
    ['{}', "json-lines"], ['{}\n[]', "json-lines"], ['{}\nnoise', "mixed"],
    ['{\n  "value": true\n}', "multiline-json"], ['\n {}\n \n[]\n', "json-lines"],
  ];
  for (const [input, expected] of formatCases) assert.equal(startupOutputFormat(input).format, expected);
  const accepted = structuredStartupErrors(jsonError("ImagePrepullError"));
  assert.equal(startupOutputMetadata('{}', 'plain', []).stdout, "json-lines");
  assert.equal(startupOutputMetadata('{}', 'plain', []).stderr, "non-json");
  assert.equal(startupOutputMetadata(undefined, undefined, []).shape, "unavailable");
  assert.equal(startupOutputMetadata(undefined, undefined, []).code, "unavailable");
  assert.equal(startupOutputMetadata('', '', []).shape, "no-json");
  assert.equal(startupOutputMetadata(jsonError("ImagePrepullError"), '', accepted).shape, "matched");
  for (const input of ['{}', '{"_tag":"Other","error":{"message":"x"}}',
    '{"type":"error","error":{}}', '{"type":"error","error":{"message":1}}',
    JSON.stringify({ _tag: "Error", error: { message: "x" } }, null, 2)]) {
    const errors = structuredStartupErrors(input);
    assert.equal(errors.length, 0);
    const metadata = startupOutputMetadata(input, '', errors);
    assert.equal(metadata.shape, "json-shape-mismatch");
    assert.equal(metadata.code, "no-matched-error");
  }
  assert.equal(structuredStartupErrors('{"type":"error","error":{"message":"x"}}').length, 1);
  for (const [input, expected] of [
    [jsonError("ImagePrepullError"), "allowlisted"],
    [jsonError(undefined, "x", false), "missing"], [jsonError(null), "invalid-type"],
    [jsonError(123), "invalid-type"], [jsonError(secret), "not-allowlisted"],
    [jsonError(secret) + "\n" + jsonError("ImagePrepullError"), "not-allowlisted"],
    [jsonError("ImagePrepullError") + "\n" + jsonError(secret), "allowlisted"],
  ]) assert.equal(startupOutputMetadata(input, '', structuredStartupErrors(input)).code, expected);
  const dbSetupJson = JSON.stringify({ _tag: "Error", error: {
    code: "DbSetupError", reason: "registry_pull", message: `private ${secret}`,
  } });
  const dbSetupErrors = structuredStartupErrors(dbSetupJson);
  const dbSetupMetadata = startupOutputMetadata(dbSetupJson, "", dbSetupErrors);
  assert.equal(dbSetupErrors[0]?.code, "DbSetupError");
  assert.equal(dbSetupErrors[0]?.setupReason, "registry_pull");
  assert.equal(dbSetupMetadata.setupReason, "registry_pull");
  assert.match(safeStartupMetadata(dbSetupMetadata), /Supabase DB setup reason: registry_pull/);
  assert.doesNotMatch(safeStartupMetadata(dbSetupMetadata), new RegExp(secret));
  let dbSetupFailure;
  try { run("supabase", ["start"], {
    spawn: () => ({ status: 1, stdout: dbSetupJson, stderr: "" }), failureMessage: safeStartFailure, startDiagnostics: true,
  }); } catch (error) { dbSetupFailure = error; }
  const safeDbSetupFailure = startupFailure(dbSetupFailure, "");
  assert.match(safeDbSetupFailure, /Supabase CLI error code: DbSetupError/);
  assert.match(safeDbSetupFailure, /Supabase DB setup reason: registry_pull/);
  assert.doesNotMatch(safeDbSetupFailure, new RegExp(secret));
  const invalidDbSetupJson = JSON.stringify({ _tag: "Error", error: {
    code: "DbSetupError", reason: `${secret}-reason`, message: `private ${secret}`,
  } });
  const invalidDbSetupMetadata = startupOutputMetadata(invalidDbSetupJson, "", structuredStartupErrors(invalidDbSetupJson));
  assert.equal(invalidDbSetupMetadata.setupReason, "unavailable");
  assert.match(safeStartupMetadata(invalidDbSetupMetadata), /Supabase DB setup reason: unavailable/);
  assert.doesNotMatch(safeStartupMetadata(invalidDbSetupMetadata), new RegExp(secret));
  const nonDbSetupJson = JSON.stringify({ _tag: "Error", error: {
    code: "ImagePrepullError", reason: "registry_pull", message: "private message",
  } });
  assert.equal(startupOutputMetadata(nonDbSetupJson, "", structuredStartupErrors(nonDbSetupJson)).setupReason, "unavailable");
  for (const [stdout, stderr, source, category] of [
    [jsonError(secret + "-code", "address already in use " + secret + "-body"), "unauthorized " + secret + "-stderr", "structured-messages", "port-allocation"],
    ["unauthorized " + secret, "", "fallback-text", "image-pull-authentication"],
    [JSON.stringify({ unknown: secret + "-field", url: "https://example.invalid/?token=" + secret + "-url" }), "TLS handshake timeout", "fallback-text", "network-timeout"],
  ]) {
    let caught;
    try { run("supabase", ["start"], {
      spawn: () => ({ status: 1, stdout, stderr }), failureMessage: safeStartFailure, startDiagnostics: true,
    }); } catch (error) { caught = error; }
    assert.equal(Boolean(caught), true);
    assert.equal(caught.startupMetadata.source, source);
    assert.equal(caught.startupFailureCategory, category);
    assert.equal(startupFailure(caught, "").includes(secret), false);
  }
  assert.throws(() => run("supabase", ["start"], {
    spawn: () => ({ error: new Error(secret) }), failureMessage: safeStartFailure, startDiagnostics: true,
  }), (error) => startupFailure(error, "").includes("Startup classification source: unavailable")
    && !startupFailure(error, "").includes(secret));
  const { EventEmitter } = await import("node:events");
  const probeEnv = { PATH: "/diagnostic/mock-only" };
  const fakeVersion = (output, status = 0, mode = "close") => (_command, args, options) => {
    assert.equal(_command, "supabase");
    assert.deepEqual(args, ["--version"]);
    assert.equal(options.env === probeEnv, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => true;
    Promise.resolve().then(() => {
      child.stdout.emit("data", Buffer.from(output));
      child.stderr.emit("data", Buffer.from(secret));
      if (mode === "error") child.emit("error", new Error(secret));
      else if (mode !== "timeout") child.emit("close", status);
    });
    return child;
  };
  for (const [output, status, mode, expected] of [
    ["2.119.0\n", 0, "close", "expected"], ["2.120.0", 0, "close", "different"],
    [secret + "-version", 0, "close", "unparseable"], [secret, 1, "close", "probe-failed"],
    [secret, 0, "error", "probe-failed"], [secret, 0, "timeout", "probe-failed"],
  ]) {
    const version = await probeCliVersion(probeEnv, fakeVersion(output, status, mode), 10);
    assert.equal(version, expected);
    assert.equal(safeStartupMetadata({ version }).includes(secret), false);
    // Probe result is metadata only; run's success/failure decision is unchanged.
    assert.equal(run("supabase", ["start"], { spawn: () => ({ status: 0, stdout: "" }) }), "");
    let failed;
    try { run("supabase", ["start"], {
      spawn: () => ({ status: 1, stdout: "unauthorized", stderr: "" }),
      failureMessage: safeStartFailure, startDiagnostics: true,
    }); } catch (error) { failed = error; }
    assert.equal(Boolean(failed), true);
    failed.startupMetadata.version = version;
    assert.equal(failed.startupFailureCategory, "image-pull-authentication");
    assert.equal(startupFailure(failed, "").includes(secret), false);
  }
  assert.equal(await probeCliVersion(probeEnv, () => { throw new Error(secret); }), "probe-failed");
  const unsafeMetadata = Object.fromEntries(Object.keys(startupDiagnosticEnums).map((key) => [key, secret]));
  for (const metadata of [unsafeMetadata, {}, ...Object.entries(startupDiagnosticEnums).flatMap(([key, values]) => values.map((value) => ({ [key]: value })))]) {
    const safe = safeStartupMetadata(metadata);
    assert.equal(safe.includes(secret), false);
    safe.split("\n").forEach((line, index) => {
      assert.equal(Object.values(startupDiagnosticEnums)[index].includes(line.split(": ")[1]), true);
    });
  }
  const workflow = readFileSync(resolve(utilityDir, "../../../.github/workflows/pr-validation.yml"), "utf8");
  assert.match(workflow, /version:\s*2\.119\.0\s*$/m);
  assert.equal(verifiedSupabaseImages.length, 12);
  assert.equal(new Set(verifiedSupabaseImages.map(({ target }) => target)).size, verifiedSupabaseImages.length);
  for (const { repository, source, target } of verifiedSupabaseImages) {
    assert.match(source, /^ghcr\.io\/supabase\/[a-z0-9-]+@sha256:[a-f0-9]{64}$/);
    assert.match(target, /^ghcr\.io\/supabase\/[a-z0-9-]+:[a-z0-9_.-]+$/);
    const sourceImage = source.match(/^ghcr\.io\/(supabase\/[a-z0-9-]+)@sha256:[a-f0-9]{64}$/)?.[1];
    const targetImage = target.match(/^ghcr\.io\/(supabase\/[a-z0-9-]+):[a-z0-9_.-]+$/)?.[1];
    const cliMirrorImage = `supabase/${repository.split("/").at(-1)}`;
    assert.equal(sourceImage, cliMirrorImage);
    assert.equal(targetImage, cliMirrorImage);
  }
  const dockerCommands = [];
  let inspectCalls = 0;
  prefetchVerifiedSupabaseImages((command, args) => {
    dockerCommands.push([command, ...args]);
    if (args[0] === "image" && args[1] === "inspect" && inspectCalls++ % 3 === 0) return { status: 1, stdout: "", stderr: "not found" };
    return { status: 0, stdout: args[0] === "image" && args[1] === "inspect" ? `sha256:${"a".repeat(64)}\n` : "", stderr: "" };
  });
  assert.equal(dockerCommands.length, verifiedSupabaseImages.length * 5);
  for (let index = 0; index < verifiedSupabaseImages.length; index += 1) {
    const { source, target } = verifiedSupabaseImages[index];
    assert.deepEqual(dockerCommands[index * 5], ["docker", "image", "inspect", "--format", "{{.Id}}", source]);
    assert.deepEqual(dockerCommands[index * 5 + 1], ["docker", "pull", source]);
    assert.deepEqual(dockerCommands[index * 5 + 2], ["docker", "image", "inspect", "--format", "{{.Id}}", source]);
    assert.deepEqual(dockerCommands[index * 5 + 3], ["docker", "image", "tag", `sha256:${"a".repeat(64)}`, target]);
    assert.deepEqual(dockerCommands[index * 5 + 4], ["docker", "image", "inspect", "--format", "{{.Id}}", target]);
  }
  const cachedCommands = [];
  prefetchVerifiedSupabaseImages((command, args) => {
    cachedCommands.push([command, ...args]);
    return { status: 0, stdout: args[1] === "inspect" ? `sha256:${"b".repeat(64)}\n` : "", stderr: "" };
  });
  assert.equal(cachedCommands.length, verifiedSupabaseImages.length * 3);
  assert.ok(cachedCommands.every(([, ...args]) => args[0] !== "pull"));
  assert.throws(() => prefetchVerifiedSupabaseImages((command, args) => ({
    status: 0,
    stdout: command === "docker" && args[1] === "inspect"
      ? `sha256:${(args.at(-1).includes("@sha256:") ? "a" : "b").repeat(64)}\n`
      : "",
    stderr: "",
  })), /detail=image-cache-tag-verification-failure/);
  const startEnv = supabaseCommandEnv(["start"], { env: { SUPABASE_INTERNAL_IMAGE_REGISTRY: "public.ecr.aws" } }, { path: "/safe-observer" });
  assert.equal(startEnv.SUPABASE_INTERNAL_IMAGE_REGISTRY, "ghcr.io");
  assert.equal(startEnv.PATH, "/safe-observer");
  assert.equal(supabaseCommandEnv(["status"], { env: { SUPABASE_INTERNAL_IMAGE_REGISTRY: "public.ecr.aws" } }).SUPABASE_INTERNAL_IMAGE_REGISTRY, "public.ecr.aws");
  assert.equal(classifyVerifiedImagePullFailure("toomanyrequests: hidden-token"), "image-pull-rate-limit");
  assert.equal(classifyVerifiedImagePullFailure("unauthorized: password=hidden"), "image-pull-authentication");
  assert.equal(classifyVerifiedImagePullFailure("403 Forbidden: invalid token=hidden"), "image-pull-authentication");
  assert.equal(classifyVerifiedImagePullFailure("TLS handshake timeout: hidden"), "network-timeout");
  assert.equal(classifyVerifiedImagePullFailure("manifest unknown"), "image-unavailable");
  assert.equal(classifyVerifiedImagePullFailure("", true), "docker-cli-launch-failure");
  assert.throws(() => prefetchVerifiedSupabaseImages(() => ({
    status: 1,
    stdout: "unauthorized token=hidden-value",
    stderr: "password=also-hidden",
  })), (error) => error.message === "Verified Supabase image preload failed; image=postgres; detail=image-pull-authentication"
    && !error.message.includes("hidden"));

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
    spawn: (_command, args) => {
      assert.deepEqual(args.slice(0, 2), ["--output-format", "json"]);
      return { status: 1, stdout: cliCredentials, stderr: cliCredentials };
    },
    stdio: "pipe", discardOutput: true, failureMessage: safeStartFailure, startDiagnostics: true,
  }), (error) => error.message === safeStartFailure
    && error.startupFailureCategory === "unclassified-start-failure"
    && error.startupExitCode === 1
    && error.startupImageDiagnosticStatus === "not-found"
    && !error.message.includes("generated-") && !error.message.includes("sb_secret_"));
  const cliJsonErrorOutput = JSON.stringify({
    _tag: "Error",
    error: {
      code: "ImagePrepullError",
      message: "failed to pull docker image from all registries: ghcr.io/supabase/postgres:15.8.1 attempt 1: toomanyrequests: token=hidden-test-token",
    },
  });
  assert.throws(() => run("supabase", ["start"], {
    spawn: () => ({ status: 1, stdout: cliJsonErrorOutput, stderr: "" }),
    stdio: "pipe", failureMessage: safeStartFailure, startDiagnostics: true,
  }), (error) => error.message === safeStartFailure
    && error.startupFailureCategory === "image-pull-rate-limit"
    && error.startupErrorCode === "ImagePrepullError"
    && error.startupImageDiagnosticStatus === "validated"
    && error.startupImageDiagnostic.includes("registry=ghcr.io image=supabase/postgres service=db")
    && !error.message.includes("hidden-test-token"));
  const typedStartupError = JSON.stringify({
    _tag: "Error", error: { code: "StartInvalidConfigError", message: "address already in use" },
  });
  assert.throws(() => run("supabase", ["start"], {
    spawn: () => ({ status: 1, stdout: typedStartupError, stderr: "unauthorized token=hidden-noise" }),
    failureMessage: safeStartFailure, startDiagnostics: true,
  }), (error) => error.startupErrorCode === "StartInvalidConfigError"
    && error.startupFailureCategory === "port-allocation"
    && startupFailure(error, "").includes("Supabase CLI error code: StartInvalidConfigError")
    && !startupFailure(error, "").includes("hidden-noise"));
  assert.equal(structuredStartupErrors(JSON.stringify({
    _tag: "Error", error: { code: "secret-code-value", message: "secret-message" },
  }))[0].code, "unrecognized");
  assert.doesNotMatch(startupFailure({ startupErrorCode: "secret-code-value" }, ""), /secret-code-value/);
  assert.equal(classifyStartFailure("failed to pull image: unauthorized: password=private"), "image-pull-authentication");
  assert.equal(classifyStartFailure("daemon reported no space left on device"), "disk-capacity");
  assert.deepEqual(startupImageDiagnostic("pull access denied for library/kong:2.8.1, repository does not exist or may require 'docker login'"), {
    status: "validated", line: "Startup image: registry=docker.io image=library/kong service=kong",
  });
  assert.deepEqual(startupImageDiagnostic('Head "https://ghcr.io/v2/supabase/cli/auth/manifests/v2.197.0": unauthorized'), {
    status: "validated", line: "Startup image: registry=ghcr.io image=supabase/cli/auth service=auth",
  });
  const validDigest = "a".repeat(64);
  const aggregatePullFailure = `failed to pull docker image from all registries: ghcr.io/supabase/cli/postgres:15.8.1@sha256:${validDigest} attempt 1: unauthorized: token=first-secret; docker.io/supabase/postgres:15.8.1 attempt 2: unauthorized: password=second-secret`;
  assert.deepEqual(startupImageDiagnostic(aggregatePullFailure), {
    status: "validated", line: "Startup image attempt: registry=ghcr.io image=supabase/cli/postgres service=db attempt=1 detail=image-pull-authentication\nStartup image attempt: registry=docker.io image=supabase/postgres service=db attempt=2 detail=image-pull-authentication",
  });
  assert.deepEqual(startupImageDiagnostic(`failed to pull docker image from all registries: docker.io/supabase/postgres:15.8.1 attempt 1: unauthorized; ghcr.io/supabase/cli/postgres:15.8.1@sha256:${validDigest} attempt 2: too many requests`), {
    status: "validated", line: "Startup image attempt: registry=docker.io image=supabase/postgres service=db attempt=1 detail=image-pull-authentication\nStartup image attempt: registry=ghcr.io image=supabase/cli/postgres service=db attempt=2 detail=image-pull-rate-limit",
  });
  assert.deepEqual(startupImageDiagnostic("authentication required"), { status: "not-found", line: "" });
  assert.deepEqual(startupImageDiagnostic("failed to pull docker image from all registries: malformed candidate"), { status: "format-mismatch", line: "" });
  assert.deepEqual(startupImageDiagnostic(`failed to pull docker image from all registries: ghcr.io/supabase/cli/postgres:15.8.1@sha256:${"a".repeat(63)} attempt 0: unauthorized`), { status: "allowlist-rejected", line: "" });
  assert.deepEqual(startupImageDiagnostic(`failed to pull docker image from all registries: ghcr.io/supabase/cli/postgres:15.8.1@sha256:${"g".repeat(64)} attempt 0: unauthorized`), { status: "allowlist-rejected", line: "" });
  assert.deepEqual(startupImageDiagnostic("failed to pull docker image from all registries: public.ecr.aws/untrusted/private:tag@sha256:" + validDigest + " attempt 0: unauthorized"), { status: "allowlist-rejected", line: "" });
  assert.deepEqual(startupImageDiagnostic("failed to pull docker image from all registries: private.registry.invalid/supabase/postgres:tag@sha256:" + validDigest + " attempt 0: unauthorized"), { status: "allowlist-rejected", line: "" });
  const credentialCandidate = startupImageDiagnostic("failed to pull docker image from all registries: https://user:secret@ghcr.io/v2/supabase/cli/auth/manifests/v2.197.0?token=secret attempt 0: unauthorized");
  assert.deepEqual(credentialCandidate, { status: "allowlist-rejected", line: "" });
  const unsafeOutput = startupFailure({
    startupFailureCategory: "image-pull-authentication",
    startupImageDiagnosticStatus: credentialCandidate.status,
    startupImageDiagnostic: credentialCandidate.line,
    startupExitCode: 1,
  }, "Startup containers: none created or ownership could not be established.");
  assert.doesNotMatch(unsafeOutput, /secret|token=|user:|ghcr\.io|supabase\/cli\/auth/);
  const safeAggregateFailure = startupFailure(
    Object.assign(new Error(aggregatePullFailure), {
      startupFailureCategory: "image-pull-authentication",
      startupImageDiagnosticStatus: startupImageDiagnostic(aggregatePullFailure).status,
      startupImageDiagnostic: startupImageDiagnostic(aggregatePullFailure).line,
      startupExitCode: 1,
    }),
    "Startup containers: none created or ownership could not be established.",
  );
  assert.match(safeAggregateFailure, /registry=ghcr\.io image=supabase\/cli\/postgres service=db attempt=1 detail=image-pull-authentication/);
  assert.doesNotMatch(safeAggregateFailure, /first-secret|second-secret|password|token=/);
  assert.deepEqual(startupImageDiagnostic("pull access denied for private.registry.invalid/team/image:tag, unauthorized"), { status: "allowlist-rejected", line: "" });
  assert.deepEqual(startupImageDiagnostic('Head "https://ghcr.io/v2/untrusted/private-package/manifests/secret-tag": unauthorized'), { status: "allowlist-rejected", line: "" });
  assert.deepEqual(startupImageDiagnostic('Head "https://user:token@ghcr.io/v2/supabase/cli/auth/manifests/v2.197.0?token=secret": unauthorized'), { status: "allowlist-rejected", line: "" });
  const cliJsonAggregateFailure = JSON.stringify({
    _tag: "Error",
    error: {
      code: "ImagePrepullError",
      message: [
        "failed to pull docker image from all registries: public.ecr.aws/supabase/postgres:15.8.1 attempt 1: toomanyrequests: password=hidden-one; ghcr.io/supabase/postgres:15.8.1 attempt 2: unauthorized: token=hidden-two",
        "failed to pull docker image from all registries: docker.io/library/kong:2.8.1 attempt 1: 429 Too Many Requests: authorization=hidden-three",
      ].join("\n"),
    },
  });
  const cliJsonDiagnostic = startupImageDiagnostic(cliJsonAggregateFailure);
  assert.deepEqual(cliJsonDiagnostic, {
    status: "validated",
    line: "Startup image attempt: registry=public.ecr.aws image=supabase/postgres service=db attempt=1 detail=image-pull-rate-limit\nStartup image attempt: registry=ghcr.io image=supabase/postgres service=db attempt=2 detail=image-pull-authentication\nStartup image attempt: registry=docker.io image=library/kong service=kong attempt=1 detail=image-pull-rate-limit",
  });
  assert.equal(classifyStartFailure(cliJsonAggregateFailure), "image-pull-rate-limit");
  const cliJsonSafeFailure = startupFailure(Object.assign(new Error("sensitive raw output"), {
    startupFailureCategory: "image-pull-rate-limit",
    startupImageDiagnosticStatus: cliJsonDiagnostic.status,
    startupImageDiagnostic: cliJsonDiagnostic.line,
    startupExitCode: 1,
  }), "Startup containers: none created or ownership could not be established.");
  assert.doesNotMatch(cliJsonSafeFailure, /hidden-one|hidden-two|hidden-three|password=|token=|authorization=/);
  const cliJsonCredentialCandidate = JSON.stringify({
    _tag: "Error",
    error: {
      code: "ImagePrepullError",
      message: "failed to pull docker image from all registries: https://user:secret@ghcr.io/v2/supabase/cli/auth/manifests/v2.197.0?token=secret attempt 1: unauthorized",
    },
  });
  const cliJsonCredentialDiagnostic = startupImageDiagnostic(cliJsonCredentialCandidate);
  assert.deepEqual(cliJsonCredentialDiagnostic, { status: "allowlist-rejected", line: "" });
  assert.doesNotMatch(startupFailure({
    startupFailureCategory: "image-pull-authentication",
    startupImageDiagnosticStatus: cliJsonCredentialDiagnostic.status,
    startupImageDiagnostic: cliJsonCredentialDiagnostic.line,
    startupExitCode: 1,
  }, "Startup containers: none created or ownership could not be established."), /secret|token=|user:|ghcr\.io|supabase\/cli\/auth/);
  const rejectedImageFailure = startupFailure(Object.assign(new Error("raw private.registry.invalid/team/image:tag"), {
    startupFailureCategory: "image-pull-authentication", startupImageDiagnosticStatus: "allowlist-rejected",
    startupExitCode: 1,
  }), "Startup containers: none created or ownership could not be established.");
  assert.match(rejectedImageFailure, /Startup image diagnostic status: allowlist-rejected/);
  assert.doesNotMatch(rejectedImageFailure, /private\.registry|team\/image|raw/);
  assert.throws(() => run("supabase", ["start"], {
    spawn: () => ({ status: 1, stdout: "failed to pull docker image from all registries: private.registry.invalid/team/image:tag attempt 0: unauthorized token=secret", stderr: "" }),
    stdio: "pipe", failureMessage: safeStartFailure, startDiagnostics: true,
  }), (error) => {
    const safe = startupFailure(error, "Startup containers: none created or ownership could not be established.");
    return error.startupImageDiagnosticStatus === "allowlist-rejected"
      && safe.includes("Startup image diagnostic status: allowlist-rejected")
      && !/private\.registry|team\/image|token=secret|unauthorized/.test(safe);
  });
  const safeImageFailure = startupFailure(
    Object.assign(new Error("raw token=secret"), {
      startupFailureCategory: "image-pull-authentication", startupImageDiagnosticStatus: startupImageDiagnostic("pull access denied for library/kong:2.8.1, unauthorized").status,
      startupImageDiagnostic: startupImageDiagnostic("pull access denied for library/kong:2.8.1, unauthorized").line, startupExitCode: 1,
    }),
    "Startup containers: none created or ownership could not be established.",
  );
  assert.match(safeImageFailure, /registry=docker\.io image=library\/kong service=kong/);
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
  assert.match(safeStartupFailure, /Startup image diagnostic status: not-found/);
  assert.match(safeStartupFailure, /Supabase CLI exit code: 1/);
  assert.doesNotMatch(safeStartupFailure, /generated-|sb_secret_|secret|private|postgresql:|host/);
  assert.throws(() => run("supabase", ["test", "db"], {
    spawn: () => ({ status: 1, stdout: `tests/version_history_introduction_read.test.sql .. not ok 3 - denied scope\nERROR: ${cliCredentials}`,
      stderr: "" }),
    stdio: "pipe", failureMessage: "Supabase test failed; CLI output suppressed.", sqlDiagnostics: true,
  }), (error) => error.message.includes("version_history_introduction_read.test.sql")
    && !error.message.includes("generated-db-password") && !error.message.includes("sb_secret_"));

  await runDockerPullObserverSelfTests();
  await runContainerEventObserverSelfTests();
  console.log("Staging security self-tests passed (Docker bindings, pull and container-event diagnostics, and suppressed Supabase CLI credentials).");
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
    removeTemporaryStage(stageRoot);
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
  let containerEventObserver;
  let containerEventObserverAttempted = false;
  try {
    const preexisting = identifyOwnedResources(projectId, before);
    if (Object.values(preexisting).some((items) => items.length > 0)) throw new Error("Generated project identity already exists; refusing startup");
    prefetchVerifiedSupabaseImages();
    const loopbackNetwork = createLoopbackNetwork(projectId);
    resources.networks.push(loopbackNetwork.id);
    context.dockerNetworkId = loopbackNetwork.id;
    verifyLoopbackNetwork(dockerJson(["network", "inspect", loopbackNetwork.id])[0], projectId);
    writeFileSync(ownershipPath, JSON.stringify({ projectId, stageRoot, ports, preexisting: beforeManifest, created: resources }, null, 2));
    containerEventObserverAttempted = true;
    const dockerApiVersion = verifyDockerEventsSocket();
    containerEventObserver = await startDockerContainerEventObserver(projectId, { apiVersion: dockerApiVersion });
    try { context.startupPullObserver = installDockerPullObserver(context); }
    catch (error) { context.startupObserverError = error; } // Preserve runSupabase's existing failure handling.
    if (!context.startupObserverError) {
      context.cliVersionVerification = await probeCliVersion(supabaseCommandEnv(["start"], {}, context.startupPullObserver));
    }
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
    } catch (error) {
      console.error(`Local Supabase cleanup stopped because ownership or removal could not be verified. Resources were left untouched where verification failed. Ownership manifest: ${ownershipPath}`);
      if (callbackError) console.error(`Test failure: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`);
      cleanupFailure = error;
    } finally {
      if (containerEventObserverAttempted) {
        let summary;
        try { summary = await stopDockerContainerEventObserver(containerEventObserver); }
        catch { summary = "Docker container events: observation=incomplete"; }
        console.log(summary);
        if (callbackError) callbackError = new Error(`${callbackError.message}\n${summary}`);
        if (cleanupFailure) cleanupFailure = new Error(`${cleanupFailure.message}\n${summary}`);
      }
      try { removeTemporaryStage(stageRoot); }
      catch (error) { cleanupFailure ??= error; }
    }
  }
  if (cleanupFailure) throw cleanupFailure;
  if (callbackError) throw callbackError;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Set(process.argv.slice(2));
  if (options.size === 1 && options.has("--security-self-test")) {
    runSecuritySelfTests().catch((error) => {
      console.error(error instanceof Error ? error.message : "Staging security self-tests failed.");
      process.exitCode = 1;
    });
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
