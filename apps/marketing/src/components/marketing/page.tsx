import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

import {
  CtaLink,
  MarketingFooter,
  MarketingHeader,
} from "@lictory/marketing/components/marketing/chrome";
import { cn } from "@lictory/core/lib/utils";

/** Dark marketing frame for public guides and comparisons. */
export function MarketingPage({ children }: { children: ReactNode }) {
  return (
    <div className="dark min-h-dvh bg-[oklch(0.135_0.005_270)] text-foreground">
      <MarketingHeader home="/" signedIn={false} sections="/" />
      <main className="px-5 pt-28 pb-16 sm:px-8 sm:pt-36 sm:pb-24">
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
      <MarketingFooter home="/" sections="/" />
    </div>
  );
}

/** Visible trail matching the page's BreadcrumbList structured data. */
export function Breadcrumbs({
  items,
}: {
  items: ReadonlyArray<{ name: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={item.name} className="flex items-center gap-1.5">
            {index > 0 ? (
              <ChevronRight aria-hidden className="size-3.5 opacity-60" />
            ) : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground">
                {item.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground/80">
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeading({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <header className="mt-6">
      <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.045em] text-balance sm:text-6xl">
        {title}
      </h1>
      <p className="mt-5 text-base leading-7 text-balance text-muted-foreground sm:text-lg sm:leading-8">
        {lead}
      </p>
      {children}
    </header>
  );
}

export function Updated({ date }: { date: string }) {
  return (
    <p className="mt-4 text-[13px] text-muted-foreground">
      Updated{" "}
      <time dateTime={date}>
        {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })}
      </time>
    </p>
  );
}

export function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return `${node}`;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2
      id={headingId(textOf(children))}
      className="mt-14 scroll-mt-24 text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-3xl"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 text-lg font-medium text-foreground">{children}</h3>
  ),
  a: ({ href = "", children }) =>
    href.startsWith("/") ? (
      <Link href={href}>{children}</Link>
    ) : (
      <a href={href} rel="noopener">
        {children}
      </a>
    ),
};

/** Long-form copy. Internal links stay client-side navigations. */
export function Prose({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[15px] leading-7 text-foreground/80 sm:text-base sm:leading-8",
        "[&_li]:pl-1 [&_ol]:mt-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:mt-5 [&_ul]:mt-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5",
        "[&_strong]:font-medium [&_strong]:text-foreground",
        "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-white/25 [&_a]:underline-offset-4 [&_a:hover]:decoration-foreground",
        "[&_blockquote]:mt-6 [&_blockquote]:border-l-2 [&_blockquote]:border-violet-300/50 [&_blockquote]:pl-5 [&_blockquote]:text-foreground/90",
        className,
      )}
    >
      <ReactMarkdown components={markdownComponents}>{children}</ReactMarkdown>
    </div>
  );
}

export function TryLictory({
  title = "Try it with one spec",
  children = "Start with one rough idea. Invite your team. Turn it into a spec you can build.",
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <aside className="mt-16 flex flex-col gap-4 rounded-2xl bg-[linear-gradient(120deg,oklch(0.6_0.18_285/0.12),oklch(0.6_0.18_285/0.03))] p-5 shadow-[inset_0_0_0_1px_oklch(0.7_0.15_285/0.18)] sm:flex-row sm:items-center sm:justify-between sm:p-7">
      <div>
        <p className="text-[15px] font-medium">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {children}
        </p>
      </div>
      <CtaLink href="/sign-up" size="lg" className="w-full sm:w-auto">
        Start for free
        <ArrowRight aria-hidden className="size-4" />
      </CtaLink>
    </aside>
  );
}

export function LinkCard({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl bg-white/2.5 p-5 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)] transition-colors hover:bg-white/4"
    >
      <span className="flex items-center justify-between gap-3 text-[15px] font-medium text-foreground">
        {title}
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </span>
      <span className="mt-2 block text-sm leading-6 text-muted-foreground">
        {children}
      </span>
    </Link>
  );
}
