/** One consent choice for a domain and its subdomains (public websites). */
export type SharedConsent = {
  /** Registrable domain, such as `lictory.com`. */
  domain: string;
  /** The websites the choice covers, as shown in the banner. */
  sites: string;
};

/** lictory.com and docs.lictory.com share one choice and one identity. */
export const websitesConsent: SharedConsent = {
  domain: "lictory.com",
  sites: "lictory.com and docs.lictory.com",
};
