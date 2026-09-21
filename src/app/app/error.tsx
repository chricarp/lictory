"use client";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/workspace";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg p-8">
      <EmptyState title="The workspace could not be opened">
        Check your connection and try again. Previously queued changes remain in
        this browser.
      </EmptyState>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
