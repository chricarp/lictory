import type { ComponentType, ReactNode } from "react";
import { cn } from "@lictory/core/lib/utils";
import { PageHeader } from "@lictory/platform/components/shell/page-header";

// The page a module shows before it has anything: what the module is for and
// what to do first. Module streams replace these pages with their own.
export function PlaceholderPage({
  title,
  icon: Icon,
  heading,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  heading: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader title={title} icon={<Icon />} />
      <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-16">
        <div className="mx-auto max-w-sm text-center">
          <div
            className={cn(
              "mx-auto mb-4 grid size-10 place-items-center rounded-[10px] bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-5" strokeWidth={1.75} />
          </div>
          <h2 className="text-sm font-medium">{heading}</h2>
          <div className="mt-1.5 text-[13px] leading-5 text-muted-foreground">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
