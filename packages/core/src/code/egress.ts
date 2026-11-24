import { lookup as lookupAddress, type LookupAddress } from "node:dns";
import { Agent } from "undici";
import {
  isMetadataAddress,
  isPrivateHost,
} from "@lictory/core/ai/provider-settings";
import { CodeHostError } from "@lictory/core/code/provider";

// Which addresses code host requests may reach. Organization administrators
// enter self-managed host URLs (GitHub Enterprise Server, GitLab), and the
// API and worker send authenticated requests to them: accepting any address
// would let an administrator make the server call what only it can reach
// (internal services, cloud instance metadata). This is server-side request
// forgery, so every request is checked twice: the URL when it is entered
// and before each call, and the addresses a host name resolves to at
// connection time (DNS rebinding included).
//
// - Cloud instance metadata and link-local addresses are always refused
//   (the same rule as AI endpoints entered in the admin console).
// - Private, loopback and internal-suffix hosts are refused unless the
//   operator lists the host in CODE_HOST_PRIVATE_HOSTS (a self-managed
//   GitLab on the company network), or outside production for loopback
//   (local development and test stand-ins).
// - Redirects are never followed, so a response cannot steer a request
//   elsewhere.

function allowlist(environment = process.env) {
  return new Set(
    (environment.CODE_HOST_PRIVATE_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

const production = () => process.env.NODE_ENV === "production";

const loopback = (host: string) =>
  host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);

function refused(host: string) {
  return new CodeHostError(
    "validation",
    `${host} is a private or internal address. An operator must list it in CODE_HOST_PRIVATE_HOSTS before Lictory connects to a code host there.`,
  );
}

// Throws unless requests may be sent to this host name or address.
export function assertReachableHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isMetadataAddress(host))
    throw new CodeHostError(
      "validation",
      `${host} is a link-local or cloud metadata address, which Lictory never calls.`,
    );
  if (allowlist().has(host)) return;
  if (!production() && loopback(host)) return;
  if (isPrivateHost(host)) throw refused(host);
}

// A self-managed host's canonical origin (with a path prefix when the host
// lives under one): https, no credentials, query or fragment.
export function selfManagedOrigin(input: string, product: string): string {
  const value = input.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new CodeHostError(
      "validation",
      `Enter the address of your ${product}, for example https://code.example.com.`,
    );
  }
  if (url.username || url.password || url.search || url.hash)
    throw new CodeHostError(
      "validation",
      `Enter the ${product} address without credentials, query or fragment.`,
    );
  const host = url.hostname.toLowerCase();
  const plainAllowed =
    url.protocol === "http:" &&
    (allowlist().has(host) || (!production() && loopback(host)));
  if (url.protocol !== "https:" && !plainAllowed)
    throw new CodeHostError(
      "validation",
      `${product} addresses must use https.`,
    );
  assertReachableHost(host);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

// Every connection checks the addresses it is about to use.
const guardedAgent = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      lookupAddress(hostname, { ...options, all: true }, (error, found) => {
        if (error) return callback(error, "", 4);
        const addresses = found;
        const allowed = allowlist().has(hostname.toLowerCase());
        for (const { address } of addresses) {
          if (isMetadataAddress(address))
            return callback(
              new CodeHostError(
                "validation",
                `${hostname} resolves to a link-local or cloud metadata address, which Lictory never calls.`,
              ),
              "",
              4,
            );
          if (
            !allowed &&
            !(!production() && loopback(address)) &&
            isPrivateHost(address)
          )
            return callback(refused(hostname), "", 4);
        }
        if ((options as { all?: boolean }).all)
          return (callback as unknown as (e: null, a: LookupAddress[]) => void)(
            null,
            addresses,
          );
        callback(null, addresses[0]!.address, addresses[0]!.family);
      });
    },
  },
});

// The fetch every code host adapter uses by default.
export const codeHostFetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const href =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  // An address in the URL is never looked up: judge it (and the name) here.
  assertReachableHost(new URL(href).hostname);
  try {
    return await fetch(input, {
      ...init,
      redirect: "manual",
      dispatcher: guardedAgent,
    } as RequestInit);
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof CodeHostError) throw cause;
    throw error;
  }
}) as typeof fetch;
