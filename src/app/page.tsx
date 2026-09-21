import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { Logo } from "~/components/logo";
import { Button } from "~/components/ui/button";

export default function HomePage() {
  return (
    <div className="min-h-dvh overflow-hidden bg-background">
      <header className="mx-auto flex h-18 max-w-6xl items-center px-5 sm:px-8">
        <Logo />
        <nav
          className="ml-auto flex items-center gap-2"
          aria-label="Authentication"
        >
          <Link href="/sign-in">
            <Button variant="ghost">Sign in</Button>
          </Link>
          <Link href="/sign-up">
            <Button>Get started</Button>
          </Link>
        </nav>
      </header>
      <main className="relative mx-auto max-w-6xl px-5 pt-20 pb-16 sm:px-8 sm:pt-28">
        <div className="absolute top-0 left-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-primary/8 blur-3xl" />
        <div className="mx-auto max-w-3xl text-center">
          <div className="mx-auto mb-6 w-fit rounded-full bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary shadow-[inset_0_0_0_1px_oklch(0.58_0.22_259/0.12)]">
            Requirements, reviewed like code
          </div>
          <h1 className="text-5xl leading-[1.03] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
            Move from product intent to engineering confidence.
          </h1>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">
            Draft, review, resolve, and approve specifications with the context
            your product, engineering, and QA teams need to safely commit.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/sign-up">
              <Button className="w-full px-5 sm:w-auto">
                Create your account
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/sign-in">
              <Button variant="secondary" className="w-full px-5 sm:w-auto">
                Sign in to your workspace
              </Button>
            </Link>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-3 rounded-[24px] bg-card p-3 shadow-[var(--shadow-panel)] md:grid-cols-3">
          {[
            [
              "Revision-aware",
              "Every approval stays tied to the specification that was actually reviewed.",
            ],
            [
              "Context preserved",
              "Discussions and suggestions remain anchored to the work they concern.",
            ],
            [
              "Readiness proven",
              "Evidence-based checks show what is complete and what still blocks delivery.",
            ],
          ].map(([title, description]) => (
            <div key={title} className="rounded-xl bg-muted/55 p-5">
              <CheckCircle2 className="size-5 text-primary" />
              <h2 className="mt-4 text-sm font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
