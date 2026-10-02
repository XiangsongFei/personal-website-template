import { describe, expect, it } from "vitest";
import { managedProfilePhotoObjectPath } from "../src/data/profilePhotoStorage";

const projectUrl = "https://project.example.test";
const resumeId = "11111111-1111-4111-8111-111111111111";
const otherResumeId = "22222222-2222-4222-8222-222222222222";
const filename = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp";
const managedUrl = `${projectUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/${filename}`;

describe("managed profile photo object paths", () => {
  it("accepts only the canonical current-resume public profile image URL", () => {
    expect(managedProfilePhotoObjectPath(projectUrl, resumeId, managedUrl)).toBe(`${resumeId}/profile/${filename}`);
  });

  it.each([
    "https://external.example.test/storage/v1/object/public/profile-images/11111111-1111-4111-8111-111111111111/profile/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
    "https://project.example.test/storage/v1/object/public/profile-images/example-cv/profile/photo.webp",
    `https://project.example.test/storage/v1/object/public/profile-images/${otherResumeId}/profile/${filename}`,
    `${projectUrl}/storage/v1/object/sign/profile-images/${resumeId}/profile/${filename}`,
    `${projectUrl}/storage/v1/render/image/public/profile-images/${resumeId}/profile/${filename}`,
    `${projectUrl}/storage/v1/object/public/resume-files/${resumeId}/profile/${filename}`,
    `${projectUrl}/storage/v1/object/public/profile-images/${resumeId}/profile/%2e%2e%2f${filename}`,
    `${managedUrl}?token=signed`,
  ])("rejects unmanaged, foreign, legacy, transformed, or ambiguous URL %s", url => {
    expect(managedProfilePhotoObjectPath(projectUrl, resumeId, url)).toBeNull();
  });

  it.each([null, undefined, "", "not a URL"]) ("rejects empty or malformed URL %s", url => {
    expect(managedProfilePhotoObjectPath(projectUrl, resumeId, url)).toBeNull();
  });
});
