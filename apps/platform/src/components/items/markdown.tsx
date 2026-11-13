import {
  Children,
  isValidElement,
  memo,
  useState,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type Options,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Link, Root, Text } from "mdast";
import { parseReferenceTarget } from "@lictory/core/contracts/references";
import { cn } from "@lictory/core/lib/utils";
import { ReferenceChip } from "@lictory/platform/components/references/chips";

function textContent(value: ReactNode): string {
  return Children.toArray(value)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      if (isValidElement<{ children?: ReactNode }>(child))
        return textContent(child.props.children);
      return "";
    })
    .join("");
}

// Whether a word diff marked (part of) a reference's text as added or
// removed (review/markdown-marks.ts).
function diffOf(value: ReactNode): "added" | "removed" | null {
  for (const child of Children.toArray(value)) {
    if (!isValidElement<{ children?: ReactNode; "data-diff"?: string }>(child))
      continue;
    const kind = child.props["data-diff"];
    if (kind === "added" || kind === "removed") return kind;
    const inner = diffOf(child.props.children);
    if (inner) return inner;
  }
  return null;
}

// A changed reference keeps its chip, tinted like the words around it.
const diffChip = {
  added:
    "rounded-md no-underline [&>[data-reference]]:!bg-success/18 [&>[data-reference]]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--success)_45%,transparent)]",
  removed:
    "rounded-md [&>[data-reference]]:!bg-destructive/14 [&>[data-reference]]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--destructive)_40%,transparent)] [&_span]:line-through [&_span]:decoration-destructive",
};

const components: Components = {
  h1: ({ children }) => (
    <h2
      data-heading={textContent(children)}
      className="mt-8 mb-3 text-xl font-semibold tracking-tight first:mt-0"
    >
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3
      data-heading={textContent(children)}
      className="mt-7 mb-2 text-base font-semibold tracking-tight first:mt-0"
    >
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4
      data-heading={textContent(children)}
      className="mt-5 mb-1.5 text-[15px] font-semibold tracking-tight first:mt-0"
    >
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5
      data-heading={textContent(children)}
      className="mt-5 mb-1.5 text-[15px] font-semibold tracking-tight first:mt-0"
    >
      {children}
    </h5>
  ),
  h5: ({ children }) => (
    <h6
      data-heading={textContent(children)}
      className="mt-5 mb-1.5 text-[15px] font-semibold tracking-tight first:mt-0"
    >
      {children}
    </h6>
  ),
  h6: ({ children }) => (
    <h6
      data-heading={textContent(children)}
      className="mt-5 mb-1.5 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase first:mt-0"
    >
      {children}
    </h6>
  ),
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  a: ({ children, href }) => {
    // Work items, pages and decisions as live chips (contracts/references).
    const target = parseReferenceTarget(href);
    if (target) {
      const chip = (
        <ReferenceChip target={target} label={textContent(children)} />
      );
      const diff = diffOf(children);
      if (diff === "added")
        return (
          <ins className={diffChip.added} data-diff="added">
            {chip}
          </ins>
        );
      if (diff === "removed")
        return (
          <del className={diffChip.removed} data-diff="removed">
            {chip}
          </del>
        );
      return chip;
    }
    return href?.startsWith("mention:") ? (
      <span className="rounded bg-primary/10 px-0.5 font-medium text-primary">
        {children}
      </span>
    ) : (
      <a
        href={href}
        rel="noreferrer noopener"
        className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      >
        {children}
      </a>
    );
  },
  ul: ({ children, className }) => (
    <ul
      className={cn(
        "my-3 flex list-disc flex-col gap-1 pl-6",
        className?.includes("contains-task-list") && "list-none pl-0",
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 flex list-decimal flex-col gap-1 pl-6">{children}</ol>
  ),
  li: ({ children, className }) => (
    <li
      className={cn(
        className?.includes("task-list-item") &&
          "flex list-none items-start gap-2 [&>input]:mt-1.5 [&>input]:size-4 [&>input]:shrink-0 [&>input]:accent-primary",
      )}
    >
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 pl-4 text-muted-foreground [&>p]:my-1">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={cn("font-mono text-[13px]", className)}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-[13px] leading-6">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-6" />,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b px-3 py-2 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b px-3 py-2">{children}</td>,
  img: ({ src, alt }) => (
    // Markdown images have content-defined dimensions.

    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      className="my-4 max-h-128 max-w-full rounded-md object-contain shadow-[0_0_0_1px_oklch(0_0_0/0.1)]"
    />
  ),
  // Task list boxes say what they show; the item's text follows them.
  input: ({ type, checked, disabled }) =>
    type === "checkbox" ? (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        readOnly
        aria-label={checked ? "Done" : "Not done"}
      />
    ) : null,
  // Strikethrough reads muted; words a diff marks as removed keep their
  // own class (review/markdown-marks.ts).
  del: ({ children, className }) => (
    <del
      className={
        className?.includes("diff-word")
          ? className
          : "text-muted-foreground decoration-current"
      }
    >
      {children}
    </del>
  ),
};

// A fenced code block with its language and a copy button (Code Block, AI
// Elements), for answers people copy code and payloads from.
function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = Children.toArray(children).find((c) => isValidElement(c));
  const language =
    (isValidElement<{ className?: string }>(code)
      ? /language-([\w+-]+)/.exec(code.props.className ?? "")?.[1]
      : undefined) ?? null;
  const text = textContent(children).replace(/\n$/, "");
  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex h-8 items-center justify-between border-b bg-muted/50 pr-1 pl-3 font-mono text-[11px] text-muted-foreground">
        <span>{language ?? "text"}</span>
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy code"}
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-sans transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          {copied ? (
            <Check className="size-3" aria-hidden />
          ) : (
            <Copy className="size-3" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-6">
        {children}
      </pre>
    </div>
  );
}

const chatComponents: Components = {
  ...components,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

// Mentions (`@[Name](mention:ID)`) and references (`item:`, `page:`,
// `decision:`) survive URL sanitising and render as chips; every other URL
// goes through react-markdown's safe default.
const urlTransform = (url: string) =>
  /^mention:[A-Za-z0-9_-]+$/.test(url) || parseReferenceTarget(url)
    ? url
    : defaultUrlTransform(url);

// The older page form `[[page:ID]]` in text reads as a page reference.
function remarkLegacyPageLinks() {
  const pattern = /\[\[page:([A-Za-z0-9_-]{1,160})\]\]/g;
  const visit = (node: { children?: unknown[] }) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      const c = child as Text | { type: string; children?: unknown[] };
      if (c.type === "code" || c.type === "inlineCode") return [child];
      if (c.type !== "text") {
        visit(c as { children?: unknown[] });
        return [child];
      }
      const value = (c as Text).value;
      if (!value.includes("[[page:")) return [child];
      const out: (Text | Link)[] = [];
      let last = 0;
      for (const match of value.matchAll(pattern)) {
        if (match.index > last)
          out.push({ type: "text", value: value.slice(last, match.index) });
        out.push({
          type: "link",
          url: `page:${match[1]}`,
          children: [{ type: "text", value: "Linked page" }],
        });
        last = match.index + match[0].length;
      }
      if (last < value.length)
        out.push({ type: "text", value: value.slice(last) });
      return out;
    });
  };
  return (tree: Root) => visit(tree);
}

const remarkPlugins = [remarkGfm, remarkLegacyPageLinks];
type Plugins = NonNullable<Options["remarkPlugins"]>;

// CommonMark plus GitHub-flavored tables, task lists, strikethrough and
// autolinks. react-markdown emits React nodes and does not execute raw HTML.
// Parsing is the expensive part, so a document is only re-parsed when its
// source changes.
//
// `marks` are remark plugins that wrap passages of the readable text
// (discussion highlights, changed words; editor/markdown-text.ts). They run
// on the tree as parsed, before Lictory's own rewrites, so their offsets
// are those of the readable text. Pass a stable array.
export const Markdown = memo(function Markdown({
  source,
  className,
  marks,
  codeBlocks,
}: {
  source: string;
  className?: string;
  marks?: Plugins;
  // Code blocks with a language label and a copy button (answers).
  codeBlocks?: boolean;
}) {
  return (
    <div className={cn("spec-prose text-[15px] leading-7", className)}>
      <ReactMarkdown
        remarkPlugins={
          marks?.length
            ? [remarkGfm, ...marks, remarkLegacyPageLinks]
            : remarkPlugins
        }
        components={codeBlocks ? chatComponents : components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
