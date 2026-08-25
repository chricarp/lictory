"use client";

import { Search } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import * as React from "react";

import { AuthGate } from "@/components/shell/auth-gate";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav, SidebarContent } from "@/components/shell/sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KEYBINDINGS, matchesKeybinding } from "@/components/ui/keybinding";
import { ApiProvider, useApi } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import {
  clearLocalCapture,
  readLocalCaptureAttachments,
  readLocalCaptureBody,
  useHasLocalCapture,
} from "@/lib/local-capture";
import { PreferencesManager } from "@/lib/preferences";
import { toast } from "sonner";

function LocalCaptureExitGuard() {
  const api = useApi();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;
  const hasLocalCapture = useHasLocalCapture(userId);
  const [exitHref, setExitHref] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const allowExitRef = React.useRef(false);

  React.useEffect(() => {
    if (!hasLocalCapture) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowExitRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasLocalCapture]);

  React.useEffect(() => {
    if (!hasLocalCapture) return;
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank")
        return;
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        (destination.pathname === "/app" ||
          destination.pathname.startsWith("/app/"))
      ) {
        return;
      }
      event.preventDefault();
      setExitHref(destination.href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [hasLocalCapture]);

  const leave = React.useCallback((href: string) => {
    allowExitRef.current = true;
    window.location.assign(href);
  }, []);

  const saveDraftAndLeave = async () => {
    if (!exitHref || !userId) return;
    setSaving(true);
    let noteId: string | null = null;
    try {
      const bodyMarkdown = readLocalCaptureBody(userId);
      const attachments = await readLocalCaptureAttachments(userId);
      const { note } = await api.createNote({ bodyMarkdown });
      noteId = note.id;
      await Promise.all(
        attachments.map((attachment) =>
          api.uploadAttachment(note.id, {
            fileName: attachment.fileName,
            contentType: attachment.contentType,
            bytes: attachment.bytes,
            durationSeconds: attachment.durationSeconds ?? undefined,
            body: attachment.file,
          }),
        ),
      );
      await clearLocalCapture(userId);
      toast.success("Draft saved");
      leave(exitHref);
    } catch (error) {
      if (noteId) await api.deleteNote(noteId).catch(() => undefined);
      toast.error(
        error instanceof Error ? error.message : "Could not save this draft",
      );
      setSaving(false);
    }
  };

  const discardAndLeave = async () => {
    if (!exitHref || !userId) return;
    await clearLocalCapture(userId);
    leave(exitHref);
  };

  return (
    <Dialog
      open={exitHref !== null}
      onOpenChange={(open) => {
        if (!open && !saving) setExitHref(null);
      }}
    >
      <DialogContent className="max-w-md" showClose={!saving}>
        <DialogHeader>
          <DialogTitle>Keep this capture?</DialogTitle>
          <DialogDescription>
            Save it as a draft before leaving Lictory, or discard it from this
            device.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setExitHref(null)}
            disabled={saving}
          >
            Keep editing
          </Button>
          <Button
            variant="danger"
            onClick={() => void discardAndLeave()}
            disabled={saving}
          >
            Discard and leave
          </Button>
          <Button
            variant="primary"
            onClick={() => void saveDraftAndLeave()}
            loading={saving}
          >
            Save draft and leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
        <LocalCaptureExitGuard />
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
