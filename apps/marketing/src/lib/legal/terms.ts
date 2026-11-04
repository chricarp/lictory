import type { LegalSection } from "@lictory/marketing/components/legal/legal-document";

// The lictory.com operator's terms for the two public websites. Operator
// content, never shown by a self-hosted installation (docs/operations/legal.md).
// They form no account contract: the websites accept no user input.
export const termsSections: LegalSection[] = [
  {
    id: "scope",
    title: "What these terms cover",
    body: `These terms apply to your use of the Lictory project websites, **lictory.com** and **docs.lictory.com**, operated by the person identified in the box above (“we”, “us”). By using the websites you agree to them. If you do not agree, please do not use the websites.

The websites only provide information about Lictory: you cannot create an account, buy anything or submit content here. Using them is free.

These terms do not govern the Lictory software or any installation of it:

- **The software** is open source. Your rights to use, copy, modify and distribute it come solely from its license, the MIT License, published with the [source code](https://github.com/chricarp/lictory). Nothing in these terms restricts those rights.
- **An installation** of Lictory is operated by whoever runs it, under that operator's own terms and privacy notice. We do not operate a hosted Lictory service and are not a party to your relationship with an installation's operator.`,
  },
  {
    id: "content",
    title: "Website content",
    body: `The source of both websites, including their texts and illustrations, is part of the Lictory repository and is available under the MIT License, unless a file says otherwise. Third-party materials keep their own licenses, listed in the repository's third-party notices.

The license covers copyright, not the “Lictory” name and logo, which identify the project. You may use them to refer to the project truthfully, but not in a way that suggests we endorse, sponsor or are affiliated with you, your product or your installation unless we are.`,
  },
  {
    id: "information",
    title: "Information, not advice",
    body: `We write the websites carefully, but they describe software that changes. Features, instructions, comparisons with other products and guides may be incomplete, out of date or not suited to your situation. Check the documentation for the version you run and test changes before relying on them.

Comparisons with other products reflect our understanding at the date shown on the page and are not endorsed by their owners. Product names belong to their respective owners. Guides are general information about software practice, not professional, legal or security advice.

Links to other websites, such as GitHub, are provided for convenience. Those websites are operated by others under their own terms; we are not responsible for their content.`,
  },
  {
    id: "use",
    title: "Acceptable use",
    body: `Do not misuse the websites: do not attempt to gain unauthorized access, disrupt or overload them, circumvent their security, or use them to distribute malicious software. Automated access, including by search engines and AI assistants, is welcome within the limits published in robots.txt, provided it does not impair the websites for others.

Please report security vulnerabilities in the websites or the software privately, as described in the project's security policy on GitHub, rather than publicly.`,
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: `We provide the websites free of charge and may change, suspend or discontinue them, or any part of them, at any time. We do not guarantee that they will always be available or error free.

We may update these terms when the websites change. The version date at the top of this page shows when they last changed; the version in force when you use the websites applies.`,
  },
  {
    id: "liability",
    title: "Liability",
    body: `Each of us is responsible under applicable law; these terms neither exclude nor limit that liability. The software itself is provided under its license, which contains its own warranty disclaimer and limitation of liability.

If you use the websites as a consumer, nothing in these terms limits the rights mandatory consumer law of your country of residence gives you.`,
  },
  {
    id: "law",
    title: "Applicable law and contact",
    body: `These terms do not choose a governing law or an exclusive court: the law and courts that have jurisdiction are those determined by the applicable rules, and you always keep the protection of the mandatory law of your country of residence.

For questions about these terms, write to the email address in the box above. Personal data processed when you use the websites is described in the [Privacy Notice](/privacy).`,
  },
];
