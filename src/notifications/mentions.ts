// Mentions are stored in message bodies as Markdown links with a `mention:`
// target: `@[Ada Lovelace](mention:USER_ID)`. The label keeps the text readable
// anywhere Markdown is shown; the ID is what the server trusts (after checking
// organization membership).
const pattern = /@\[([^\]\n]{1,120})\]\(mention:([A-Za-z0-9_-]{1,64})\)/g;

export function mentionToken(user: { id: string; name: string }) {
  const label = user.name.replace(/[[\]\n]/g, "").trim() || "member";
  return `@[${label}](mention:${user.id})`;
}

export function mentionedUserIds(body: string): string[] {
  return [...new Set([...body.matchAll(pattern)].map((m) => m[2]!))];
}

// Plain-text rendering for email and notification excerpts.
export function stripMentions(body: string) {
  return body.replace(pattern, (_, label: string) => `@${label}`);
}
