"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight, Menu, X } from "lucide-react";

export function MobileNav({
  links,
  activeHref,
}: {
  links: readonly (readonly [string, string])[];
  activeHref: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Observe the breakpoint from mount, including a quick trip to desktop
    // and back. Read the event's value rather than the later viewport size.
    const desktop = window.matchMedia("(min-width: 960px)");
    const resize = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktop.addEventListener("change", resize);
    return () => desktop.removeEventListener("change", resize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className="mobile-nav"
      data-open={open || undefined}
      data-keyboard={keyboard || undefined}
      onKeyDown={(event) => {
        setKeyboard(true);
        if (event.key === "Escape" && open) {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          setKeyboard(event.detail === 0);
          setOpen(!open);
        }}
      >
        <Menu aria-hidden className="nav-menu-icon" />
        <X aria-hidden className="nav-close-icon" />
      </button>
      <nav
        id={id}
        aria-label="Mobile sections"
        className="mobile-nav-panel"
        aria-hidden={!open}
        inert={!open}
      >
        {links.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            aria-current={activeHref === href ? "location" : undefined}
            onClick={(event) => {
              setKeyboard(event.detail === 0);
              setOpen(false);
            }}
          >
            {label}
            <ChevronRight aria-hidden />
          </Link>
        ))}
      </nav>
    </div>
  );
}
