import type { LegalSection } from "@lictory/marketing/components/legal/legal-document";

// The lictory.com operator's own notice for the two public websites. It is
// operator content, not part of the Lictory software: self-hosted
// installations never show it (docs/operations/legal.md). The operator's
// identity comes from the build environment (LegalOperator), never from here.
// When the websites' processing changes (analytics settings, ANALYTICS_CONSENT,
// hosting, new third-party services), update this notice in the same change.
export const privacySections: LegalSection[] = [
  {
    id: "scope",
    title: "Who is responsible and what this notice covers",
    body: `The operator identified in the box above is the **controller** of the personal data described here, within the meaning of Regulation (EU) 2016/679 (General Data Protection Regulation, GDPR). Write to the email address shown there about anything in this notice.

This notice covers the two public websites of the Lictory open-source project:

- **lictory.com** (and www.lictory.com), the project website; and
- **docs.lictory.com**, the documentation.

It does not cover a Lictory installation. Lictory is self-hosted software: each installation is run by its own operator, who controls the data of its users and is responsible for its own privacy notice. Installations send no telemetry to the Lictory project or to us, and connect to external services only when their operator configures them; the [self-hosting privacy page](https://docs.lictory.com/self-hosting/privacy) lists each one. We cannot see, export, correct or delete data in an installation: send requests about that data to the installation's operator.

It also does not cover GitHub, where the source code, issues, discussions and release images (ghcr.io/chricarp/lictory-*) are hosted; GitHub is a separate controller under its own privacy statement. Downloading the source code or the release images sends no data to us.`,
  },
  {
    id: "no-input",
    title: "No accounts, forms or uploads",
    body: `You cannot create an account, sign in, fill in a form, comment or upload anything on these websites. Documentation search runs entirely in your browser, using an index downloaded with the page: your search terms are not sent to us.

We therefore process only:

1. the technical data any website needs to deliver its pages (section 3);
2. on lictory.com only, privacy-friendly usage statistics (section 4); and
3. the messages you choose to send us (section 5).

We do not sell personal data, use it for advertising, build profiles of visitors or make automated decisions about anyone. Analytics are never required to read the websites or to download, install or use Lictory.`,
  },
  {
    id: "delivery",
    title: "Delivering the websites",
    body: `**What.** When your browser requests a page, our hosting provider receives your IP address, the date and time, the requested address, the referring page and your browser's user-agent string (browser, version and operating system).

**Why and on what basis.** To deliver the pages, keep them available and protect them against attacks and abuse. This is necessary for our legitimate interests in operating secure websites (Article 6(1)(f) GDPR), and you cannot use a website without it.

**Who.** Both websites are static files served by **Cloudflare, Inc.**, which processes these data on our behalf as a processor under its data processing addendum. We keep no access logs of our own. Cloudflare may keep security and network records for a short period, as described in its own documentation. Cloudflare operates a global network, so a request can be handled in a data centre outside the European Economic Area; such transfers rely on the safeguards in Cloudflare's data processing addendum, such as the European Commission's standard contractual clauses.

The pages load no third-party scripts, fonts, images or embedded content: fonts and images are served from the same website.`,
  },
  {
    id: "analytics",
    title: "Usage statistics on lictory.com",
    body: `We use **PostHog** to understand how many people visit lictory.com and which pages they find useful. docs.lictory.com uses no analytics at all.

Your browser never contacts PostHog directly: requests go to lictory.com/relay and are forwarded to PostHog's EU servers. The relay forwards the event with your IP address and your browser's user-agent and language (PostHog needs the first two for the visitor count described below), never cookies. Session recording, heatmaps, click capture, page text and form capture are all disabled. Addresses are sent without their query string or fragment, and page titles are removed.

The first time you visit, a banner lets you choose. Until you accept, and whenever you reject or withdraw consent, statistics are collected **without cookies**:

- **Without your consent (cookieless).** Nothing is stored on your device to recognize you: no analytics cookie and no identifier in local storage. PostHog counts unique visitors with a hash of your IP address, user-agent and a secret salt that changes every day, so the same visitor cannot be followed from one day to the next. PostHog does not store your IP address with the events. Events record the page viewed, the referring page, browser, operating system, device type, screen size and an approximate location (country and city) derived from your IP address. These events are pseudonymous rather than anonymous, so we treat them as personal data. The legal basis is our legitimate interest in measuring the reach and usefulness of an open-source project with minimal data (Article 6(1)(f) GDPR). We consider this interest not to be overridden by your interests or rights, because the data are minimized, cannot be linked to your name, and are never used for advertising.
- **With your consent.** PostHog also stores a random identifier in a first-party cookie and in local storage on lictory.com, so that repeat visits from the same browser can be recognized. The identifier is not linked to your name or email address. The legal basis is your consent (Article 6(1)(a) GDPR and the national rules implementing Article 5(3) of the ePrivacy Directive). You can withdraw it at any time.

Open **Privacy preferences** in the footer of lictory.com to change your choice at any time. Your choice is stored in your browser by the c15t consent manager, without an external consent service. Withdrawing consent deletes PostHog's cookie and storage from your browser and reloads the page, which returns to cookieless statistics. It does not affect the lawfulness of processing before withdrawal, and it does not erase events already collected.

**Processor and location.** PostHog Inc. processes these data on our behalf under its data processing agreement, in its EU cloud region. If PostHog or one of its subprocessors accesses data from outside the European Economic Area, the transfer relies on the safeguards in that agreement, such as the European Commission's standard contractual clauses or the EU-U.S. Data Privacy Framework where the recipient is certified.`,
  },
  {
    id: "contact",
    title: "Messages you send us",
    body: `If you email us, we process your email address, your name if you give it, and the content of your message, to answer you and handle your request. The legal basis is our legitimate interest in responding to people who contact us (Article 6(1)(f) GDPR), or steps you ask us to take before entering into an agreement (Article 6(1)(b)). Where you exercise a privacy right, or binding law otherwise requires it, we process the request to comply with our legal obligations (Article 6(1)(c)).

Our email provider processes these messages on our behalf. Do not send sensitive information, such as health data, that your message does not need.

Feedback about the software belongs in the project's GitHub repository, where GitHub's terms and privacy statement apply.`,
  },
  {
    id: "storage",
    title: "Cookies and local storage",
    body: `These are all the cookies and local-storage entries the websites use:

- **\`c15t\`** (cookie and local storage, lictory.com): remembers your analytics choice so the banner does not appear again. Kept for 1 year or until you change your choice.
- **\`lictory_analytics_consent\`** (cookie, lictory.com): records that you granted analytics consent. Kept for 1 year and deleted when you withdraw.
- **\`ph_…\`** (cookie and local storage, lictory.com): PostHog's analytics identifier, set **only with your consent**. Kept for up to 1 year and deleted when you withdraw. Without consent, PostHog stores only a flag telling it to stay cookieless.
- **\`theme\`** (local storage, docs.lictory.com): remembers light or dark mode if you change it, until you clear site data.

Apart from the PostHog identifier, these entries only remember choices you made; storing them does not require consent. The relay never forwards any of these cookies to PostHog. You can delete all of them at any time in your browser's settings.`,
  },
  {
    id: "retention",
    title: "How long we keep data",
    body: `- **Request data at Cloudflare:** only as long as Cloudflare needs it to deliver the pages and protect its network.
- **Usage statistics:** deleted after at most 12 months; aggregated counts that no longer relate to a visitor may be kept longer.
- **Emails:** for as long as needed to handle your request, normally no longer than 24 months after the last exchange, unless a legal claim or obligation requires keeping them longer.`,
  },
  {
    id: "rights",
    title: "Your rights",
    body: `Under the GDPR you have the right to:

- **access** the personal data we hold about you and receive a copy (Article 15);
- have inaccurate data **corrected** (Article 16);
- have data **erased** (Article 17) or its processing **restricted** (Article 18);
- receive data you provided to us in a **portable** format (Article 20);
- **object** at any time, on grounds relating to your particular situation, to processing based on our legitimate interests, including the cookieless statistics (Article 21); and
- **withdraw consent** at any time, through Privacy preferences, without affecting earlier processing (Article 7(3)).

Write to the email address at the top of this page. We reply within one month; for complex requests we may extend this by two further months and will tell you why within the first month. Requests are free. We may ask for information to confirm your identity only where we have a reasonable doubt about it.

Cookieless statistics contain no identifier that we can connect to you, so we usually cannot find or erase the events of a particular visitor (Article 11 GDPR). If you object, we will consider whether to stop this processing altogether. You can also stop it yourself at any time by blocking requests to lictory.com/relay with a content blocker; the website works the same without them.

You also have the right to lodge a complaint with a data protection supervisory authority, in particular in the EU member state where you live, work or where you believe an infringement occurred (Article 77 GDPR). You do not need to contact us first, though we would welcome the chance to address your concern.`,
  },
  {
    id: "changes",
    title: "Security, children and changes",
    body: `Both websites are served only over HTTPS. The analytics relay strips cookies and authorization headers before forwarding anything. Report a security vulnerability in Lictory or the websites privately through [GitHub private vulnerability reporting](https://github.com/chricarp/lictory/security/advisories/new), not in a public issue.

The websites are aimed at software professionals and are not directed at children.

We update this notice when the websites or the way they process data change. The version date at the top shows when it last changed. If we ever want to use data for a new purpose that needs your consent, we will ask for it first. See also the [Terms of Service](/terms-of-service).`,
  },
];
