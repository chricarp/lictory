// The public site (lictory.com): legal pages and the product home. The app
// host links there; it never serves them itself.
const configured = import.meta.env.VITE_SITE_URL?.trim() ?? "";
export const siteUrl = (
  configured === "" ? "https://lictory.com" : configured
).replace(/\/+$/, "");
export const siteLink = (path: string) => `${siteUrl}${path}`;
