import Link from "next/link";
import { Callout } from "fumadocs-ui/components/callout";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";

import { bootstrap, commands, type CliCommand } from "@lictory/docs/lib/cli";

function usage(command: CliCommand) {
  return command === "bootstrap" ? bootstrap : commands[command].usage;
}

/** One or more `lictory` commands as a copyable shell block. */
export function Cli({ command }: { command: CliCommand | CliCommand[] }) {
  const lines = (Array.isArray(command) ? command : [command]).map(usage);
  return (
    <CodeBlock title="lictory CLI">
      <Pre>
        <code>{lines.join("\n")}</code>
      </Pre>
    </CodeBlock>
  );
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

/** Every command with a one-line summary. */
export function CliReference() {
  return (
    <table>
      <thead>
        <tr>
          <th>Command</th>
          <th>What it does</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>{bootstrap}</code>
          </td>
          <td>Install the lictory command itself.</td>
        </tr>
        {Object.values(commands).map(({ usage, summary }) => (
          <tr key={usage}>
            <td>
              <code>{usage}</code>
            </td>
            <td>{summary}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
