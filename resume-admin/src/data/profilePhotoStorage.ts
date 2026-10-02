const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Return an object key only for this app's canonical profile image in the current resume namespace. */
export function managedProfilePhotoObjectPath(supabaseUrl: string | undefined, resumeId: string, photoUrl: string | null | undefined): string | null {
  if (!supabaseUrl || !photoUrl || !new RegExp(`^${UUID}$`).test(resumeId)) return null;

  let project: URL;
  let image: URL;
  try {
    project = new URL(supabaseUrl);
    image = new URL(photoUrl);
  } catch {
    return null;
  }

  if (!/^https?:$/.test(project.protocol) || project.username || project.password || project.search || project.hash
    || (project.pathname !== "/" && project.pathname !== "")) return null;
  if (image.origin !== project.origin || image.username || image.password || image.search || image.hash
    || photoUrl.includes("%") || photoUrl.includes("\\")) return null;

  const prefix = `/storage/v1/object/public/profile-images/${resumeId}/profile/`;
  if (!image.pathname.startsWith(prefix)) return null;
  const filename = image.pathname.slice(prefix.length);
  if (!new RegExp(`^${UUID}\\.(?:jpg|jpeg|png|webp)$`).test(filename)) return null;

  const objectPath = `${resumeId}/profile/${filename}`;
  if (photoUrl !== `${project.origin}/storage/v1/object/public/profile-images/${objectPath}`) return null;
  return objectPath;
}
