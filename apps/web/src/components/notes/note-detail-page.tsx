"use client";

import { ArrowLeft } from "@/components/ui/icons";
import Link from "next/link";
import * as React from "react";

import { NoteDetail } from "@/components/notes/note-detail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useResource } from "@/lib/api";

export function NoteDetailPage({ noteId }: { noteId: string }) {
  const api = useApi();
  const note = useResource(`note:${noteId}`, () => api.getNote(noteId));

  const busy =
    note.data?.note.status === "processing" ||
    note.data?.note.status === "queued";

  // Poll only while the model is actually working on this note.
  React.useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void note.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [busy, note]);

  return (
    <div className="w-full max-w-5xl">
      <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
        <Link href="/app/notes">
          <ArrowLeft />
          All notes
        </Link>
      </Button>

      {note.initialLoading ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </div>
          <Skeleton className="h-56 w-full rounded-md" />
        </div>
      ) : note.error ? (
        <div className="rounded-md border border-[rgb(var(--danger)/0.3)] bg-[rgb(var(--danger)/0.08)] p-6 text-sm text-danger">
          {note.error.message}
        </div>
      ) : note.data ? (
        <NoteDetail
          note={note.data.note}
          onChange={(updated) => note.mutate({ note: updated })}
        />
      ) : null}
    </div>
  );
}
