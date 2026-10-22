// Keep raw uploads below the hosted function request limit.
export const MAX_PROFILE_PHOTO_SIZE = 4 * 1024 * 1024;
export const ACCEPT_PROFILE_PHOTO = "image/png,image/jpeg,image/webp";

export function profilePhotoUrl(userId: string, sha: string) {
  return `/api/users/${encodeURIComponent(userId)}/photo?v=${sha}`;
}

// Provider URLs are displayed by the browser, never fetched by the server.
export function safeProfileImage(image: string | null | undefined) {
  if (!image) return null;
  if (/^\/api\/users\/[^/?#]+\/photo\?v=[a-f0-9]{64}$/.test(image))
    return image;
  try {
    const url = new URL(image);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
