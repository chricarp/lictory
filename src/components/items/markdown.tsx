import { Fragment, type ReactNode } from "react";
import { cn } from "~/lib/utils";

// Minimal Markdown → React renderer for specifications: headings, paragraphs,
// lists (incl. task items), block quotes, fenced code, rules and inline
// code/bold/italic/links. Output is React elements, never raw HTML.
type Block =
  | { kind: "heading"; level: number; text: string; line: number }
  | { kind: "paragraph"; text: string; line: number }
  | {
      kind: "list";
      ordered: boolean;
      items: { text: string; checked?: boolean; line: number }[];
      line: number;
    }
  | { kind: "quote"; text: string; line: number }
  | { kind: "code"; text: string; language?: string; line: number }
  | { kind: "rule"; line: number };

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```\s*(\w+)?\s*$/.exec(line);
    if (fence) {
      const start = i;
      const buffer: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!))
        buffer.push(lines[i++]!);
      i++;
      blocks.push({
        kind: "code",
        text: buffer.join("\n"),
        language: fence[1],
        line: start,
      });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: heading[2]!,
        line: i,
      });
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: "rule", line: i });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const start = i;
      const buffer: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!))
        buffer.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: buffer.join("\n"), line: start });
      continue;
    }
    const listItem = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listItem) {
      const start = i;
      const ordered = /\d/.test(listItem[1]!);
      const items: { text: string; checked?: boolean; line: number }[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(m[1]!) !== ordered) break;
        const task = /^\[( |x|X)\]\s*(.*)$/.exec(m[2]!);
        items.push({
          text: task ? task[2]! : m[2]!,
          checked: task ? task[1]!.toLowerCase() === "x" : undefined,
          line: i,
        });
        i++;
        // Continuation lines indented under the item.
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]!) &&
          !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)
        ) {
          items[items.length - 1]!.text += ` ${lines[i]!.trim()}`;
          i++;
        }
      }
      blocks.push({ kind: "list", ordered, items, line: start });
      continue;
    }
    const start = i;
    const buffer: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(#{1,6})\s/.test(lines[i]!) &&
      !lines[i]!.startsWith("```") &&
      !/^>\s?/.test(lines[i]!) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]!)
    )
      buffer.push(lines[i++]!);
    blocks.push({ kind: "paragraph", text: buffer.join(" "), line: start });
  }
  return blocks;
}

const inlinePattern =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
export function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const [raw] = match;
    if (match[1])
      nodes.push(
        <code
          key={key++}
          className="rounded bg-muted px-1 py-px font-mono text-[0.85em]"
        >
          {raw.slice(1, -1)}
        </code>,
      );
    else if (match[2] || match[3])
      nodes.push(
        <strong key={key++} className="font-semibold">
          {renderInline(raw.slice(2, -2))}
        </strong>,
      );
    else if (match[4] || match[5])
      nodes.push(<em key={key++}>{renderInline(raw.slice(1, -1))}</em>);
    else if (match[6]) {
      const href = match[8]!;
      const safe = /^(https?:\/\/|mailto:|\/)/i.test(href);
      nodes.push(
        safe ? (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            {match[7]}
          </a>
        ) : (
          <span key={key++}>{match[7]}</span>
        ),
      );
    }
    last = index + raw.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length === 1 ? nodes[0] : <Fragment>{nodes}</Fragment>;
}

export function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const blocks = parseBlocks(source);
  return (
    <div className={cn("spec-prose text-[15px] leading-7", className)}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const Tag = `h${Math.min(6, block.level + 1)}` as
              "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag
                key={index}
                data-heading={block.text}
                className={cn(
                  "font-semibold tracking-tight",
                  block.level === 1 && "mt-8 mb-3 text-xl first:mt-0",
                  block.level === 2 && "mt-7 mb-2 text-base first:mt-0",
                  block.level >= 3 && "mt-5 mb-1.5 text-[15px] first:mt-0",
                )}
              >
                {renderInline(block.text)}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={index} className="my-3 first:mt-0">
                {renderInline(block.text)}
              </p>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag
                key={index}
                className={cn(
                  "my-3 space-y-1 pl-6",
                  block.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {block.items.map((item, i) => (
                  <li
                    key={i}
                    className={cn(
                      item.checked !== undefined &&
                        "-ml-6 flex list-none items-start gap-2",
                    )}
                  >
                    {item.checked !== undefined && (
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 grid size-4 shrink-0 place-items-center rounded border text-[10px]",
                          item.checked
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-muted-foreground/50",
                        )}
                      >
                        {item.checked && "✓"}
                      </span>
                    )}
                    <span
                      className={cn(
                        item.checked && "text-muted-foreground line-through",
                      )}
                    >
                      {renderInline(item.text)}
                    </span>
                  </li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote
                key={index}
                className="my-3 border-l-2 pl-4 text-muted-foreground"
              >
                {block.text.split("\n").map((l, i) => (
                  <p key={i}>{renderInline(l)}</p>
                ))}
              </blockquote>
            );
          case "code":
            return (
              <pre
                key={index}
                className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px] leading-6"
              >
                <code>{block.text}</code>
              </pre>
            );
          case "rule":
            return <hr key={index} className="my-6" />;
        }
      })}
    </div>
  );
}
