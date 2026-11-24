"use client";

import { ArrowDown, Download } from "lucide-react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { CtaLink } from "@lictory/marketing/components/marketing/cta-link";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";
import {
  desktopDownloads,
  desktopSystems,
  otherSystems,
  primaryDownload,
  type DesktopDownload,
} from "@lictory/marketing/content/downloads";
import {
  browserHints,
  detectSystem,
  type DetectedSystem,
} from "@lictory/marketing/lib/download-platform";

type HighEntropyValues = {
  platform?: string;
  mobile?: boolean;
  architecture?: string;
  bitness?: string;
};
type UserAgentData = {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<HighEntropyValues>;
};

// Nothing to subscribe to: a browser does not change its system.
const noSubscription = () => () => undefined;

/**
 * The visitor's system: `null` in the server's HTML and while hydrating (the
 * page then offers every system), the User-Agent's answer right after, and
 * Chromium's architecture hint once it arrives (its User-Agent string says
 * x64 even on arm64). Nothing leaves the browser.
 */
function useDetectedSystem(): DetectedSystem | null {
  // A string, so the snapshot compares equal between renders.
  const fromUserAgent = useSyncExternalStore(
    noSubscription,
    () => JSON.stringify(detectSystem(browserHints(navigator))),
    () => null,
  );
  const [refined, setRefined] = useState<DetectedSystem | null>(null);
  useEffect(() => {
    const data = (navigator as Navigator & { userAgentData?: UserAgentData })
      .userAgentData;
    if (!data?.getHighEntropyValues) return;
    let current = true;
    data.getHighEntropyValues(["architecture", "bitness"]).then(
      (values) => {
        if (!current) return;
        setRefined(
          detectSystem({
            ...browserHints(navigator),
            userAgentData: {
              platform: values.platform ?? data.platform,
              mobile: values.mobile ?? data.mobile,
              architecture: values.architecture,
              bitness: values.bitness,
            },
          }),
        );
      },
      // Without the hint, the User-Agent's answer stands.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  return (
    refined ??
    (fromUserAgent ? (JSON.parse(fromUserAgent) as DetectedSystem) : null)
  );
}

const tracking = {
  cta: "download",
  placement: "hero",
  page: "download",
} as const;

const textLink =
  "font-medium text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground";

/** The download for this computer, or a choice when it cannot be told. */
export function DownloadHero() {
  const system = useDetectedSystem();
  const primary = system ? primaryDownload(system) : null;
  return (
    <section
      aria-label="Download the desktop app"
      data-system={primary?.id ?? system?.kind ?? "pending"}
      className="mt-10 rounded-xl border border-border bg-card p-6 sm:p-8"
    >
      {primary ? (
        <Promoted download={primary} />
      ) : system?.kind === "mobile" ? (
        <Note>
          The desktop app is for computers: macOS, Windows and Linux. Open this
          page on your computer to download it, or pick a file below. On a phone
          or tablet, use your team’s Lictory in the browser.
        </Note>
      ) : system?.kind === "chromeos" ? (
        <Note>
          There is no desktop app for ChromeOS: use your team’s Lictory in
          Chrome. Every download for macOS, Windows and Linux is listed below.
        </Note>
      ) : (
        <Choice />
      )}
    </section>
  );
}

function Promoted({ download }: { download: DesktopDownload }) {
  const deb =
    download.os === "linux"
      ? desktopDownloads.find(
          (item) =>
            item.file ===
            (download.file === "Lictory-linux-arm64.AppImage"
              ? "lictory_arm64.deb"
              : "lictory_amd64.deb"),
        )
      : undefined;
  return (
    <>
      <CtaLink
        href={download.href}
        tracking={tracking}
        size="lg"
        className="w-full sm:w-auto"
      >
        <Download aria-hidden className="size-4" />
        Download for {download.system}
      </CtaLink>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        {download.detail}{" "}
        <code className="text-[12px] [overflow-wrap:anywhere]">
          {download.file}
        </code>
      </p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {deb ? (
          <>
            Prefer a package?{" "}
            <TrackedLink
              href={deb.href}
              tracking={tracking}
              className={textLink}
            >
              {deb.label}
            </TrackedLink>
            .{" "}
          </>
        ) : null}
        Not on {desktopSystems.find(({ os }) => os === download.os)!.name}?
        Download for{" "}
        {otherSystems(download).map(({ name, download: other }, index) => (
          <span key={other.id}>
            {index > 0 ? " or " : null}
            <TrackedLink
              href={other.href}
              tracking={tracking}
              className={textLink}
            >
              {name}
            </TrackedLink>
          </span>
        ))}
        , or <AllDownloads />.
      </p>
    </>
  );
}

/** Without JavaScript, or when the browser does not say: every system. */
function Choice() {
  return (
    <>
      <p className="text-[15px] font-medium">Choose your system</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {desktopSystems.map(({ os, name }) => {
          const download = desktopDownloads.find((item) => item.os === os)!;
          return (
            <CtaLink
              key={os}
              href={download.href}
              tracking={tracking}
              size="lg"
              variant="secondary"
              className="w-full sm:w-auto"
            >
              <Download aria-hidden className="size-4" />
              {name}
            </CtaLink>
          );
        })}
      </div>
      <p className="mt-4 text-sm leading-6 text-muted-foreground">
        Linux gets the x64 AppImage here; arm64 and the .deb packages for Debian
        and Ubuntu are in <AllDownloads />.
      </p>
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <>
      <p className="text-[15px] leading-7">{children}</p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        <a href="#desktop" className={textLink}>
          Every download
          <ArrowDown aria-hidden className="ml-1 inline size-3.5" />
        </a>
      </p>
    </>
  );
}

function AllDownloads() {
  return (
    <a href="#desktop" className={textLink}>
      the list of every download
    </a>
  );
}
