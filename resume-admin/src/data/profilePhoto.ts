export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const extensionsByMime = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export function validateProfilePhoto(file: File): string | null {
  if (typeof File === "undefined" || !(file instanceof File) || !Object.prototype.hasOwnProperty.call(extensionsByMime, file.type)) {
    return "Profile photo must be a JPG, PNG, or WebP image.";
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES) return "Profile photo must be 5 MB or smaller.";
  return null;
}

export function profilePhotoExtension(file: File): string {
  const extension = extensionsByMime[file.type as keyof typeof extensionsByMime];
  if (!extension) throw new Error("Profile photo must be a JPG, PNG, or WebP image.");
  return extension;
}
