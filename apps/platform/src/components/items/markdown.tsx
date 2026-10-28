import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@lictory/core/lib/utils";

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
  a: ({ children, href }) =>
    href?.startsWith("mention:") ? (
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
    ),
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
  del: ({ children }) => (
    <del className="text-muted-foreground decoration-current">{children}</del>
  ),
};

// Mentions (`@[Name](mention:ID)`) survive URL sanitising and render as chips;
// every other URL goes through react-markdown's safe default.
const urlTransform = (url: string) =>
  /^mention:[A-Za-z0-9_-]+$/.test(url) ? url : defaultUrlTransform(url);

const remarkPlugins = [remarkGfm];

// CommonMark plus GitHub-flavored tables, task lists, strikethrough and
// autolinks. react-markdown emits React nodes and does not execute raw HTML.
// Parsing is the expensive part, so a document is only re-parsed when its
// source changes.
export const Markdown = memo(function Markdown({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  return (
    <div className={cn("spec-prose text-[15px] leading-7", className)}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
