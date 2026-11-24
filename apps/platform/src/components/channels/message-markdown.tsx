import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { parseReferenceTarget } from "@lictory/core/contracts/references";
import { cn } from "@lictory/core/lib/utils";
import { ReferenceChip } from "@lictory/platform/components/references/chips";
import { remarkMentionAt } from "@lictory/platform/components/channels/mention-at";

// Chat Markdown: compact typography, mentions of people and agents as
// highlighted names (my own mentions stronger), work items, pages and
// decisions as live reference chips, channel files as file chips and image
// previews. react-markdown never executes raw HTML.

const filePattern = /^\/api\/files\/[A-Za-z0-9-]{1,80}$/;

function text(value: ReactNode): string {
  return Children.toArray(value)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? text(child.props.children)
          : "",
    )
    .join("");
}

const urlTransform = (url: string) =>
  /^(mention|agent):[A-Za-z0-9_-]+$/.test(url) || parseReferenceTarget(url)
    ? url
    : defaultUrlTransform(url);

function components(userId: string): Components {
  return {
    p: ({ children }) => (
      <p className="my-1 first:mt-0 last:mb-0">{children}</p>
    ),
    a: ({ children, href }) => {
      const target = parseReferenceTarget(href);
      if (target)
        return <ReferenceChip target={target} label={text(children)} />;
      if (href?.startsWith("mention:") || href?.startsWith("agent:")) {
        const mine = href === `mention:${userId}`;
        return (
          <span
            data-mention={href}
            className={cn(
              "rounded px-0.5 font-medium",
              mine
                ? "bg-amber-400/25 text-foreground"
                : "bg-primary/10 text-primary",
            )}
          >
            {children}
          </span>
        );
      }
      if (href && filePattern.test(href))
        return (
          <a
            href={`${href}?download=1`}
            className="my-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 align-middle text-[13px] text-foreground no-underline hover:bg-muted"
          >
            <FileText
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate">{children}</span>
          </a>
        );
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt }) =>
      typeof src === "string" ? (
        // An image preview; it opens full size in a new tab.
        <a
          href={src}
          target="_blank"
          rel="noreferrer noopener"
          className="my-1 block w-fit"
        >
          <img
            src={src}
            alt={alt ?? ""}
            loading="lazy"
            className="max-h-72 max-w-full rounded-lg object-contain shadow-[0_0_0_1px_oklch(0_0_0/0.1)] sm:max-w-md"
          />
        </a>
      ) : null,
    ul: ({ children }) => (
      <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-1 border-l-2 pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    code: ({ children, className }) =>
      className ? (
        <code className={cn("font-mono text-[12.5px]", className)}>
          {children}
        </code>
      ) : (
        <code className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
          {children}
        </code>
      ),
    pre: ({ children }) => (
      <pre className="my-1.5 overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-[12.5px] leading-5">
        {children}
      </pre>
    ),
    h1: ({ children }) => <p className="my-1 font-semibold">{children}</p>,
    h2: ({ children }) => <p className="my-1 font-semibold">{children}</p>,
    h3: ({ children }) => <p className="my-1 font-semibold">{children}</p>,
    h4: ({ children }) => <p className="my-1 font-semibold">{children}</p>,
    h5: ({ children }) => <p className="my-1 font-semibold">{children}</p>,
    h6: ({ children }) => <p className="my-1 font-semibold">{children}</p>,
    hr: () => <hr className="my-2" />,
    table: ({ children }) => (
      <div className="my-1.5 overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-left text-[13px]">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b bg-muted/60 px-2 py-1 font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border-b px-2 py-1">{children}</td>,
    input: ({ type, checked }) =>
      type === "checkbox" ? (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          readOnly
          aria-label={checked ? "Done" : "Not done"}
          className="mr-1 align-middle"
        />
      ) : null,
  };
}

const cache = new Map<string, Components>();
const plugins = [remarkGfm, remarkMentionAt];

export const MessageMarkdown = memo(function MessageMarkdown({
  source,
  userId,
  className,
}: {
  source: string;
  userId: string;
  className?: string;
}) {
  let map = cache.get(userId);
  if (!map) {
    map = components(userId);
    cache.set(userId, map);
  }
  return (
    <div
      className={cn(
        "min-w-0 text-[14px] leading-[1.45rem] [overflow-wrap:anywhere] break-words",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={plugins}
        components={map}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
