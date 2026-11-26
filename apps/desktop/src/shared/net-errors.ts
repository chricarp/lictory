// Chromium's network errors (net::ERR_CONNECTION_REFUSED and the like) in
// plain words: what happened and what the person can do next. The code
// itself is kept as a detail for an administrator, never as the message.

export type NetworkProblem = {
  summary: string;
  next: string;
  // The Chromium error name, e.g. ERR_CONNECTION_REFUSED, when known.
  code: string | null;
};

// did-fail-load reports a number and usually the name as well.
const names: Record<number, string> = {
  [-7]: "ERR_TIMED_OUT",
  [-21]: "ERR_NETWORK_CHANGED",
  [-100]: "ERR_CONNECTION_CLOSED",
  [-101]: "ERR_CONNECTION_RESET",
  [-102]: "ERR_CONNECTION_REFUSED",
  [-104]: "ERR_CONNECTION_FAILED",
  [-105]: "ERR_NAME_NOT_RESOLVED",
  [-106]: "ERR_INTERNET_DISCONNECTED",
  [-109]: "ERR_ADDRESS_UNREACHABLE",
  [-118]: "ERR_CONNECTION_TIMED_OUT",
  [-130]: "ERR_PROXY_CONNECTION_FAILED",
  [-137]: "ERR_NAME_RESOLUTION_FAILED",
  [-312]: "ERR_UNSAFE_PORT",
  [-324]: "ERR_EMPTY_RESPONSE",
};

export function networkErrorCode(
  error: string | number | null | undefined,
): string | null {
  if (typeof error === "number") return names[error] ?? null;
  return error?.match(/ERR_[A-Z0-9_]+/)?.[0] ?? null;
}

const askAdministrator = "If it continues, ask your administrator.";

export function describeNetworkError(
  error: string | number | null | undefined,
  host: string,
): NetworkProblem {
  const code =
    networkErrorCode(error) ??
    (typeof error === "number" ? `error ${error}` : null);
  const problem = (summary: string, next: string) => ({ summary, next, code });
  switch (code) {
    case "ERR_INTERNET_DISCONNECTED":
      return problem(
        "This computer is offline.",
        "Check your Wi-Fi or network cable. Lictory loads the server again when you are back online.",
      );
    case "ERR_NETWORK_CHANGED":
      return problem(
        "The network connection changed while the server was loading.",
        "Lictory tries again by itself once the network is stable.",
      );
    case "ERR_NAME_NOT_RESOLVED":
    case "ERR_NAME_RESOLUTION_FAILED":
      return problem(
        `No server named ${host} could be found.`,
        "Check the address for typos. If the server is on your company's network, connect to that network or its VPN.",
      );
    case "ERR_CONNECTION_REFUSED":
      return problem(
        `${host} refused the connection.`,
        `The server may be down or restarting, or the port in the address may be wrong. ${askAdministrator}`,
      );
    case "ERR_TIMED_OUT":
    case "ERR_CONNECTION_TIMED_OUT":
    case "ERR_CONNECTION_FAILED":
    case "ERR_ADDRESS_UNREACHABLE":
      return problem(
        `${host} did not answer.`,
        `Check your network connection or VPN. ${askAdministrator}`,
      );
    case "ERR_CONNECTION_RESET":
    case "ERR_CONNECTION_CLOSED":
    case "ERR_CONNECTION_ABORTED":
    case "ERR_EMPTY_RESPONSE":
      return problem(
        `The connection to ${host} was interrupted.`,
        `Try again in a moment. ${askAdministrator}`,
      );
    case "ERR_UNSAFE_PORT":
      return problem(
        `${host} uses a port that Lictory never opens, for safety.`,
        "Use the address you open Lictory at in your browser, usually without a port number.",
      );
  }
  if (code?.startsWith("ERR_CERT_"))
    return problem(
      `The security certificate of ${host} is not trusted on this computer.`,
      "Lictory never skips this check. Ask your administrator: a company certificate authority must be trusted by your operating system.",
    );
  if (code?.startsWith("ERR_SSL_") || code === "ERR_BAD_SSL_CLIENT_AUTH_CERT")
    return problem(
      `A secure connection to ${host} could not be set up.`,
      "Ask your administrator to check the server's HTTPS setup.",
    );
  if (code?.includes("PROXY") || code === "ERR_TUNNEL_CONNECTION_FAILED")
    return problem(
      `Your proxy could not connect Lictory to ${host}.`,
      "Check your system's proxy settings, or ask your administrator.",
    );
  return problem(
    `${host} could not be loaded.`,
    `Check your network connection or VPN. ${askAdministrator}`,
  );
}
