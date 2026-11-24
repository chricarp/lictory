import type { ReactNode } from "react";

import {
  latestReleaseUrl,
  repositoryReleasesUrl,
} from "@lictory/core/release/downloads";
import { JsonLd } from "@lictory/marketing/components/json-ld";
import { DownloadHero } from "@lictory/marketing/components/download/download-hero";
import {
  Breadcrumbs,
  MarketingPage,
  PageHeading,
  TryLictory,
} from "@lictory/marketing/components/marketing/page";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";
import {
  checksumFiles,
  desktopDownloads,
  desktopSystems,
  runnerBinaries,
  runnerInstallCommands,
  runnerScripts,
} from "@lictory/marketing/content/downloads";
import {
  desktopDocsUrl,
  downloadPath,
  runnerDocsUrl,
} from "@lictory/marketing/lib/get-started";
import { publicPageMetadata } from "@lictory/marketing/lib/public-metadata";
import { absoluteUrl, publicPage } from "@lictory/marketing/lib/site";
import {
  publicPageStructuredData,
  schemaIds,
  webPageId,
} from "@lictory/marketing/lib/structured-data";

export const metadata = publicPageMetadata(downloadPath);

const tracking = {
  cta: "download",
  placement: "list",
  page: "download",
} as const;

const textLink =
  "text-foreground underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground";

const buttonLink =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-card px-4 text-[13px] font-medium text-foreground shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.05)] transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60";

/** One file: what it is, its name, and a plain link to it. */
function FileRow({
  label,
  detail,
  file,
  href,
}: {
  label: string;
  detail?: string;
  file: string;
  href: string;
}) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-foreground">{label}</p>
        {detail ? (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {detail}
          </p>
        ) : null}
        <p className="mt-1 font-mono text-[12px] [overflow-wrap:anywhere] text-muted-foreground">
          {file}
        </p>
      </div>
      <TrackedLink href={href} tracking={tracking} className={buttonLink}>
        Download<span className="sr-only"> {label}</span>
      </TrackedLink>
    </li>
  );
}

function Files({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-4 divide-y divide-border border-y border-border">
      {children}
    </ul>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mt-16 scroll-mt-24"
    >
      <h2
        id={`${id}-title`}
        className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-[15px] leading-7 text-foreground/80 sm:text-base sm:leading-8">
      {children}
    </p>
  );
}

function Command({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 text-[13px] leading-6">
      <code>{children}</code>
    </pre>
  );
}

export default function DownloadPage() {
  const { title, description } = publicPage(downloadPath);
  return (
    <MarketingPage page="download">
      <Breadcrumbs
        items={[{ name: "Lictory", href: "/" }, { name: "Download" }]}
      />
      <PageHeading title={title} lead={description} />
      <DownloadHero />
      <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
        Every link downloads the newest stable release from GitHub.{" "}
        <a href={latestReleaseUrl} className={textLink}>
          What changed in it
        </a>
      </p>

      <Section id="desktop" title="Desktop app">
        <Lead>
          Your team’s Lictory servers in one window, with native notifications,
          a badge and <code>lictory://</code> links. The app asks for the
          address of your team’s server and signs in as the browser does.{" "}
          <a href={desktopDocsUrl} className={textLink}>
            Install and connect it
          </a>
        </Lead>
        {desktopSystems.map(({ os, name }) => (
          <div key={os} className="mt-8">
            <h3 className="text-lg font-medium">{name}</h3>
            <Files>
              {desktopDownloads
                .filter((download) => download.os === os)
                .map((download) => (
                  <FileRow key={download.id} {...download} />
                ))}
            </Files>
          </div>
        ))}
      </Section>

      <Section id="runner" title="lictory-runner">
        <Lead>
          Runs your agents’ sessions on a server, a VPS, a laptop or a Mac. To
          add a runner, copy the command from <strong>Factory → Runners</strong>{" "}
          in your Lictory: it installs your server’s version and registers the
          runner in one step. To install the newest stable release by hand:
        </Lead>
        {runnerInstallCommands.map(({ id, label, shell, command }) => (
          <div key={id} className="mt-6">
            <h3 className="text-[15px] font-medium">
              {label}{" "}
              <span className="font-normal text-muted-foreground">
                ({shell})
              </span>
            </h3>
            <Command>{command}</Command>
          </div>
        ))}
        <Lead>
          The installer checks the binary against the release’s checksums.{" "}
          <a href={runnerDocsUrl} className={textLink}>
            Register and run a runner
          </a>
        </Lead>
        <div className="mt-8">
          <h3 className="text-lg font-medium">Binaries and installers</h3>
          <Files>
            {[...runnerBinaries, ...runnerScripts].map((file) => (
              <FileRow key={file.file} {...file} />
            ))}
          </Files>
        </div>
      </Section>

      <Section id="verify" title="Check a download">
        <Lead>
          <code>SHA256SUMS</code> lists the SHA-256 of every file in the
          release, and the release workflow signs it. In the folder of your
          download:
        </Lead>
        <Command>sha256sum --check --ignore-missing SHA256SUMS</Command>
        <Files>
          {checksumFiles.map((file) => (
            <FileRow key={file.file} {...file} />
          ))}
        </Files>
        <Lead>
          <a href={latestReleaseUrl} className={textLink}>
            Release notes of the newest release
          </a>{" "}
          ·{" "}
          <a href={repositoryReleasesUrl} className={textLink}>
            Every release, including nightlies
          </a>
        </Lead>
      </Section>

      <TryLictory page="download" title="No Lictory server yet?">
        The desktop app and runners connect to your team’s own Lictory server.
        Try it on your computer with one command first.
      </TryLictory>
      <JsonLd
        data={publicPageStructuredData(downloadPath, {
          nodes: [
            {
              "@type": "SoftwareApplication",
              "@id": absoluteUrl(`${downloadPath}#desktop-app`),
              name: "Lictory desktop app",
              description:
                "The Lictory desktop app: your team’s Lictory servers in one window, with native notifications, a badge and lictory:// links.",
              applicationCategory: "BusinessApplication",
              operatingSystem: "macOS, Windows, Linux",
              downloadUrl: desktopDownloads.map((download) => download.href),
              license: "https://opensource.org/license/mit",
              isAccessibleForFree: true,
              mainEntityOfPage: { "@id": webPageId(downloadPath) },
              publisher: { "@id": schemaIds.organization },
            },
          ],
        })}
      />
    </MarketingPage>
  );
}
