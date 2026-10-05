import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { PrivacyPreferencesButton } from "~/components/app/consent-ui";
import { Logo } from "~/components/logo";
import { LegalOperator } from "~/components/legal/legal-operator";

export type LegalSection = { id: string; title: string; body: string };

export function LegalDocument({
  title,
  introduction,
  sections,
}: {
  title: string;
  introduction: string;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <Logo />
          <Link
            href="/sign-in"
            className="rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="max-w-3xl">
          <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
            Lictory · Legal
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Version: 5 October 2026
          </p>
          <p className="mt-6 text-base leading-7 text-muted-foreground">
            {introduction}
          </p>
        </div>
        <LegalOperator />
        <div className="mt-12 grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14">
          <nav aria-label={`${title} contents`} className="text-sm">
            <p className="mb-4 font-medium">On this page</p>
            <ol className="space-y-3 text-muted-foreground">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="min-w-0 space-y-10">
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className="scroll-mt-8">
                <h2 className="mb-4 text-lg font-semibold tracking-tight">
                  {index + 1}. {section.title}
                </h2>
                <div className="space-y-4 text-sm leading-7 text-muted-foreground [&_a]:rounded [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_a]:outline-none [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring [&_a:hover]:decoration-foreground [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                  <ReactMarkdown>{section.body}</ReactMarkdown>
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <footer className="border-t border-border px-5 py-8 sm:px-8">
        <nav
          aria-label="Legal footer"
          className="mx-auto flex max-w-5xl flex-wrap gap-x-6 gap-y-4 text-sm text-muted-foreground [&_a]:rounded [&_a]:outline-none [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring [&_a:hover]:text-foreground"
        >
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy Notice</Link>
          <Link href="/terms-of-service">Terms of Service</Link>
          <PrivacyPreferencesButton className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Privacy preferences
          </PrivacyPreferencesButton>
        </nav>
      </footer>
    </div>
  );
}
