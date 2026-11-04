# Public legal notices

The `/privacy` and `/terms-of-service` pages on `lictory.com` cover only the
project's websites, `lictory.com` and `docs.lictory.com`. The hosted Lictory
service is retired: the project hosts no installation and receives no data
from any. Lictory is self-hosted software under the MIT License; each
installation's operator is the controller for its data and writes its own
notices. The pages say so and link to the
[self-hosting privacy page](https://docs.lictory.com/self-hosting/privacy).

What the pages describe, and where it comes from:

- **Hosting:** both websites are static exports served by Cloudflare Workers
  ([websites on Cloudflare](websites.md)). The documentation loads no
  analytics or third-party scripts.
- **Analytics:** `lictory.com` uses PostHog EU Cloud through the Worker's
  first-party `/relay`, behind the c15t consent banner
  ([product analytics](../internals/analytics.md#consent)). The privacy notice
  describes the default consent mode (`ANALYTICS_CONSENT` unset in the
  `websites` environment): cookieless, anonymous capture before a choice or
  after rejection, and a stored PostHog identifier only after consent.
  Setting `ANALYTICS_CONSENT=strict`, removing the PostHog variables or
  adding any other script or provider changes the processing: update
  `apps/marketing/src/lib/legal/privacy.ts` and `legalVersion` in the same
  change.
- **Operator:** Christian Carpinelli, an individual in Italy, confirmed as the
  websites' operator. Provider configurations (Cloudflare, PostHog EU) are
  operator declarations, not guarantees inferred from SDK options or verified
  vendor contracts.

Set `LICTORY_LEGAL_ADDRESS` and `LICTORY_LEGAL_EMAIL` to a correspondence address
and monitored public contact. Without either, both pages explicitly display a
draft notice. `LICTORY_LEGAL_NAME` overrides the operator name and
`LICTORY_LEGAL_REGISTRATION` supplies registration/VAT details if applicable.
These public values are compiled into the website at build time: for
lictory.com they are variables of the GitHub environment `websites`
([websites on Cloudflare](websites.md#github-configuration)). Rerun **Deploy
marketing website** after changing them.

The terms avoid contractual liability caps, exclusive jurisdiction or other
clauses that would need separate acceptance under Italian Civil Code Articles
1341–1342. Do not add such clauses without designing that acceptance. The
software's warranty disclaimer is the MIT License's, not the website terms'.

Before relying on cookieless analytics on the websites, assess and document
the legitimate interest and how an objection is honored. Cookieless IP/user-agent
hashes are not assumed anonymous. Consent is stored locally by c15t; its offline
mode keeps no server-side consent evidence register.

## Self-hosted installations

The platform's sign-up and sign-in screens still say that creating an account
accepts "our" Terms of Service and acknowledges "our" Privacy Notice, linked
on the installation's website origin (`SITE_URL`, otherwise the
installation's own origin, which serves no legal pages). That wording dates
from the hosted service. Replacing it with operator-configurable notice links
is a product change outside these pages. Until it lands, operators
should know that those links do not lead to notices that describe their
installation.

## Legal basis for the drafting choices

- [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj): transparency, lawful bases,
  processor agreements, rights, retention and international transfers.
- [European Commission: controller and processor responsibilities](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en).
- [Garante cookie guidance](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876): necessary storage, separate optional consent and access to the extended notice.
- [Italian Legislative Decree 70/2003](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2003-04-09;70): accessible provider and contracting information.
- [Italian Civil Code Article 1341](https://def.giustiziatributaria.gov.it/DocTribFrontend/executePrintArticolo.do?articolo=Articolo+1341&codiceOrdinamento=0000000000013410000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000&id=%7B9E93F1BE-06AE-4F24-8E9D-B838F7E0C2E6%7D): specific acceptance of certain standard terms.

Reassess the text when the websites' processing or vendors change, or if the
project ever offers a service again.
