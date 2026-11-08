"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@lictory/ui/logo";
import { HeaderGetStartedLinks } from "@lictory/marketing/components/marketing/get-started-cta";
import { MobileNav } from "@lictory/marketing/components/marketing/mobile-nav";
import type { CtaPageType } from "@lictory/marketing/lib/cta-analytics";

/** Section anchors point home when this header appears on an article. */
export function MarketingHeader({
  sections = "",
  page,
}: {
  sections?: string;
  /** Reported with the header's calls to action. */
  page: CtaPageType;
}) {
  const pathname = usePathname();
  const links = useMemo(
    () =>
      [
        ["Workflow", `${sections}#features`],
        ["Agents", `${sections}#agents`],
        ["Delivery", `${sections}#delivery`],
        ["Spaces", `${sections}#spaces`],
        ["Open source", `${sections}#open-source`],
        ["Guides", "/guides"],
      ] as const,
    [sections],
  );
  const [scrolled, setScrolled] = useState(false);
  const [activeHref, setActiveHref] = useState<string | null>(null);

  useEffect(() => {
    const targets = links.flatMap(([, href]) => {
      if (!href.startsWith("#")) return [];
      const element = document.getElementById(href.slice(1));
      return element ? [{ href, element }] : [];
    });
    let frame = 0;
    let previousScrolled: boolean | undefined;
    let previousHref: string | null | undefined;
    const update = () => {
      frame = 0;
      const nextScrolled = window.scrollY > 32;
      let nextHref =
        pathname === "/guides" || pathname.startsWith("/guides/")
          ? "/guides"
          : null;
      // Read only the navigation targets, once per frame. Nested sections
      // (Agents inside Workflow) win once their heading clears the dock.
      for (const { href, element } of targets) {
        if (element.getBoundingClientRect().top <= 160) nextHref = href;
      }
      if (previousScrolled !== nextScrolled) {
        previousScrolled = nextScrolled;
        setScrolled(nextScrolled);
      }
      if (previousHref !== nextHref) {
        previousHref = nextHref;
        setActiveHref(nextHref);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [links, pathname]);

  return (
    <header className="marketing-header" data-scrolled={scrolled || undefined}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="header-inner">
        <Logo className="header-logo" />
        <DesktopNav links={links} activeHref={activeHref} />
        <div className="header-account">
          <HeaderGetStartedLinks page={page} />
        </div>
        <MobileNav links={links} activeHref={activeHref} />
      </div>
    </header>
  );
}

function DesktopNav({
  links,
  activeHref,
}: {
  links: readonly (readonly [string, string])[];
  activeHref: string | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<number | null>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLAnchorElement>("[aria-current]");
      setPosition(
        active ? active.offsetLeft + active.offsetWidth / 2 - 8 : null,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [activeHref]);
  return (
    <nav ref={ref} aria-label="Sections" className="desktop-nav">
      <span
        aria-hidden
        className="nav-indicator"
        style={{
          opacity: position === null ? 0 : 1,
          transform: `translateX(${position ?? 0}px)`,
        }}
      />
      {links.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          aria-current={activeHref === href ? "location" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
