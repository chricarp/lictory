"use client";

import type { NoteSummary } from "@lictory/contracts";
import { motion } from "motion/react";
import { ArrowRight } from "@/components/ui/icons";
import Link from "next/link";
import * as React from "react";

import { AnimatedNumber } from "@/components/ai/primitives";
import { EntityChip } from "@/components/entities/entity-chip";
import { NoteCard, NoteCardSkeleton } from "@/components/notes/note-card";
import { NoteComposer } from "@/components/notes/note-composer";
import { useApi, useResource } from "@/lib/api";
import { ENTITY_META } from "@/lib/entities";

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  accent: string;
}) {
  return (
    <Link
      href={href}
      className="group border-l border-hairline-strong px-4 py-3 transition-colors first:border-l-0 hover:bg-surface"
    >
      <p className={`mb-1 text-2xl font-semibold tabular-nums ${accent}`}>
        <AnimatedNumber value={value} />
      </p>
      <p className="inline-flex items-center gap-1 text-xs text-subtle">
        {label}
        <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </p>
    </Link>
  );
}

export function CaptureHome() {
  const api = useApi();

  const notes = useResource("recent-notes", () => api.listNotes({ limit: 6 }), {
    refreshInterval: 6_000,
  });
  const graph = useResource("graph", () => api.graph(), {
    refreshInterval: 20_000,
  });

  const processing = (notes.data?.notes ?? []).filter(
    (note: NoteSummary) =>
      note.status === "processing" || note.status === "queued",
  ).length;

  return (
    <div className="w-full">
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-7"
      >
        <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-4xl">
          Keep what matters.
        </h1>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.06 }}
      >
        <NoteComposer
          onCreated={() => {
            void notes.refresh();
            void graph.refresh();
          }}
        />
      </motion.div>

      {graph.data ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="mt-7 grid grid-cols-2 overflow-hidden rounded-lg border border-hairline bg-surface sm:grid-cols-4"
        >
          <StatCard
            label="People"
            value={graph.data.totals.people}
            href="/app/people"
            accent={ENTITY_META.person.tint}
          />
          <StatCard
            label="Places"
            value={graph.data.totals.places}
            href="/app/places"
            accent={ENTITY_META.place.tint}
          />
          <StatCard
            label="Moments"
            value={graph.data.totals.times}
            href="/app/calendar"
            accent={ENTITY_META.time.tint}
          />
          <StatCard
            label="Notes"
            value={graph.data.totals.notes}
            href="/app/notes"
            accent="text-foreground"
          />
        </motion.div>
      ) : null}

      {graph.data && graph.data.upcoming.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-muted">Coming up</h2>
          <div className="flex flex-wrap gap-2">
            {graph.data.upcoming.map((entity) => (
              <EntityChip key={entity.id} entity={entity} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted">
            Recent notes
            {processing > 0 ? (
              <span className="ml-2 text-xs font-normal text-ember-bright">
                {processing} finishing up
              </span>
            ) : null}
          </h2>
          <Link
            href="/app/notes"
            className="inline-flex items-center gap-1 text-xs text-subtle transition-colors hover:text-foreground"
          >
            All notes
            <ArrowRight className="size-3" />
          </Link>
        </div>

        {notes.initialLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((index) => (
              <NoteCardSkeleton key={index} />
            ))}
          </div>
        ) : (notes.data?.notes.length ?? 0) === 0 ? (
          <div className="atlas-grid rounded-lg border border-dashed border-hairline-strong px-6 py-14 text-center">
            <p className="text-sm font-medium text-foreground">
              Nothing captured yet
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-subtle">
              Start with a thought, a voice memo or a photo.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {notes.data?.notes.map((note) => (
              <NoteCard key={note.id} note={note} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
