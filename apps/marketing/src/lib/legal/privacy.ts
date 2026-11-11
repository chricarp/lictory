import type { LegalSection } from "@lictory/marketing/components/legal/legal-document";

// The privacy notice for lictory.com and docs.lictory.com (GDPR Article 13,
// and the Garante's cookie guidelines of 10 June 2021). Operator content, never
// shown by a self-hosted installation (docs/operations/legal.md). Every
// statement here must match what the code and the provider settings do: when
// the websites' processing changes (analytics settings, ANALYTICS_CONSENT, the
// consent banner, hosting, new services or storage), update this notice and
// `legalVersion` in the same change.
export const privacySections: LegalSection[] = [
  {
    id: "controller",
    title: "Who is responsible",
    body: `The **controller** of the personal data described here, within the meaning of Regulation (EU) 2016/679 (the General Data Protection Regulation, GDPR), is **Christian Carpinelli**, a private individual in Rome, Italy, who runs the Lictory open-source project and its websites. Write to **[me@chricarp.com](mailto:me@chricarp.com)** about anything in this notice or to exercise your rights.

We have not appointed a data protection officer: Article 37 GDPR does not require one for these websites.`,
  },
  {
    id: "scope",
    title: "What this notice covers",
    body: `This notice covers the two public websites of the Lictory project:

- **lictory.com** (and www.lictory.com), the project website; and
- **docs.lictory.com**, the documentation.

Both websites are hosted and measured in the same way, and this notice says where they differ. You cannot create an account, sign in, fill in a form, comment or upload anything on either website. Documentation search runs entirely in your browser, using an index downloaded with the page, so your search terms are not sent to us.

This notice does not cover:

- **A Lictory installation.** Lictory is self-hosted software. Whoever runs an installation, usually your employer or organization, controls its users' data and provides its own privacy notice. Installations send no telemetry to us; the [self-hosting privacy page](https://docs.lictory.com/self-hosting/privacy) lists what an installation connects to.
- **GitHub**, where the source code, issues, discussions and release images are hosted. GitHub is a separate controller under the [GitHub General Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement). The websites link to GitHub but do not embed it: GitHub receives data about you only when you follow a link there.

The websites contain no social media buttons, embedded videos, maps or advertising, and load no fonts or images from other websites. They do not link to X or other social networks. Like most websites, they include preview metadata so that a link someone shares shows a title and image; the network that displays the preview fetches it, and no data about you is sent to us or to it when you visit.`,
  },
  {
    id: "hosting",
    title: "Hosting and security",
    body: `**What.** When your browser requests a page, our hosting provider receives your IP address, the date and time, the requested address, the referring page and your browser's user-agent string (browser, version and operating system), as it would for any website.

**Why and on what basis.** To deliver the pages, keep them available and protect them against attacks and abuse. This is necessary for our legitimate interest in running secure websites (Article 6(1)(f) GDPR). A website cannot be delivered without it.

**Who.** Both websites are served by **Cloudflare, Inc.**, which processes these data on our behalf as a processor under its data processing addendum. A small program on Cloudflare also runs the /relay path used for visit statistics (section 4). We have not enabled request logging for the websites, so we keep no access logs of our own. Cloudflare sets no cookies on the websites.`,
  },
  {
    id: "analytics",
    title: "Visit statistics (PostHog)",
    body: `We use **PostHog** to learn how many people visit the websites and which pages they find useful. We do not use the data for advertising, do not sell it and do not combine it with other data.

**How it reaches PostHog.** Your browser never contacts PostHog directly. Requests go to the path /relay on the website you are visiting, which forwards them to PostHog's EU servers. The relay forwards your IP address, your browser's user-agent and language, and the event itself; it never forwards cookies or sets them. Session recording, heatmaps, automatic click capture and error reports are switched off. Page addresses are sent without their query string or fragment, and page titles are removed.

**What is recorded.** The page viewed, the referring page, browser, operating system, device type and screen size. The websites also record a few actions, never anything you type:

- **lictory.com:** clicks on the Get started and GitHub links, with where on the page the link was.
- **docs.lictory.com:** that search was opened and which result page was chosen (not the search terms); that a code block was copied and, for documented commands, which command (not the copied text); and clicks on the GitHub and Website links in the navigation.

**Your choice.** The first time you visit a website, a banner offers **Accept All**, **Reject All** and **Customize**, with equal weight. Each website asks separately: a choice on lictory.com does not apply to docs.lictory.com.

- **Until you choose, and after you reject: cookieless statistics.** Nothing that identifies you or your browser is stored on your device: no analytics cookie and no identifier, only PostHog's record that you have not consented (section 5). PostHog counts unique visitors with a one-way hash of your IP address, user-agent and the website's name combined with a secret that changes every day and is then deleted, so the same visitor cannot be recognized from one day to the next. PostHog removes the IP address before it processes these events, so they carry no IP address, no location and no persistent identifier. They are pseudonymous rather than anonymous, so we treat them as personal data. The legal basis is our legitimate interest in measuring the reach of an open-source project with minimal data (Article 6(1)(f) GDPR). We consider that this interest is not overridden by your rights because the data are minimized, used only by us for aggregate statistics about our own websites, never used to profile you, and processed by PostHog only on our behalf. For the same reasons we use this measurement without asking consent, as the Garante's cookie guidelines allow for analytics tools that serve only aggregate statistics for the site that uses them. You can object at any time (section 9).
- **If you accept: statistics with a browser identifier.** PostHog additionally stores a random identifier in a cookie and in local storage on that website, so it can recognize repeat visits from the same browser, and derives an approximate location (country and city) from your IP address. The IP address itself is not stored with the events, and the identifier is not linked to your name or email address. The legal basis is your consent (Article 6(1)(a) GDPR, and Article 122 of the Italian Privacy Code, Legislative Decree 196/2003, which implements Article 5(3) of the ePrivacy Directive).

**Changing your mind.** Open **Privacy preferences**, in the footer of lictory.com or below the navigation of docs.lictory.com, to change your choice at any time. Withdrawing consent deletes PostHog's cookie and storage from your browser and reloads the page, which goes back to cookieless statistics. Withdrawal does not affect processing that took place before it, and it does not erase events already collected.`,
  },
  {
    id: "storage",
    title: "Cookies and similar storage",
    body: `These are all the cookies and browser-storage entries the websites use. Each website keeps its own; none is shared between lictory.com and docs.lictory.com, and none is set by a third party. \`<token>\` stands for the public key of our PostHog project.

Entries marked *necessary* only record your choice or keep a feature working; the law does not require consent for them. The PostHog identifier is set only with your consent. You can delete all of them at any time in your browser's settings; the websites keep working without them.`,
    table: {
      caption: "Cookies and browser storage used by the websites",
      columns: ["Name", "Type and provider", "Purpose", "Kept for"],
      rows: [
        [
          "c15t",
          "Cookie and local storage, first party (c15t consent manager), both websites. Necessary.",
          "Remembers your analytics choice, with a random identifier for the choice record and its date, so the banner does not appear again. Stays in your browser: no consent service receives it.",
          "Cookie: 1 year. Local storage: until you change your choice or clear site data.",
        ],
        [
          "lictory_analytics_consent",
          "Cookie, first party, both websites. Necessary.",
          "Records that you accepted analytics. Set only when you accept.",
          "1 year, or until you withdraw consent.",
        ],
        [
          "__ph_opt_in_out_<token>",
          "Local storage, first party (PostHog), both websites. Necessary.",
          "Tells PostHog whether you consented, so it stays cookieless until you do. Holds 0 or 1, no identifier.",
          "Until you clear site data.",
        ],
        [
          "ph_<token>_posthog",
          "Cookie and local storage, first party (PostHog), both websites. Analytics, only with consent.",
          "Random identifier that recognizes repeat visits from your browser.",
          "Cookie: 1 year. Local storage: until you withdraw consent or clear site data.",
        ],
        [
          "ph_<token>_*",
          "Session storage, first party (PostHog), both websites. Analytics, only with consent.",
          "Technical state of the current browsing session.",
          "Until you close the tab.",
        ],
        [
          "theme",
          "Local storage, first party, docs.lictory.com only. Necessary.",
          "Remembers light or dark mode, if you choose one.",
          "Until you clear site data.",
        ],
      ],
    },
  },
  {
    id: "contact",
    title: "Emails you send us",
    body: `If you email us, we process your email address, your name if you give it, and the content of your message, to answer you and handle your request. The legal basis is our legitimate interest in replying to people who write to us (Article 6(1)(f) GDPR). When you exercise a privacy right, we process your request to comply with our legal obligations (Article 6(1)(c)). Our email provider processes these messages on our behalf. Please do not send sensitive information, such as health data, that your message does not need.`,
  },
  {
    id: "recipients",
    title: "Recipients and transfers outside the EU",
    body: `Your data is processed by us and by these processors, each acting only on our instructions under a data processing agreement:

- **Cloudflare, Inc.** (United States), which hosts and protects both websites (section 3).
- **PostHog Inc.** (United States), whose EU cloud stores the visit statistics in the European Union (section 4).
- Our email provider, for messages you send us (section 6).

We do not sell or share personal data with anyone else, except where the law requires disclosure to a public authority.

Both providers are based in the United States, Cloudflare handles a request in the data centre nearest to you, which may be outside the European Economic Area, and PostHog's data processing agreement allows processing in the United States. These transfers are covered by:

- the **EU–U.S. Data Privacy Framework**, under which the European Commission has found that certified companies protect personal data adequately (Commission Implementing Decision (EU) 2023/1795). Cloudflare, Inc. and PostHog Inc. are both certified, as the [Data Privacy Framework list](https://www.dataprivacyframework.gov/list) shows; and
- the European Commission's **standard contractual clauses** (Decision (EU) 2021/914), which PostHog's data processing agreement includes as well, and which Cloudflare's applies if its certification lapses.

You can ask us for a copy of these safeguards at the address in section 1.`,
  },
  {
    id: "retention",
    title: "How long data is kept",
    body: `- **Hosting and security records at Cloudflare:** Cloudflare keeps no request logs for us. Its traffic analytics for our websites, which can include visitors' IP addresses, cover a rolling period of about one month. Cloudflare keeps its own network security records only as long as needed to protect its network.
- **Visit statistics at PostHog:** one year, the retention period of our PostHog plan, after which PostHog deletes them (deletion can take some time after expiry). Totals that no longer relate to any visitor, such as monthly visit counts, may be kept longer.
- **Emails:** as long as needed to handle your request, and no longer than 24 months after the last exchange, unless a legal claim or obligation requires keeping them longer.
- **Cookies and browser storage:** as listed in section 5.`,
  },
  {
    id: "rights",
    title: "Your rights",
    body: `Under the GDPR you have the right to:

- **access** the personal data we hold about you and receive a copy (Article 15);
- have inaccurate data **corrected** (Article 16);
- have data **erased** (Article 17);
- have its processing **restricted** (Article 18);
- receive data you gave us in a **portable** format (Article 20);
- **object** at any time, on grounds relating to your particular situation, to processing based on our legitimate interest, including the cookieless statistics (Article 21); and
- **withdraw your consent** at any time, as easily as you gave it, through Privacy preferences, without affecting the lawfulness of earlier processing (Article 7(3)).

Write to [me@chricarp.com](mailto:me@chricarp.com). Requests are free. We reply within one month; for complex requests this can be extended by two further months, and we will tell you why within the first month. We ask for information to confirm your identity only if we have reasonable doubts about it.

Cookieless statistics contain no identifier that links them to you, so we usually cannot find the events of a particular visitor (Article 11 GDPR). If you object, we will stop using cookieless statistics for you where we can, or tell you why we cannot. You can also stop them yourself at any time by blocking requests to lictory.com/relay and docs.lictory.com/relay with a content blocker; the websites work the same without them.

You also have the right to lodge a complaint with a supervisory authority (Article 77 GDPR). In Italy this is the [Garante per la protezione dei dati personali](https://www.garanteprivacy.it); you can also complain to the authority of the EU country where you live or work, or where you believe an infringement occurred.`,
  },
  {
    id: "other",
    title: "Automated decisions, children and changes",
    body: `Giving us data is never required to read the websites or to download, install or use Lictory. We make no decisions about anyone by automated means, including profiling (Article 22 GDPR).

The websites are aimed at software professionals. They are not directed at children, and we do not knowingly collect data about children.

We update this notice when the websites or the way they process data change; the date at the top shows the last change. If we ever want to use data for a new purpose that needs your consent, we will ask first. See also the [Terms of Use](/terms-of-service).`,
  },
];
