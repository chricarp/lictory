// Server-rendered deployment facts. Never infer the controller from a brand,
// repository author, hosting provider or authentication identity.
export function LegalOperator() {
  const configuredName = process.env.LICTORY_LEGAL_NAME?.trim();
  const name = configuredName?.length ? configuredName : "Not published";
  const address = process.env.LICTORY_LEGAL_ADDRESS;
  const email = process.env.LICTORY_LEGAL_EMAIL;
  const registration = process.env.LICTORY_LEGAL_REGISTRATION;
  const complete = name !== "Not published" && address && email;

  return (
    <section
      aria-label="Service provider and privacy contact"
      className="mt-8 max-w-3xl rounded-xl border border-border p-5 text-sm leading-6"
    >
      {!complete && (
        <p role="note" className="mb-4 font-medium">
          Draft: the operator’s contact email and postal address must be
          completed before public launch. This document is not yet a complete
          legal notice.
        </p>
      )}
      <h2 className="font-semibold">Service provider and privacy contact</h2>
      <dl className="mt-3 space-y-2 text-muted-foreground">
        <div>
          <dt className="font-medium text-foreground">Legal name</dt>
          <dd>{name}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Business address</dt>
          <dd className="whitespace-pre-line">{address ?? "Not published"}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">
            Email for privacy, support and legal requests
          </dt>
          <dd>
            {email ? (
              <a
                href={`mailto:${email}`}
                className="rounded underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {email}
              </a>
            ) : (
              "Not published"
            )}
          </dd>
        </div>
        {registration && (
          <div>
            <dt className="font-medium text-foreground">
              VAT and registration details, where applicable
            </dt>
            <dd>{registration}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
