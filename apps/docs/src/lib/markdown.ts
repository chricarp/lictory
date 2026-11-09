import { renderPlaceholder } from "fumadocs-core/mdx-plugins/remark-llms.runtime";

import { bootstrap, commands, type CliCommand } from "@lictory/docs/lib/cli";
import { absoluteUrl, site } from "@lictory/docs/lib/site";
import type { source } from "@lictory/docs/lib/source";

// Markdown versions of the documentation pages, for AI assistants and agents:
// served at the page URL with `.md` appended and concatenated in
// llms-full.txt (https://llmstxt.org). The HTML pages stay canonical.

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

/** An MDX attribute: a string, or an expression such as `{["a", "b"]}`. */
function commandList(value: unknown): CliCommand[] {
  if (typeof value === "string") return [value as CliCommand];
  const expression = (value as { value?: string } | undefined)?.value ?? "[]";
  return JSON.parse(expression) as CliCommand[];
}

const usage = (command: CliCommand) =>
  command === "bootstrap" ? bootstrap : commands[command].usage;

type Placeholder = {
  attributes: Record<string, unknown>;
  children: string;
};

/** A block of its own, separated from the text around it. */
const block = (text: string) => `\n\n${text.trim()}\n\n`;

// The components source.ts lists as placeholders, written as plain Markdown.
// Illustrations repeat what the surrounding text says, so they are dropped.
const renderers = {
  Steps: ({ children }: Placeholder) => block(children),
  Step: ({ children }: Placeholder) => block(children),
  Tabs: ({ children }: Placeholder) => block(children),
  Tab: ({ attributes, children }: Placeholder) =>
    block(
      `${typeof attributes.value === "string" ? `**${attributes.value}**\n\n` : ""}${children}`,
    ),
  Cards: ({ children }: Placeholder) => block(children),
  Card: ({ attributes, children }: Placeholder) =>
    `- [${String(attributes.title)}](${String(attributes.href)})${children.trim() ? `: ${children.trim()}` : ""}\n`,
  Callout: ({ attributes, children }: Placeholder) => {
    const title =
      typeof attributes.title === "string" ? `**${attributes.title}:** ` : "";
    const text = children
      .trim()
      .split("\n")
      .map((line) => line.trim());
    return block(`> ${title}${text.join("\n> ")}`);
  },
  Cli: ({ attributes }: Placeholder) =>
    block(
      `\`\`\`sh\n${commandList(attributes.command).map(usage).join("\n")}\n\`\`\``,
    ),
  CliNotice: () =>
    block(
      "> **The lictory CLI:** commands marked _lictory CLI_ belong to the `lictory` command, which installs and operates a server. Every command takes `--env` for a second environment on the same server; run `lictory <command> --help` for its options, or see the [command reference](/self-hosting/commands).",
    ),
  CliReference: () =>
    block(
      [
        `- \`${bootstrap}\`: Install the lictory command itself.`,
        ...Object.values(commands).map(
          (command) => `- \`${command.usage}\`: ${command.summary}`,
        ),
      ].join("\n"),
    ),
  Lifecycle: () => "",
  DirectPublishing: () => "",
  ReviewedChange: () => "",
  SpaceAccess: () => "",
};

/** Root-relative links and images become absolute, so the text stands alone. */
function absoluteLinks(markdown: string) {
  return markdown.replace(/\]\(\//g, `](${site.url}/`);
}

/** The page as one Markdown document, its title as the only level-1 heading. */
export async function pageMarkdown(page: DocsPage) {
  const body = await renderPlaceholder(
    await page.data.getText("processed"),
    renderers,
  );
  return `# ${page.data.title}

> ${page.data.description}

Canonical URL: ${absoluteUrl(page.url)}

${absoluteLinks(body.replace(/\n{3,}/g, "\n\n").trim())}
`;
}
