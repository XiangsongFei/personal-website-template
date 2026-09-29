import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroPortrait } from "../app/HeroPortrait";

const props = { name: "Demo User", locale: "en" as const, avatarInitials: "DU", portraitRef: null } as const;

test("renders the provided photo inside the existing portrait area without initials", () => {
  const html = renderToStaticMarkup(createElement(HeroPortrait, { ...props, photoUrl: "https://storage.example.test/photo.webp" }));
  assert.match(html, /class="portrait-wrap"/);
  assert.match(html, /<img src="https:\/\/storage\.example\.test\/photo\.webp" alt="Portrait of Demo User"\/>/);
  assert.doesNotMatch(html, /portrait-placeholder|DU/);
});

test("keeps an accessible initials placeholder when there is no photo URL", () => {
  const html = renderToStaticMarkup(createElement(HeroPortrait, { ...props, photoUrl: null }));
  assert.match(html, /class="portrait-wrap"/);
  assert.match(html, /<div class="portrait-placeholder" role="img" aria-label="Portrait of Demo User">DU<\/div>/);
  assert.doesNotMatch(html, /<img/);
});

test("uses the localized Chinese name for the public avatar alternative", () => {
  const html = renderToStaticMarkup(createElement(HeroPortrait, { ...props, name: "示例用户", locale: "zh", photoUrl: "https://storage.example.test/photo.webp" }));
  assert.match(html, /alt="示例用户的个人头像"/);
});
