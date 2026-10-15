import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resumeContent } from "../app/data/resume.ts";
import { loadResumeContent } from "../app/data/resume-validation.ts";

async function requestWorker(request) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    request,
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

async function render() {
  return requestWorker(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
  );
}

test("serves the current Public HTML shell with its metadata and favicon", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Demo User \| Data Analytics Portfolio Template<\/title>/i);
  assert.match(
    html,
    /<meta[^>]+name="description"[^>]+content="A public, bilingual portfolio template for data analytics and information systems work\."/i,
  );
  assert.match(html, /<link[^>]+rel="(?:icon|shortcut icon)"[^>]+href="\/favicon\.svg"/i);
});

test("returns a controlled response for a malformed progressive Server Action request", { timeout: 2_000 }, async () => {
  const form = new FormData();
  form.append("$ACTION_REF_0", "malformed-reference");
  form.append("$ACTION_0:", '{"id":"not-a-real-action"}');

  const response = await requestWorker(
    new Request("http://localhost/", {
      method: "POST",
      headers: {
        accept: "text/html",
        origin: "http://localhost",
      },
      body: form,
    }),
  );

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Server action not found.");
});

test("falls back to the bundled bilingual resume when a successful response is invalid", async () => {
  const incompleteResume = structuredClone(resumeContent);
  delete incompleteResume.locales.en;

  const result = await loadResumeContent(async () => Response.json(incompleteResume));

  assert.strictEqual(result, resumeContent);
  assert.deepStrictEqual(Object.keys(result.locales).sort(), ["en", "zh"]);
});

test("keeps the public resume hidden until both locale and resume data are ready", async () => {
  const [page, loader] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/resume-validation.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const \[isResumeReady, setIsResumeReady\] = useState\(false\);/);
  assert.match(page, /loadResumeContent\(fetch, controller\.signal\)\.then\(content => \{\s*if \(!controller\.signal\.aborted\) \{\s*setCurrentResumeContent\(content\);\s*setIsResumeReady\(true\);/);
  const readinessGate = page.indexOf("if (!isLocaleReady || !isResumeReady) return null;");
  const resumeMarkup = page.indexOf("return <main className={`locale-${locale}`}");
  assert.ok(readinessGate >= 0 && resumeMarkup > readinessGate, "resume markup must stay behind the readiness gate");

  assert.match(page, /if \(!isLocaleReady \|\| !isResumeReady\) return;[\s\S]*?\}, \[isLocaleReady, isResumeReady\]\);/);
  assert.match(page, /if \(!isLocaleReady \|\| !isResumeReady\) return;[\s\S]*?\}, \[isLocaleReady, isResumeReady, locale\]\);/);
  assert.match(page, /if \(!isLocaleReady \|\| !isResumeReady \|\| hasRestoredReloadScrollRef\.current/);

  assert.match(loader, /if \(!response\.ok\) return resumeContent;/);
  assert.match(loader, /return isResumeContent\(payload\) \? payload : resumeContent;/);
  assert.match(loader, /catch \{\s*return resumeContent;/);
});
