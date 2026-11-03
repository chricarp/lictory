# Public legal notices

The public `/privacy` and `/terms-of-service` pages describe the deployed service,
including optional Lictory Intelligence, organization review history and both delivery modes. The
operator has confirmed Christian Carpinelli, an individual in Italy, as the
operator; EU configurations for Vercel, Neon, Cloudflare R2, Resend and PostHog;
and an OpenAI Zero Data Retention arrangement. These are operator declarations,
not guarantees inferred from SDK options or verified vendor contracts.

**Before the self-hosted launch** the hosting sentence in
`apps/marketing/src/lib/legal/privacy.ts` must be updated by the operator: the
application and its PostgreSQL database move from Vercel and Neon to the chosen
EU server provider (see [deployment](deployment.md)), and encrypted database
backups are kept off-server for up to about six months (7 daily, 4 weekly, 6
monthly; see [recovery](recovery.md)), which matters for erasure requests.
This is an operator declaration and is deliberately not changed by engineering.

Set `LICTORY_LEGAL_ADDRESS` and `LICTORY_LEGAL_EMAIL` to a correspondence address
and monitored public contact before launch. Without either, both pages explicitly
display a draft notice. `LICTORY_LEGAL_NAME` overrides the operator name and
`LICTORY_LEGAL_REGISTRATION` supplies registration/VAT details if applicable.
These public values are compiled into the website at build time; rebuild and
redeploy after changing them.

The signup notice makes account creation the acceptance action, also for social
authentication that first creates an account on the sign-in page. Privacy notice
acknowledgment is not consent. The terms avoid contractual liability caps,
exclusive jurisdiction, automatic renewal or unrestricted suspension rights that
would need additional consideration under Italian Civil Code Articles 1341–1342.
Do not add such clauses without designing the required separate acceptance.
The present implementation does not persist a versioned acceptance receipt or
collect acceptance of future material amendments from existing accounts.

## Operational requirements beyond the pages

Legal wording alone cannot establish compliance. Before offering the service to
organizations, arrange an Article 28 processing agreement with them, obtain
appropriate provider agreements/subprocessor authorizations, confirm actual
processing and support-access countries and transfer safeguards, and verify that
the OpenAI organization/project and all features used qualify for Zero Data
Retention. `store: false` alone does not establish ZDR.

The operator's policy is account-lifetime retention for account data and
organization-lifetime retention for workspace data. Confirm and document provider
retention for analytics, emails, logs and backups, and a process to fulfill
access, portability, objections and erasure requests. Account deletion currently
calls Better Auth deletion, while many historical actor foreign keys restrict
user deletion; an organization erasure workflow is not implemented. Assisted
erasure/anonymization is needed, and the pages do not claim automatic complete
deletion. Removing immutable history merely to make deletion succeed is not an
acceptable fix.

Assess and document the legitimate interests and necessity of cookieless browser
and identified server analytics before relying on that basis, including how an
individual's objection is honored. Cookieless IP/user-agent hashes are not assumed
anonymous. Browser analytics consent is stored locally by c15t; its offline mode
does not provide a server-side consent evidence register. Assess whether this is
sufficient to demonstrate consent and implement the appropriate recordkeeping.

## Legal basis for the drafting choices

- [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj): transparency, lawful bases,
  processor agreements, rights, retention and international transfers.
- [European Commission: controller and processor responsibilities](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en).
- [Garante cookie guidance](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876): necessary storage, separate optional consent and access to the extended notice.
- [Italian Legislative Decree 70/2003](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2003-04-09;70): accessible provider and contracting information.
- [Italian Civil Code Article 1341](https://def.giustiziatributaria.gov.it/DocTribFrontend/executePrintArticolo.do?articolo=Articolo+1341&codiceOrdinamento=0000000000013410000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000&id=%7B9E93F1BE-06AE-4F24-8E9D-B838F7E0C2E6%7D): specific acceptance of certain standard terms.

Reassess the text when processing, vendors, monetization or contract formation
changes. Preserve the terms accepted by existing customers and provide an
appropriate notice/acceptance flow for material amendments.
