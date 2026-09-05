"use client";

import { useMotionValueEvent, useScroll } from "motion/react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { NAV_LINKS } from "./content";
import { Wordmark } from "./primitives";

export function Header() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = React.useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-3 pt-3 sm:px-5 sm:pt-4">
      <div
        className={cn(
          "pointer-events-auto flex h-14 w-full max-w-[80rem] items-center gap-2 rounded-xl border px-3 pl-4 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300",
          scrolled
            ? "border-hairline bg-canvas/80 shadow-[0_1px_2px_rgb(15_20_25/0.04),0_8px_24px_-12px_rgb(15_20_25/0.12)] backdrop-blur-md"
            : "border-transparent bg-transparent",
        )}
      >
        <Link href="/" aria-label="Lictory home" className="rounded-md">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="mx-auto hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-strong hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button variant="primary" size="sm" asChild>
            <Link href="/login">Start remembering</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
