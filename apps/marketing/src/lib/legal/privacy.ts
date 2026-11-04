import type { LegalSection } from "@lictory/marketing/components/legal/legal-document";

// Describes what lictory.com and docs.lictory.com actually do. When the
// websites' processing changes (analytics settings, ANALYTICS_CONSENT,
// hosting, new third-party services), update this notice in the same change.
// See docs/operations/legal.md.
export const privacySections: LegalSection[] = [
  {
    id: "responsibility",
    title: "Who is responsible for your data",
    body: `This notice covers the Lictory websites: **lictory.com** (including www.lictory.com) and the documentation at **docs.lictory.com**. They are operated by the individual based in Italy identified in the details above, who is the **controller** for the personal data processed when you visit them or contact the operator.

Lictory itself is open-source software that organizations install and run on their own servers. **The Lictory project does not host Lictory for anyone and does not receive, store or have access to the data in any Lictory installation.** The organization or person running an installation (its operator) decides how it is configured and is the controller for the accounts, specifications, discussions, files and other data in it. This notice is not the privacy notice of any installation; contact your installation's operator about its policies.

This notice is intended to provide information under Articles 13 and 14 of Regulation (EU) 2016/679 (GDPR), alongside the Italian Personal Data Protection Code (Legislative Decree 196/2003, as amended).`,
  },
  {
    id: "data",
    title: "Data processed when you visit the websites",
    body: `The websites have no accounts, sign-in, forms or comments. Both are static sites served by **Cloudflare Workers**.

**Requests.** Like any website, serving a page involves your IP address, the requested address, your browser's user agent and request headers such as the referring page. Cloudflare processes these to deliver the pages and protect them against abuse.

**Documentation (docs.lictory.com).** The documentation loads no analytics or third-party scripts and sets no cookies. Search runs in your browser on a downloaded index; your search terms are not sent anywhere. If you choose a light or dark theme, your browser stores that choice locally.

**Analytics on lictory.com.** lictory.com measures visits with PostHog, as explained in the next section, and stores your privacy choice in your browser.

**Contacting the operator.** If you write to the contact address above, the operator receives your email address, your message and anything you include in it.

**GitHub.** The source code, issues, pull requests and release images (ghcr.io/chricarp/lictory-*) are hosted on GitHub. What you publish there, for example in an issue or pull request, is public and is processed by GitHub under its own privacy statement. Downloading the source code or the release images does not send data to the operator.`,
  },
  {
    id: "analytics",
    title: "Cookies, local storage and PostHog analytics",
    body: `lictory.com uses **PostHog** on PostHog's EU servers to understand which pages are visited. Your browser never contacts PostHog directly: analytics requests go to lictory.com/relay, which forwards them to PostHog with your IP address, user agent and language headers, but never your cookies.

On your first visit a banner asks whether you allow optional analytics cookies. You can accept, reject or customize, and change your choice at any time with **Privacy preferences** in the footer. Your choice is stored in your browser by the c15t consent manager, without an external consent service.

**Before you choose, or if you reject.** PostHog runs in cookieless mode. It stores no identifier on your device (only its opt-out flag) and records page visits. Page addresses and referrers lose their query strings and fragments, and page titles are removed, before anything is sent. To count unique visitors, PostHog derives a hash from your IP address and user agent on its servers, which changes every day. This does not identify you by name, but it is still personal data. It relies on the operator's legitimate interest in knowing how the website is used (see the next section), and you can object to it.

**If you allow analytics.** PostHog stores a random identifier in a first-party cookie and local storage on lictory.com, so visits from the same browser can be linked across sessions. lictory.com also sets a first-party cookie recording that you allowed analytics (for up to one year). The website has no accounts, so these events are not linked to your name or email address.

**In both cases** session recording, automatic capture of page text and clicks, heatmaps and dead-click capture are disabled. Withdrawing consent removes PostHog's cookie and storage and reloads the page, which then runs in cookieless mode again. It does not erase events already collected.`,
  },
  {
    id: "purposes",
    title: "Purposes and legal bases",
    body: `- **Delivering and protecting the websites: legitimate interests (Article 6(1)(f)).** Serving pages, keeping them secure and preventing abuse.
- **Cookieless visit measurement: legitimate interests (Article 6(1)(f)).** Understanding which pages are useful and whether visitors find the installation guide, with no identifier stored on your device. You can object to this processing.
- **Analytics with stored identifiers: consent (Article 6(1)(a)).** Only after you allow analytics in the banner or Privacy preferences. You can withdraw consent at any time; this does not affect earlier processing.
- **Answering your messages: legitimate interests (Article 6(1)(f)).** Replying to questions, reports and requests you send.
- **Legal obligations: Article 6(1)(c).** Responding to binding legal requests. Establishing, exercising or defending legal claims may instead rely on Article 6(1)(f).

Analytics are never required to read the websites or to download, install or use Lictory. The operator does not sell personal data or use it for advertising.`,
  },
  {
    id: "sharing",
    title: "Recipients and international transfers",
    body: `- **Cloudflare** serves both websites and processes the request data described above.
- **PostHog** receives the analytics events described above, on its EU servers.
- **GitHub** hosts the repository and release images and processes what you do there under its own terms.

These providers may access only the data needed for their function. The operator may also disclose information where binding law requires it or to protect legal rights.

Cloudflare operates a global network, so a request can be handled in a data centre outside the European Economic Area. Transfers outside the EEA require a valid GDPR transfer mechanism, such as an adequacy decision or the European Commission's standard contractual clauses. Contact the operator for details of the safeguards that apply.`,
  },
  {
    id: "retention",
    title: "How long data is kept",
    body: `Your privacy choice and the analytics cookies stay in your browser until they expire, you change your choice or you clear site data. Analytics events are kept in PostHog according to the retention settings of the operator's PostHog project. Messages you send are kept for as long as needed to handle them and any follow-up. Cloudflare keeps request data according to its own retention for the service. Contact the operator for the settings that apply.`,
  },
  {
    id: "self-hosted",
    title: "Self-hosted Lictory installations",
    body: `When an organization runs Lictory, the data stays under that organization's control:

- A self-hosted installation sends **no telemetry** to the Lictory project or anyone else.
- It connects to external services only when its operator configures them, for example email delivery, file storage, sign-in providers, Lictory Intelligence (AI), Jira or the operator's own PostHog analytics. The [self-hosting privacy page](https://docs.lictory.com/self-hosting/privacy) lists each one.
- The installation's operator decides about accounts, analytics and consent, retention, backups and deletion, and is responsible for informing its users, for example with its own privacy notice.

The Lictory project cannot see, export, correct or delete data in an installation. Send requests about that data to the installation's operator.`,
  },
  {
    id: "rights",
    title: "Your rights and how to contact us",
    body: `Subject to the conditions in the GDPR, you can request access, correction, erasure and restriction of your personal data and a portable copy of data processed on the basis of consent. You can object to processing based on legitimate interests, including cookieless visit measurement; the operator must then stop unless overriding grounds or legal claims justify continuing. Withdraw analytics consent through Privacy preferences.

Use the contact address above and describe your request. Because the websites have no accounts, the operator may need information from you, such as the approximate time of a visit, to find data relating to you. Requests are normally free and answered within one month; a permitted extension of up to two further months must be explained within that first month.

You may complain to the Italian **[Garante per la protezione dei dati personali](https://www.garanteprivacy.it/)** or the supervisory authority where you habitually live, work or where an alleged infringement occurred, and seek a judicial remedy. You do not need to contact the operator first.`,
  },
  {
    id: "updates",
    title: "Security and changes",
    body: `Report a security vulnerability in Lictory or the websites privately through [GitHub private vulnerability reporting](https://github.com/chricarp/lictory/security/advisories/new), not in a public issue.

This notice is updated when the websites' processing or legal requirements change; the version is shown at the top of this page. A revised notice does not create consent for a new optional purpose. See also the [Terms of Service](/terms-of-service).`,
  },
];
