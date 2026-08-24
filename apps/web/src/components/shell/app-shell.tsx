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
import { PreferencesManager } from "@/lib/preferences";

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
        <PreferencesManager />
        <TooltipProvider delayDuration={300}>
          <div className="mx-auto grid min-h-dvh w-full max-w-[90rem] grid-cols-1 bg-canvas lg:grid-cols-[5rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]">
            <aside
              aria-label="Primary navigation"
              data-app-sidebar
              className="sticky top-0 hidden h-dvh min-h-0 flex-col overflow-y-auto border-r border-hairline bg-canvas px-3 py-3 lg:flex lg:items-center xl:items-stretch xl:px-4 xl:pl-6"
            >
              <SidebarContent onSearch={() => setPaletteOpen(true)} />
            </aside>

            <div className="flex min-h-dvh min-w-0 flex-col">
              <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-[rgb(var(--canvas)/0.9)] px-4 backdrop-blur-xl sm:px-6 lg:hidden">
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
              </header>

              <main className="flex min-w-0 flex-1 px-4 py-7 sm:px-6 lg:px-10 lg:py-9">
                <div
                  data-app-content
                  className="mx-auto min-w-0 w-full max-w-6xl flex-1"
                >
                  {children}
                </div>
              </main>
            </div>
          </div>

          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </TooltipProvider>
      </ApiProvider>
    </AuthGate>
  );
}
