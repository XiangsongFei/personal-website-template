import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("public LinkedIn Hero action stays shared while Contact label follows active locale content", () => {
  const hero = page.match(/<div className="hero-actions">([\s\S]*?)<\/div><div className="graduation-meta">/)?.[1];
  assert.ok(hero, "Hero actions should be present");
  assert.match(hero, /<span className="link-label">\{currentResumeContent\.publicLinks\.linkedInLabel\}<\/span>/);
  assert.doesNotMatch(hero, /t\.linkedInLabel/);

  const footer = page.match(/<footer id="contact">([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer, "Contact footer should be present");
  assert.match(footer, /<span className="contact-link-label">\{t\.linkedInLabel\}<\/span>/);
  assert.match(footer, /\{currentResumeContent\.publicLinks\.linkedInDisplayName\}/);
  assert.match(page, /const t = currentResumeContent\.locales\[locale\];/);
});
