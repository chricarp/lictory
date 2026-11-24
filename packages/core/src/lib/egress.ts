import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { envBoolean, type Environment } from "@lictory/core/lib/env";

// Outbound requests to destinations people enter (webhooks of agent
// events). Server-side request forgery is the risk: a URL a person or an
// agent chooses must not make the server call what only it can reach
// (loopback services, the private network, cloud instance metadata). So:
//
// - every address is judged, whether written in the URL or behind a name,
//   and a name is resolved once and connected to at the address that was
//   judged (no second lookup an attacker's DNS could answer differently);
// - private networks are refused unless the operator allows them
//   (`AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS`, for agents on the LAN of a
//   self-hosted installation); link-local, metadata, unspecified, multicast
//   and reserved addresses are refused always;
// - https is required except to a private destination the operator
//   allowed; redirects are never followed; time and response size are
//   bounded.
//
// Code host requests use code/egress.ts instead (operator-listed private
// hosts by name, fetch for paginated adapters); docs/internals/agent-events.md#egress.

type EgressReason =
  | "invalid_url"
  | "blocked_address"
  | "dns"
  | "timeout"
  | "tls_error"
  | "connection_refused"
  | "network";

export class EgressError extends Error {
  constructor(
    readonly reason: EgressReason,
    message: string,
  ) {
    super(message);
    this.name = "EgressError";
  }
}

// --------------------------------------------------------------- addresses

type Range = [bigint, bigint, number];

function ipv4Number(address: string): bigint | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function ipv6Number(address: string): bigint | undefined {
  let text = address.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // An embedded IPv4 tail (::ffff:10.0.0.1) becomes two groups.
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const v4 = ipv4Number(tail[2]!);
    if (v4 === undefined) return undefined;
    text = `${tail[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

const v4 = (cidr: string): Range => {
  const [base, bits] = cidr.split("/");
  return [ipv4Number(base!)!, BigInt(32 - Number(bits)), 4];
};
const v6 = (cidr: string): Range => {
  const [base, bits] = cidr.split("/");
  return [ipv6Number(base!)!, BigInt(128 - Number(bits)), 6];
};
const inRange = (value: bigint, [base, hostBits]: Range) =>
  value >> hostBits === base >> hostBits;

// Never a webhook: this machine's identity and credentials (link-local,
// cloud metadata), addresses that mean "any" or "everyone", and ranges
// reserved for documentation and the future.
const forbidden: Range[] = [
  v4("0.0.0.0/8"),
  v4("169.254.0.0/16"),
  v4("192.0.0.0/24"),
  v4("192.0.2.0/24"),
  v4("198.51.100.0/24"),
  v4("203.0.113.0/24"),
  v4("224.0.0.0/4"),
  v4("240.0.0.0/4"),
  v6("::/128"),
  v6("fe80::/10"),
  v6("ff00::/8"),
  v6("2001:db8::/32"),
  v6("fd00:ec2::254/128"),
];
// Only with the operator's permission: loopback and private networks.
const privateRanges: Range[] = [
  v4("10.0.0.0/8"),
  v4("100.64.0.0/10"),
  v4("127.0.0.0/8"),
  v4("172.16.0.0/12"),
  v4("192.168.0.0/16"),
  v4("198.18.0.0/15"),
  v6("::1/128"),
  v6("fc00::/7"),
];
// IPv4 carried in IPv6 (mapped, NAT64) is judged as the IPv4 address.
const embedding: Range[] = [v6("::ffff:0:0/96"), v6("64:ff9b::/96")];

type AddressClass = "public" | "private" | "forbidden";

export function classifyAddress(address: string): AddressClass {
  const family = isIP(address.replace(/^\[|\]$/g, "").split("%")[0]!);
  if (family === 4) {
    const value = ipv4Number(address)!;
    const ranges = forbidden.filter((r) => r[2] === 4);
    if (ranges.some((r) => inRange(value, r))) return "forbidden";
    return privateRanges.some((r) => r[2] === 4 && inRange(value, r))
      ? "private"
      : "public";
  }
  if (family === 6) {
    const value = ipv6Number(address);
    if (value === undefined) return "forbidden";
    if (embedding.some((r) => inRange(value, r))) {
      const low = Number(value & 0xffffffffn);
      return classifyAddress(
        [low >>> 24, (low >>> 16) & 255, (low >>> 8) & 255, low & 255].join(
          ".",
        ),
      );
    }
    if (forbidden.some((r) => r[2] === 6 && inRange(value, r)))
      return "forbidden";
    return privateRanges.some((r) => r[2] === 6 && inRange(value, r))
      ? "private"
      : "public";
  }
  return "forbidden";
}

// Names that only make sense on a private network (or this machine).
function privateName(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    !host.includes(".") ||
    /\.(?:internal|local|lan|home\.arpa|svc|cluster\.local)$/.test(host)
  );
}

export type EgressPolicy = {
  // The operator allows private networks (self-hosted agents on the LAN).
  allowPrivateNetworks?: boolean;
};

export function allowPrivateNetworksFromEnv(
  environment: Environment = process.env,
) {
  return (
    envBoolean("AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS", environment) ?? false
  );
}

const refusedAddress = (what: string, policy: EgressPolicy) =>
  new EgressError(
    "blocked_address",
    policy.allowPrivateNetworks
      ? `${what} is a link-local, metadata or reserved address, which webhooks never reach.`
      : `${what} is not a public internet address. Webhooks reach public hosts only, unless the operator allows private networks (AGENT_EVENTS_ALLOW_PRIVATE_NETWORKS).`,
  );

function judge(address: string, what: string, policy: EgressPolicy) {
  const kind = classifyAddress(address);
  if (
    kind === "forbidden" ||
    (kind === "private" && !policy.allowPrivateNetworks)
  )
    throw refusedAddress(what, policy);
  return kind;
}

// Checks a destination URL before it is stored and again before every
// request. Returns the normalized URL.
export function checkDestinationUrl(raw: string, policy: EgressPolicy = {}) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new EgressError(
      "invalid_url",
      "Enter a full URL, starting with https://.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new EgressError("invalid_url", "Webhook URLs use https.");
  if (url.username || url.password)
    throw new EgressError(
      "invalid_url",
      "Put credentials in the secret, not in the URL.",
    );
  if (url.hash)
    throw new EgressError("invalid_url", "Webhook URLs have no #fragment.");
  if (url.href.length > 2048)
    throw new EgressError("invalid_url", "This URL is too long.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host) !== 0;
  if (literal) judge(host, host, policy);
  else if (privateName(host) && !policy.allowPrivateNetworks)
    throw refusedAddress(host, policy);
  const privateDestination = literal
    ? classifyAddress(host) === "private"
    : privateName(host);
  if (
    url.protocol === "http:" &&
    !(policy.allowPrivateNetworks && privateDestination)
  )
    throw new EgressError(
      "invalid_url",
      "Webhook URLs use https. Plain http is accepted only for private-network destinations the operator allows.",
    );
  return url;
}

// --------------------------------------------------------------- requests

export type Resolver = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    ),
  );

type EgressRequest = {
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  // The response body is read up to this many bytes.
  maxResponseBytes?: number;
};

type EgressResponse = {
  status: number;
  body: string;
  truncated: boolean;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE = 64 * 1024;

function classifyError(error: unknown): EgressError {
  if (error instanceof EgressError) return error;
  const code = (error as { code?: string }).code ?? "";
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ECONNREFUSED" || code === "ECONNRESET")
    return new EgressError(
      "connection_refused",
      "The receiver refused the connection.",
    );
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NONAME")
    return new EgressError("dns", "The webhook's host name does not resolve.");
  if (
    /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO|DEPTH_ZERO|SELF_SIGNED|ERR_OSSL)/.test(
      code,
    ) ||
    /certificate|tls|ssl/i.test(message)
  )
    return new EgressError("tls_error", `TLS failed: ${message.slice(0, 200)}`);
  return new EgressError("network", message.slice(0, 300));
}

// Sends one request under the rules above. Non-2xx answers (redirects
// included) are returned, never followed; the caller decides.
export function egressRequest(
  raw: string,
  request: EgressRequest,
  policy: EgressPolicy & { resolve?: Resolver } = {},
): Promise<EgressResponse> {
  let url: URL;
  try {
    url = checkDestinationUrl(raw, policy);
  } catch (error) {
    return Promise.reject(
      error instanceof Error
        ? error
        : new EgressError("invalid_url", String(error)),
    );
  }
  const resolve = policy.resolve ?? systemResolver;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = request.maxResponseBytes ?? DEFAULT_MAX_RESPONSE;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise<EgressResponse>((settle, fail) => {
    let finished = false;
    const done = (error: unknown, response?: EgressResponse) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) fail(classifyError(error));
      else settle(response!);
    };
    const timer = setTimeout(() => {
      req?.destroy();
      done(
        new EgressError(
          "timeout",
          `No answer within ${Math.round(timeoutMs / 1000)} seconds.`,
        ),
      );
    }, timeoutMs);
    // The vetted lookup: every address of the name is judged and the
    // connection goes to one of them, so the name is resolved exactly once.
    const lookup = (
      name: string,
      options: { all?: boolean },
      callback: (...args: unknown[]) => void,
    ) => {
      resolve(name).then(
        (addresses) => {
          try {
            if (!addresses.length)
              throw new EgressError(
                "dns",
                "The webhook's host name does not resolve.",
              );
            for (const a of addresses) judge(a.address, name, policy);
            if (options?.all) callback(null, addresses);
            else callback(null, addresses[0]!.address, addresses[0]!.family);
          } catch (error) {
            callback(error);
          }
        },
        (error: unknown) => callback(error),
      );
    };
    const client = url.protocol === "https:" ? https : http;
    let req: http.ClientRequest | undefined;
    try {
      req = client.request(
        {
          protocol: url.protocol,
          hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: request.method ?? "POST",
          headers: {
            "user-agent": "Lictory-Webhooks/1",
            ...(request.body !== undefined
              ? { "content-length": String(Buffer.byteLength(request.body)) }
              : {}),
            ...request.headers,
          },
          servername: isIP(hostname) ? undefined : hostname,
          lookup: lookup as never,
          agent: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          res.on("data", (chunk: Buffer) => {
            if (truncated) return;
            size += chunk.length;
            if (size > limit) {
              truncated = true;
              chunks.push(chunk.subarray(0, chunk.length - (size - limit)));
              res.destroy();
              done(null, {
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
                truncated,
              });
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            done(null, {
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
            }),
          );
          res.on("error", (error) => done(error));
        },
      );
    } catch (error) {
      done(error);
      return;
    }
    req.on("error", (error) => done(error));
    if (request.body !== undefined) req.end(request.body);
    else req.end();
  });
}
