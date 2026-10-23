"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { openWorkspaceLabel } from "@lictory/marketing/components/marketing/account-cta";
import { platformHref } from "@lictory/marketing/lib/platform";
import { useSignedIn } from "@lictory/marketing/lib/signed-in";

/**
 * A small-screen signup bar (or "Open workspace" when signed in). It appears once the hero call to action has
 * scrolled away and hides again while another call to action is on screen,
 * so it never duplicates a visible button or covers the footer.
 */
export function MobileCta({ label }: { label: string }) {
  const [visible, setVisible] = useState(false);
  const signedIn = useSignedIn();

  useEffect(() => {
    const targets = document.querySelectorAll("[data-cta-anchor]");
    if (targets.length === 0) return;
    const onScreen = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) onScreen.add(entry.target);
        else onScreen.delete(entry.target);
      }
      // Only show after the visitor has scrolled past the hero.
      setVisible(onScreen.size === 0 && window.scrollY > 200);
    });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden",
        "bg-linear-to-t from-background via-background/90 to-transparent",
        "transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <Link
        href={platformHref(signedIn ? "/" : "/sign-up")}
        tabIndex={visible ? undefined : -1}
        className="flex h-12 w-full items-center justify-center gap-1.5 rounded-full bg-foreground text-sm font-medium text-background shadow-[0_8px_24px_-8px_oklch(0_0_0/0.7)] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {signedIn ? openWorkspaceLabel : label}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
