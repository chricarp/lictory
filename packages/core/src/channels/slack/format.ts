// Text between Slack's mrkdwn and Lictory's Markdown. Pure: no database.
//
// Inbound text is untrusted. Lictory's mention tokens (`@[Ada](mention:ID)`,
// `@[forge](agent:ID)`) are what the conversation writer resolves into
// notifications and agent work, so a Slack message can never carry one by
// typing it: any such token in Slack text is broken before conversion, and
// only the adapter adds tokens, for Slack mentions it resolved itself
// (`<@U123>` of a mapped person) and for agent handles the author may
// address (inbound.ts decides).

// Code spans and blocks are kept verbatim by both directions.
const codePattern = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

function mapOutsideCode(text: string, map: (prose: string) => string) {
  let out = "";
  let last = 0;
  for (const match of text.matchAll(codePattern)) {
    out += map(text.slice(last, match.index));
    out += match[0];
    last = match.index + match[0].length;
  }
  return out + map(text.slice(last));
}

const decodeEntities = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// A label inside `[...]` must not close the link early.
const linkLabel = (label: string) => label.replace(/[[\]]/g, "");

// Breaks Lictory mention tokens typed as text, so they render as text and
// resolve to no one.
export function neutralizeTokens(text: string) {
  return text.replace(/@\[/g, "@\\[");
}

export type InboundResolver = {
  /** A Slack user id as a Lictory person (mapped) or a display name. */
  user(slackUserId: string): { userId: string | null; name: string };
  /** An agent handle the author may address, or null to leave it text. */
  agent(handle: string): { id: string; handle: string } | null;
};

/** Slack mrkdwn to Lictory Markdown. */
export function slackToMarkdown(text: string, resolve: InboundResolver) {
  return mapOutsideCode(text, (prose) => {
    let out = neutralizeTokens(prose).replace(
      /<([^<>\n]{1,2000})>/g,
      (_, inner: string) => {
        const [target = "", label] = inner.split("|", 2) as [string, string?];
        if (target.startsWith("@")) {
          const id = target.slice(1);
          const person = resolve.user(id);
          return person.userId
            ? `@[${linkLabel(person.name)}](mention:${person.userId})`
            : `@${person.name}`;
        }
        if (target.startsWith("#")) return `#${label ?? "channel"}`;
        if (target.startsWith("!subteam^")) return label ?? "@team";
        if (target.startsWith("!date^")) return label ?? "";
        if (target.startsWith("!")) return `@${target.slice(1)}`;
        if (/^(https?|mailto):/i.test(target)) {
          const url = decodeEntities(target);
          return label
            ? `[${linkLabel(decodeEntities(label))}](${url})`
            : `<${url}>`;
        }
        return label ?? target;
      },
    );
    out = decodeEntities(out);
    // Bold and strike: Slack's single markers to Markdown's double ones.
    out = out
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, "$1**$2**")
      .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/g, "$1~~$2~~");
    // Agent handles the author may address become tokens.
    out = out.replace(
      /(^|[\s(])@([a-z0-9][a-z0-9_-]{1,39})\b/g,
      (whole, before: string, handle: string) => {
        const agent = resolve.agent(handle);
        return agent ? `${before}@[${agent.handle}](agent:${agent.id})` : whole;
      },
    );
    return out;
  });
}

/** `@handle` words a Slack text may address (outside code). */
export function slackHandles(text: string): string[] {
  const handles = new Set<string>();
  mapOutsideCode(text, (prose) => {
    for (const m of prose.matchAll(/(^|[\s(])@([a-z0-9][a-z0-9_-]{1,39})\b/g))
      handles.add(m[2]!);
    return prose;
  });
  return [...handles];
}

/** Slack user ids mentioned (`<@U123>`), outside code. */
export function slackUserMentions(text: string): string[] {
  const ids = new Set<string>();
  mapOutsideCode(text, (prose) => {
    for (const m of prose.matchAll(/<@([A-Z0-9]{2,20})(?:\|[^>]*)?>/g))
      ids.add(m[1]!);
    return prose;
  });
  return [...ids];
}

const escapeSlack = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type OutboundResolver = {
  /** The Slack user id of a Lictory person, when known. */
  slackUser(userId: string): string | null;
};

/** Lictory Markdown to Slack mrkdwn. */
export function markdownToSlack(body: string, resolve: OutboundResolver) {
  return mapOutsideCode(body, (prose) => {
    const links: string[] = [];
    const hold = (slack: string) => `\u0000${links.push(slack) - 1}\u0000`;
    let out = prose
      .replace(
        /@\[([^\]\n]{1,120})\]\(mention:([A-Za-z0-9_-]{1,160})\)/g,
        (_, label: string, id: string) => {
          const slackId = resolve.slackUser(id);
          return slackId ? hold(`<@${slackId}>`) : `@${label}`;
        },
      )
      .replace(
        /@\[([^\]\n]{1,120})\]\(agent:[A-Za-z0-9_-]{1,160}\)/g,
        (_, label: string) => `@${label}`,
      )
      .replace(
        /!?\[([^\]\n]*)\]\(((?:https?|mailto):[^)\s]+)\)/g,
        (_, label: string, url: string) =>
          hold(
            label
              ? `<${url}|${escapeSlack(label).replace(/\|/g, "¦")}>`
              : `<${url}>`,
          ),
      )
      // Lictory references (items, pages, decisions) keep their label.
      .replace(/\[([^\]\n]+)\]\([a-z]+:[^)\s]+\)/g, "$1")
      .replace(/<((?:https?|mailto):[^>\s]+)>/g, (_, url: string) =>
        hold(`<${url}>`),
      );
    out = escapeSlack(out)
      .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
      .replace(/\*\*([^*\n]+)\*\*/g, "\u0001$1\u0001")
      .replace(/__([^_\n]+)__/g, "\u0001$1\u0001")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1_$2_")
      .replace(/\u0001/g, "*")
      .replace(/~~([^~\n]+)~~/g, "~$1~");
    return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => links[+i]!);
  });
}

/** Plain text for Slack's notification fallback. */
export function slackFallback(mrkdwn: string, max = 3000) {
  return mrkdwn.length > max ? `${mrkdwn.slice(0, max - 1)}…` : mrkdwn;
}

// Slack's limit for one message's text is 40,000 characters; Lictory's is
// 16,000, so every Lictory message fits. Imported text longer than
// Lictory's limit is cut with a note and a link to the original.
export function clampImported(markdown: string, max: number, url?: string) {
  if (markdown.length <= max) return markdown;
  const note = url
    ? `\n\n… [continued in Slack](${url})`
    : "\n\n… (cut: too long for Lictory)";
  return markdown.slice(0, max - note.length) + note;
}

/** A Block Kit summary of a Lictory card with a link back to Lictory. */
export function cardBlocks(input: {
  text: string;
  url: string;
  label?: string;
}): unknown[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: input.text.slice(0, 2900) },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: input.label ?? "Open in Lictory",
          },
          url: input.url,
          action_id: "lictory_open",
        },
      ],
    },
  ];
}

/** `:thumbsup:` for Lictory, `thumbsup` for Slack. */
export const slackEmojiToLictory = (name: string) => `:${name}:`;
export function lictoryEmojiToSlack(emoji: string): string | null {
  const named = /^:([a-z0-9_+-]{1,60}):$/.exec(emoji);
  if (named) return named[1]!;
  return unicodeEmojiNames[emoji] ?? null;
}

// The reactions the Lictory picker offers, by their Slack names. Other
// Unicode emoji have no Slack name Lictory can be sure of and stay local.
const unicodeEmojiNames: Record<string, string> = {
  "👍": "+1",
  "👎": "-1",
  "❤️": "heart",
  "😄": "smile",
  "😂": "joy",
  "🎉": "tada",
  "🙏": "pray",
  "👀": "eyes",
  "🚀": "rocket",
  "✅": "white_check_mark",
  "❌": "x",
  "🔥": "fire",
  "💯": "100",
  "🤔": "thinking_face",
  "👏": "clap",
  "😢": "cry",
  "😅": "sweat_smile",
  "😮": "open_mouth",
  "🙌": "raised_hands",
  "👌": "ok_hand",
  "💡": "bulb",
  "📌": "pushpin",
  "🐛": "bug",
  "⚠️": "warning",
  "➕": "heavy_plus_sign",
};
const slackNameToUnicode = Object.fromEntries(
  Object.entries(unicodeEmojiNames).map(([k, v]) => [v, k]),
);
slackNameToUnicode.thumbsup = "👍";
slackNameToUnicode.thumbsdown = "👎";

/** A Slack reaction name as the emoji Lictory stores. */
export function slackReactionToLictory(name: string): string {
  const base = name.split("::")[0]!;
  return slackNameToUnicode[base] ?? slackEmojiToLictory(base);
}
