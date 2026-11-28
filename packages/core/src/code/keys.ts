// Work item keys named in code: branch names, pull request titles and
// descriptions, issue titles and commit messages. A key is a project key, a
// hyphen and a number (`PAY-142`), matched case-insensitively and only as a
// whole word, so `xpay-142`, `PAY-1423` (for 142) and `PAY-142a` do not
// name PAY-142. Only the keys of projects the repository is linked to are
// looked for: a repository serving Payments never links an Operations item.

export type ItemKey = { projectKey: string; number: number };

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function detectKeys(
  texts: readonly (string | null | undefined)[],
  projectKeys: readonly string[],
): ItemKey[] {
  const keys = [...new Set(projectKeys.map((k) => k.toUpperCase()))].filter(
    (k) => /^[A-Z][A-Z0-9]{1,9}$/.test(k),
  );
  if (keys.length === 0) return [];
  // Longest first, so OPS2 is preferred to OPS where both exist.
  keys.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])(${keys.map(escape).join("|")})-(\\d{1,9})(?![A-Za-z0-9])`,
    "gi",
  );
  const found = new Map<string, ItemKey>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(pattern)) {
      const projectKey = match[1]!.toUpperCase();
      const number = Number(match[2]);
      if (!Number.isSafeInteger(number) || number < 1) continue;
      found.set(`${projectKey}-${number}`, { projectKey, number });
    }
  }
  return [...found.values()];
}

// A branch name for a work item: its key and a slug of its title,
// lower-case, within Git's ref-name rules (`pay-142-refund-over-the-api`).
export function suggestBranchName(key: string, title: string, prefix = "") {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 8)
    .join("-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  const cleanPrefix = prefix
    .replace(/[^a-zA-Z0-9/_-]/g, "")
    .replace(/^\/+|\/+$/g, "");
  const base = `${key.toLowerCase()}${slug ? `-${slug}` : ""}`;
  return cleanPrefix ? `${cleanPrefix}/${base}` : base;
}
