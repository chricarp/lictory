// Mentions are stored in message bodies as Markdown links with a `mention:`
// target: `@[ada](mention:USER_ID)`. The label (the person's handle, or their
// name if they have none) keeps the text readable anywhere Markdown is shown;
// the ID is what the server trusts (after checking organization membership),
// so mentions survive handle changes.
const pattern = /@\[([^\]\n]{1,120})\]\(mention:([A-Za-z0-9_-]{1,64})\)/g;

export function mentionToken(user: {
  id: string;
  name: string;
  handle?: string | null;
}) {
  const label =
    (user.handle ?? user.name).replace(/[[\]\n]/g, "").trim() || "member";
  return `@[${label}](mention:${user.id})`;
}

export function mentionedUserIds(body: string): string[] {
  return [...new Set([...body.matchAll(pattern)].map((m) => m[2]!))];
}

// Plain-text rendering for email and notification excerpts.
export function stripMentions(body: string) {
  return body.replace(pattern, (_, label: string) => `@${label}`);
}
