# Public legal notices

Two different things need legal notices, and they never share them:

- **The Lictory websites** (`lictory.com` and `docs.lictory.com`). The
  `/privacy` and `/terms-of-service` pages of `apps/marketing` are the
  website operator's own notices for these two sites only. They are operator
  content kept in this repository; the websites are never shipped to
  self-hosting users ([websites](websites.md)). They link to the
  [self-hosting privacy page](https://docs.lictory.com/self-hosting/privacy)
  for what an installation processes.
- **A Lictory installation.** Each self-hosted installation is run by its own
  operator, who is the controller for its users and publishes their own terms
  and privacy notice. The platform links to them through `LEGAL_TERMS_URL` and
  `LEGAL_PRIVACY_URL` (below) and never to the lictory.com notices.

## Website notices

The websites accept no user input: no accounts, forms, comments or uploads,
and documentation search runs in the browser. The notices therefore cover only
request data at Cloudflare, PostHog analytics on both websites (through each
Worker's first-party `/relay`, behind the c15t consent banner; one choice for
both sites; cookieless before a choice and after a rejection, a first-party
identifier shared by both sites only with consent; see
[product analytics](../internals/analytics.md#consent)) and email
correspondence. One notice in `apps/marketing` covers both websites; the
documentation links to it.

The terms are short website terms of use: they form no account contract and
do not govern the MIT-licensed software. They choose Italian law without
removing a consumer's mandatory protection. Their liability clause never
excludes wilful misconduct or gross negligence (Civil Code Article 1229) or
Consumer Code rights. Do not add clauses that would need a separately accepted
contract, such as an exclusive court (Civil Code Articles 1341–1342).

The operator is a private individual, so the notices name them, their city and
the contact email (`legalOperator` in `apps/marketing/src/lib/site.ts`). GDPR
Article 13 requires the controller's identity and contact details. If a
business ever runs the websites, add its legal name, registered address and
VAT number there and in both notices: a commercial operator must also show the
identification details of Legislative Decree 70/2003, Article 7.

### Operator declarations the website notice relies on

The privacy notice states facts engineering cannot verify from code. Confirm
them in the provider consoles, and change the notice if any stops being true:

- **PostHog:** an EU Cloud project; _Cookieless server hash mode_ enabled
  (otherwise cookieless events are dropped); _Discard client IP data_ enabled
  (the notice says IP addresses are not stored with events); session replay, heatmaps,
  autocapture and surveys off; event retention of at most 12 months; the
  PostHog DPA accepted.
- **Cloudflare:** the DPA accepted; Workers Logs and Logpush not enabled for
  `lictory-marketing` and `lictory-docs` (the notice says no access logs are
  kept; `wrangler.jsonc` enables no observability).
- **Email:** the provider of the published contact address processes
  correspondence; replies and requests are kept for at most 24 months unless a
  claim or obligation requires longer.
- `ANALYTICS_CONSENT` stays unset in the `websites` environment (built in as
  `NEXT_PUBLIC_ANALYTICS_CONSENT`; cookieless before consent). If it is set to
  `strict`, rewrite the analytics section and the cookie table: nothing would
  then be collected without consent. Removing the PostHog variables or adding any other script or
  provider also changes the processing: update
  `apps/marketing/src/lib/legal/privacy.ts` in the same change.
- **Legitimate interest:** before relying on cookieless analytics, assess and
  document the legitimate interest and how an objection is honored. Cookieless
  IP/user-agent hashes are not assumed anonymous. Consent is stored locally by
  c15t; its offline mode keeps no server-side consent evidence register.
- **Cookie table:** the storage entries listed in the notice were observed in
  a browser against a local build (before a choice, after Reject All, after
  Accept All and after withdrawal). Re-check them when posthog-js, c15t or the
  consent configuration changes.

Change `legalVersion` in `apps/marketing/src/lib/site.ts` whenever the text
changes; it dates both pages and their sitemap entries.

## Installation notices

`LEGAL_TERMS_URL` and `LEGAL_PRIVACY_URL` (absolute http(s) URLs, read by the
API at runtime and written into the SPA document) are the installation
operator's terms and privacy notice. With them, sign-up and social sign-in say
that creating an account accepts the terms and acknowledges the notice, and
the consent banner links to the notice. Without them there is no acceptance
notice and no legal link: Lictory never presents another operator's terms as
an installation's own. Invalid values count as unset. Analytics and their
consent banner exist only when the installation configures PostHog
([product analytics](../internals/analytics.md#consent)).

Acceptance is not recorded: the platform does not persist a versioned
acceptance receipt or collect acceptance of amended terms from existing
accounts. An operator who needs that evidence must arrange it separately.

## Legal basis for the drafting choices

- [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj): Articles 6 (lawful
  bases), 7(3) (withdrawal), 11 (processing not requiring identification),
  12–13 (transparency), 15–21 (rights), 28 (processors), 44–49 (transfers) and
  77 (complaints).
- [ePrivacy Directive Article 5(3)](https://eur-lex.europa.eu/eli/dir/2002/58/oj):
  consent for storing or reading information on a device unless strictly
  necessary for a service the user requested.
- [EDPB Guidelines 2/2023 on the technical scope of Article 5(3)](https://www.edpb.europa.eu/our-work-tools/documents/public-consultations/2023/guidelines-22023-technical-scope-art-53-eprivacy_en):
  why cookieless analytics still involves personal data and why the notice
  treats it as pseudonymous.
- [Garante cookie guidance](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876):
  necessary storage, separate optional consent, a rejection as easy as an
  acceptance (the banner gives Reject All and Accept All equal weight),
  analytics comparable to technical cookies, and access to the extended
  notice.

Reassess the text when the websites start accepting input, their processing
or vendors change, or the project begins offering a paid or hosted service.
