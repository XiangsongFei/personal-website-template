import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the public footer renders the mapped localized Availability value", async () => {
  const [page, adapter] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/data/resume-adapter.ts", import.meta.url), "utf8"),
  ]);

  assert.match(adapter, /availability:\s*text\(localeRow,\s*"availability"/);
  assert.match(page, /<footer id="contact">[\s\S]*?<h2>\{t\.availability\}<\/h2>/);
  assert.doesNotMatch(page, /<h2>\{locale === "zh" \? <>欢迎就/);
});
