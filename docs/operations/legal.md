# Public legal notices

Two different things need legal notices, and they never share them:

- **The Lictory websites** (`lictory.com` and `docs.lictory.com`). The
  `/privacy` and `/terms-of-service` pages of `apps/marketing` are the
  website operator's own notices for these two sites only. They are operator
  content kept in this repository; the websites are never shipped to
  self-hosting users ([websites](websites.md)).
- **A Lictory installation.** Each self-hosted installation is run by its own
  operator, who is the controller for its users and publishes their own terms
  and privacy notice. The platform links to them through `LEGAL_TERMS_URL` and
  `LEGAL_PRIVACY_URL` (below) and never to the lictory.com notices.

## Website notices

The websites accept no user input: no accounts, forms, comments or uploads,
and documentation search runs in the browser. The notices therefore cover only
request data at Cloudflare, PostHog analytics on `lictory.com` (cookieless
without consent, a first-party identifier with it; the docs have no
analytics) and email correspondence. The terms are website terms of use: they
form no account contract, do not govern the MIT-licensed software and choose no
governing law, exclusive court or liability limitation. Do not add clauses that
would need a separately accepted contract (for Italy, Civil Code Articles
1341–1342).

The operator's identity is never committed. `LegalOperator` reads it at build
time:

| Variable                     | Shown as                                      |
| ---------------------------- | --------------------------------------------- |
| `LICTORY_LEGAL_NAME`         | Operator (controller); required               |
| `LICTORY_LEGAL_EMAIL`        | Privacy and legal contact; required           |
| `LICTORY_LEGAL_ADDRESS`      | Postal address; optional, shown only when set |
| `LICTORY_LEGAL_REGISTRATION` | VAT/registration details; optional            |

Without a name and email both pages display a draft notice; nothing falls back
to a person's name. GDPR Article 13 requires the controller's identity and
contact details, so a published notice needs at least those two. For
lictory.com they are variables of the GitHub environment `websites`
([websites on Cloudflare](websites.md#github-configuration)); rerun **Deploy
marketing website** after changing them, since they are compiled into the
pages. Whether a postal address is also required (for example by national
e-commerce rules for a commercial service) is the operator's decision.

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
  kept).
- **Email:** the provider of the published contact address processes
  correspondence; replies and requests are kept for at most 24 months unless a
  claim or obligation requires longer.
- `NEXT_PUBLIC_ANALYTICS_CONSENT` stays unset (cookieless before consent). If
  it is set to `strict`, rewrite the analytics section: nothing would then be
  collected without consent.

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
  necessary storage, separate optional consent and access to the extended
  notice.

Reassess the text when the websites start accepting input, add vendors or
analytics features, or begin offering a paid or hosted service.
