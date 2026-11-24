// Which desktop download suits the visitor's computer, from what the browser
// says about itself. Pure: the download page reads the browser, this decides.
// A guess only promotes one download; every download stays listed.

export type DesktopOs = "macos" | "windows" | "linux";
export type DesktopArch = "x64" | "arm64";

export type DetectedSystem =
  /** A computer the desktop app is built for; `arch` when the browser says. */
  | { kind: "computer"; os: DesktopOs; arch: DesktopArch | null }
  /** A phone or tablet: the desktop app is for computers. */
  | { kind: "mobile" }
  /** A Chromebook: no desktop app is built for ChromeOS. */
  | { kind: "chromeos" }
  | { kind: "unknown" };

/** What the browser exposes: `navigator` and User-Agent Client Hints. */
export type BrowserHints = {
  userAgent: string;
  /** `navigator.platform` (deprecated, still the only hint in Safari). */
  platform?: string;
  maxTouchPoints?: number;
  /** `navigator.userAgentData` (Chromium), with its high-entropy values once read. */
  userAgentData?: {
    platform?: string;
    mobile?: boolean;
    architecture?: string;
    bitness?: string;
  };
};

function architecture({
  userAgent,
  userAgentData,
}: BrowserHints): DesktopArch | null {
  // Chromium's reduced User-Agent string always says "x86_64" on Linux and
  // "Win64; x64" on Windows, even on arm64; only the client hint is accurate.
  const hinted = userAgentData?.architecture?.toLowerCase();
  if (hinted && userAgentData?.bitness !== "32") {
    if (hinted === "arm") return "arm64";
    if (hinted === "x86") return "x64";
  }
  if (/\b(aarch64|arm64|armv8)/i.test(userAgent)) return "arm64";
  if (/\b(x86_64|x86-64|x64|amd64|win64|wow64)\b/i.test(userAgent))
    return "x64";
  return null;
}

/** The visitor's system, or why no desktop download is promoted. */
export function detectSystem(hints: BrowserHints): DetectedSystem {
  const { userAgent, platform = "", maxTouchPoints = 0 } = hints;
  const hinted = hints.userAgentData?.platform?.toLowerCase() ?? "";
  if (
    hints.userAgentData?.mobile ||
    hinted === "android" ||
    hinted === "ios" ||
    /Android|iPhone|iPad|iPod|Mobile|Silk\//.test(userAgent) ||
    // iPadOS asks for desktop sites as a Mac, but a Mac has no touch screen.
    (platform.startsWith("Mac") && maxTouchPoints > 1)
  )
    return { kind: "mobile" };
  if (
    hinted === "chrome os" ||
    hinted === "chromeos" ||
    /\bCrOS\b/.test(userAgent)
  )
    return { kind: "chromeos" };
  const computer = (os: DesktopOs): DetectedSystem => ({
    kind: "computer",
    os,
    // One universal app runs on Apple silicon and Intel alike, and Safari
    // reports "MacIntel" on both, so a Mac's architecture is never needed.
    arch: os === "macos" ? null : architecture(hints),
  });
  if (
    hinted === "windows" ||
    /Windows NT|Win64|Win32/.test(userAgent) ||
    platform.startsWith("Win")
  )
    return computer("windows");
  if (
    hinted === "macos" ||
    /Macintosh|Mac OS X/.test(userAgent) ||
    platform.startsWith("Mac")
  )
    return computer("macos");
  if (
    hinted === "linux" ||
    /Linux|X11/.test(userAgent) ||
    platform.startsWith("Linux")
  )
    return computer("linux");
  return { kind: "unknown" };
}

/** The read of `navigator` the download page uses, before high-entropy hints. */
export function browserHints(navigator: Navigator): BrowserHints {
  const data = (
    navigator as Navigator & {
      userAgentData?: { platform?: string; mobile?: boolean };
    }
  ).userAgentData;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    ...(data
      ? { userAgentData: { platform: data.platform, mobile: data.mobile } }
      : {}),
  };
}
