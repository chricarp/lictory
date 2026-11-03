// Which repository paths belong to which shippable thing. The platform is
// released as versioned images; the marketing and documentation websites are
// deployed to the maintainer's Cloudflare account. A change that only touches
// the websites, maintainer documentation or CI never produces a platform
// release, a version bump or a platform release note.

/** Paths that are never part of the released platform. */
const outsidePlatform = [
  /^apps\/(marketing|docs)\//,
  /^tests\/(marketing|docs)\//,
  /^docs\//,
  /^\.github\//,
  /^[^/]+\.md$/,
  /^LICENSES?(\/|$)/,
];

/**
 * Whether these changed files can change the released platform. Unknown or
 * empty file lists count as platform changes: a missed release is worse than
 * an unnecessary one.
 */
export function touchesPlatform(files: readonly string[]): boolean {
  return (
    files.length === 0 ||
    files.some((file) => !outsidePlatform.some((path) => path.test(file)))
  );
}

/** What each website is built from (its source, shared UI and the Worker). */
const sites = {
  marketing: [
    /^apps\/marketing\//,
    /^packages\/ui\//,
    /^packages\/core\/src\/lib\//,
    /^deploy\/cloudflare\//,
    /^bun\.lock$/,
    /^package\.json$/,
    /^\.github\/workflows\/deploy-marketing\.yml$/,
  ],
  docs: [
    /^apps\/docs\//,
    /^packages\/ui\//,
    /^deploy\/cloudflare\//,
    /^bun\.lock$/,
    /^package\.json$/,
    /^\.github\/workflows\/deploy-docs\.yml$/,
  ],
} as const;
export type Site = keyof typeof sites;

/** Whether these changed files can change what a website serves. */
export function touchesSite(site: Site, files: readonly string[]): boolean {
  return files.some((file) => sites[site].some((path) => path.test(file)));
}
