import assert from "node:assert/strict";
import test from "node:test";
import { resumeContent } from "../app/data/resume";
import { isResumeContent, loadResumeContent } from "../app/data/resume-validation";

const successfulResponse = () => Response.json(resumeContent);
type MutablePayload = {
  [key: string]: unknown;
  locales: Record<string, {
    [key: string]: unknown;
    edu: { entryType: string }[];
    projects: { id: string; methods: unknown }[];
    contactFocusItems: unknown[];
  }>;
};
const mutablePayload = (): MutablePayload => structuredClone(resumeContent) as unknown as MutablePayload;

test("accepts the complete current bilingual resume payload without changing it", async () => {
  assert.equal(isResumeContent(resumeContent), true);
  const result = await loadResumeContent(async input => {
    assert.equal(input, "/api/resume");
    return successfulResponse();
  });
  assert.deepStrictEqual(result, resumeContent);
  assert.notStrictEqual(result, resumeContent);
});

test("requests the same-origin endpoint with no-store and the supplied abort signal", async () => {
  const controller = new AbortController();
  await loadResumeContent(async (_input, init) => {
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, controller.signal);
    return successfulResponse();
  }, controller.signal);
});

test("keeps the exact static fallback after HTTP, network, and JSON failures", async () => {
  assert.strictEqual(await loadResumeContent(async () => new Response(null, { status: 503 })), resumeContent);
  assert.strictEqual(await loadResumeContent(async () => { throw new Error("network unavailable"); }), resumeContent);
  assert.strictEqual(await loadResumeContent(async () => new Response("{ invalid json")), resumeContent);
});

test("rejects missing zh and en locales", () => {
  const noChinese = mutablePayload();
  delete noChinese.locales.zh;
  assert.equal(isResumeContent(noChinese), false);

  const noEnglish = mutablePayload();
  delete noEnglish.locales.en;
  assert.equal(isResumeContent(noEnglish), false);
});

test("rejects missing required top-level data", () => {
  const noPublicLinks = mutablePayload();
  delete noPublicLinks.publicLinks;
  assert.equal(isResumeContent(noPublicLinks), false);
});

test("rejects malformed repeatable records and malformed nested arrays", () => {
  const badEducation = mutablePayload();
  badEducation.locales.zh.edu[0].entryType = "summer";
  assert.equal(isResumeContent(badEducation), false);

  const badProjectMethods = mutablePayload();
  badProjectMethods.locales.en.projects[0].methods = "Data Preparation";
  assert.equal(isResumeContent(badProjectMethods), false);

  const badFocusTuple = mutablePayload();
  badFocusTuple.locales.zh.contactFocusItems[0] = ["only one value"];
  assert.equal(isResumeContent(badFocusTuple), false);

  const duplicateId = mutablePayload();
  duplicateId.locales.en.projects[1].id = duplicateId.locales.en.projects[0].id;
  assert.equal(isResumeContent(duplicateId), false);

  const mismatchedLocaleOrder = mutablePayload();
  mismatchedLocaleOrder.locales.en.edu.reverse();
  assert.equal(isResumeContent(mismatchedLocaleOrder), false);
});

test("preserves empty strings and absent optional fields", async () => {
  const payload = structuredClone(resumeContent);
  assert.equal(isResumeContent(payload), true);
  assert.equal(payload.locales.zh.projects[0].href, "");
  assert.equal("location" in payload.locales.zh.jobs[0], false);
  const result = await loadResumeContent(async () => Response.json(payload));
  assert.deepStrictEqual(result, payload);
});
