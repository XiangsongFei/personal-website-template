import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const legacyRelativePath = "assets/index-BwbHGD-E.js";
const legacySha256 = "011ed233337c29086aca8f285a737d94c664c77ddc10b9c3e605f6f0b229598e";
const publicLegacyPath = resolve("public", legacyRelativePath);
const builtLegacyPath = resolve("dist", legacyRelativePath);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

for (const path of [publicLegacyPath, builtLegacyPath]) {
  if (sha256(path) !== legacySha256) {
    throw new Error(`Admin compatibility asset is missing, modified, or collided: ${path}`);
  }
}

const html = readFileSync(resolve("dist/index.html"), "utf8");
const scriptPaths = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/g)].map((match) => match[1]);
const stylePaths = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/g)].map((match) => match[1]);
if (scriptPaths.length === 0 || scriptPaths.some((path) => path.includes("index-BwbHGD-E.js"))) {
  throw new Error("The new Admin HTML must reference its own generated JavaScript asset.");
}
if (stylePaths.length === 0) throw new Error("The new Admin HTML must reference its generated stylesheet.");

for (const path of [...scriptPaths, ...stylePaths]) {
  const builtPath = resolve("dist", `.${path.startsWith("/") ? path : `/${path}`}`);
  readFileSync(builtPath);
}
