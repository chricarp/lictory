import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

import { formatDate } from "@lictory/marketing/components/marketing/comparison-parts";
import { MarketingFooter } from "@lictory/marketing/components/marketing/chrome";
import { MarketingHeader } from "@lictory/marketing/components/marketing/header";
import {
  GetStartedCta,
  InstallServerLink,
  RepositoryCta,
} from "@lictory/marketing/components/marketing/get-started-cta";
import type { CtaPageType } from "@lictory/marketing/lib/cta-analytics";
import { cn } from "@lictory/core/lib/utils";

/** Shared marketing frame for public guides and comparisons. */
export function MarketingPage({
  page,
  children,
}: {
  /** Reported with the page's calls to action. */
  page: CtaPageType;
  children: ReactNode;
}) {
  return (
    <div className="marketing-site min-h-dvh bg-background text-foreground">
      <MarketingHeader sections="/" page={page} />
      <main
        id="main-content"
        className="marketing-article px-5 py-16 sm:px-8 sm:py-24"
      >
        <div className="mx-auto max-w-3xl">{children}</div>
      </main>
      <MarketingFooter sections="/" />
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
      <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-6xl">
        {title}
      </h1>
      <p className="mt-5 text-base leading-7 text-balance text-muted-foreground sm:text-lg sm:leading-8">
        {lead}
      </p>
      {children}
    </header>
  );
}

export function Updated({
  date,
  reviewed,
}: {
  date: string;
  /** When facts about other products were last checked against their sites. */
  reviewed?: string;
}) {
  return (
    <p className="mt-4 text-[13px] text-muted-foreground">
      Updated <time dateTime={date}>{formatDate(date)}</time>
      {reviewed ? (
        <>
          {" · "}Last reviewed{" "}
          <time dateTime={reviewed}>{formatDate(reviewed)}</time>
        </>
      ) : null}
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
        "[&_code]:text-[0.9em] [&_code]:[overflow-wrap:anywhere]",
        "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-foreground/25 [&_a]:underline-offset-4 [&_a:hover]:decoration-foreground",
        "[&_blockquote]:mt-6 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-5 [&_blockquote]:text-foreground/90",
        className,
      )}
    >
      <ReactMarkdown components={markdownComponents}>{children}</ReactMarkdown>
    </div>
  );
}

export function TryLictory({
  page,
  title = "Try it with one spec",
  children = "Start with one rough idea. Invite your team. Turn it into a spec you can build.",
}: {
  page: CtaPageType;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <aside className="mt-16 flex flex-col gap-6 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div>
        <p className="text-[15px] font-medium">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {children}
        </p>
        <InstallServerLink
          placement="final"
          page={page}
          className="mt-3 text-sm leading-6 text-muted-foreground"
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <GetStartedCta
          placement="final"
          page={page}
          className="w-full sm:w-auto"
        />
        <RepositoryCta
          placement="final"
          page={page}
          className="w-full sm:w-auto"
        />
      </div>
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
      className="group block rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted"
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
