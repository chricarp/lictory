import type { LegalSection } from "@lictory/marketing/components/legal/legal-document";

export const termsSections: LegalSection[] = [
  {
    id: "scope",
    title: "What these terms cover",
    body: `These terms govern your use of the Lictory websites, **lictory.com** and **docs.lictory.com**, provided by the individual in Italy identified in the details above (“we”, “us”). The websites are free and have no accounts. By using them you accept these terms.

These terms do not govern the Lictory software or any installation of it:

- **The software** is licensed under the MIT License included in the [source repository](https://github.com/chricarp/lictory). That license, not these terms, sets what you may do with the source code and the release images. Bundled third-party components keep their own licenses, listed in the repository's third-party notices.
- **A Lictory installation** is run by its own operator, usually your employer or organization. The operator's own terms and policies govern accounts and data in that installation. We do not operate any installation and are not a party to your use of one.

The [Privacy Notice](/privacy) explains how personal data is handled on the websites. It is information, not part of this agreement.`,
  },
  {
    id: "content",
    title: "Website content",
    body: `The websites describe Lictory, explain how to install and operate it, and publish guides and comparisons. We try to keep them accurate, but content can be incomplete or out of date, and the software can change between releases. Check the documentation for the version you run.

Guides and comparison pages reflect our understanding at the time of writing. Product names and trademarks of other companies belong to their owners and are used only to identify their products; no endorsement is implied.

Nothing on the websites is legal, security or professional advice. Following an installation or security guide does not guarantee that an installation is secure or compliant; the operator remains responsible for it.`,
  },
  {
    id: "use",
    title: "Acceptable use",
    body: `Do not use the websites to break the law, gain unauthorized access, interfere with their operation, overload them with automated requests, or misuse the analytics relay for anything other than the website's own analytics.

Security research must avoid disruption and must not access other people's data. Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/chricarp/lictory/security/advisories/new), not in a public issue. You may exercise any rights that cannot lawfully be restricted by contract.`,
  },
  {
    id: "links",
    title: "Links and third-party services",
    body: `The websites link to other sites, such as the GitHub repository, issues and container registry. Those sites operate under their own terms and privacy policies. Taking part in the project on GitHub, for example by opening an issue or pull request, is also governed by the repository's contribution guide and code of conduct.`,
  },
  {
    id: "availability",
    title: "Availability and changes to the websites",
    body: `The websites are provided free of charge. We may change, interrupt or discontinue them, or any part of them, at any time. No service level is promised. Released versions of the software remain available under their license independently of the websites.`,
  },
  {
    id: "liability",
    title: "Responsibility and mandatory protections",
    body: `Each party is responsible for its obligations under these terms and applicable law. These terms do not exclude or limit liability. In particular, nothing excludes liability for intentional misconduct, gross negligence, or any responsibility that cannot lawfully be excluded under Italian law. The warranty and liability terms for the software are those of its license.

If you qualify as a consumer under applicable law, mandatory protections under the Italian Consumer Code (Legislative Decree 206/2005) remain unaffected.`,
  },
  {
    id: "law",
    title: "Applicable law, disputes and changes",
    body: `These terms are governed by Italian law, subject to mandatory protections that apply in your country under EU or other applicable rules. Courts with jurisdiction under applicable law handle disputes. We do not impose an exclusive court, arbitration, or a waiver of your right to seek remedies from a competent authority or court.

We may update these terms; the version is shown at the top of this page. Changes apply to use of the websites after they are published.

Contact the operator using the details above for questions or complaints.`,
  },
];
