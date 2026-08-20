"use client";

import { Search } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import * as React from "react";

import { AuthGate } from "@/components/shell/auth-gate";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav, SidebarContent } from "@/components/shell/sidebar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KEYBINDINGS, matchesKeybinding } from "@/components/ui/keybinding";
import { ApiProvider } from "@/lib/api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;

      if (matchesKeybinding(event, KEYBINDINGS.search)) {
        event.preventDefault();
        setPaletteOpen((current) => !current);
        return;
      }

      if (!matchesKeybinding(event, KEYBINDINGS.capture)) return;

      event.preventDefault();
      setPaletteOpen(false);
      router.push("/app");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return (
    <AuthGate redirectTo="/login">
      <ApiProvider>
        <TooltipProvider delayDuration={300}>
          <div className="mx-auto flex min-h-dvh max-w-[90rem] bg-canvas">
            <aside className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center bg-canvas px-3 py-3 lg:flex xl:w-72 xl:items-stretch xl:px-4 xl:pl-6">
              <SidebarContent onSearch={() => setPaletteOpen(true)} />
            </aside>

            <div className="flex min-w-0 flex-1 flex-col border-l border-hairline">
              <div className="flex items-center gap-2 px-4 pt-3 sm:px-6 lg:hidden">
                <MobileNav onSearch={() => setPaletteOpen(true)} />

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setPaletteOpen(true)}
                  aria-label="Search"
                  className="lg:hidden"
                >
                  <Search />
                </Button>
              </div>

              <main className="min-w-0 flex-1 px-4 py-7 sm:px-6 lg:px-10 lg:py-9">
                {children}
              </main>
            </div>
          </div>

          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </TooltipProvider>
      </ApiProvider>
    </AuthGate>
  );
}
