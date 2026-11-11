import { legalOperator } from "@lictory/marketing/lib/site";

// Who runs the websites (the controller in the privacy notice) and how to
// reach them, shown at the top of both legal pages.
export function LegalOperator() {
  return (
    <section
      aria-label="Website operator and privacy contact"
      className="mt-8 max-w-3xl rounded-xl border border-border p-5 text-sm leading-6"
    >
      <h2 className="font-semibold">Website operator and privacy contact</h2>
      <dl className="mt-3 space-y-2 text-muted-foreground">
        <div>
          <dt className="font-medium text-foreground">Operator (controller)</dt>
          <dd>
            {legalOperator.name}, {legalOperator.description}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">
            Email for privacy and legal requests
          </dt>
          <dd>
            <a
              href={`mailto:${legalOperator.email}`}
              className="rounded underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {legalOperator.email}
            </a>
          </dd>
        </div>
      </dl>
    </section>
  );
}
