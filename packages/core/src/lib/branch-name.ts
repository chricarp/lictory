/**
 * Branch names follow Git's ref-name rules (`git check-ref-format`) as enforced
 * by GitHub, restricted to a conservative ASCII character set.
 */
export const BRANCH_NAME_MAX_LENGTH = 80;

/**
 * Normalizes input while the user types: whitespace becomes "-", other
 * disallowed characters are dropped, and repeated separators collapse. Trailing
 * separators are kept so the user can keep typing; use `finalizeBranchName`
 * before submitting.
 */
export function sanitizeBranchNameInput(value: string): string {
  return value
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._/-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/\.{2,}/g, ".")
    .replace(/\/[.-]+/g, "/")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, BRANCH_NAME_MAX_LENGTH);
}

/** Removes trailing separators and a trailing ".lock" left over from typing. */
export function finalizeBranchName(value: string): string {
  let name = sanitizeBranchNameInput(value);
  for (;;) {
    const next = name.replace(/[./-]+$/, "").replace(/\.lock$/i, "");
    if (next === name) return name;
    name = next;
  }
}

/** Returns a human-readable problem, or null when the name is valid. */
export function branchNameProblem(name: string): string | null {
  if (!name) return "Enter a branch name.";
  if (name.length > BRANCH_NAME_MAX_LENGTH)
    return `Use at most ${BRANCH_NAME_MAX_LENGTH} characters.`;
  if (!/^[a-zA-Z0-9._/-]+$/.test(name))
    return "Use only letters, numbers, “-”, “_”, “.” and “/”.";
  if (!/^[a-zA-Z0-9]/.test(name))
    return "Start the name with a letter or number.";
  if (/[./-]$/.test(name)) return "Don’t end the name with “-”, “.” or “/”.";
  if (name.includes("..")) return "Don’t use “..” in the name.";
  if (name.includes("//")) return "Don’t use “//” in the name.";
  if (
    name.split("/").some((part) => /^[.-]/.test(part) || /\.lock$/i.test(part))
  )
    return "Each part between “/” must start with a letter or number and not end with “.lock”.";
  if (name.toLowerCase() === "main")
    return "That branch name is already in use.";
  return null;
}

export function isValidBranchName(name: string): boolean {
  return branchNameProblem(name) === null;
}
