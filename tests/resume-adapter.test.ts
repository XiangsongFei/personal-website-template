import assert from "node:assert/strict";
import test from "node:test";
import { resumeContent } from "../app/data/resume";
import { adaptResumeRows, ResumeDataValidationError } from "../app/data/resume-adapter";
import { createResumeRowsFixture } from "./resume-adapter-fixtures";

test("production-shaped rows adapt deeply to the current static resume content", () => {
  assert.deepStrictEqual(adaptResumeRows(createResumeRowsFixture()), resumeContent);
});

test("maps the shared nullable profile photo URL without locale duplication", () => {
  const fixture = createResumeRowsFixture();
  const photoUrl = "https://storage.example.test/profile-images/example-cv/profile/photo.webp";
  fixture.resume_profile[0].photo_url = photoUrl;
  const mapped = adaptResumeRows(fixture);
  assert.equal(mapped.profile.photoUrl, photoUrl);
  assert.equal(mapped.locales.zh && mapped.profile.photoUrl, photoUrl);
  assert.equal(mapped.locales.en && mapped.profile.photoUrl, photoUrl);
  fixture.resume_profile[0].photo_url = null;
  assert.equal(adaptResumeRows(fixture).profile.photoUrl, null);
});

test("fails closed when the profile photo column is absent or malformed", () => {
  const missing = createResumeRowsFixture();
  delete missing.resume_profile[0].photo_url;
  assert.throws(() => adaptResumeRows(missing), ResumeDataValidationError);
  const malformed = createResumeRowsFixture();
  malformed.resume_profile[0].photo_url = "blob:temporary";
  assert.throws(() => adaptResumeRows(malformed), ResumeDataValidationError);
});

test("fails closed when a locale is missing", () => {
  const fixture = createResumeRowsFixture();
  fixture.resume_locale_content = fixture.resume_locale_content.filter((row) => row.locale !== "en");
  assert.throws(() => adaptResumeRows(fixture), ResumeDataValidationError);
});

test("fails closed when a translation uniqueness key is duplicated", () => {
  const fixture = createResumeRowsFixture();
  fixture.resume_profile_translations.push({ ...fixture.resume_profile_translations[0] });
  assert.throws(() => adaptResumeRows(fixture), ResumeDataValidationError);
});

test("fails closed when a row references a different resume", () => {
  const fixture = createResumeRowsFixture();
  fixture.resume_public_links[0].resume_id = "00000000-0000-4000-8000-000000000099";
  assert.throws(() => adaptResumeRows(fixture), ResumeDataValidationError);
});

test("fails closed when a required stable source_key is null", () => {
  const fixture = createResumeRowsFixture();
  fixture.resume_education_entries[0].source_key = null;
  assert.throws(() => adaptResumeRows(fixture), ResumeDataValidationError);
});

test("fails closed when a project method references a missing project", () => {
  const fixture = createResumeRowsFixture();
  fixture.resume_project_methods[0].project_entry_id = "00000000-0000-4000-8000-000000000099";
  assert.throws(() => adaptResumeRows(fixture), ResumeDataValidationError);
});
