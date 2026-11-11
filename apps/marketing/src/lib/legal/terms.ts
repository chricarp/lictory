import type { LegalSection } from "@lictory/marketing/components/legal/legal-document";

// Terms of use for the two public websites, lictory.com and docs.lictory.com.
// Never shown by a self-hosted installation (docs/operations/legal.md). The
// websites accept no user input, so these terms form no account contract.
// Keep them short and keep the liability clause within Italian Civil Code
// Article 1229 and the Consumer Code; see docs/operations/legal.md.
export const termsSections: LegalSection[] = [
  {
    id: "scope",
    title: "Who runs the websites",
    body: `**lictory.com** and **docs.lictory.com** are run by Christian Carpinelli, a private individual in Rome, Italy (“we”, “us”), shown in the box above with the email address for any question about these terms. By using the websites you accept these terms.

The websites give information about Lictory, an open-source project. You cannot create an account, buy anything or submit content on them, and using them is free.`,
  },
  {
    id: "software",
    title: "The Lictory software",
    body: `Lictory is open-source software released under the [MIT License](https://github.com/chricarp/lictory/blob/main/LICENSE). Your rights to use, copy, modify and distribute it, and the terms under which it is provided, come only from that license. These terms do not change it.

An installation of Lictory is run by whoever operates it, usually your employer or organization, under that operator's own terms and privacy notice. We do not run a hosted Lictory service.`,
  },
  {
    id: "use",
    title: "Acceptable use",
    body: `Do not misuse the websites. In particular, do not try to gain unauthorized access to them, disrupt or overload them, get around their security, use their analytics relay for anything other than the websites' own statistics, or use them to spread malicious software. Automated access, including by search engines and AI assistants, is welcome within the limits published in robots.txt, provided it does not impair the websites for others.

Report security vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/chricarp/lictory/security/advisories/new), not in a public issue.`,
  },
  {
    id: "ip",
    title: "Content, name and logo",
    body: `The source of both websites, including their text and illustrations, is part of the Lictory repository and is available under the MIT License unless a file says otherwise. Third-party materials keep their own licenses, listed in the repository's third-party notices.

The MIT License covers copyright. It gives no rights in the **Lictory name and logo**, which identify the project. You may use them to refer to the project accurately, for example to say that your product works with Lictory or that you run an installation. Do not use them in a way that suggests we endorse, sponsor or are affiliated with you, your product or your installation, and do not use them as or in the name or logo of another product.

Other product names mentioned on the websites belong to their owners. Comparisons with other products reflect our understanding on the date shown on the page and are not endorsed by those owners.`,
  },
  {
    id: "information",
    title: "Information and links",
    body: `We write the websites with care, but they describe software that changes. Instructions, guides and comparisons can be incomplete or out of date, and they are general information, not professional, legal or security advice. Check the documentation for the version you run and test changes before you rely on them.

The websites link to other websites, such as GitHub, which are run by others under their own terms. We are not responsible for their content.

We may change, suspend or stop the websites, or any part of them, at any time. Released versions of the software stay available under their license.`,
  },
  {
    id: "liability",
    title: "Liability",
    body: `The websites are free and informational. To the extent the law allows, we are not liable for loss or damage arising from using them or relying on their content.

This does not exclude or limit liability for wilful misconduct or gross negligence, for death or personal injury, or any other liability that the law does not allow to be excluded or limited (including under Article 1229 of the Italian Civil Code). Nothing in these terms limits the rights you have as a consumer under the Italian Consumer Code (Legislative Decree 206/2005) or under the mandatory consumer law of your country of residence.`,
  },
  {
    id: "law",
    title: "Applicable law and changes",
    body: `These terms are governed by Italian law. If you use the websites as a consumer, this choice does not deprive you of the protection of the mandatory rules of the country where you live, and these terms do not take away any right the law gives you to bring a claim before the courts of your place of residence.

We may update these terms when the websites change. The date at the top of this page shows when they last changed, and the version in force when you use the websites applies. How we handle personal data is explained in the [Privacy Notice](/privacy).`,
  },
];
