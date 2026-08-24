"use client";

import { motion } from "motion/react";
import {
  ArrowRight,
  AudioLines,
  Camera,
  FileText,
  MapPin,
  Paperclip,
  PenLine,
  UserRound,
} from "@/components/ui/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";

const WAYS_TO_CAPTURE = [
  { icon: PenLine, label: "Write" },
  { icon: AudioLines, label: "Talk" },
  { icon: Camera, label: "Snap" },
  { icon: FileText, label: "Attach" },
];

function Logo() {
  return (
    <span className="flex size-9 items-center justify-center rounded-md bg-ember text-xs font-bold tracking-[-0.08em] text-white shadow-[0_8px_24px_rgb(var(--ember)/0.22)]">
      LI
    </span>
  );
}

function NotePreview() {
  return (
    <div className="relative mx-auto w-full max-w-lg rounded-xl border border-hairline-strong bg-canvas-raised p-3 shadow-[0_32px_100px_rgb(0_0_0/0.28)] sm:p-4">
      <div className="rounded-lg border border-hairline bg-surface px-5 py-6 sm:px-6">
        <div className="mb-5 flex items-center gap-2 text-xs text-subtle">
          <span>Today, 10:42</span>
          <Paperclip className="ml-auto size-3.5" />
          <span>2</span>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          Coffee with Marta
        </h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          Meet at Bar Luce on Thursday. Bring the revised deck and the research
          notes from last week.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--entity-person)/0.3)] bg-[rgb(var(--entity-person)/0.1)] px-3 py-1.5 text-xs text-person">
            <UserRound className="size-3.5" /> Marta
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--entity-place)/0.3)] bg-[rgb(var(--entity-place)/0.1)] px-3 py-1.5 text-xs text-place">
            <MapPin className="size-3.5" /> Bar Luce
          </span>
          <span className="rounded-full border border-[rgb(var(--entity-time)/0.3)] bg-[rgb(var(--entity-time)/0.1)] px-3 py-1.5 text-xs text-time">
            Thursday
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {WAYS_TO_CAPTURE.map(({ icon: Icon, label }) => (
          <div
            key={label}
            className="flex flex-col items-center gap-2 rounded-md bg-surface px-2 py-3 text-xs text-muted"
          >
            <Icon className="size-4 text-ember-bright" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-dvh overflow-hidden bg-canvas">
      <header className="mx-auto flex h-20 w-full max-w-7xl items-center px-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Lictory home"
        >
          <Logo />
          <span className="text-base font-semibold tracking-tight">
            Lictory
          </span>
        </Link>
        <nav className="ml-auto">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100dvh-5rem)] w-full max-w-7xl items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16 lg:py-20">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <h1 className="max-w-2xl text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.055em] sm:text-6xl">
              Keep the whole moment.
            </h1>
            <p className="mt-6 max-w-lg text-pretty text-lg leading-8 text-muted">
              Notes, voice, photos and files stay together—easy to save, easy to
              find, and ready when you need them.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button variant="primary" size="lg" asChild>
                <Link href="/login">
                  Start capturing <ArrowRight />
                </Link>
              </Button>
              <span className="text-sm text-subtle">Private by default</span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="relative"
          >
            <div className="absolute inset-8 rounded-full bg-[rgb(var(--ember)/0.13)] blur-3xl" />
            <div className="relative">
              <NotePreview />
            </div>
          </motion.div>
        </section>

        <section className="border-y border-hairline bg-canvas-raised/70">
          <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-16 sm:px-8 md:grid-cols-3">
            {[
              [
                "Capture freely",
                "Mix words, recordings, pictures and documents in the same note.",
              ],
              [
                "Find naturally",
                "Search by a person, place, moment or any detail you remember.",
              ],
              [
                "Stay in control",
                "Review connections when you want. Your choices are always kept.",
              ],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-lg border border-hairline bg-surface p-6"
              >
                <h2 className="text-base font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6 px-5 py-20 sm:px-8 md:flex-row md:items-center md:justify-between">
          <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.04em]">
            Save what matters. The rest falls into place.
          </h2>
          <Button variant="primary" size="lg" asChild>
            <Link href="/login">
              Open Lictory <ArrowRight />
            </Link>
          </Button>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-7xl items-center border-t border-hairline px-5 py-7 text-xs text-subtle sm:px-8">
        <span>© {new Date().getFullYear()} Lictory</span>
        <span className="ml-auto">Made for your private life</span>
      </footer>
    </div>
  );
}
