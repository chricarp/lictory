import Link from "next/link";
import { Callout } from "fumadocs-ui/components/callout";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { highlight } from "fumadocs-core/highlight";

import { bootstrap, commands, type CliCommand } from "@lictory/docs/lib/cli";

function usage(command: CliCommand) {
  return command === "bootstrap" ? bootstrap : commands[command].usage;
}

/**
 * One or more `lictory` commands as a copyable shell block, highlighted like
 * the Markdown code blocks around it (same themes, padded `.line` rows).
 */
export async function Cli({ command }: { command: CliCommand | CliCommand[] }) {
  const lines = (Array.isArray(command) ? command : [command]).map(usage);
  return highlight(lines.join("\n"), {
    lang: "sh",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    components: {
      pre: (props) => (
        <CodeBlock title="lictory CLI">
          <Pre {...props} />
        </CodeBlock>
      ),
    },
  });
}

/** States what the commands are, wherever the documentation relies on them. */
export function CliNotice() {
  return (
    <Callout title="The lictory CLI">
      Commands marked <em>lictory CLI</em> belong to the <code>lictory</code>{" "}
      command, which installs and operates a server. Every command takes{" "}
      <code>--env</code> for a second environment on the same server; run{" "}
      <code>lictory &lt;command&gt; --help</code> for its options, or see the{" "}
      <Link href="/self-hosting/commands">command reference</Link>.
    </Callout>
  );
}

/**
 * Every command with its summary: the command on its own line, the summary
 * below at reading width. (A two-column table squeezed the summaries into a
 * narrow column beside the long commands.)
 */
export function CliReference() {
  const entries = [
    { usage: bootstrap, summary: "Install the lictory command itself." },
    ...Object.values(commands),
  ];
  return (
    <dl className="cli-reference">
      {entries.map(({ usage, summary }) => (
        <div key={usage}>
          <dt>
            <code>{usage}</code>
          </dt>
          <dd>{summary}</dd>
        </div>
      ))}
    </dl>
  );
}
