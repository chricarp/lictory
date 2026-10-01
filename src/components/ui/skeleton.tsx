import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// Route loading states. Each mirrors the real page's frame (header bar, panes,
// column widths) so the swap to content causes no layout shift. They render
// inside the workspace Shell via `loading.tsx`, which lets Next.js prefetch
// them and commit a navigation the moment a link is pressed.

export function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-md bg-muted", className)} />;
}

// The frame fades in after a short delay so fast navigations never flash a
// skeleton; slower ones get a calm pulse instead of a frozen page.
function Frame({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={cn("route-skeleton h-full min-h-0", className)}
    >
      <div aria-hidden className="contents">
        {children}
      </div>
    </div>
  );
}

function HeaderBar({ children }: { children?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      {children ?? (
        <>
          <Bone className="h-3.5 w-28" />
          <Bone className="ml-auto h-6 w-20" />
        </>
      )}
    </div>
  );
}

// Varied widths read as text; identical bars read as a placeholder grid.
const widths = ["w-3/5", "w-2/5", "w-1/2", "w-2/3", "w-1/3", "w-[45%]"];

function Rows({ count = 12 }: { count?: number }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 border-b px-4">
          <Bone className="size-3.5 shrink-0 rounded-full" />
          <Bone className="h-3 w-14 shrink-0" />
          <Bone className={cn("h-3", widths[i % widths.length])} />
          <Bone className="ml-auto size-5 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <Frame label="Loading list" className="flex flex-col">
      <HeaderBar />
      <Rows />
    </Frame>
  );
}

// Detail pane of the split view: document column plus the review rail.
export function ItemSkeleton() {
  return (
    <Frame label="Loading work item" className="flex flex-col">
      <HeaderBar>
        <Bone className="h-3.5 w-16" />
        <Bone className="h-3.5 w-40" />
        <Bone className="ml-auto h-6 w-24" />
      </HeaderBar>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="mx-auto max-w-3xl space-y-6 px-6 py-6 lg:px-10">
            <Bone className="h-7 w-3/4" />
            <div className="flex gap-2">
              <Bone className="h-5 w-20 rounded-full" />
              <Bone className="h-5 w-24 rounded-full" />
            </div>
            <Paragraph lines={4} />
            <Bone className="h-4 w-40" />
            <Paragraph lines={3} />
          </div>
        </div>
        <div className="hidden w-[300px] shrink-0 space-y-5 border-l bg-muted/20 p-4 xl:block">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bone className="h-3 w-20" />
              <Bone className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

function Paragraph({ lines }: { lines: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }, (_, i) => (
        <Bone
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

const cardCounts = [3, 2, 4, 1];

export function BoardSkeleton() {
  return (
    <Frame label="Loading board" className="flex flex-col">
      <HeaderBar />
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {cardCounts.map((cards, i) => (
          <div
            key={i}
            className="flex w-[272px] shrink-0 flex-col gap-1.5 self-start rounded-xl bg-muted/50 p-1.5"
          >
            <Bone className="m-1.5 h-3 w-24 bg-muted-foreground/10" />
            {Array.from({ length: cards }, (_, j) => (
              <div
                key={j}
                className="space-y-2 rounded-lg border bg-background p-2.5"
              >
                <Bone className="h-3 w-12" />
                <Bone
                  className={cn("h-3.5", widths[(i + j) % widths.length])}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  );
}

// Centered document pages: settings, backlog, iteration reports.
export function DocumentSkeleton({
  headerBar = false,
}: {
  headerBar?: boolean;
}) {
  return (
    <Frame label="Loading page" className="flex flex-col">
      {headerBar && <HeaderBar />}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
          {!headerBar && <Bone className="h-6 w-56" />}
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Bone className="h-4 w-32" />
              <Paragraph lines={2} />
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}
