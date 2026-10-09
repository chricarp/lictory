import type { LegalSection } from "~/components/legal/legal-document";

export const privacySections: LegalSection[] = [
  {
    id: "responsibility",
    title: "Who is responsible for your data",
    body: `Lictory is operated by an individual based in Italy, identified in the service-provider details above. That person is the **controller** for public-website, account, service administration and product-analytics data: they decide why and how those data are processed.

For personal data your organization puts into specifications, discussions, files and delivery work, your organization normally acts as controller and Lictory acts as its **processor**, following documented instructions. Your organization decides who can join, what to upload, how to use integrations and how long its workspace is needed. An Article 28 GDPR data-processing agreement must govern that processing; these terms and this notice do not replace it. Contact your organization’s administrator about its own policies.

This notice is intended to provide information under Articles 13 and 14 of Regulation (EU) 2016/679 (GDPR), alongside the Italian Personal Data Protection Code (Legislative Decree 196/2003, as amended).`,
  },
  {
    id: "data",
    title: "Data we handle and where it comes from",
    body: `**Account and identity.** Your name, email address, chosen handle, profile image if supplied, email-verification state and preferences. Email/password accounts store a password hash, not a readable password. Authentication also involves verification and reset tokens, session identifiers and expiry times, IP addresses and browser/device information. If enabled and chosen, Google or Microsoft sign-in supplies identity information and authentication tokens.

**Organization and collaboration.** Memberships, invitations, roles, teams, projects, specifications, immutable revisions, review decisions, approvals, anchored discussions, suggestions, readiness checks, work items, estimates, iterations, relations, notifications and associated authorship, timestamps and activity history. Uploaded files and their metadata may contain personal data. Review and delivery history records who did what and which revision was reviewed.

**Integrations and Lictory Intelligence.** Connection settings and credentials, external issue identifiers, publishing results, and the content you publish through a configured delivery integration. When Lictory Intelligence is enabled, we also handle requests, contextual content, generated findings and the identity of the requester.

**Technical, support and usage data.** Requests to the website and APIs, diagnostic and security information, browser and device characteristics, page visits, feature-use events, identifiers and counts, and correspondence you send us. The analytics section below explains which events are collected even without analytics-cookie consent.

We receive data directly from you, from your browser, from organization administrators and collaborators, from a sign-in provider you select, and from integrations your organization connects. For example, an administrator can provide your email to invite you, and another member can mention or assign you in work. This notice also applies to those indirect sources. Do not upload unnecessary personal data, special-category data such as health information, or criminal-record data; Lictory is not designed to host those records.`,
  },
  {
    id: "purposes",
    title: "Purposes and legal bases",
    body: `For processing where Lictory is controller, we use the following bases:

- **Providing your account and requested service — contract (Article 6(1)(b)).** Creating and authenticating an account, maintaining sessions, handling account preferences, and sending verification, password-reset and essential service messages, insofar as necessary to perform our agreement with you.
- **Running an organization’s service — legitimate interests (Article 6(1)(f)) where you are not the contracting customer.** Administering access, invitations and service communications so the organization and its authorized members can collaborate.
- **Security and support — legitimate interests (Article 6(1)(f)).** Protecting accounts and workspace confidentiality, preventing abuse, diagnosing failures and answering requests. Our interest is in providing a safe and reliable service with proportionate technical records.
- **Service improvement and limited usage measurement — legitimate interests (Article 6(1)(f)).** Understanding which workflows function and where failures occur, using minimized cookieless browser events and server-side feature-use events. This requires a balancing of those interests against your rights; see the analytics section and your right to object below.
- **Optional browser analytics with stored identifiers — consent (Article 6(1)(a)).** Only after you enable Analytics in Privacy preferences. You may withdraw it at any time.
- **Legal obligations — Article 6(1)(c).** Responding to binding legal requests and keeping records required by applicable law. Establishing, exercising or defending legal claims may instead rely on Article 6(1)(f).

For organization-controlled workspace content, the organization determines the lawful basis; Lictory processes it on the organization’s instructions, including optional Lictory Intelligence and external publishing. Enabling a feature is an instruction to provide it, not blanket GDPR consent on behalf of everyone mentioned in its content.

Name, email and authentication information are needed to provide an account. Without them we cannot register or authenticate you. Workspace information is needed for the features you choose. Optional analytics consent is not required to create an account or use core collaboration. Account creation acknowledges this notice; it does not waive your rights.`,
  },
  {
    id: "analytics",
    title: "Cookies, local storage and PostHog analytics",
    body: `**Necessary storage.** Lictory uses authentication cookies and related security state to sign you in and keep sessions working. Your browser also stores privacy choices, appearance and other interface preferences. The workspace uses a local IndexedDB cache and pending changes to support responsive use and reconnection. These local copies can contain workspace content; use a trusted device and clear site data when leaving a shared device. Necessary storage supports the service or settings you request and is separate from optional measurement.

**With Analytics enabled.** When PostHog is configured, its browser SDK uses first-party analytics storage, captures page visits and selected feature-use events, and associates events with your user ID, organization and browser session. This can connect activity across sessions or devices signed in to the same account. We do not enable session replay, automatic capture of page text, heatmaps or dead-click capture. Explicit analytics payloads exclude specification text, discussion bodies, search terms, file names, email addresses and display names; URLs are stripped of queries and fragments.

**Without Analytics enabled.** The SDK still loads through Lictory’s relay. If PostHog’s cookieless mode is configured, it receives minimized browser events and uses IP address and user-agent information to derive a daily rotating server-side visitor hash. Events are not linked to your Lictory user or organization by browser identification, and workspace paths are reduced. Cookieless does not mean that no personal data is processed: network information and pseudonymous hashes can still be personal data.

**Server-side events.** When PostHog is configured, successful and failed service actions can also generate server events associated with your authenticated user ID and organization or work-item identifiers. These events, and operational diagnostics, are independent of the browser’s analytics-cookie choice. We use them for the limited improvement and reliability purposes described above, not advertising. You can object to processing based on legitimate interests by contacting the controller.

PostHog analytics is hosted on EU servers in this deployment. Open **Privacy preferences** in the footer or your account menu to accept, reject or withdraw optional analytics. Withdrawal removes browser analytics storage and reloads the page; it does not erase events already collected or stop the separate server/cookieless processing described above. Browser choices are saved locally by the c15t consent manager, without an external consent service. Stored identifiers last until their configured expiry, withdrawal or clearance of site data; the account session lifetime also depends on whether you choose to stay signed in.`,
  },
  {
    id: "ai",
    title: "Optional Lictory Intelligence analysis",
    body: `Lictory Intelligence is off by default for an organization and requires administrator enablement and a configured provider. Depending on team policy, an authorized request or a review update can trigger analysis. The current provider is **OpenAI**, under the operator’s Zero Data Retention arrangement. Requests also use the API’s storage-disabled setting. Provider retention controls concern OpenAI’s handling of the request; Lictory retains its own Lictory Intelligence run history and results with the workspace.

Analysis can send specifications of the relevant item and related ancestors or descendants, initial open discussion messages, statuses, estimates, relations and changed lines in a proposed revision. Do not enable analysis for content you are not authorized to disclose to that provider. Your organization must establish any required lawful basis and processing arrangements.

Outputs are proposals for human review and can be wrong. Lictory Intelligence does not approve a specification, resolve a discussion or authorize publishing. Lictory does not use AI to make decisions about individuals that produce legal or similarly significant effects. The availability of EU hosting for the application and analytics does not establish that Lictory Intelligence processing stays in the EEA; applicable transfer arrangements must cover any access or processing outside it.`,
  },
  {
    id: "sharing",
    title: "Recipients and international transfers",
    body: `Workspace data is available to members who have access through your organization’s permissions. Administrators manage access and can see membership and activity information. Content you submit is not made public just because the legal pages and landing page are public.

The website/application is hosted by **Vercel in a European datacenter**. **Neon** hosts the PostgreSQL database, **Cloudflare R2** stores private uploaded files, and **Resend** delivers transactional email, using the operator’s EU-hosted configurations. **PostHog on EU servers** receives the analytics described above; **OpenAI** receives context only when Lictory Intelligence is enabled, under the operator’s Zero Data Retention arrangement. Authorized service providers and personnel may access only the data needed for their functions under appropriate confidentiality and data-processing arrangements.

Google or Microsoft handles sign-in if you select an enabled provider. A delivery provider, currently Jira where connected, receives the work-item content and metadata your organization instructs Lictory to publish; it handles those data under your organization’s relationship with it. Provider privacy terms apply to processing it independently determines. We may also disclose information where necessary to comply with binding law or protect legal rights. Lictory does not sell personal data or use workspace content for advertising.

European hosting does not exclude access from other countries by a provider or an organization member. Transfers outside the EEA require a valid GDPR transfer mechanism, such as an applicable adequacy decision or the European Commission’s standard contractual clauses with any necessary supplementary protections. The operator must confirm the actual countries, subprocessors and safeguards for this deployment; EU hosting or a storage-disabled API setting alone is not a transfer safeguard. Contact the controller for the applicable details and a copy of relevant safeguards, with confidential information redacted where necessary.`,
  },
  {
    id: "retention",
    title: "Retention and account or organization closure",
    body: `The operator’s retention policy is to keep account data for the life of the account and organization workspace data for the life of the organization, then delete the corresponding data following account closure or organization deletion, subject to a specific lawful reason to retain limited records.

Closing a personal account and deleting an organization are different requests. Specifications, revisions, review decisions, discussions and delivery history belong to the organization’s collaborative record. Closing an account does not itself delete the organization or its other members’ work. Personal attribution within that history must be assessed with the organization: it must be erased or anonymized when required, or retained only where a lawful exception or continuing purpose applies. Historical integrity does not justify indefinite retention of unnecessary identifying information.

Deleting or archiving a work item is not the same as erasing all its immutable history. Contact the controller and your organization’s administrator for a privacy-erasure or complete workspace-deletion request. The current service does not promise that account closure automatically removes every historical reference: those requests may need assisted handling.

Authentication tokens have expiry times. Local storage can remain on your device until its expiry or you clear site data. Analytics, email-provider records, diagnostic logs and backups have their own provider retention settings; contact the controller for the settings applicable to your data. Those records must be limited to what is necessary for their stated purpose, with deletion from live systems and eventual expiry of residual backup copies after closure. If a limited record is retained for a legal obligation or claim, we identify the reason, restrict its use and keep it only for the required or applicable limitation period. Published external issues are controlled by the destination system and are not deleted merely by closing Lictory.`,
  },
  {
    id: "rights",
    title: "Your rights and how to contact us",
    body: `Subject to the conditions in the GDPR, you can request access, correction, erasure, restriction and a portable copy of data processed automatically on consent or contract. You can object to legitimate-interest processing, including the usage measurement described above. We must stop that processing unless overriding grounds or legal claims justify continuing it. Withdraw optional analytics consent through Privacy preferences; this does not affect earlier lawful processing.

Use the privacy contact above and describe the data or request. We may ask for proportionate identity verification. Requests are normally free, and we respond within one month; a permitted extension of up to two further months must be explained within that first month. For organization-controlled content, we assist the organization in responding and direct your request to the appropriate controller.

You may complain to the Italian **[Garante per la protezione dei dati personali](https://www.garanteprivacy.it/)** or the supervisory authority where you habitually live, work or where an alleged infringement occurred, and seek a judicial remedy. You do not need to contact us first.`,
  },
  {
    id: "updates",
    title: "Security, audience and changes",
    body: `Lictory uses authenticated access, organization-scoped authorization and private file access. Passwords are hashed and delivery credentials are encrypted in storage. No service can eliminate every security risk; keep credentials private and report suspected unauthorized access to the contact above.

Lictory is intended for adult professional users, not children. If a child has supplied data, contact us so we can assess and address it.

We update this notice when processing or legal requirements change and identify the version on this page. Material changes are communicated before new processing where required. A revised notice does not create consent for a new optional purpose. See also our [Terms of Service](/terms-of-service).`,
  },
];
