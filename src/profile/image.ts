import sharp from "sharp";
import { sniffLogo } from "../branding/logo";
import { MAX_PROFILE_PHOTO_SIZE } from "./photo";

export class PhotoError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 413 | 415,
  ) {
    super(message);
  }
}

export async function normalizePhoto(bytes: Uint8Array) {
  if (!bytes.length) throw new PhotoError("Choose a photo to upload.", 400);
  if (bytes.length > MAX_PROFILE_PHOTO_SIZE)
    throw new PhotoError("Choose a photo smaller than 4 MB.", 413);
  if (!sniffLogo(bytes))
    throw new PhotoError("Choose a JPEG, PNG or WebP photo.", 415);
  try {
    // Decode untrusted pixels, bound memory, honor orientation, and strip all
    // metadata. Only the first frame is used, keeping avatars static.
    return await sharp(bytes, {
      limitInputPixels: 25_000_000,
      failOn: "warning",
    })
      .rotate()
      .resize(256, 256, { fit: "cover", position: "centre" })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new PhotoError(
      "This photo could not be read. Choose another image (up to 25 megapixels).",
      400,
    );
  }
}
