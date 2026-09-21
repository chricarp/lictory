import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, Check, LockKeyhole, Sparkles } from "lucide-react";

import { Button } from "~/components/ui/button";
import { auth } from "~/lib/auth";

export default async function WorkspacePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) return null;

  const firstName = session.user.name.split(" ")[0] ?? "there";

  return (
    <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Check className="size-3.5" strokeWidth={2.5} />
            Authentication verified
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
            Welcome, {firstName}.
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">
            This workspace is server-protected. Seeing it confirms your session
            cookie and database-backed Better Auth session are both valid.
          </p>
        </div>
        <Link href="/app/account" className="w-fit">
          <Button variant="secondary">
            Manage account
            <ArrowRight className="size-4" />
          </Button>
        </Link>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        <StatusCard
          icon={<LockKeyhole className="size-5" />}
          title="Protected route"
          description="Validated again on the server, not only at the network boundary."
        />
        <StatusCard
          icon={<Sparkles className="size-5" />}
          title="Account ready"
          description={session.user.email}
        />
        <div className="rounded-2xl bg-foreground p-6 text-background shadow-lg">
          <p className="text-xs font-semibold tracking-wider text-background/50 uppercase">
            Next up
          </p>
          <p className="mt-3 text-lg font-semibold">Your product workspace</p>
          <p className="mt-2 text-sm leading-6 text-background/60">
            Authentication is scaffolded and ready for the collaborative domain.
          </p>
        </div>
      </div>
    </main>
  );
}

function StatusCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl bg-card p-6 shadow-[var(--shadow-border)]">
      <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <h2 className="mt-5 font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 break-words text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
