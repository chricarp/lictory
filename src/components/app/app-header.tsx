"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";

import { Logo } from "~/components/logo";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";

export function AppHeader({ name, email }: { name: string; email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Logo />
        <nav
          className="ml-auto flex items-center gap-1"
          aria-label="Account navigation"
        >
          <Link
            href="/app"
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pathname === "/app"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Workspace
          </Link>
          <Link
            href="/app/account"
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pathname.startsWith("/app/account")
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Settings className="mr-1.5 inline size-4" />
            <span className="hidden sm:inline">Account</span>
          </Link>
          <Button
            variant="ghost"
            className="size-10 min-h-10 px-0"
            onClick={signOut}
            aria-label={`Sign out ${name || email}`}
            title="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </nav>
      </div>
    </header>
  );
}
