import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("Summer School course descriptions render the optional locale value directly", () => {
  const education = page.match(/<section className="section education[\s\S]*?<\/section>/)?.[0];
  assert.ok(education, "public Education renderer should exist");
  assert.match(education, /\{x\.courseDescription \? <p className="course-description">\{x\.courseDescription\}<\/p> : null\}/);
  assert.doesNotMatch(education, /\.slice\(|keep-phrase|完成分析与模型评估。/);
  assert.doesNotMatch(css, /keep-phrase/);
});
