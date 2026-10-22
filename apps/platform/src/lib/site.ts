// The public site (lictory.com): legal pages and the product home. The app
// host links there; it never serves them itself.
export const siteUrl = (
  import.meta.env.VITE_SITE_URL || "https://lictory.com"
).replace(/\/+$/, "");
export const siteLink = (path: string) => `${siteUrl}${path}`;
