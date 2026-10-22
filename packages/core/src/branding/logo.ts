// Organization branding: an optional square logomark and an optional wide
// logo. Only raster formats are accepted. SVG can carry script, and these
// images are served from the application origin.

export const logoKinds = ["mark", "full"] as const;
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

export function logoUrl(organizationId: string, kind: LogoKind, sha: string) {
  return `/api/organizations/${encodeURIComponent(organizationId)}/logo/${kind}?v=${sha.slice(0, 16)}`;
}
