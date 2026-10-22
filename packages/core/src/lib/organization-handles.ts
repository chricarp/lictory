// Organization handles are URL names, independent of organization IDs and
// person handles. Existing generated slugs remain valid until changed.
export const ORGANIZATION_HANDLE_MAX = 30;

// Organizations are the first path segment of the app (app.lictory.com/acme),
// so no organization may shadow a top-level app page, API or static asset path.
const reserved = new Set([
  // App pages.
  "account",
  "auth-error",
  "forgot-password",
  "invitation",
  "new-organization",
  "reset-password",
  "sign-in",
  "sign-up",
  "verify-email",
  "welcome",
  // Server and static paths.
  "api",
  "app",
  "assets",
  "brand",
  "favicon.ico",
  "healthz",
  "icon.svg",
  "illustrations",
  "manifest.webmanifest",
  "readyz",
  "relay",
  "robots.txt",
  "zero",
  // Names that would read as Lictory itself.
  "admin",
  "help",
  "lictory",
  "root",
  "settings",
  "support",
  "system",
]);

export function normalizeOrganizationHandle(input: string) {
  return input.trim().toLowerCase();
}

export function organizationHandleProblem(handle: string): string | null {
  if (handle.length < 3) return "Use at least 3 characters.";
  if (handle.length > ORGANIZATION_HANDLE_MAX)
    return `Use at most ${ORGANIZATION_HANDLE_MAX} characters.`;
  if (!/^[a-z][a-z0-9_-]*$/.test(handle))
    return "Start with a letter and use only letters, numbers, hyphens and underscores.";
  if (/[-_]{2}/.test(handle)) return "Avoid consecutive separators.";
  if (/[-_]$/.test(handle)) return "Handles cannot end with a separator.";
  if (reserved.has(handle)) return "That organization handle is reserved.";
  return null;
}

export function suggestOrganizationHandle(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, ORGANIZATION_HANDLE_MAX)
    .replace(/-+$/, "");
}

export function organizationHandleError(error: {
  code?: string;
  message?: string;
}) {
  return [
    "ORGANIZATION_ALREADY_EXISTS",
    "ORGANIZATION_SLUG_ALREADY_TAKEN",
  ].includes(error.code ?? "")
    ? "That organization handle is already taken."
    : (error.message ?? "Could not save the organization. Try again.");
}
