"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ArrowRight } from "@/components/ui/icons";

import { NAV_LINKS, PRINCIPLES } from "./content";
import {
  Container,
  Eyebrow,
  Heading,
  Lede,
  Reveal,
  Wordmark,
} from "./primitives";

export function Philosophy() {
  return (
    <section className="border-t border-hairline py-28 sm:py-36">
      <Container size="narrow">
        <Reveal>
          <Eyebrow>What we&apos;re building</Eyebrow>
          <Heading className="mt-4">
            A memory that grows from your own context.
          </Heading>
          <Lede className="mt-6 max-w-2xl">
            Not a file manager. Not a notes app with tags. Something closer to
            the way you actually remember: by who was there, where you were,
            what it was about — and what else it reminds you of.
          </Lede>
        </Reveal>

        <ol className="mt-16 grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-3">
          {PRINCIPLES.map((p, i) => (
            <Reveal
              as="li"
              key={p.title}
              delay={0.05 + i * 0.08}
              className="bg-canvas p-6 sm:p-7"
            >
              <span className="font-mono text-[0.75rem] text-subtle">
                0{i + 1}
              </span>
              <h3 className="mt-4 text-lg font-semibold leading-snug tracking-[-0.02em]">
                {p.title}
              </h3>
              <p className="mt-3 text-[0.9375rem] leading-6 text-muted">
                {p.body}
              </p>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-hairline">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%] bg-[radial-gradient(ellipse_60%_80%_at_50%_100%,rgb(var(--ember)/0.08),transparent_70%)]"
      />
      <Container className="relative flex min-h-[80vh] flex-col items-center justify-center py-32 text-center sm:py-44">
        <Reveal>
          <p className="text-balance text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.035em] text-muted sm:text-5xl lg:text-6xl">
            You don&apos;t need to remember everything.
          </p>
        </Reveal>
        <Reveal delay={0.25}>
          <p className="mt-3 text-balance text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-5xl lg:text-6xl">
            Lictory will.
          </p>
        </Reveal>
        <Reveal delay={0.45} className="mt-12">
          <Button variant="primary" size="lg" asChild>
            <Link href="/login">
              Start remembering <ArrowRight />
            </Link>
          </Button>
        </Reveal>
        <Reveal delay={0.55}>
          <p className="mt-5 text-sm text-subtle">
            Free while in early access. Private by default.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}

const YEAR = new Date().getFullYear();

export function Footer() {
  return (
    <footer className="border-t border-hairline">
      <Container className="flex flex-col gap-8 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/"
            aria-label="Lictory home"
            className="inline-block rounded-md"
          >
            <Wordmark />
          </Link>
          <p className="mt-3 text-sm text-subtle">
            You capture. Lictory remembers.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="hover:text-foreground">
                  {l.label}
                </a>
              </li>
            ))}
            <li>
              <Link href="/login" className="hover:text-foreground">
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      </Container>
      <Container className="flex items-center justify-between border-t border-hairline py-5 text-xs text-subtle">
        <span>© {YEAR} Lictory</span>
        <span>Made for your private life</span>
      </Container>
    </footer>
  );
}
