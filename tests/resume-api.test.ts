import assert from "node:assert/strict";
import test from "node:test";
import { resumeContent } from "../app/data/resume";
import { createResumeRowsFixture } from "./resume-adapter-fixtures";
import type { ResumeDatabaseRows } from "../app/data/resume-adapter";
import { handleResumeApi, isResumeApiPath } from "../worker/resume-api";

const env = { SUPABASE_URL: "https://unit-test.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };

function fakeSupabaseFetch(
  fixture: ResumeDatabaseRows,
  options: { noSite?: boolean; multipleSites?: boolean; failTable?: string } = {},
): typeof fetch {
  return async (input, init) => {
    const requestUrl = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    assert.equal(requestUrl.origin, "https://unit-test.supabase.co");
    assert.equal(new Headers(init?.headers).get("apikey"), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.equal(init?.method, "GET");
    const table = requestUrl.pathname.split("/").at(-1)!;
    if (options.failTable === table) return Response.json({ message: "upstream detail must not be forwarded" }, { status: 500 });
    if (table === "resume_sites") {
      assert.equal(requestUrl.searchParams.get("site_key"), "eq.example-cv");
      assert.equal(requestUrl.searchParams.get("is_published"), "eq.true");
      assert.equal(requestUrl.searchParams.get("limit"), "2");
      if (options.noSite) return Response.json([]);
      if (options.multipleSites) {
        return Response.json([...fixture.resume_sites, { ...fixture.resume_sites[0], id: "00000000-0000-4000-8000-000000000099" }]);
      }
      return Response.json(fixture.resume_sites);
    }
    assert.equal(requestUrl.searchParams.get("resume_id"), `eq.${fixture.resume_sites[0].id}`);
    const result = fixture[table as keyof ResumeDatabaseRows];
    assert.ok(Array.isArray(result), `unexpected table request: ${table}`);
    if (table === "resume_profile") assert.match(requestUrl.searchParams.get("select") ?? "", /photo_url/);
    return Response.json(result);
  };
}

async function withFetch<T>(fetcher: typeof fetch, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("GET /api/resume is recognized and returns normalized content through the real adapter", async () => {
  const fixture = createResumeRowsFixture();
  const request = new Request("https://example.test/api/resume");
  assert.equal(isResumeApiPath(new URL(request.url).pathname), true);
  assert.equal(isResumeApiPath("/api/locale"), false);
  const response = await withFetch(fakeSupabaseFetch(fixture), () => handleResumeApi(request, env));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepStrictEqual(await response.json(), resumeContent);
});

test("GET /api/resume returns the shared photo URL from resume_profile", async () => {
  const fixture = createResumeRowsFixture();
  const photoUrl = "https://storage.example.test/profile-images/example-cv/profile/photo.webp";
  fixture.resume_profile[0].photo_url = photoUrl;
  const response = await withFetch(fakeSupabaseFetch(fixture), () => handleResumeApi(new Request("https://example.test/api/resume"), env));
  assert.equal(response.status, 200);
  const payload = await response.json() as typeof resumeContent;
  assert.equal(payload.profile.photoUrl, photoUrl);
});

test("non-GET requests to /api/resume are rejected", async () => {
  const response = await handleResumeApi(new Request("https://example.test/api/resume", { method: "POST" }), env);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});

test("missing environment bindings fail safely", async () => {
  const response = await handleResumeApi(new Request("https://example.test/api/resume"), {});
  assert.equal(response.status, 503);
  assert.deepStrictEqual(await response.json(), { error: "Resume service unavailable" });
});

test("no published example-cv resume returns not found", async () => {
  const response = await withFetch(fakeSupabaseFetch(createResumeRowsFixture(), { noSite: true }), () => handleResumeApi(new Request("https://example.test/api/resume"), env));
  assert.equal(response.status, 404);
  assert.deepStrictEqual(await response.json(), { error: "Published resume not found" });
});

test("multiple published roots fail closed", async () => {
  const response = await withFetch(fakeSupabaseFetch(createResumeRowsFixture(), { multipleSites: true }), () => handleResumeApi(new Request("https://example.test/api/resume"), env));
  assert.equal(response.status, 500);
  assert.deepStrictEqual(await response.json(), { error: "Resume data unavailable" });
});

test("Supabase errors are not forwarded to public clients", async () => {
  const response = await withFetch(fakeSupabaseFetch(createResumeRowsFixture(), { failTable: "resume_sites" }), () => handleResumeApi(new Request("https://example.test/api/resume"), env));
  assert.equal(response.status, 500);
  assert.deepStrictEqual(await response.json(), { error: "Resume data unavailable" });
});

test("a required child-table failure does not return partial data", async () => {
  const response = await withFetch(fakeSupabaseFetch(createResumeRowsFixture(), { failTable: "resume_project_methods" }), () => handleResumeApi(new Request("https://example.test/api/resume"), env));
  assert.equal(response.status, 500);
  assert.deepStrictEqual(await response.json(), { error: "Resume data unavailable" });
});

test("adapter validation failures do not return partial resume data", async () => {
  const fixture = createResumeRowsFixture();
  fixture.resume_profile_translations = fixture.resume_profile_translations.filter((row) => row.locale !== "en");
  const response = await withFetch(fakeSupabaseFetch(fixture), () => handleResumeApi(new Request("https://example.test/api/resume"), env));
  assert.equal(response.status, 500);
  assert.deepStrictEqual(await response.json(), { error: "Resume data unavailable" });
});
