import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroPortrait } from "../app/HeroPortrait";

const props = { avatarLabel: "Profile portrait", avatarInitials: "DU", portraitRef: null } as const;

test("renders the provided photo inside the existing portrait area without initials", () => {
  const html = renderToStaticMarkup(createElement(HeroPortrait, { ...props, photoUrl: "https://storage.example.test/photo.webp" }));
  assert.match(html, /class="portrait-wrap"/);
  assert.match(html, /<img src="https:\/\/storage\.example\.test\/photo\.webp" alt="" aria-hidden="true"\/>/);
  assert.doesNotMatch(html, /portrait-placeholder|DU/);
});

test("keeps the exact initials placeholder when there is no photo URL", () => {
  const html = renderToStaticMarkup(createElement(HeroPortrait, { ...props, photoUrl: null }));
  assert.match(html, /class="portrait-wrap"/);
  assert.match(html, /<div class="portrait-placeholder" aria-hidden="true">DU<\/div>/);
  assert.doesNotMatch(html, /<img/);
});
