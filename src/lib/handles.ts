// A handle is a person's platform-wide name: `@alex_morgan`. It is unique
// across every organization, stored lowercase, and used to mention and find
// people. Mentions still reference the user ID, so changing a handle never
// breaks existing mentions.
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;

const shape = /^[a-z][a-z0-9_]*$/;

// Names that would be confusing or impersonate the product or its staff.
const reserved = new Set([
  "admin",
  "administrator",
  "all",
  "anonymous",
  "api",
  "app",
  "channel",
  "everyone",
  "here",
  "help",
  "lictory",
  "me",
  "mod",
  "moderator",
  "null",
  "owner",
  "root",
  "security",
  "settings",
  "staff",
  "support",
  "system",
  "team",
  "undefined",
  "unassigned",
]);

export function normalizeHandle(input: string) {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

// Returns why a (normalized) handle is unacceptable, or null when it is valid.
export function handleProblem(handle: string): string | null {
  if (handle.length < HANDLE_MIN)
    return `Use at least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX)
    return `Use at most ${HANDLE_MAX} characters.`;
  if (!shape.test(handle))
    return "Start with a letter and use only letters, numbers and underscores.";
  if (handle.includes("__")) return "Avoid consecutive underscores.";
  if (handle.endsWith("_")) return "Handles cannot end with an underscore.";
  if (reserved.has(handle)) return "That handle is reserved.";
  return null;
}

function clean(part: string) {
  return part
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function fit(handle: string) {
  let h = handle.replace(/^[^a-z]+/, "").slice(0, HANDLE_MAX);
  h = h.replace(/_+$/, "");
  return h;
}

// Ordered, valid candidates derived from a name and email. Availability is
// checked by the server; these are only starting points.
export function handleCandidates(name: string, email: string): string[] {
  const words = clean(name).split("_").filter(Boolean);
  const local = clean(email.split("@")[0] ?? "");
  const first = words[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]! : "";
  const bases = [
    words.join("_"),
    first && last ? `${first}${last}` : "",
    first && last ? `${first[0]}${last}` : "",
    local,
    first,
  ]
    .map(fit)
    .filter((h) => handleProblem(h) === null);
  const unique = [...new Set(bases)];
  const root = unique[0] ?? fit(`${local || first || "member"}`);
  const base = handleProblem(root) === null ? root : "member";
  for (let n = 1; unique.length < 12; n++) {
    const suffix = String(n + (n > 3 ? 7 * n : 0));
    unique.push(`${base.slice(0, HANDLE_MAX - suffix.length)}${suffix}`);
  }
  return unique.filter((h) => handleProblem(h) === null);
}

// Local person search shared by pickers and @mention autocomplete. "@al"
// matches handles only; plain text also matches name and email.
export function matchesPerson(
  person: { name: string; email?: string; handle?: string | null },
  query: string,
) {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  const q = raw.replace(/^@+/, "");
  const handle = person.handle?.startsWith(q) ?? false;
  if (raw.startsWith("@")) return handle;
  return (
    handle ||
    person.name.toLowerCase().includes(q) ||
    (person.email?.toLowerCase().includes(q) ?? false)
  );
}
