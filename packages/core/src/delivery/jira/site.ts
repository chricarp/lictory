import { DeliveryError } from "@lictory/core/delivery/provider";

// Which hosts a Jira Cloud connection may point at. The API and worker send
// authenticated requests to a connection's stored site URL, and organization
// administrators choose that URL. Accepting any host would let them make the
// server call addresses only it can reach (internal services, cloud metadata
// endpoints): server-side request forgery. Jira Cloud sites always live on
// Atlassian's own domains, so only those are allowed. Self-managed Jira (Data
// Center) on private networks needs an explicit operator allowlist and is not
// supported yet.
const CLOUD_SITE =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:atlassian\.net|jira\.com)$/;

// Returns the site's canonical origin, or throws a validation error naming
// what to enter instead. Used when connecting and again before every request,
// so a stored connection that predates the check cannot be used either.
export function jiraCloudSite(input: string): string {
  const value = input.trim();
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw invalidSite();
  }
  if (localDevelopment(url)) return url.origin;
  if (url.protocol !== "https:")
    throw new DeliveryError("validation", "Jira Cloud sites must use https.");
  if (url.port !== "" || !CLOUD_SITE.test(url.hostname)) throw invalidSite();
  return url.origin;
}

function invalidSite() {
  return new DeliveryError(
    "validation",
    "Enter your Jira Cloud site URL, for example https://acme.atlassian.net.",
  );
}

// A local Jira stand-in (http://localhost) is accepted outside production so
// the export flow can be exercised end to end without a Jira Cloud site.
function localDevelopment(url: URL) {
  return (
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}
