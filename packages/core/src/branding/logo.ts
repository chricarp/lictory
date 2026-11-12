// Organization branding images: an optional square logomark, an optional wide
// logo and an optional browser icon. Only raster formats are accepted. SVG
// can carry script, and these images are served from the application origin.

export const logoKinds = ["mark", "full", "icon"] as const;
export type LogoKind = (typeof logoKinds)[number];
export const MAX_LOGO_SIZE = 512 * 1024;
export const ACCEPT_LOGO = "image/png,image/jpeg,image/webp";

export function isLogoKind(value: string): value is LogoKind {
  return (logoKinds as readonly string[]).includes(value);
}

// The type comes from the file's bytes, not from what the browser claims.
export function sniffLogo(bytes: Uint8Array) {
  const starts = (sig: number[], at = 0) =>
    sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

export type LogoCheck =
  | { ok: true; mimeType: string }
  | { ok: false; error: string; status: 400 | 413 | 415 };

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (!bytes.length)
    return { ok: false, error: "The image is empty.", status: 400 };
  if (bytes.length > MAX_LOGO_SIZE)
    return {
      ok: false,
      error: `Logos can be at most ${MAX_LOGO_SIZE / 1024} KB. This image is ${Math.ceil(bytes.length / 1024)} KB.`,
      status: 413,
    };
  const mimeType = sniffLogo(bytes);
  if (!mimeType)
    return {
      ok: false,
      error: "Upload a PNG, JPEG or WebP image.",
      status: 415,
    };
  return { ok: true, mimeType };
}

// Pixel dimensions read from the image header, or null when the header is not
// one this understands. Email needs them: some mail clients ignore CSS sizes
// and would show the image at its natural size.
export function imageSize(bytes: Uint8Array) {
  const u16 = (at: number) => (bytes[at]! << 8) | bytes[at + 1]!;
  const u32 = (at: number) => u16(at) * 0x10000 + u16(at + 2);
  const le = (at: number, length: number) => {
    let value = 0;
    for (let i = length - 1; i >= 0; i--) value = value * 256 + bytes[at + i]!;
    return value;
  };
  const size = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  const type = sniffLogo(bytes);
  const tag = (at: number) =>
    String.fromCharCode(...bytes.subarray(at, at + 4));
  if (type === "image/png")
    return bytes.length >= 24 && tag(12) === "IHDR"
      ? size(u32(16), u32(20))
      : null;
  if (type === "image/jpeg") {
    let at = 2;
    while (at + 9 < bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1]!;
      // Start-of-frame markers carry the dimensions.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return size(u16(at + 7), u16(at + 5));
      at += 2 + u16(at + 2);
    }
    return null;
  }
  if (type === "image/webp" && bytes.length >= 30) {
    const chunk = tag(12);
    if (chunk === "VP8 ") return size(le(26, 2) & 0x3fff, le(28, 2) & 0x3fff);
    if (chunk === "VP8L") {
      const bits = le(21, 4);
      return size(
        (bits & 0x3fff) + 1,
        (Math.floor(bits / 0x4000) & 0x3fff) + 1,
      );
    }
    if (chunk === "VP8X") return size(le(24, 3) + 1, le(27, 3) + 1);
  }
  return null;
}

export function logoUrl(organizationId: string, kind: LogoKind, sha: string) {
  return `/api/organizations/${encodeURIComponent(organizationId)}/logo/${kind}?v=${sha.slice(0, 16)}`;
}

// The address email uses for a logo. Mail clients cannot sign in, so this one
// is public; the image's full SHA-256 in the path keeps it unguessable to
// anyone who has not already been sent the image.
export function publicLogoPath(
  organizationId: string,
  kind: LogoKind,
  sha: string,
) {
  return `/api/organizations/${encodeURIComponent(organizationId)}/logo/${kind}/${sha}`;
}
