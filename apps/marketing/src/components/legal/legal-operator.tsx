// The website operator's identity and contact, compiled in at build time from
// the deployment's environment (for lictory.com, the GitHub environment
// `websites`). Never committed and never inferred from a brand, repository
// author, hosting provider or authentication identity: without a name and an
// email the notices say they are drafts.
function setting(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function LegalOperator() {
  const name = setting(process.env.LICTORY_LEGAL_NAME);
  const email = setting(process.env.LICTORY_LEGAL_EMAIL);
  const address = setting(process.env.LICTORY_LEGAL_ADDRESS);
  const registration = setting(process.env.LICTORY_LEGAL_REGISTRATION);

  return (
    <section
      aria-label="Website operator and privacy contact"
      className="mt-8 max-w-3xl rounded-xl border border-border p-5 text-sm leading-6"
    >
      {!(name && email) && (
        <p role="note" className="mb-4 font-medium">
          Draft: the operator’s name and contact email are not configured yet.
          This document is not yet a complete legal notice.
        </p>
      )}
      <h2 className="font-semibold">Website operator and privacy contact</h2>
      <dl className="mt-3 space-y-2 text-muted-foreground">
        <div>
          <dt className="font-medium text-foreground">Operator (controller)</dt>
          <dd>{name ?? "Not published"}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">
            Email for privacy and legal requests
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
        {address && (
          <div>
            <dt className="font-medium text-foreground">Postal address</dt>
            <dd className="whitespace-pre-line">{address}</dd>
          </div>
        )}
        {registration && (
          <div>
            <dt className="font-medium text-foreground">
              VAT and registration details
            </dt>
            <dd>{registration}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
