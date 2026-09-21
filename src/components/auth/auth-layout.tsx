import type { ReactNode } from "react";

import { CheckCircle2 } from "lucide-react";

import { Logo } from "~/components/logo";

const benefits = [
  "Review requirements with durable context",
  "Keep approvals tied to exact revisions",
  "Turn agreed specifications into delivery work",
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(360px,0.9fr)_minmax(560px,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-foreground p-10 text-background lg:flex lg:flex-col">
        <div className="absolute inset-0 [background-image:radial-gradient(circle_at_15%_20%,oklch(0.68_0.19_258/0.45),transparent_32%),radial-gradient(circle_at_85%_80%,oklch(0.75_0.13_190/0.25),transparent_30%)] opacity-40" />
        <Logo className="relative z-10 text-background focus-visible:ring-background" />
        <div className="relative z-10 my-auto max-w-lg">
          <p className="mb-5 text-xs font-semibold tracking-[0.18em] text-background/55 uppercase">
            From intent to readiness
          </p>
          <h1 className="text-4xl leading-[1.08] font-semibold tracking-[-0.035em] xl:text-5xl">
            Requirements your whole team can trust.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-background/65">
            Shape product intent into an approved, implementation-ready
            specification—without another status meeting.
          </p>
          <ul className="mt-10 space-y-4">
            {benefits.map((benefit) => (
              <li
                key={benefit}
                className="flex items-center gap-3 text-sm text-background/78"
              >
                <CheckCircle2
                  className="size-4 text-blue-400"
                  strokeWidth={2}
                />
                {benefit}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative z-10 text-xs text-background/40">
          Collaborative engineering readiness
        </p>
      </aside>
      <section className="flex min-h-dvh flex-col bg-background px-5 py-6 sm:px-8 lg:px-14">
        <Logo className="mb-12 lg:hidden" />
        <div className="m-auto w-full max-w-[420px] py-8">{children}</div>
      </section>
    </main>
  );
}

export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}) {
  return (
    <div className="mb-7">
      <h1 className="text-3xl font-semibold tracking-[-0.035em]">{title}</h1>
      <div className="mt-2 text-[15px] leading-6 text-muted-foreground">
        {description}
      </div>
    </div>
  );
}
