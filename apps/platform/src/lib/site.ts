import { publicConfig } from "@lictory/platform/lib/public-config";

// The public website (SITE_URL): legal pages and the product home. The app
// host links there; it never serves them itself. Without a configured
// website this is the platform's own origin.
export const siteUrl = publicConfig.siteUrl;
export const siteLink = (path: string) => `${siteUrl}${path}`;
