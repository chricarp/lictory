import type { LegalSection } from "~/components/legal/legal-document";

export const termsSections: LegalSection[] = [
  {
    id: "agreement",
    title: "The operator and your agreement",
    body: `Lictory is provided by the individual in Italy identified in the service-provider details above (“we”, “us”). “You” means the person using an account. Creating an account, including an account first created through Google or Microsoft sign-in, signifies agreement to these terms. The account-creation notice links to them before you continue. Existing-account sign-in does not by itself accept a future material amendment.

Lictory is intended for professional use by adults aged 18 or over. Provide accurate account details and use the service only if you have authority to do so. Creating an account does not automatically mean you can enter a contract on behalf of an employer. An organization’s commercial agreement, if separately concluded by an authorized person, governs its purchased service and prevails over conflicting provisions here for that subject.

The service and these terms are provided in English. Correct registration details before submitting the form; use account settings or contact us to request later corrections. You can print or save these terms. Acknowledging the [Privacy Notice](/privacy) is separate from agreeing to this contract and from choosing optional analytics.`,
  },
  {
    id: "service",
    title: "What Lictory does",
    body: `Lictory helps software teams turn proposals into reviewed specifications and implementation work. It supports revisions and diffs, contextual discussions, suggestions, reviewer decisions, revision-specific approvals, readiness checks and collaboration history.

A team can manage delivery within Lictory using work items, workflows, boards, backlogs and iterations, or publish work through a configured external delivery provider. A team’s delivery mode determines which system owns delivery state; refinement remains in Lictory. Integrations and AI are available only where configured and authorized.

Readiness checks and recorded approvals are evidence of the review performed. They are not a certification that a design is secure, legally compliant, complete or free of defects. Your team decides whether the specification is suitable and whether to begin or publish work.`,
  },
  {
    id: "accounts",
    title: "Accounts and organization access",
    body: `Keep your credentials confidential, do not share accounts and promptly report suspected compromise. You are responsible for actions you authorize through your account. We remain responsible for our own obligations, including appropriate service security.

Organization administrators manage invitations, membership, roles, team policies and available integrations. Use only organizations and content you are authorized to access. An administrator can remove your organization access; this does not transfer ownership of the organization’s work to you. Before leaving, arrange any necessary handover of administration or work through an authorized administrator.

The service can send essential verification, password-reset, invitation and service communications. Notification preferences govern supported optional workflow notifications; they do not prevent messages needed to secure or administer your account.`,
  },
  {
    id: "content",
    title: "Your content and confidentiality",
    body: `You and the applicable rights holders retain ownership of specifications, discussions, files and other content supplied to Lictory. You grant us only the permission needed to host, copy, transmit, display and process that content to provide the service, follow authorized instructions and meet legal obligations. This does not transfer ownership or grant permission to advertise with your content.

Ensure that you have the necessary rights and lawful basis to upload content, invite people and share information with members, AI providers or integrations. Avoid unnecessary personal data and secrets in specifications or discussions. The service is not designed for special-category personal data or criminal-record records.

We treat non-public workspace content as confidential. Access and disclosure are limited to providing the service, authorized sharing, support, security or legal requirements. Revisions, discussions, approvals and audit history preserve collaboration context; resolving, archiving or leaving does not necessarily erase those records. Privacy requests remain governed by applicable law.`,
  },
  {
    id: "use",
    title: "Acceptable use",
    body: `Do not use Lictory to break the law, infringe intellectual-property or privacy rights, harass people, distribute malicious software, gain unauthorized access, defeat organization permissions, interfere with the service or send spam. Do not expose another organization’s confidential information or impersonate another person.

Security research must respect access boundaries and avoid disruption or disclosure of other users’ data. Report vulnerabilities privately using the contact above. You may exercise any rights that cannot lawfully be restricted by contract.`,
  },
  {
    id: "ai",
    title: "AI assistance and human review",
    body: `An organization administrator must enable AI before its content is analyzed. When enabled, analysis can run at an authorized user’s request or according to the team’s review policy. Relevant specifications, related work and discussion context can be sent to OpenAI as explained in the Privacy Notice. Check the organization’s confidentiality and data-protection requirements before enabling it.

AI findings, questions and proposed edits may be inaccurate or incomplete. Review them before accepting or relying on them. Humans decide what changes become part of a specification, what discussions are resolved, and what is approved or published. An AI result does not constitute professional, legal or security advice. OpenAI Zero Data Retention concerns provider-side request handling; Lictory still records AI runs and results in workspace history.`,
  },
  {
    id: "integrations",
    title: "External delivery and other integrations",
    body: `Connect a third-party service only with the required authority and provide credentials you are entitled to use. Your organization is responsible for selecting destination projects and mappings and reviewing the content to be published. Lictory acts on authorized publishing instructions or explicitly configured automation.

Publishing can create or update records in an external system and may partly succeed. Inspect the recorded outcomes and resolve configuration or conflicts before retrying. Removing a Lictory connection or closing an account does not erase external issues, revoke credentials at the provider, or override that provider’s retention rules.

Third-party services operate under their own agreements with you or your organization. We remain responsible for our own processing and integration behavior; the external provider controls its own service and delivery state.`,
  },
  {
    id: "fees",
    title: "Fees and service changes",
    body: `Account creation alone does not authorize a charge. A paid service requires a separate, clearly disclosed offer accepted by an authorized customer, including price, applicable taxes, duration, billing and cancellation terms. These terms do not create an automatic renewal or authorize later charging for a free account.

Features may evolve and maintenance or failures may affect availability. We communicate material changes affecting your contracted service and honor applicable contractual and statutory obligations. No specific service-level commitment is created by these terms; a separate agreement may provide one. This does not exclude duties imposed by law or rights to remedies.`,
  },
  {
    id: "closure",
    title: "Leaving, closure and legal remedies",
    body: `You can stop using Lictory, leave an organization through supported controls, or request account closure using account settings or the contact above. Organization deletion must be requested by an authorized administrator. Coordinate the handover of shared work before requesting deletion and request an accessible copy of your data where applicable law entitles you to it.

Account closure and organization deletion have different effects, as explained in the Privacy Notice. Organization history may require assisted erasure or anonymization of personal references. Copies already published to another service remain subject to that service and your organization’s instructions. We do not promise that closing an account deletes other people’s work.

Misuse, serious breach or unlawful content may require action under applicable law, including appropriate protective measures or termination for breach. We explain the reason and provide a way to contact us and challenge an error, unless prohibited by law or incompatible with addressing an immediate security risk. These terms do not grant us an unrestricted discretionary right to terminate or suspend your contract. Statutory termination rights and remedies remain available to both parties.`,
  },
  {
    id: "liability",
    title: "Responsibility and mandatory protections",
    body: `Each party is responsible for its obligations under these terms and applicable law. We do not exclude or cap liability through these terms. In particular, nothing excludes liability for intentional misconduct, gross negligence, or any responsibility that cannot lawfully be excluded under Italian law.

If you qualify as a consumer under applicable law, mandatory protections under the Italian Consumer Code (Legislative Decree 206/2005), including applicable digital-service conformity, remedy and distance-contract rights, remain unaffected. Describing Lictory as a professional service does not remove those protections where they apply. No acceptance here waives a statutory withdrawal right or requests early performance that extinguishes such a right; any paid consumer offer must supply the required information separately.`,
  },
  {
    id: "law",
    title: "Applicable law, disputes and amendments",
    body: `These terms are governed by Italian law, subject to mandatory protections that apply in your country under EU or other applicable rules. Courts with jurisdiction under applicable law handle disputes. We do not impose an exclusive court, arbitration, or a waiver of your right to seek remedies from a competent authority or court. You may first contact us to try to resolve a problem, but this is not a condition for exercising your rights.

We identify the terms’ version on this page. Material amendments affecting an existing agreement require appropriate notice and acceptance where required; merely changing the page does not silently replace that agreement. If you do not accept a proposed material change, contact us about continuing under the existing agreement or closing your account, subject to applicable law and any separate customer contract.

Contact the operator using the details above for questions, complaints or account and organization requests.`,
  },
];
